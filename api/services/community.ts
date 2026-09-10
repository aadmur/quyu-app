/**
 * @layer Application Layer —— CommunityService（帖子互动：点赞/评论/鱼讯）
 * @file api/services/community.ts
 *
 * 数据主权：likes / comments 表唯一写方。
 * P0 修复：点赞由「SELECT-then-INSERT 竞态」改为 INSERT IGNORE + affectedRows 分支
 *（uq_like 唯一索引去重，计数 UPDATE 原子累加，见 design/arch-v5.md §4.4）。
 */
import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { toDataURL as qrToDataURL } from "qrcode";
import { comments, fishNews, likes, ponds, posts } from "@db/schema";
import { getCache, getDataSource, getQueue, isDupEntry, timedRead } from "../infra";
import { pushNotification } from "./notify";
import { assertContentAllowed, createSystemReport } from "./contentFilter";

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

/**
 * 点赞/取消点赞（原子去重 + 计数，消除并发计数漂移）。
 * 插入撞 uq_like 唯一索引（ER_DUP_ENTRY）→ 已赞过 → DELETE 并 -1；成功则 +1。
 * 并发下两个相同 INSERT 只有一个成功，计数不漂移（design/arch-v5.md §4.4）。
 */
export async function toggleLike(userId: number, postId: number, actorName = "钓友"): Promise<{ liked: boolean }> {
  const db = getDataSource().write();
  try {
    await db.insert(likes).values({ userId, postId });
  } catch (err) {
    if (!isDupEntry(err)) throw err;
    // 取消点赞：DELETE 靠唯一索引定位，并发下只有一方能删除成功
    const del = await db.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId)));
    if (affectedRows(del) === 1) {
      await db
        .update(posts)
        .set({ likeCount: sql`GREATEST(${posts.likeCount} - 1, 0)` })
        .where(eq(posts.id, postId));
    }
    return { liked: false };
  }
  await db.update(posts).set({ likeCount: sql`${posts.likeCount} + 1` }).where(eq(posts.id, postId));
  await getQueue().publish("community.post.liked", { userId, postId });
  // 与原实现对齐：点赞同时记行为事件（异步画像更新）
  await getQueue().publish("tracking.user_event", { userId, postId, action: "like", durationMs: 0 });
  // 消息中心：通知帖子作者（失败不阻断点赞主流程）
  try {
    const [post] = await db
      .select({ authorId: posts.authorId, content: posts.content })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (post?.authorId) {
      await pushNotification(
        { userId: post.authorId, type: "like", actorName, actorId: userId, refId: postId, preview: post.content.slice(0, 50) },
        db,
      );
    }
  } catch {
    // 通知失败不阻断主流程
  }
  return { liked: true };
}

/** 发表评论（计数原子累加 + 事件入队 + 通知帖子作者）；parentId 存在时为楼中楼回复并通知被回复者 */
export async function addComment(
  userId: number,
  postId: number,
  content: string,
  authorName: string,
  actorName?: string,
  parentId?: number,
): Promise<void> {
  const db = getDataSource().write();
  // 内容前置过滤（QY-SAFE-002）：违禁词 reject 直接抛错不落库；广告词 flag 照常发表、事后写系统举报
  const filter = assertContentAllowed(content, "comment", userId);
  // 楼中楼（QY-COMM-006）：回复须指向同帖评论；回复「回复」时挂到其顶层评论（最多两层）
  let effectiveParentId: number | null = null;
  let replyToUserId: number | null = null;
  if (parentId != null) {
    const [parent] = await db
      .select({ id: comments.id, postId: comments.postId, userId: comments.userId, parentId: comments.parentId })
      .from(comments)
      .where(eq(comments.id, parentId))
      .limit(1);
    if (!parent || Number(parent.postId) !== postId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在或已删除" });
    }
    effectiveParentId = parent.parentId != null ? Number(parent.parentId) : Number(parent.id);
    replyToUserId = parent.userId != null ? Number(parent.userId) : null;
  }
  await db.insert(comments).values({ postId, userId, authorName, content, parentId: effectiveParentId });
  await db.update(posts).set({ commentCount: sql`${posts.commentCount} + 1` }).where(eq(posts.id, postId));
  await getQueue().publish("community.post.commented", { userId, postId });
  // 与原实现对齐：评论同时记行为事件（异步画像更新）
  await getQueue().publish("tracking.user_event", { userId, postId, action: "comment", durationMs: 0 });
  // 消息中心：回复通知被回复者（reply），顶层评论通知帖子作者（comment）；失败不阻断评论主流程
  try {
    if (replyToUserId != null) {
      await pushNotification(
        { userId: replyToUserId, type: "reply", actorName: actorName ?? authorName, actorId: userId, refId: postId, preview: content.slice(0, 50) },
        db,
      );
    } else {
      const [post] = await db
        .select({ authorId: posts.authorId })
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);
      if (post?.authorId) {
        await pushNotification(
          { userId: post.authorId, type: "comment", actorName: actorName ?? authorName, actorId: userId, refId: postId, preview: content.slice(0, 50) },
          db,
        );
      }
    }
  } catch {
    // 通知失败不阻断主流程
  }
  // 广告词命中（QY-SAFE-002）：评论已落库，对被举报帖写一条系统举报进审核队列（best-effort，内部容错）
  if (filter.action === "flag" && filter.hit) {
    await createSystemReport({ postId, authorId: userId, hit: filter.hit, kind: "comment", excerpt: content.slice(0, 20) });
  }
}

