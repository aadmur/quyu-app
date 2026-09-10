import { and, eq, isNotNull, isNull, lt, notLike, or } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

export async function upsertUser(data: InsertUser) {
  const values = { ...data };
  const updateSet: Partial<InsertUser> = {
    lastSignInAt: new Date(),
    ...data,
  };

  // 塘主一次性授权语义：OWNER_UNION_ID 命中的账号在每次登录 upsert 时显式授予 admin
  // （独立显式判断，不依附于"调用方未显式传 role"这一隐含条件）。
  // 不提供回收路径：取消授权需直接改库（本 MVP 阶段刻意不做自助降级，文档注释说明）。
  if (env.ownerUnionId && values.unionId === env.ownerUnionId) {
    values.role = values.role ?? "admin";
    updateSet.role = "admin";
  }

  await getDb()
    .insert(schema.users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

// ============ 账号注销（QY-E-005） ============

/** 已匿名化账号的 unionId 前缀（deleted:<原id>:<时间戳>），登录查找天然不命中 */
export const DELETED_UNION_ID_PREFIX = "deleted:";

/** 申请注销：仅在未申请时写入申请时间（幂等），返回当前生效的申请时间 */
export async function requestAccountDeletion(userId: number): Promise<Date> {
  const now = new Date();
  await getDb()
    .update(schema.users)
    .set({ deletionRequestedAt: now })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletionRequestedAt)));
  const rows = await getDb()
    .select({ deletionRequestedAt: schema.users.deletionRequestedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows.at(0)?.deletionRequestedAt ?? now;
}

/** 冷静期内撤销注销（幂等：未申请时同样返回成功） */
export async function cancelAccountDeletion(userId: number): Promise<void> {
  await getDb()
    .update(schema.users)
    .set({ deletionRequestedAt: null })
    .where(eq(schema.users.id, userId));
}

/** 扫描冷静期已到期的待注销账号（排除已匿名化的 deleted: 前缀，双保险） */
export async function findUsersPendingDeletion(cutoff: Date) {
  return getDb()
    .select({ id: schema.users.id, unionId: schema.users.unionId, deletionRequestedAt: schema.users.deletionRequestedAt })
    .from(schema.users)
    .where(
      and(
        isNotNull(schema.users.deletionRequestedAt),
        lt(schema.users.deletionRequestedAt, cutoff),
        notLike(schema.users.unionId, `${DELETED_UNION_ID_PREFIX}%`),
      ),
    );
}

/**
 * 到期匿名化（不删行，保留订单/票券/帖子/评论/举报流水）：
 * unionId 改为 deleted:<id>:<ts>（旧 JWT 自然失效），昵称置「已注销用户」，个人资料字段清空；
 * 关注关系与钓场收藏物理删除（无主数据意义）。
 *
 * 注意：posts/comments/reviews 的作者名是写入时冗余列（读取路径不 join users），
 * 因此这里同步把冗余作者名改写为「已注销用户」、头像回退默认图，
 * 否则旧昵称会继续挂在社区内容上（隐私泄露）。楼中楼结构靠 parentId 维持，不受影响。
 * notifications.actorName 无 actorId 列、无法精确定位，保留历史快照（见遗留风险）。
 */
export async function anonymizeAccount(userId: number): Promise<void> {
  const db = getDb();
  await db
    .update(schema.users)
    .set({
      unionId: `${DELETED_UNION_ID_PREFIX}${userId}:${Date.now()}`,
      name: "已注销用户",
      email: null,
      avatar: null,
      bio: null,
      cover: null,
      passwordHash: null,
      deletionRequestedAt: null,
    })
    .where(eq(schema.users.id, userId));
  // 冗余作者名改写（内容保留，作者匿名）
  await db
    .update(schema.posts)
    .set({ authorName: "已注销用户", authorAvatar: "/avatar-1.png" })
    .where(eq(schema.posts.authorId, userId));
  await db
    .update(schema.comments)
    .set({ authorName: "已注销用户" })
    .where(eq(schema.comments.userId, userId));
  await db
    .update(schema.reviews)
    .set({ authorName: "已注销用户", authorAvatar: "/avatar-1.png" })
    .where(eq(schema.reviews.userId, userId));
  await db
    .delete(schema.follows)
    .where(or(eq(schema.follows.followerId, userId), eq(schema.follows.followeeId, userId)));
  await db.delete(schema.pondMarks).where(eq(schema.pondMarks.userId, userId));
}
