/**
 * @layer Application Layer —— SocialService（关注/粉丝关系）
 * @file api/services/social.ts
 *
 * 数据主权：follows 表唯一写方。
 * 关注切换与点赞同模式：INSERT 撞 uq_follow 唯一索引（ER_DUP_ENTRY）→ 已关注 → DELETE 取关，
 * 并发下两个相同 INSERT 只有一个成功（参照 community.ts toggleLike，design/arch-v5.md §4.4）。
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { follows, users } from "@db/schema";
import { getDataSource, isDupEntry, timedRead } from "../infra";

/**
 * 关注/取关切换（原子去重，消除并发竞态）。
 * 不能关注自己；目标用户不存在时 NOT_FOUND（不泄露额外信息）。
 */
export async function toggleFollow(userId: number, targetUserId: number): Promise<{ following: boolean }> {
  if (userId === targetUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能关注自己" });
  }
  const db = getDataSource().write();
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
  }
  try {
    await db.insert(follows).values({ followerId: userId, followeeId: targetUserId });
  } catch (err) {
    if (!isDupEntry(err)) throw err;
    // 已关注 → 取关：DELETE 靠唯一索引定位，并发下只有一方能删除成功
    await db.delete(follows).where(and(eq(follows.followerId, userId), eq(follows.followeeId, targetUserId)));
    return { following: false };
  }
  return { following: true };
}

/** 关注统计：{ followers 粉丝数, following 关注数 } */
export async function followStats(userId: number): Promise<{ followers: number; following: number }> {
  const [followers, following] = await Promise.all([
    timedRead("follows.followers", (db) =>
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(follows)
        .where(eq(follows.followeeId, userId)),
    ),
    timedRead("follows.following", (db) =>
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(follows)
        .where(eq(follows.followerId, userId)),
    ),
  ]);
  return {
    followers: Number(followers[0]?.count ?? 0),
    following: Number(following[0]?.count ?? 0),
  };
}

/** 是否已关注目标用户 */
export async function isFollowing(userId: number, targetUserId: number): Promise<boolean> {
  const rows = await timedRead("follows.is_following", (db) =>
    db
      .select({ id: follows.id })
      .from(follows)
      .where(and(eq(follows.followerId, userId), eq(follows.followeeId, targetUserId)))
      .limit(1),
  );
  return rows.length > 0;
}

/** 关注状态（帖子详情页作者行）：是否已关注 + 目标用户粉丝数 */
export async function followState(
  userId: number,
  targetUserId: number,
): Promise<{ following: boolean; followers: number }> {
  const [following, stats] = await Promise.all([isFollowing(userId, targetUserId), followStats(targetUserId)]);
  return { following, followers: stats.followers };
}

/** 我关注的全部作者 id（QY-COMM-008：关注流召回 + 推荐关注加权；recommendService 侧走 60s 缓存） */
export async function followeeIds(userId: number): Promise<number[]> {
  const rows = await timedRead("follows.followee_ids", (db) =>
    db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, userId)),
  );
  return rows.map((r) => Number(r.id));
}

/** 粉丝/关注列表项（QY-E-003）：isFollowingBack = 当前访问者是否已关注该用户（匿名恒 false） */
export interface FollowListItem {
  id: number;
  name: string;
  avatar: string;
  isFollowingBack: boolean;
}

const FOLLOW_LIST_LIMIT = 100;

interface FollowJoinRow {
  id: number | bigint;
  name: string | null;
  avatar: string | null;
}

/** 批量补齐 isFollowingBack：viewerId 为空（匿名）→ 全部 false，不打库 */
async function withFollowingBack(rows: FollowJoinRow[], viewerId: number | null): Promise<FollowListItem[]> {
  const ids = rows.map((r) => Number(r.id));
  let back = new Set<number>();
  if (viewerId != null && ids.length > 0) {
    const rel = await timedRead("follows.following_back", (db) =>
      db
        .select({ id: follows.followeeId })
        .from(follows)
        .where(and(eq(follows.followerId, viewerId), inArray(follows.followeeId, ids))),
    );
    back = new Set(rel.map((r) => Number(r.id)));
  }
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name ?? "钓友",
    avatar: r.avatar ?? "/avatar-1.png",
    isFollowingBack: back.has(Number(r.id)),
  }));
}

/** 粉丝列表：关注我的人，按关注时间倒序，上限 100 */
export async function followersList(userId: number, viewerId: number | null): Promise<FollowListItem[]> {
  const rows = await timedRead("follows.followers_list", (db) =>
    db
      .select({ id: users.id, name: users.name, avatar: users.avatar })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followerId))
      .where(eq(follows.followeeId, userId))
      .orderBy(desc(follows.createdAt))
      .limit(FOLLOW_LIST_LIMIT),
  );
  return withFollowingBack(rows, viewerId);
}

/** 关注列表：我关注的人，按关注时间倒序，上限 100 */
export async function followingList(userId: number, viewerId: number | null): Promise<FollowListItem[]> {
  const rows = await timedRead("follows.following_list", (db) =>
    db
      .select({ id: users.id, name: users.name, avatar: users.avatar })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followeeId))
      .where(eq(follows.followerId, userId))
      .orderBy(desc(follows.createdAt))
      .limit(FOLLOW_LIST_LIMIT),
  );
  return withFollowingBack(rows, viewerId);
}
