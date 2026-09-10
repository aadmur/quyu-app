/**
 * @layer Application Layer —— NotifyService（消息中心通知）
 * @file api/services/notify.ts
 *
 * 数据主权：notifications 表唯一写方。
 * 事件挂钩（点赞/评论/核销）以同步插入实现，调用方 try/catch 兜底，通知失败不阻断主流程。
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { notifications, users } from "@db/schema";
import { getDataSource, timedRead, type Db } from "../infra";

export type NotificationType = "like" | "comment" | "reply" | "verify" | "refund" | "report" | "apply";

export interface PushNotificationInput {
  /** 接收者 userId */
  userId: number;
  type: NotificationType;
  /** 动作发起者昵称（核销场景固定"塘主"） */
  actorName: string;
  /** 帖子 id 或订单 id */
  refId: number;
  /** 内容摘要（截取前 50 字，此处再兜底截断一次） */
  preview: string;
  /** 发起者 userId（可选）：与接收者相同时不通知（自己给自己点赞/评论） */
  actorId?: number;
}

/**
 * 写入一条通知：接收者存在且 != 发起者才插入。
 * db 缺省时自备写连接（事件挂钩均为同事务外的事后同步插入）。
 */
export async function pushNotification(input: PushNotificationInput, db?: Db): Promise<void> {
  if (input.actorId !== undefined && input.actorId === input.userId) return;
  const w = db ?? getDataSource().write();
  const [receiver] = await w.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!receiver) return;
  await w.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    actorName: input.actorName.slice(0, 64),
    refId: input.refId,
    preview: input.preview.slice(0, 50),
  });
}

/** 通知列表（近 50 条倒序） */
export async function listNotifications(userId: number) {
  return timedRead("notify.list", (db) =>
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50),
  );
}

/** 未读数（is_read=false 计数） */
export async function unreadCount(userId: number): Promise<{ count: number }> {
  const rows = await timedRead("notify.unread", (db) =>
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false))),
  );
  return { count: Number(rows[0]?.count ?? 0) };
}

/** 全部已读：UPDATE is_read=1 WHERE user_id=? AND is_read=0 */
export async function markAllRead(userId: number): Promise<void> {
  const db = getDataSource().write();
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
}
