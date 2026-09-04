/**
 * @layer Application Layer —— PondCatalogService（钓场目录/票种/钓位/评价聚合）
 * @file api/services/pond.ts
 *
 * P0 修复：ponds.list 全表扫描 + 内存过滤 → SearchIndex 关键词检索 + 缓存；
 * detail 4 次串行查询 → Promise.all 并行 + 整页缓存（TTL 60s，写后失效）。
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { fishNews, orders, ponds, reviews, seats, ticketTypes, type Pond } from "@db/schema";
import { getCache, getDataSource, getSearch, timedRead, type Db } from "../infra";

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
    const [tickets, seatRows, news, reviewRows, day] = await Promise.all([
      db.select().from(ticketTypes).where(eq(ticketTypes.pondId, pond.id)),
      db.select().from(seats).where(eq(seats.pondId, pond.id)),
      db.select().from(fishNews).where(eq(fishNews.pondId, pond.id)).orderBy(desc(fishNews.createdAt)).limit(5),
      db.select().from(reviews).where(eq(reviews.pondId, pond.id)).orderBy(desc(reviews.createdAt)).limit(10),
      dayPromise,
    ]);
    const occupied = await occupiedSeats(db, pond.id, day);
    // 查询层覆盖计算：静态 is_sold 列不再作为展示口径
    const seatList = seatRows.map((s) => ({ ...s, isSold: occupied.has(s.seatNo) }));
    return { ...pond, tickets, seats: seatList, news, reviews: reviewRows } as PondDetail;
  });
  return result === "none" ? null : result;
}

/** 钓场侧写后失效（下单/评价后调用） */
export async function invalidatePondCache(): Promise<void> {
  await getCache().invalidateTag("pond");
}

/** 塘主发布鱼讯：写入 fish_news 并失效钓场缓存（详情页鱼讯列表即时可见）。 */
export async function publishNews(pondSlug: string, content: string) {
  const db = getDataSource().write();
  const [pond] = await db.select({ id: ponds.id }).from(ponds).where(eq(ponds.slug, pondSlug)).limit(1);
  if (!pond) throw new Error("钓场不存在");
  const res = await db.insert(fishNews).values({ pondId: pond.id, content });
  await getCache().invalidateTag("pond");
  const insertId = ((res as unknown as [{ insertId?: number }])[0]?.insertId) ?? 0;
  return { id: insertId, pondId: pond.id, content };
}