/** 评论列表（命中 idx_comments_post_created 复合索引，消除 filesort） */
export async function listComments(postId: number) {
  return timedRead("comments.list", (db) =>
    db.select().from(comments).where(eq(comments.postId, postId)).orderBy(desc(comments.createdAt)).limit(50),
  );
}

/** 单帖详情（帖子详情页）；软删帖返回 null，由路由层抛 404 */
export async function getPost(postId: number) {
  const rows = await timedRead("posts.detail", (db) =>
    db.select().from(posts).where(and(eq(posts.id, postId), isNull(posts.deletedAt))).limit(1),
  );
  return rows[0] ?? null;
}

/** 最新鱼讯（全站 10 条，联查钓场名） */
export async function listNews() {
  return timedRead("news.list", (db) =>
    db
      .select({ id: fishNews.id, content: fishNews.content, createdAt: fishNews.createdAt, pondName: ponds.name, pondSlug: ponds.slug })
      .from(fishNews)
      .innerJoin(ponds, eq(fishNews.pondId, ponds.id))
      .orderBy(desc(fishNews.createdAt))
      .limit(10),
  );
}

/** 发帖（发渔获）：写入真实信息流，进入推荐召回池 */
export interface CreatePostInput {
  content: string;
  images: string[];
  pondSlug?: string;
  fishSpecies?: string;
  weightJin?: number;
  latitude?: number;
  longitude?: number;
  locationText?: string;
}
export async function createPost(
  user: { id: number; name: string; avatar: string },
  input: CreatePostInput,
) {
  const db = getDataSource().write();
  // 内容前置过滤（QY-SAFE-002）：正文 + 鱼种标签合并检查；
  // 违禁词 reject 直接抛错不落库；广告词 flag 照常发帖、事后写系统举报进审核队列
  const filter = assertContentAllowed(`${input.content} ${input.fishSpecies ?? ""}`, "post", user.id);
  // 由 pondSlug 反查 pondId（冗余列 pondSlug 直填，消除推荐召回 N+1）
  let pondId: number | null = null;
  if (input.pondSlug) {
    const [p] = await db.select({ id: ponds.id }).from(ponds).where(eq(ponds.slug, input.pondSlug));
    pondId = p?.id ?? null;
  }
  const res = await db.insert(posts).values({
    authorId: user.id,
    authorName: user.name,
    authorAvatar: user.avatar,
    content: input.content,
    images: input.images,
    pondId,
    pondSlug: input.pondSlug ?? null,
    fishSpecies: input.fishSpecies ?? null,
    weightJin: input.weightJin != null ? String(input.weightJin) : null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    locationText: input.locationText ?? null,
  });
  const insertId = ((res as unknown as [{ insertId?: number }])[0]?.insertId) ?? 0;
  const [post] = await db.select().from(posts).where(eq(posts.id, insertId));
  // 发帖后让作者立即在信息流看到：失效共享召回池 + 作者 feed 首页缓存
  await getCache().del("recall:hot", `feed:${user.id}:1:5`);
  // 广告词命中（QY-SAFE-002）：帖子已落库，写系统举报进审核队列（best-effort，内部容错）
  if (filter.action === "flag" && filter.hit) {
    await createSystemReport({ postId: insertId, authorId: user.id, hit: filter.hit, kind: "post" });
  }
  return post;
}

/** 读取本人未删除帖子：他人资源/已软删一律 NOT_FOUND，不泄露存在性 */
async function requireOwnPost(userId: number, postId: number) {
  const db = getDataSource().write();
  const [post] = await db
    .select({ id: posts.id, authorId: posts.authorId })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  if (!post || post.authorId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在或已删除" });
  }
  return post;
}

/** 删帖（QY-COMM-004）：仅作者本人；软删 CAS（WHERE deleted_at IS NULL），点赞/评论保留 */
export async function deletePost(userId: number, postId: number): Promise<{ ok: true }> {
  await requireOwnPost(userId, postId);
  const db = getDataSource().write();
  const res = await db
    .update(posts)
    .set({ deletedAt: new Date() })
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)));
  if (affectedRows(res) !== 1) {
    // 并发下已被另一请求删除
    throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在或已删除" });
  }
  // 与 createPost 同口径：失效共享召回池 + 作者 feed 首页缓存
  await getCache().del("recall:hot", `feed:${userId}:1:5`);
  return { ok: true };
}

