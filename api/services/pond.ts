/**
 * @layer Application Layer —— PondCatalogService（钓场目录/票种/钓位/评价聚合）
 * @file api/services/pond.ts
 *
 * P0 修复：ponds.list 全表扫描 + 内存过滤 → SearchIndex 关键词检索 + 缓存；
 * detail 4 次串行查询 → Promise.all 并行 + 整页缓存（TTL 60s，写后失效）。
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { fishNews, orders, pondMarks, ponds, reviews, seats, ticketTypes, type Pond } from "@db/schema";
import { getCache, getDataSource, getSearch, isDupEntry, timedRead, type Db } from "../infra";
import { assertContentAllowed } from "./contentFilter";

/** 占座口径：同钓场、同游玩日、有效订单（pending=待核销 / used=已核销）中的 seat_nos */
export const OCCUPIED_STATUSES = ["pending", "used"] as const;

/**
 * 某钓场某日已被占用的座位号集合（占用判定的唯一口径，下单与展示共用）。
 * 不再使用 seats.is_sold 静态列：该列只进不出会永久锁死钓位，且无法表达"按日占用"。
 */
export async function occupiedSeats(db: Db, pondId: number, visitDate: string): Promise<Set<number>> {
  const rows = await db
    .select({ seatNos: orders.seatNos })
    .from(orders)
    .where(
      and(eq(orders.pondId, pondId), eq(orders.visitDate, visitDate), inArray(orders.status, [...OCCUPIED_STATUSES])),
    );
  const occupied = new Set<number>();
  for (const r of rows) for (const n of r.seatNos) occupied.add(n);
  return occupied;
}

/** 钓场列表：keyword 走 SearchIndex（FULLTEXT/LIKE），tag 精确过滤，结果缓存 30s */
export async function listPonds(input?: { keyword?: string; tag?: string }): Promise<Pond[]> {
  const cache = getCache();
  const key = await cache.taggedKey("pond", `pond:list:${input?.keyword ?? ""}:${input?.tag ?? ""}`);
  const cached = await cache.get<Pond[]>(key);
  if (cached) return cached;

  let out: Pond[];
  if (input?.keyword) {
    // 搜索走 Port：当前 SqlSearchIndex（FULLTEXT/LIKE），未来 ES 零改动。
    // 命中结果是 SELECT * 的 snake_case 原始行，不能直接当 Pond 用（fish_species 等列名不符），
    // 只取 id 列表，再用 drizzle 回表取列名映射后的行（按搜索命中顺序保序）。
    const res = await getSearch().search<{ id: number | string }>("ponds", {
      keyword: input.keyword,
      size: 100,
      sort: "rating DESC",
    });
    const hitIds = res.hits.map((h) => Number(h.id)).filter((n) => Number.isFinite(n));
    if (hitIds.length === 0) {
      out = [];
    } else {
      const mapped = await timedRead("ponds.list.search", (db) =>
        db.select().from(ponds).where(inArray(ponds.id, hitIds)),
      );
      const byId = new Map(mapped.map((p) => [p.id, p]));
      out = hitIds.map((id) => byId.get(id)).filter((p): p is Pond => p !== undefined);
    }
    // JSON 数组列（fish_species）不参与 SQL LIKE 匹配，内存补召回保持原语义
    const k = input.keyword;
    const extra = await timedRead("ponds.list.fish", (db) => db.select().from(ponds).orderBy(desc(ponds.rating)));
    const seen = new Set(out.map((p) => p.id));
    for (const p of extra) {
      if (!seen.has(p.id) && (p.fishSpecies.some((f) => f.includes(k)) || p.region.includes(k) || p.name.includes(k))) {
        out.push(p);
      }
    }
  } else {
    out = await timedRead("ponds.list", (db) => db.select().from(ponds).orderBy(desc(ponds.rating)));
  }
  if (input?.tag) out = out.filter((p) => p.tags.includes(input.tag!));
  await cache.set(key, out, 30);
  return out;
}

export interface PondDetail extends Pond {
  tickets: (typeof ticketTypes.$inferSelect)[];
  seats: (typeof seats.$inferSelect)[];
  news: (typeof fishNews.$inferSelect)[];
  reviews: (typeof reviews.$inferSelect)[];
}

/**
 * 钓场详情：整页缓存 60s（single-flight 防击穿）+ 并行查询；"none" 哨兵做空值缓存防穿透。
 * visitDate（YYYY-MM-DD）指定座位占用口径的游玩日，缺省按 DB 会话时区的"今天"（CURDATE()）。
 * seats[].isSold 由查询层按 (pondId, visitDate, seatNo) 实时计算覆盖——
 * seats.is_sold 静态列不再参与展示/下单口径（见 occupiedSeats）。
 */
