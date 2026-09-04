/**
 * @layer Application Layer —— CommunityService（帖子互动：点赞/评论/鱼讯）
 * @file api/services/community.ts
 *
 * 数据主权：likes / comments 表唯一写方。
 * P0 修复：点赞由「SELECT-then-INSERT 竞态」改为 INSERT IGNORE + affectedRows 分支
 *（uq_like 唯一索引去重，计数 UPDATE 原子累加，见 design/arch-v5.md §4.4）。
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { comments, fishNews, likes, ponds, posts } from "@db/schema";
import { getDataSource, getQueue, isDupEntry, timedRead } from "../infra";

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

/**
 * 点赞/取消点赞（原子去重 + 计数，消除并发计数漂移）。
 * 插入撞 uq_like 唯一索引（ER_DUP_ENTRY）→ 已赞过 → DELETE 并 -1；成功则 +1。
 * 并发下两个相同 INSERT 只有一个成功，计数不漂移（design/arch-v5.md §4.4）。
 */
export async function toggleLike(userId: number, postId: number): Promise<{ liked: boolean }> {
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
  return { liked: true };
}

/** 发表评论（计数原子累加 + 事件入队） */
export async function addComment(
  userId: number,
  postId: number,
  content: string,
  authorName: string,
): Promise<void> {
  const db = getDataSource().write();
  await db.insert(comments).values({ postId, userId, authorName, content });
  await db.update(posts).set({ commentCount: sql`${posts.commentCount} + 1` }).where(eq(posts.id, postId));
  await getQueue().publish("community.post.commented", { userId, postId });
  // 与原实现对齐：评论同时记行为事件（异步画像更新）
  await getQueue().publish("tracking.user_event", { userId, postId, action: "comment", durationMs: 0 });
}

/** 评论列表（命中 idx_comments_post_created 复合索引，消除 filesort） */
export async function listComments(postId: number) {
  return timedRead("comments.list", (db) =>
    db.select().from(comments).where(eq(comments.postId, postId)).orderBy(desc(comments.createdAt)).limit(50),
  );
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
}
export async function createPost(
  user: { id: number; name: string; avatar: string },
  input: CreatePostInput,
) {
  const db = getDataSource().write();
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
  });
  const insertId = ((res as unknown as [{ insertId?: number }])[0]?.insertId) ?? 0;
  const [post] = await db.select().from(posts).where(eq(posts.id, insertId));
  return post;
}
