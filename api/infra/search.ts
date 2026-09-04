/**
 * @layer Data Access Layer —— SearchIndex Port（搜索抽象）
 * @file api/infra/search.ts
 *
 * 业务只依赖 SearchIndex 接口；当前注入 SqlSearchIndex（MySQL/TiDB FULLTEXT +
 * LIKE 回退），未来切换 ElasticSearchIndex / MeilisearchIndex 业务零改动
 * （见 design/arch-v5.md §3.3）。SearchResult 结构与 ES 响应同构（hits/total/cursor）。
 * 安全：所有值走 drizzle 参数化绑定；表名/列名/sort 只接受服务端白名单常量。
 */
import { sql, type SQL } from "drizzle-orm";

export interface SearchQuery {
  keyword?: string;
  filters?: Record<string, unknown>;
  geo?: { lat: number; lng: number; radiusKm: number }; // 预留"附近钓场"
  cursor?: string;
  size: number;
  /** 服务端常量排序，如 "created_at DESC, id DESC"；禁止用户输入 */
  sort?: string;
}

export interface SearchResult<T> {
  hits: T[];
  /** 命中总数（与 ES total 语义对齐：SQL 适配器下为真实 COUNT(*)，不含 cursor 翻页条件） */
  total: number;
  cursor?: string;
}

export interface SearchIndex {
  /** SQL 适配器下为 no-op（数据 SSOT 在关系表，搜索索引为派生物）；ES 适配器下同步文档。 */
  upsert(index: string, id: string, doc: Record<string, unknown>): Promise<void>;
  delete(index: string, id: string): Promise<void>;
  search<T>(index: string, query: SearchQuery): Promise<SearchResult<T>>;
}

type Row = Record<string, unknown>;
interface SqlExecutor {
  execute(q: SQL): Promise<unknown>;
}

/** 索引名 → 表与可搜索列白名单（标识符防注入的唯一来源） */
const INDEX_DEFS: Record<string, { table: string; columns: string[]; filterable: string[]; cursorCols: boolean }> = {
  ponds: { table: "ponds", columns: ["name", "region", "intro"], filterable: ["region"], cursorCols: true },
  posts: { table: "posts", columns: ["content", "fish_species"], filterable: ["pond_id"], cursorCols: true },
  products: { table: "products", columns: ["name", "desc"], filterable: ["category"], cursorCols: false },
};

/** FULLTEXT 可用性探测缓存（TiDB 低版本不支持 FULLTEXT 时回退 LIKE） */
const fulltextSupport = new Map<string, boolean>();

function unwrapRows(res: unknown): Row[] {
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0] as Row[];
  const r = res as { rows?: Row[] };
  return r.rows ?? [];
}

export class SqlSearchIndex implements SearchIndex {
  private db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.db = db;
  }

  async upsert(): Promise<void> {
    /* SQL 派生索引无需同步；ES 适配器在此推送文档 */
  }
  async delete(): Promise<void> {
    /* 同上 */
  }

  private async supportsFulltext(index: string): Promise<boolean> {
    const cached = fulltextSupport.get(index);
    if (cached !== undefined) return cached;
    const def = INDEX_DEFS[index];
    let ok = false;
    try {
      await this.db.execute(
        sql.raw(
          `SELECT 1 FROM ${def.table} WHERE MATCH(${def.columns.join(",")}) AGAINST('probe' IN NATURAL LANGUAGE MODE) LIMIT 1`,
        ),
      );
      ok = true;
    } catch {
      ok = false;
    }
    fulltextSupport.set(index, ok);
    return ok;
  }

  async search<T>(index: string, query: SearchQuery): Promise<SearchResult<T>> {
    const def = INDEX_DEFS[index];
    if (!def) throw new Error(`unknown search index: ${index}`);

    const conds: SQL[] = [];
    if (query.keyword) {
      if (await this.supportsFulltext(index)) {
        conds.push(
          sql`${sql.raw(`MATCH(${def.columns.join(",")}) AGAINST(`)}${query.keyword}${sql.raw(" IN NATURAL LANGUAGE MODE)")}`,
        );
      } else {
        const likes = def.columns.map((c) => sql`${sql.raw(c)} LIKE ${"%" + query.keyword + "%"}`);
        conds.push(sql.join([sql.raw("("), sql.join(likes, sql.raw(" OR ")), sql.raw(")")]));
      }
    }
    if (query.filters) {
      for (const [k, v] of Object.entries(query.filters)) {
        if (!def.filterable.includes(k)) continue; // 白名单字段才可下推
        conds.push(sql`${sql.raw(k)} = ${v as string | number}`);
      }
    }
    // 命中条件（keyword+filters）与翻页条件（cursor）分开：total 统计命中总数，不含 cursor
    const matchConds = [...conds];
    if (query.cursor && def.cursorCols) {
      const [ts, id] = Buffer.from(query.cursor, "base64").toString("utf8").split("|");
      conds.push(sql`(created_at, id) < (${new Date(ts)}, ${Number(id)})`);
    }

    const buildWhere = (cs: SQL[]) =>
      cs.length ? sql.join([sql.raw("WHERE "), sql.join(cs, sql.raw(" AND "))]) : sql.raw("");
    const whereFrag = buildWhere(conds);
    // sort 为服务端白名单常量（如 "rating DESC"），必须补 ORDER BY 前缀
    const orderFrag = sql.raw("ORDER BY " + (query.sort ?? "created_at DESC, id DESC"));
    const size = Math.min(Math.max(query.size, 1), 100);

    const q = sql.join(
      [sql.raw(`SELECT * FROM ${def.table} `), whereFrag, sql.raw(" "), orderFrag, sql.raw(` LIMIT ${size + 1}`)],
      sql.raw(""),
    );
    const countQ = sql.join([sql.raw(`SELECT COUNT(*) AS c FROM ${def.table} `), buildWhere(matchConds)], sql.raw(""));
    const [listRes, countRes] = await Promise.all([this.db.execute(q), this.db.execute(countQ)]);
    const list = unwrapRows(listRes);
    const total = Number((unwrapRows(countRes)[0] as { c?: number | string } | undefined)?.c ?? 0);
    const hasMore = list.length > size;
    const page = list.slice(0, size);
    const last = page[page.length - 1];
    return {
      hits: page as T[],
      total,
      cursor:
        hasMore && last && def.cursorCols
          ? Buffer.from(`${new Date(last.created_at as string).toISOString()}|${last.id}`).toString("base64")
          : undefined,
    };
  }
}