export async function getPondDetail(slug: string, visitDate?: string): Promise<PondDetail | null> {
  const cache = getCache();
  const key = await cache.taggedKey("pond", `pond:detail:${slug}:${visitDate ?? "today"}`);
  const result = await cache.getOrSet(key, 60, async (): Promise<PondDetail | "none"> => {
    const db = getDataSource().read();
    const [pond] = await db.select().from(ponds).where(eq(ponds.slug, slug)).limit(1);
    if (!pond) return "none";
    // 占用日与并行查询同时开始：无 visitDate 时用 DB 会话时区 CURDATE()（与统计口径一致）
    const dayPromise: Promise<string> = visitDate
      ? Promise.resolve(visitDate)
      : db
          .execute(sql`SELECT CURDATE() AS d`)
          .then((res) => String(((res as unknown as [[{ d: string }]])[0]?.[0]?.d ?? "").slice(0, 10)));
    const [tickets, seatRows, news, reviewRows, reviewAgg, day] = await Promise.all([
      db.select().from(ticketTypes).where(eq(ticketTypes.pondId, pond.id)),
      db.select().from(seats).where(eq(seats.pondId, pond.id)),
      db.select().from(fishNews).where(eq(fishNews.pondId, pond.id)).orderBy(desc(fishNews.createdAt)).limit(5),
      db.select().from(reviews).where(eq(reviews.pondId, pond.id)).orderBy(desc(reviews.createdAt)).limit(10),
      // 对账（QY-B-002）：真实 reviews 聚合，校正 ponds.rating/review_count 历史冗余列
      db
        .select({ cnt: sql<number>`COUNT(*)`, avg: sql<string | null>`AVG(${reviews.rating})` })
        .from(reviews)
        .where(eq(reviews.pondId, pond.id)),
      dayPromise,
    ]);
    const occupied = await occupiedSeats(db, pond.id, day);
    // 查询层覆盖计算：静态 is_sold 列不再作为展示口径
    const seatList = seatRows.map((s) => ({ ...s, isSold: occupied.has(s.seatNo) }));
    // rating/reviewCount 以真实聚合为准；无真实评价时保留 ponds.rating 种子值（空集无法求均值）
    const realCount = Number(reviewAgg[0]?.cnt ?? 0);
    const realRating = realCount > 0 ? Number(reviewAgg[0]?.avg ?? 0).toFixed(1) : pond.rating;
    const pondOut = { ...pond, rating: realRating, reviewCount: realCount };
    return { ...pondOut, tickets, seats: seatList, news, reviews: reviewRows } as PondDetail;
  });
  return result === "none" ? null : result;
}

/** 评价分页结果（QY-B-002）：items 按 created_at 倒序；stats 为全量一次性聚合 */
export interface PondReviewStats {
  count: number;
  avgRating: number;
  dist: Record<1 | 2 | 3 | 4 | 5, number>;
}
export interface PondReviewPage {
  items: (typeof reviews.$inferSelect)[];
  hasMore: boolean;
  stats: PondReviewStats;
}

/**
 * 钓场评价列表（QY-B-002）：slug 反查 pondId，reviews 按 created_at 倒序分页。
 * stats 每次全量聚合（COUNT/AVG/星级分布），与分页解耦，前端首屏即得评分分布条。
 */
export async function listPondReviews(slug: string, page = 1, pageSize = 10): Promise<PondReviewPage> {
  const db = getDataSource().read();
  const [pond] = await db.select({ id: ponds.id }).from(ponds).where(eq(ponds.slug, slug)).limit(1);
  if (!pond) throw new TRPCError({ code: "NOT_FOUND", message: "钓场不存在" });
  const p = Math.max(1, Math.floor(page));
  const size = Math.min(50, Math.max(1, Math.floor(pageSize)));
  const [items, aggRows, distRows] = await Promise.all([
    db
      .select()
      .from(reviews)
      .where(eq(reviews.pondId, pond.id))
      .orderBy(desc(reviews.createdAt))
      .limit(size)
      .offset((p - 1) * size),
    db
      .select({ cnt: sql<number>`COUNT(*)`, avg: sql<string | null>`AVG(${reviews.rating})` })
      .from(reviews)
      .where(eq(reviews.pondId, pond.id)),
    db
      .select({ rating: reviews.rating, cnt: sql<number>`COUNT(*)` })
      .from(reviews)
      .where(eq(reviews.pondId, pond.id))
      .groupBy(reviews.rating),
  ]);
  const dist: PondReviewStats["dist"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of distRows) {
    const k = Math.round(Number(r.rating));
    if (k >= 1 && k <= 5) dist[k as 1 | 2 | 3 | 4 | 5] += Number(r.cnt);
  }
  const count = Number(aggRows[0]?.cnt ?? 0);
  const avgRating = count > 0 ? +Number(aggRows[0]?.avg ?? 0).toFixed(1) : 0;
  return { items, hasMore: p * size < count, stats: { count, avgRating, dist } };
}

