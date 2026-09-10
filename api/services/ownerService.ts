/**
 * @layer Application Layer —— OwnerDashboardService（塘主看板：订单/营收/核销统计）
 * @file api/services/ownerService.ts
 *
 * 读路径走 AnalyticsStore Port（§4.5：当日实时聚合 + owner_stats_daily 汇总表物化，
 * 未来改打 ClickHouse 业务零改动）；结果缓存 15s。
 * 同时注册 order.created / order.verified 消费者，实时增量更新当日汇总行。
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { orders, ownerStatsDaily, ponds, ticketTypes } from "@db/schema";
import { getAnalytics, getCache, getDataSource, getQueue, timedRead } from "../infra";
import { verifyOrder, type VerifyResult } from "./trade";
import { canManagePond, myPonds, type OwnerUser } from "./ownerBinding";

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

// ============ #6 多钓场绑定：作用域收紧版看板/核销 ============

/** 核销（作用域版，#6）：先按核销码查出订单所属钓场（只读不核销），
 *  无权管理该钓场 → FORBIDDEN「该订单不属于你管理的钓场」；通过再委托 trade.verifyOrder 完成核销。 */
export async function verifyOrderScoped(user: OwnerUser, code: string): Promise<VerifyResult> {
  const rows = await timedRead("orders.verifyScope", (db) =>
    db.select({ pondId: orders.pondId }).from(orders).where(eq(orders.verifyCode, code)).limit(1),
  );
  const pondId = rows[0]?.pondId;
  if (pondId === undefined || !(await canManagePond(user, pondId))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "该订单不属于你管理的钓场" });
  }
  return verifyOrder(code);
}

/** 塘主看板（作用域版，#6）：admin 未指定钓场时沿用全站 ownerStats；
 *  绑定塘主 / admin 指定钓场时按 pond_id IN (作用域) 过滤，返回结构与 ownerStats 一致。 */