/** 编辑帖子（QY-COMM-004）：仅作者本人；仅更新传入字段 */
export interface EditPostInput {
  content?: string;
  images?: string[];
  fishSpecies?: string;
  weightJin?: number;
}
export async function editPost(userId: number, postId: number, input: EditPostInput) {
  await requireOwnPost(userId, postId);
  const db = getDataSource().write();
  // 内容前置过滤（QY-SAFE-002 补齐编辑入口）：正文/鱼种任一变更时，
  // 新文本与 createPost 同口径合并检查，堵住「先正常发帖、再编辑绕过发布过滤」的口子。
  // 违禁 reject 直接抛错（编辑不落库）；广告 flag 照常保存、事后幂等写系统举报。
  const filter =
    input.content !== undefined || input.fishSpecies !== undefined
      ? assertContentAllowed(`${input.content ?? ""} ${input.fishSpecies ?? ""}`, "post", userId)
      : null;
  const patch: Partial<typeof posts.$inferInsert> = {};
  if (input.content !== undefined) patch.content = input.content;
  if (input.images !== undefined) patch.images = input.images;
  if (input.fishSpecies !== undefined) patch.fishSpecies = input.fishSpecies;
  if (input.weightJin !== undefined) patch.weightJin = String(input.weightJin);
  if (Object.keys(patch).length > 0) {
    // CAS：仅当帖子未被软删时才允许编辑，避免与并发删除交错复活内容
    const res = await db
      .update(posts)
      .set(patch)
      .where(and(eq(posts.id, postId), isNull(posts.deletedAt)));
    if (affectedRows(res) !== 1) {
      throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在或已删除" });
    }
  }
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  // 与 createPost 同口径：失效共享召回池 + 作者 feed 首页缓存
  await getCache().del("recall:hot", `feed:${userId}:1:5`);
  // 广告词命中（QY-SAFE-002）：编辑已落库，写系统举报进审核队列。
  // 幂等由 uq_report（reporterId=作者本人, postId）保证：发帖时已系统举报过
  // 或前次编辑已举报过的帖子，重复命中不会重复写（createSystemReport 内部容错）。
  if (filter?.action === "flag" && filter.hit) {
    await createSystemReport({ postId, authorId: userId, hit: filter.hit, kind: "post" });
  }
  return post;
}

/** 帖子搜索（QY-COMM-007）：标题正文/鱼种模糊匹配，按发布时间倒序；返回结构与 feed 条目兼容 */
export async function searchPosts(keyword: string, page = 1, pageSize = 10) {
  const kw = `%${keyword.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const where = and(
    isNull(posts.deletedAt),
    or(like(posts.content, kw), like(posts.fishSpecies, kw)),
  );
  const rows = await timedRead("posts.search", (db) =>
    db
      .select()
      .from(posts)
      .where(where)
      .orderBy(desc(posts.createdAt))
      .limit(pageSize + 1) // 多取一条判定 hasMore
      .offset((page - 1) * pageSize),
  );
  const hasMore = rows.length > pageSize;
  return { items: rows.slice(0, pageSize), hasMore };
}

// ============ 渔获分享卡片（QY-COMM-009） ============

/** 分享落地页 base：默认线上地址，可用环境变量覆盖 */
const SHARE_BASE_URL = (process.env.SHARE_BASE_URL ?? "http://47.109.185.118:3000").replace(/\/$/, "");

/** 分享卡片渲染契约：前端 canvas 绘制的全部输入 */
export interface ShareCardData {
  /** 正文摘要（≤60 字，超出截断加省略号） */
  title: string;
  authorName: string;
  species: string | null;
  /** 重量（斤，decimal 原样字符串） */
  weight: string | null;
  pondName: string | null;
  /** 首图 URL（同源 /feed-x.jpg 或 /uploads/...，可能为空） */
  coverUrl: string | null;
  landingUrl: string;
  /** 落地页二维码 PNG DataURL；生成失败降级为 null，前端绘制占位框不阻断 */
  qrDataUrl: string | null;
}

/**
 * 分享卡片数据：单帖查询（不含软删），联查钓场名；二维码由纯 JS 库 qrcode 生成
 *（esbuild 打包进 bundle，生产无原生图像库也可用；纠错级 M、小 margin）。
 */
export async function getShareCard(postId: number): Promise<ShareCardData | null> {
  const post = await getPost(postId);
  if (!post) return null;

  let pondName: string | null = null;
  if (post.pondSlug) {
    const rows = await timedRead("posts.shareCardPond", (db) =>
      db
        .select({ name: ponds.name })
        .from(ponds)
        .where(eq(ponds.slug, post.pondSlug!))
        .limit(1),
    );
    pondName = rows[0]?.name ?? null;
  }

  const landingUrl = `${SHARE_BASE_URL}/post/${post.id}`;
  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await qrToDataURL(landingUrl, { margin: 1, errorCorrectionLevel: "M", width: 360 });
  } catch {
    qrDataUrl = null; // 降级路径：前端在二维码位置绘制占位框 + 链接文本
  }

  const excerpt = post.content.replace(/\s+/g, " ").trim();
  return {
    title: excerpt.length > 60 ? `${excerpt.slice(0, 60)}…` : excerpt,
    authorName: post.authorName,
    species: post.fishSpecies ?? null,
    weight: post.weightJin != null ? String(post.weightJin) : null,
    pondName,
    coverUrl: post.images?.[0] ?? null,
    landingUrl,
    qrDataUrl,
  };
}