/** 钓场侧写后失效（下单/评价后调用） */
export async function invalidatePondCache(): Promise<void> {
  await getCache().invalidateTag("pond");
}

/**
 * 塘主发布鱼讯：写入 fish_news 并失效钓场缓存（详情页鱼讯列表即时可见）。
 * 内容前置过滤（QY-SAFE-002）：违禁词 reject 直接抛错不落库。
 * 广告词 flag 时鱼讯照常落库；但 reports 表 post_id 非空且仅关联 posts（审核队列
 * innerJoin posts），fish_news 无对应帖子可挂，故鱼讯 flag 只写审计日志（命中词/用户/前 20 字），
 * 由日志告警承接人工复核——若要进审核队列需先扩展 reports 支持 fish_news（遗留项）。
 */
export async function publishNews(pondSlug: string, content: string, userId = 0) {
  const db = getDataSource().write();
  assertContentAllowed(content, "news", userId);
  const [pond] = await db.select({ id: ponds.id }).from(ponds).where(eq(ponds.slug, pondSlug)).limit(1);
  if (!pond) throw new Error("钓场不存在");
  const res = await db.insert(fishNews).values({ pondId: pond.id, content });
  await getCache().invalidateTag("pond");
  const insertId = ((res as unknown as [{ insertId?: number }])[0]?.insertId) ?? 0;
  return { id: insertId, pondId: pond.id, content };
}

export type MarkKind = "fav" | "news";

/**
 * 收藏/订阅切换（原子去重，写法对照 community.toggleLike）。
 * 插入撞 uq_pond_mark 唯一索引（ER_DUP_ENTRY）→ 已标记 → DELETE；成功则标记。
 */
export async function toggleMark(userId: number, pondSlug: string, kind: MarkKind): Promise<{ marked: boolean }> {
  const db = getDataSource().write();
  const [pond] = await db.select({ id: ponds.id }).from(ponds).where(eq(ponds.slug, pondSlug)).limit(1);
  if (!pond) throw new TRPCError({ code: "NOT_FOUND", message: "钓场不存在" });
  try {
    await db.insert(pondMarks).values({ userId, pondId: pond.id, kind });
  } catch (err) {
    if (!isDupEntry(err)) throw err;
    await db
      .delete(pondMarks)
      .where(and(eq(pondMarks.userId, userId), eq(pondMarks.pondId, pond.id), eq(pondMarks.kind, kind)));
    return { marked: false };
  }
  return { marked: true };
}

/** 我的收藏/订阅 slug 集合（联查 ponds 取 slug） */
export async function myMarks(userId: number): Promise<{ fav: string[]; news: string[] }> {
  const rows = await timedRead("marks.mine", (db) =>
    db
      .select({ kind: pondMarks.kind, slug: ponds.slug })
      .from(pondMarks)
      .innerJoin(ponds, eq(pondMarks.pondId, ponds.id))
      .where(eq(pondMarks.userId, userId)),
  );
  const out: { fav: string[]; news: string[] } = { fav: [], news: [] };
  for (const r of rows) {
    if (r.kind === "fav") out.fav.push(r.slug);
    else if (r.kind === "news") out.news.push(r.slug);
  }
  return out;
}

/** 我收藏的钓场完整列表（按收藏时间倒序，取展示字段） */
export async function myFavoritePonds(userId: number) {
  return timedRead("marks.favorites", (db) =>
    db
      .select({
        slug: ponds.slug,
        name: ponds.name,
        region: ponds.region,
        priceFrom: ponds.priceFrom,
        rating: ponds.rating,
        cover: ponds.cover,
        markedAt: pondMarks.createdAt,
      })
      .from(pondMarks)
      .innerJoin(ponds, eq(pondMarks.pondId, ponds.id))
      .where(and(eq(pondMarks.userId, userId), eq(pondMarks.kind, "fav")))
      .orderBy(desc(pondMarks.createdAt)),
  );
}
