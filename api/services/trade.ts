/**
 * @layer Application Layer —— OrderService（下单/核销/退款状态机，强一致 + 幂等）
 * @file api/services/trade.ts
 *
 * 数据主权：orders 表唯一写方。SSOT 永远 TiDB（架构红线）。
 * P0 修复（design/arch-v5.md §4.2/§4.3/§5.4）：
 * - 下单：idempotency_key 幂等 + withTx 事务 + 金额服务端重算 + 座位行锁 + 按日占用冲突检查 + 同事务 outbox 事件
 * - 核销：单条 CAS UPDATE `WHERE verify_code=? AND status='pending'`，并发只有一方影响 1 行
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { orders, outboxEvents, ponds, reviews, ticketTypes, type Order } from "@db/schema";
import { getDataSource, getQueue, isDupEntry, timedRead } from "../infra";
import { invalidatePondCache, occupiedSeats } from "./pond";
import { pushNotification } from "./notify";

function genVerifyCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

export interface CreateOrderInput {
  pondSlug: string;
  ticketTypeId: number;
  visitDate: string;
  quantity: number;
  seatNos: number[];
  /** 前端金额仅作展示参考，服务端不信任、按 ticketTypes.price × quantity 重算 */
  totalAmount: number;
  /** 客户端幂等键（ULID）；缺省时服务端生成（兼容旧前端） */
  idempotencyKey?: string;
}

/** 下单（幂等 + 事务 + 防超卖）。重复提交（同 idempotencyKey）返回原单。 */
export async function createOrder(userId: number, input: CreateOrderInput): Promise<{ orderId: number }> {
  const ds = getDataSource();
  const idemKey = input.idempotencyKey ?? `srv-${randomUUID()}`;

  // 座位数必须与票数一致（1 票 1 位；前端按 quantity 选座）
  if (input.seatNos.length !== input.quantity) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "钓位数量必须与购票数量一致" });
  }

  // 1. 幂等快路径：命中直接返回原单
  const [dup] = await ds.read().select({ id: orders.id }).from(orders).where(eq(orders.idempotencyKey, idemKey)).limit(1);
  if (dup) return { orderId: dup.id };

  try {
    return await ds.withTx(async (tx) => {
      // 2. 校验钓场/票种（合并为 1 次 LEFT JOIN，原 2 次串行 RT 减半），金额服务端重算（不信任前端 totalAmount）
      //    LEFT JOIN 保留错误语义：行不存在 → 钓场不存在；ticketId 为 NULL → 票种不存在/不属于该钓场
      const ptRes = await tx.execute(sql`
        SELECT p.id AS pondId, t.id AS ticketId, t.price AS price
        FROM ponds p
        LEFT JOIN ticket_types t ON t.id = ${input.ticketTypeId} AND t.pond_id = p.id
        WHERE p.slug = ${input.pondSlug}
        LIMIT 1
      `);
      const pt = (ptRes as unknown as [[{ pondId: number | null; ticketId: number | null; price: number | null }]])[0]?.[0];
      if (!pt || pt.pondId === null) throw new Error("钓场不存在");
      if (pt.ticketId === null || pt.price === null) throw new Error("票种不存在");
      const pond = { id: Number(pt.pondId) };
      const ticket = { price: Number(pt.price) };

      // 3. 钓位占用冲突检查（按 (pondId, visitDate, seatNo) 维度；不再使用 seats.is_sold 全局 CAS——
      //    该列只进不出，约一个班次后钓位会被永久锁死）。
      //    先对目标座位行加 FOR UPDATE 行锁，串行化并发下单，再做冲突判定（替代原 CAS 的互斥作用）。
      if (input.seatNos.length > 0) {
        await tx.execute(
          sql`SELECT id FROM seats WHERE pond_id = ${pond.id} AND seat_no IN (${sql.join(
            input.seatNos.map((n) => sql`${n}`),
            sql.raw(","),
          )}) FOR UPDATE`,
        );
        const occupied = await occupiedSeats(tx, pond.id, input.visitDate);
        if (input.seatNos.some((n) => occupied.has(n))) {
          throw new TRPCError({ code: "CONFLICT", message: "所选钓位当日已被预订" });
        }
      }

      // 4. 落单（verify_code 唯一索引兜底重试一次）
      const amount = ticket.price * input.quantity;
      let orderId: number | null = null;
      for (let attempt = 0; attempt < 2 && orderId === null; attempt++) {
        try {
          const [row] = await tx
            .insert(orders)
            .values({
              userId,
              pondId: pond.id,
              ticketTypeId: input.ticketTypeId,
              visitDate: input.visitDate,
              quantity: input.quantity,
              seatNos: input.seatNos,
              totalAmount: amount,
              verifyCode: genVerifyCode(),
              idempotencyKey: idemKey,
              status: "pending",
            })
            .$returningId();
          orderId = row.id;
        } catch (err) {
          if (attempt === 0 && String(err).includes("verify_code")) continue; // 核销码碰撞，换码重试
          throw err;
        }
      }
      if (orderId === null) throw new Error("下单失败，请重试");

      // 5. Outbox 事件与业务写同事务提交（不丢事件；dispatcher 恢复路径会捞起派发）
      await tx.insert(outboxEvents).values({
        eventId: randomUUID(),
        topic: "order.created",
        payload: { orderId, userId, pondId: pond.id, amount },
        status: "pending",
      });
      return { orderId };
    });
  } catch (err) {
    // 幂等键并发冲突：另一请求已落单，返回原单（唯一索引兜底）
    if (String(err).includes("idempotency_key")) {
      const [existing] = await ds
        .read()
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.idempotencyKey, idemKey))
        .limit(1);
      if (existing) return { orderId: existing.id };
    }
    throw err;
  } finally {
    await invalidatePondCache(); // 写后失效（钓位占用变更）
  }
}

