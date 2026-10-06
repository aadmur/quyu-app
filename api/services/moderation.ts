/**
 * @layer Application Layer —— ModerationService（内容举报与审核，QY-SAFE-001）
 * @file api/services/moderation.ts
 *
 * 数据主权：reports 表唯一写方。
 * - 举报：撞 uq_report 唯一索引 → 幂等返回 already=true（同一人对同一目标只记一次）
 *   目标分两种：comment_id=0 举报整帖，非 0 举报该帖下的某条评论（v14）
 * - 审核：全局 admin 看全站；绑定塘主（pond_admins）只看/只处理自己钓场（posts.pond_slug）的举报
 * - 处理：CAS UPDATE status='pending' 防并发重复处理；action='delete' 时同步软删帖子（评论举报则只软删该评论，帖子不动）并通知作者
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { comments, posts, reports, users } from "@db/schema";
import { getCache, getDataSource, isDupEntry, timedRead } from "../infra";
import { pushNotification } from "./notify";
import { myPonds, type OwnerUser } from "./ownerBinding";

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

/**
 * 举报（QY-SAFE-001）：被举报帖必须存在且未删；不能举报自己的帖子；重复举报幂等。
 * commentId 省略或为 0 = 举报整帖；非 0 = 举报该帖下的某条评论（v14）。
 * comment_id 用 0 而非 NULL 承载"整帖举报"，是因为 MySQL 唯一索引里 NULL <> NULL，
 * 用 NULL 会让同一人对同帖的重复举报不再被去重。
 */
export async function reportPost(
  userId: number,
  postId: number,
  reason: string,
  commentId = 0,
): Promise<{ ok: true; already: boolean }> {
  const db = getDataSource().write();
  const [post] = await db
    .select({ id: posts.id, authorId: posts.authorId })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  if (!post) {
    throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在" });
  }
  if (commentId !== 0) {
    // 评论举报：目标必须是该帖下未被软删的真实评论，且不能举报自己的评论。
    // 归属不符一律 NOT_FOUND（与 handleReport 同口径，不泄露评论存在性）
    const [comment] = await db
      .select({ id: comments.id, authorId: comments.userId })
      .from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.postId, postId), isNull(comments.deletedAt)))
      .limit(1);
    if (!comment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在" });
    }
    if (comment.authorId != null && Number(comment.authorId) === userId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "不能举报自己的评论" });
    }
  } else if (post.authorId != null && Number(post.authorId) === userId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能举报自己的帖子" });
  }
  try {
    await db
      .insert(reports)
      .values({ reporterId: userId, postId, commentId, reason: reason.slice(0, 255) });
  } catch (err) {
    // uq_report 唯一索引：同一人已举报过同一目标 → 幂等成功
    if (!isDupEntry(err)) throw err;
    return { ok: true, already: true };
  }
  return { ok: true, already: false };
}

/** 审核队列单条：举报信息 + 被举报帖摘要（首图/正文/作者/钓场） + 举报人昵称 */
export interface ReportQueueItem {
  id: number;
  postId: number;
  reason: string;
  createdAt: Date;
  reporterId: number;
  reporterName: string | null;
  post: {
    content: string;
    authorName: string;
    /** 帖子首图，无图时为 null */
    cover: string | null;
    pondSlug: string | null;
  };
  /** 0 = 整帖举报；非 0 = 评论举报（v14） */
  commentId: number;
  /** 评论举报时的目标评论内容与作者；整帖举报为 null */
  comment: { id: number; content: string; authorName: string } | null;
}

/**
 * 审核队列（QY-SAFE-001）：
 * - 全局 admin → 全部 pending 举报
 * - 绑定塘主 → 仅其绑定钓场（pond_admins → ponds.slug）下帖子的举报
 * - 普通用户（零绑定非 admin）→ FORBIDDEN
 * 按举报时间倒序，上限 50；已软删帖的举报不再出现。
 */