export async function ownerStatsScoped(user: OwnerUser, pondId?: number) {
  if (user.role === "admin" && pondId === undefined) return ownerStats();
  // 作用域集合：admin 指定单钓场 = [pondId]；绑定塘主 = 绑定集合（传 pondId 时取交集，集合外 = 空看板）
  const bound = (await myPonds(user)).map((p) => p.id);
  const scope =
    user.role === "admin"
      ? [pondId as number]
      : pondId !== undefined
        ? bound.filter((id) => id === pondId)
        : bound;
  const cache = getCache();
  // 缓存 key 带 userId + pondId：不同塘主的作用域看板互相隔离，TTL 与全站看板一致 15s
  return cache.getOrSet(`owner:stats:today:u${user.id}:p${pondId ?? "all"}`, 15, async () => {
    if (scope.length === 0) {
      // 未绑定任何钓场：空看板（today 口径与全站一致，DB 会话时区）
      const t = await getAnalytics().query<{ today: string }>(
        `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today`,
      );
      return { today: t[0]?.today ?? "", totalOrders: 0, totalAmount: 0, usedCount: 0, pendingList: [] as never[] };
    }
    // 与 ownerStats 同口径的当日实时聚合，仅追加 pond_id IN 过滤
    const statRows = await timedRead("ownerStats.scoped", (db) =>
      db
        .select({
          today: sql<string>`DATE_FORMAT(CURDATE(), '%Y-%m-%d')`,
          totalOrders: sql<number>`COUNT(*)`,
          totalAmount: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
          usedCount: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} IN ('used','completed') THEN 1 ELSE 0 END), 0)`,
        })
        .from(orders)
        .where(and(sql`${orders.createdAt} >= CURDATE()`, inArray(orders.pondId, scope))),
    );
    const pendingRows = await timedRead("orders.pending.scoped", (db) =>
      db
        .select({ order: orders, pondName: ponds.name, ticketName: ticketTypes.name })
        .from(orders)
        .innerJoin(ponds, eq(orders.pondId, ponds.id))
        .innerJoin(ticketTypes, eq(orders.ticketTypeId, ticketTypes.id))
        .where(and(eq(orders.status, "pending"), inArray(orders.pondId, scope)))
        .orderBy(desc(orders.createdAt))
        .limit(20),
    );
    const stats = statRows[0];
    return {
      today: stats?.today ?? "",
      totalOrders: Number(stats?.totalOrders ?? 0),
      totalAmount: Number(stats?.totalAmount ?? 0),
      usedCount: Number(stats?.usedCount ?? 0),
      pendingList: pendingRows.map((r) => ({ ...r.order, pondName: r.pondName, ticketName: r.ticketName })),
    };
  });
}

// ============ #7 经营周报：接 owner_stats_daily 物化汇总表 ============

export interface OwnerWeeklyDay {
  day: string;
  orders: number;
  gmv: number;
  usedCnt: number;
}

export interface OwnerWeeklyResult {
  /** 最近 7 个完整日（不含今天），按日升序；表无数据的日补 0 */
  days: OwnerWeeklyDay[];
  totals: { orders: number; gmv: number; usedCnt: number };
  /** 再往前 7 天合计（环比基线） */
  prevWeekTotals: { orders: number; gmv: number; usedCnt: number };
}

/** 从 startDay（YYYY-MM-DD）起枚举 count 个连续日（纯字符串日粒度，与 DB 记账口径对齐） */
function enumerateDays(startDay: string, count: number): string[] {
  const out: string[] = [];
  const t = Date.parse(`${startDay}T00:00:00Z`);
  for (let i = 0; i < count; i++) out.push(new Date(t + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** 经营周报（#7）：owner_stats_daily 最近 7 个完整日按日聚合 + 再前 7 天环比。
 *  day 是 varchar 'YYYY-MM-DD'，直接字符串比较；边界以 DB 会话时区 CURDATE() 为准。
 *  绑定塘主按 pond_id IN (绑定集合) 过滤；admin 全站（传 pondId 可锁定单钓场）。 */
export async function ownerWeekly(user: OwnerUser, pondId?: number): Promise<OwnerWeeklyResult> {
  const bound = user.role === "admin" ? null : (await myPonds(user)).map((p) => p.id);
  // scope=null 表示全站不过滤；绑定塘主传集合外 pondId → 空集合（全 0 返回）
  const scope: number[] | null =
    user.role === "admin"
      ? pondId !== undefined
        ? [pondId]
        : null
      : pondId !== undefined
        ? (bound as number[]).filter((id) => id === pondId)
        : bound;

  const zeroTotals = { orders: 0, gmv: 0, usedCnt: 0 };

  // 日边界：本周窗口 [today-7, today-1]，环比窗口 [today-14, today-8]（DB 会话时区）
  const bounds = await getAnalytics().query<{ startDay: string; endDay: string; prevStart: string; prevEnd: string }>(
    `SELECT DATE_FORMAT(CURDATE() - INTERVAL 7 DAY, '%Y-%m-%d') AS startDay,
            DATE_FORMAT(CURDATE() - INTERVAL 1 DAY, '%Y-%m-%d') AS endDay,
            DATE_FORMAT(CURDATE() - INTERVAL 14 DAY, '%Y-%m-%d') AS prevStart,
            DATE_FORMAT(CURDATE() - INTERVAL 8 DAY, '%Y-%m-%d') AS prevEnd`,
  );
  const b = bounds[0];
  if (!b || (scope !== null && scope.length === 0)) {
    // 未绑定钓场：结构完整的全 0 周报
    return { days: b ? enumerateDays(b.startDay, 7).map((day) => ({ day, ...zeroTotals })) : [], totals: { ...zeroTotals }, prevWeekTotals: { ...zeroTotals } };
  }

  // 一次查询取 14 天按日聚合（GMV/订单/核销均为 SUM；day 字符串直接比较）
  const rows = await timedRead("ownerStats.weekly", (db) =>
    db
      .select({
        day: ownerStatsDaily.day,
        orders: sql<number>`COALESCE(SUM(${ownerStatsDaily.orders}), 0)`,
        gmv: sql<number>`COALESCE(SUM(${ownerStatsDaily.gmv}), 0)`,
        usedCnt: sql<number>`COALESCE(SUM(${ownerStatsDaily.usedCnt}), 0)`,
      })
      .from(ownerStatsDaily)
      .where(
        and(
          gte(ownerStatsDaily.day, b.prevStart),
          lte(ownerStatsDaily.day, b.endDay),
          scope !== null ? inArray(ownerStatsDaily.pondId, scope) : undefined,
        ),
      )
      .groupBy(ownerStatsDaily.day),
  );
  const byDay = new Map(rows.map((r) => [r.day, { orders: Number(r.orders), gmv: Number(r.gmv), usedCnt: Number(r.usedCnt) }]));

  // 本周 7 日明细（缺日补 0，升序供前端柱状图）
  const days = enumerateDays(b.startDay, 7).map((day) => ({ day, ...(byDay.get(day) ?? zeroTotals) }));
  const totals = days.reduce((acc, d) => ({ orders: acc.orders + d.orders, gmv: acc.gmv + d.gmv, usedCnt: acc.usedCnt + d.usedCnt }), { ...zeroTotals });
  // 环比基线：前 7 天合计
  const prevWeekTotals = enumerateDays(b.prevStart, 7).reduce(
    (acc, day) => {
      const v = byDay.get(day) ?? zeroTotals;
      return { orders: acc.orders + v.orders, gmv: acc.gmv + v.gmv, usedCnt: acc.usedCnt + v.usedCnt };
    },
    { ...zeroTotals },
  );
  return { days, totals, prevWeekTotals };
}