/** 我的订单（命中 idx_orders_user_created 复合索引） */
export async function myOrders(userId: number) {
  const rows = await timedRead("orders.mine", (db) =>
    db
      .select({ order: orders, pondName: ponds.name, pondSlug: ponds.slug, ticketName: ticketTypes.name })
      .from(orders)
      .innerJoin(ponds, eq(orders.pondId, ponds.id))
      .innerJoin(ticketTypes, eq(orders.ticketTypeId, ticketTypes.id))
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt)),
  );
  return rows.map((r) => ({ ...r.order, pondName: r.pondName, pondSlug: r.pondSlug, ticketName: r.ticketName }));
}

export type VerifiedOrder = Order & { pondName: string; ticketName: string };
export type VerifyResult = { ok: true; order: VerifiedOrder } | { ok: false; reason: string };

/** 核销：单条 CAS UPDATE（状态机 pending→used），天然幂等；并发只有一方成功。
 *  过期票（visit_date 早于 DB 会话时区今天）不可核销。 */
export async function verifyOrder(code: string): Promise<VerifyResult> {
  const db = getDataSource().write();
  const res = await db.execute(
    sql`UPDATE orders SET status = 'used', used_at = NOW()
        WHERE verify_code = ${code} AND status = 'pending' AND visit_date >= CURDATE()`,
  );
  if (affectedRows(res) === 1) {
    const found = await db
      .select({ order: orders, pondName: ponds.name, ticketName: ticketTypes.name })
      .from(orders)
      .innerJoin(ponds, eq(orders.pondId, ponds.id))
      .innerJoin(ticketTypes, eq(orders.ticketTypeId, ticketTypes.id))
      .where(eq(orders.verifyCode, code))
      .limit(1);
    // CAS 已命中 1 行，此处理论上必有行；仍判空兜底（防脏读/删库边界下裸 500）
    if (!found[0]) return { ok: false, reason: "核销状态异常，请重试" };
    await getQueue().publish("order.verified", { code, orderId: found[0].order.id });
    // 消息中心：通知订单用户门票已核销（失败不阻断核销主流程）
    try {
      await pushNotification(
        {
          userId: found[0].order.userId,
          type: "verify",
          actorName: "塘主",
          refId: found[0].order.id,
          preview: `你的门票（核销码 ${code}）已核销`,
        },
        db,
      );
    } catch {
      // 通知失败不阻断主流程
    }
    return { ok: true, order: { ...found[0].order, pondName: found[0].pondName, ticketName: found[0].ticketName } };
  }
  // affected=0 → 查当前状态给出幂等语义化的失败原因（含过期判定，DB 会话时区口径）
  const rows = (await db.execute(
    sql`SELECT status, visit_date, (visit_date < CURDATE()) AS expired FROM orders WHERE verify_code = ${code} LIMIT 1`,
  )) as unknown as [[{ status: string; visit_date: string; expired: number | string }?]];
  const o = rows[0]?.[0];
  if (!o) return { ok: false, reason: "核销码不存在" };
  if (o.status === "pending" && Number(o.expired) === 1) return { ok: false, reason: "该票已过期，不可核销" };
  return { ok: false, reason: "该票已核销或已退款" };
}