export async function listReports(user: OwnerUser): Promise<ReportQueueItem[]> {
  // 作用域：admin = 全部；否则取绑定钓场 slug 集合
  let slugs: string[] | null = null;
  if (user.role !== "admin") {
    const ponds = await myPonds(user);
    if (ponds.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "仅限审核员访问" });
    }
    slugs = ponds.map((p) => p.slug);
  }
  const where = and(
    eq(reports.status, "pending"),
    isNull(posts.deletedAt),
    ...(slugs ? [inArray(posts.pondSlug, slugs)] : []),
  );
  const rows = await timedRead("reports.queue", (db) =>
    db
      .select({
        id: reports.id,
        postId: reports.postId,
        commentId: reports.commentId,
        reason: reports.reason,
        createdAt: reports.createdAt,
        reporterId: reports.reporterId,
        reporterName: users.name,
        content: posts.content,
        authorName: posts.authorName,
        // 这里刻意保留 posts 全量 images（而非 feed 的 512 字符阈值封面）：
        // 审核员必须能看到可能正是 base64 形态的那张违规原图，套阈值会让审核队列变瞎。
        images: posts.images,
        pondSlug: posts.pondSlug,
        commentContent: comments.content,
        commentAuthor: comments.authorName,
      })
      .from(reports)
      .innerJoin(posts, eq(reports.postId, posts.id))
      .leftJoin(users, eq(reports.reporterId, users.id))
      // comment_id=0（整帖举报）时自然匹配不到行，leftJoin 出 NULL；
      // 额外限定评论归属同一帖，防历史脏数据把别的帖评论拼进来看板
      .leftJoin(comments, and(eq(comments.id, reports.commentId), eq(comments.postId, reports.postId)))
      .where(where)
      .orderBy(desc(reports.createdAt))
      .limit(50),
  );
  return rows.map((r) => ({
    id: Number(r.id),
    postId: Number(r.postId),
    commentId: Number(r.commentId ?? 0),
    reason: r.reason,
    createdAt: r.createdAt,
    reporterId: Number(r.reporterId),
    reporterName: r.reporterName,
    post: {
      content: r.content,
      authorName: r.authorName,
      cover: Array.isArray(r.images) && r.images.length > 0 ? r.images[0] : null,
      pondSlug: r.pondSlug,
    },
    comment:
      r.commentId !== 0 && r.commentContent != null
        ? { id: Number(r.commentId), content: r.commentContent, authorName: r.commentAuthor ?? "" }
        : null,
  }));
}

/**
 * 处理举报（QY-SAFE-001）：
 * - 权限同 listReports；塘主处理非自己钓场的举报按 NOT_FOUND 返回（不泄露存在性）
 * - CAS：UPDATE reports SET status/handled_by/handled_at WHERE id AND status='pending'，
 *   0 行 = 已被他人处理 → CONFLICT
 * - action='delete'：同时软删帖子（CAS：deleted_at IS NULL）+ 通知作者 + 失效召回池缓存
 */
export async function handleReport(
  user: OwnerUser,
  reportId: number,
  action: "ignore" | "delete",
): Promise<{ ok: true }> {
  const db = getDataSource().write();
  const [row] = await db
    .select({
      id: reports.id,
      postId: reports.postId,
      commentId: reports.commentId,
      postAuthorId: posts.authorId,
      commentAuthorId: comments.userId,
      pondSlug: posts.pondSlug,
    })
    .from(reports)
    .innerJoin(posts, eq(reports.postId, posts.id))
    .leftJoin(comments, and(eq(comments.id, reports.commentId), eq(comments.postId, reports.postId)))
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "举报不存在" });
  }
  if (user.role !== "admin") {
    const ponds = await myPonds(user);
    if (ponds.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "仅限审核员访问" });
    }
    // 塘主越权处理他人钓场的举报：按不存在处理，不泄露存在性
    if (!row.pondSlug || !ponds.some((p) => p.slug === row.pondSlug)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "举报不存在" });
    }
  }
  // CAS 占用：仅 pending 可被处理，并发下只有一方成功
  const res = await db
    .update(reports)
    .set({ status: action === "delete" ? "actioned" : "ignored", handledBy: user.id, handledAt: new Date() })
    .where(and(eq(reports.id, reportId), eq(reports.status, "pending")));
  if (affectedRows(res) !== 1) {
    throw new TRPCError({ code: "CONFLICT", message: "该举报已被处理" });
  }
  if (action === "delete") {
    const targetCommentId = Number(row.commentId ?? 0);
    if (targetCommentId !== 0) {
      // 评论举报处置：只软删该评论，**帖子不动**。
      // 走与 deleteComment 相同的 deletedAt 语义——列表里仍会出现"该评论已删除"占位，
      // 保住楼中楼结构不塌陷；comment_count 口径＝可见口径，故不减计数。
      await db
        .update(comments)
        .set({ deletedAt: new Date() })
        .where(and(eq(comments.id, targetCommentId), isNull(comments.deletedAt)));
      try {
        if (row.commentAuthorId != null) {
          await pushNotification(
            {
              userId: Number(row.commentAuthorId),
              type: "report",
              actorName: "平台",
              refId: Number(row.postId),
              preview: "你的一条回复因违规已被下架",
            },
            db,
          );
        }
      } catch {
        // 通知失败不阻断主流程
      }
      // 评论不进 feed 召回池，无需 del("recall:hot")
      return { ok: true };
    }
    // 整帖举报：不走 deletePost（那是作者自删口径），直接软删，已删则跳过
    await db
      .update(posts)
      .set({ deletedAt: new Date() })
      .where(and(eq(posts.id, Number(row.postId)), isNull(posts.deletedAt)));
    // 通知帖子作者（失败不阻断处理主流程）
    try {
      if (row.postAuthorId != null) {
        await pushNotification(
          {
            userId: Number(row.postAuthorId),
            type: "report",
            actorName: "平台",
            refId: Number(row.postId),
            preview: "你的帖子因违规已被下架",
          },
          db,
        );
      }
    } catch {
      // 通知失败不阻断主流程
    }
    // 与 deletePost 同口径：失效共享召回池
    await getCache().del("recall:hot");
  }
  return { ok: true };
}
