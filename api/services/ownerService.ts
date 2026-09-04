/**
 * @layer Application Layer —— OwnerDashboardService（塘主看板：订单/营收/核销统计）
 * @file api/services/ownerService.ts
 *
 * 读路径走 AnalyticsStore Port（§4.5：当日实时聚合 + owner_stats_daily 汇总表物化，
 * 未来改打 ClickHouse 业务零改动）；结果缓存 15s。
 * 同时注册 order.created / order.verified 消费者，实时增量更新当日汇总行。
 */
import { desc, eq, sql } from "drizzle-orm";
import { orders, ponds, ticketTypes } from "@db/schema";
import { getAnalytics, getCache, getDataSource, getQueue, timedRead } from "../infra";

/** 塘主端看板（对外契约与原 ownerStats 一致） */
export async function ownerStats() {
  const cache = getCache();
  return cache.getOrSet("owner:stats:today", 15, async () => {
    // 当日实时聚合：仅统计今天（DB 会话时区 CURDATE()，与 analytics 的 DATE_FORMAT 口径一致）；
    // used 口径 = 已核销（used）+ 已完结（completed），不含退款单。
    const stats = await getAnalytics().query<{
      today: string;
      totalOrders: number | string;
      totalAmount: number | string;
      usedCount: number | string;
    }>(
      `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today,
              COUNT(*) AS totalOrders,
              COALESCE(SUM(total_amount), 0) AS totalAmount,
              COALESCE(SUM(CASE WHEN status IN ('used','completed') THEN 1 ELSE 0 END), 0) AS usedCount
       FROM orders
       WHERE created_at >= CURDATE()`,
    );
    const pendingRows = await timedRead("orders.pending", (db) =>
      db
        .select({ order: orders, pondName: ponds.name, ticketName: ticketTypes.name })
        .from(orders)
        .innerJoin(ponds, eq(orders.pondId, ponds.id))
        .innerJoin(ticketTypes, eq(orders.ticketTypeId, ticketTypes.id))
        .where(eq(orders.status, "pending"))
        .orderBy(desc(orders.createdAt))
        .limit(20),
    );
    return {
      today: stats[0]?.today ?? "",
      totalOrders: Number(stats[0]?.totalOrders ?? 0),
      totalAmount: Number(stats[0]?.totalAmount ?? 0),
      usedCount: Number(stats[0]?.usedCount ?? 0),
      pendingList: pendingRows.map((r) => ({ ...r.order, pondName: r.pondName, ticketName: r.ticketName })),
    };
  });
}

// ============ 订单事件消费者：增量更新当日汇总（物化视图的实时增量，定时全量重算兜底） ============
let consumersRegistered = false;

export function registerOrderConsumers(): void {
  if (consumersRegistered) return;
  consumersRegistered = true;
  const db = getDataSource().write();

  // 批量消费（消费端批处理）：整批事件按 (pondId, day) 聚合成少量 UPSERT，
  // 避免逐事件 handler 在高并发下把连接池打爆（曾导致 verify/create P95 > 10s）
  getQueue().subscribeBatch(
    "order.created",
    async (events) => {
      const agg = new Map<number, { orders: number; gmv: number }>();
      for (const e of events) {
        const { pondId, amount } = e.payload as { pondId: number; amount: number };
        const a = agg.get(pondId) ?? { orders: 0, gmv: 0 };
        a.orders += 1;
        a.gmv += amount ?? 0;
        agg.set(pondId, a);
      }
      // 日记账统一用 DB 会话时区（CURDATE()），与 refreshMaterialized 的 DATE_FORMAT 口径一致
      await Promise.all(
        [...agg].map(([pondId, a]) =>
          db.execute(sql`
            INSERT INTO owner_stats_daily (pond_id, day, orders, gmv, used_cnt)
            VALUES (${pondId}, CURDATE(), ${a.orders}, ${a.gmv}, 0)
            ON DUPLICATE KEY UPDATE orders = orders + ${a.orders}, gmv = gmv + ${a.gmv}
          `),
        ),
      );
      await getCache().del("owner:stats:today");
    },
    { chunkSize: 500 },
  );

  getQueue().subscribeBatch(
    "order.verified",
    async (events) => {
      const orderIds = events
        .map((e) => (e.payload as { orderId?: number }).orderId)
        .filter((id): id is number => typeof id === "number");
      if (orderIds.length === 0) return;
      // used_cnt 按订单【下单日】记账，与 refreshMaterialized 全量重算口径一致
      // （此前按核销日记账会被每日重算覆盖，两条路径语义互相冲突）。
      // 日口径用 DB 会话时区 DATE_FORMAT（与 analytics.ts 一致），不再用 JS UTC 日。
      const rows = (await db.execute(
        sql`SELECT id, pond_id, DATE_FORMAT(created_at, '%Y-%m-%d') AS day FROM orders WHERE id IN (${sql.join(
          orderIds.map((id) => sql`${id}`),
          sql.raw(","),
        )})`,
      )) as unknown as [[{ id: number; pond_id: number | string; day: string }]];
      const agg = new Map<string, { pondId: number; day: string; n: number }>();
      for (const r of rows[0] ?? []) {
        const pondId = Number(r.pond_id);
        const day = String(r.day).slice(0, 10);
        const key = `${pondId}|${day}`;
        const a = agg.get(key) ?? { pondId, day, n: 0 };
        a.n += 1;
        agg.set(key, a);
      }
      await Promise.all(
        [...agg.values()].map((a) =>
          db.execute(sql`
            INSERT INTO owner_stats_daily (pond_id, day, orders, gmv, used_cnt)
            VALUES (${a.pondId}, ${a.day}, 0, 0, ${a.n})
            ON DUPLICATE KEY UPDATE used_cnt = used_cnt + ${a.n}
          `),
        ),
      );
      await getCache().del("owner:stats:today");
    },
    { chunkSize: 500 },
  );

  scheduleDailyRefresh();
}

/**
 * 每日 02:00 全量重算 owner_stats_daily（arch §4.5"每小时重算"的最小落地：日粒度对账兜底）。
 * 重算与增量消费同口径（均按下单日），幂等 UPSERT 覆盖，消除语义互相覆盖问题。
 */
let refreshScheduled = false;

function scheduleDailyRefresh(): void {
  if (refreshScheduled) return;
  refreshScheduled = true;
  const now = Date.now();
  const next = new Date();
  next.setHours(2, 0, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  const run = () => {
    getAnalytics()
      .refreshMaterialized("owner_stats_daily")
      .catch((e) => console.warn("[ownerStats] daily refresh failed:", e));
  };
  setTimeout(() => {
    run();
    setInterval(run, 24 * 3600 * 1000);
  }, next.getTime() - now);
}

registerOrderConsumers();