/** 退款（MVP 无真实支付渠道/商户资质，退款即状态迁移，refundAmount 供前端展示）。
 *  状态机：pending→refunded，单条 CAS UPDATE，并发只有一方成功；
 *  已 refunded 幂等返回成功（不重复退）；used/completed 不可退。
 *  退款后钓位自动释放：occupiedSeats 占用口径仅统计 pending/used，refunded 自然不占。 */
export async function refundOrder(
  userId: number,
  orderId: number,
): Promise<{ orderId: number; refundAmount: number }> {
  const db = getDataSource().write();
  // 本人订单限定：查不到视为不存在（不泄露他人订单存在性，写法对照 reviewOrder）
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
  // 幂等快路径：已退款直接返回成功，不重复退
  if (o.status === "refunded") return { orderId: o.id, refundAmount: o.totalAmount };
  if (o.status !== "pending") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "已核销订单不可退款" });
  }

  // 单条 CAS UPDATE（状态机 pending→refunded）：并发只有一方影响 1 行（写法对照 verifyOrder）
  const res = await db.execute(sql`UPDATE orders SET status = 'refunded' WHERE id = ${orderId} AND status = 'pending'`);
  if (affectedRows(res) === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "订单状态已变更，请刷新后重试" });
  }

  await invalidatePondCache(); // 写后失效（钓位占用释放）
  await getQueue().publish("order.refunded", { orderId: o.id, userId, pondId: o.pondId, amount: o.totalAmount });
  // 消息中心：通知用户退款已受理（失败不阻断退款主流程，写法对照 verifyOrder）
  try {
    await pushNotification(
      {
        userId,
        type: "refund",
        actorName: "系统",
        refId: o.id,
        preview: `你的门票退款已受理，金额 ¥${o.totalAmount}`,
      },
      db,
    );
  } catch {
    // 通知失败不阻断主流程
  }
  return { orderId: o.id, refundAmount: o.totalAmount };
}

/** 订单评价（核销后）；写后失效钓场缓存。
 *  IDOR 修复：仅本人订单可评、仅 status='used' 可评、重复评价返回 CONFLICT。 */
export async function reviewOrder(
  userId: number,
  authorName: string,
  input: { orderId: number; rating: number; content: string; tags: string[]; images: string[] },
): Promise<void> {
  const db = getDataSource().write();
  // 本人订单限定：查不到视为不存在（不泄露他人订单存在性）
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.userId, userId)))
    .limit(1);
  if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
  if (o.status !== "used") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "订单未核销不可评价" });
  }
  try {
    await db.insert(reviews).values({
      orderId: input.orderId,
      pondId: o.pondId,
      userId,
      authorName,
      rating: input.rating,
      content: input.content,
      tags: input.tags,
      images: input.images,
    });
  } catch (err) {
    // reviews.order_id 唯一索引：重复评价 → 明确 CONFLICT，而非裸 500
    if (isDupEntry(err)) throw new TRPCError({ code: "CONFLICT", message: "已评价过" });
    throw err;
  }
  await db.update(orders).set({ status: "completed" }).where(eq(orders.id, input.orderId));
  await invalidatePondCache();
}
