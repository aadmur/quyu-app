/**
 * @layer Application Layer —— ModerationService（内容举报与审核，QY-SAFE-001）
 * @file api/services/moderation.ts
 *
 * 数据主权：reports 表唯一写方。
 * - 举报：撞 uq_report 唯一索引 → 幂等返回 already=true（同一人对同帖只记一次）
 * - 审核：全局 admin 看全站；绑定塘主（pond_admins）只看/只处理自己钓场（posts.pond_slug）的举报
 * - 处理：CAS UPDATE status='pending' 防并发重复处理；action='delete' 时同步软删帖子并通知作者
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { posts, reports, users } from "@db/schema";
import { getCache, getDataSource, isDupEntry, timedRead } from "../infra";
import { pushNotification } from "./notify";
import { myPonds, type OwnerUser } from "./ownerBinding";

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

/** 举报（QY-SAFE-001）：被举报帖必须存在且未删；不能举报自己的帖子；重复举报幂等 */
export async function reportPost(
  userId: number,
  postId: number,
  reason: string,
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
  if (post.authorId != null && Number(post.authorId) === userId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能举报自己的帖子" });
  }
  try {
    await db.insert(reports).values({ reporterId: userId, postId, reason: reason.slice(0, 255) });
  } catch (err) {
    // uq_report 唯一索引：同一人已举报过该帖 → 幂等成功
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
        reason: reports.reason,
        createdAt: reports.createdAt,
        reporterId: reports.reporterId,
        reporterName: users.name,
        content: posts.content,
        authorName: posts.authorName,
        images: posts.images,
        pondSlug: posts.pondSlug,
      })
      .from(reports)
      .innerJoin(posts, eq(reports.postId, posts.id))
      .leftJoin(users, eq(reports.reporterId, users.id))
      .where(where)
      .orderBy(desc(reports.createdAt))
      .limit(50),
  );
  return rows.map((r) => ({
    id: Number(r.id),
    postId: Number(r.postId),
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
      postAuthorId: posts.authorId,
      pondSlug: posts.pondSlug,
    })
    .from(reports)
    .innerJoin(posts, eq(reports.postId, posts.id))
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
    // 审核删除：不走 deletePost（那是作者自删口径），直接软删，已删则跳过
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
