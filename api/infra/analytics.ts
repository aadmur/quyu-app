/**
 * @layer Data Access Layer —— AnalyticsStore Port（分析/OLAP 抽象）
 * @file api/infra/analytics.ts
 *
 * 业务只依赖 AnalyticsStore 接口；当前注入 SqlAnalyticsStore（TiDB 聚合 +
 * owner_stats_daily 汇总表物化），未来切换 ClickHouseAnalytics 业务零改动
 * （design/arch-v5.md §3.3 / §4.5）。
 */
import { sql } from "drizzle-orm";
import { userEvents } from "@db/schema";
import { getDataSource, type Db } from "./datasource";

export interface AnalyticsStore {
  /** 明细行摄入（当前写 TiDB 表；未来写 ClickHouse 宽表） */
  ingest(stream: string, rows: Record<string, unknown>[]): Promise<void>;
  /** 分析查询：走只读连接（未来只读副本/ClickHouse） */
  query<T>(sqlText: string, params?: unknown[]): Promise<T[]>;
  /** 预聚合刷新：对应 ClickHouse 物化视图；当前重算汇总表 */
  refreshMaterialized(view: string): Promise<void>;
}

const STREAM_TABLES: Record<string, string> = {
  user_events: "user_events",
};

export class SqlAnalyticsStore implements AnalyticsStore {
  private ds: { read(): Db; write(): Db };

  constructor(ds: { read(): Db; write(): Db }) {
    this.ds = ds;
  }

  async ingest(stream: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    if (stream === "user_events") {
      await this.ds.write().insert(userEvents).values(
        rows.map((r) => ({
          userId: Number(r.userId),
          postId: Number(r.postId),
          action: String(r.action),
          durationMs: Number(r.durationMs ?? 0),
        })),
      );
      return;
    }
    if (!STREAM_TABLES[stream]) throw new Error(`unknown analytics stream: ${stream}`);
  }

  async query<T>(sqlText: string, params: unknown[] = []): Promise<T[]> {
    // sqlText 由服务端常量提供（禁止用户输入）；参数走绑定
    const frag = sql.raw(sqlText);
    const res = (await this.ds.read().execute(
      params.length
        ? // 简易位置参数替换：sqlText 中的 ? 依次绑定
          sql.join(
            sqlText.split("?").map((part, i) => {
              const p = sql.raw(part);
              return i === 0 ? p : sql.join([sql`${params[i - 1] as string | number | Date}`, p], sql.raw(""));
            }),
            sql.raw(""),
          )
        : frag,
    )) as unknown;
    if (Array.isArray(res) && Array.isArray(res[0])) return res[0] as T[];
    return ((res as { rows?: T[] }).rows ?? []) as T[];
  }

  /** 重算 owner_stats_daily 汇总表（从 orders 全量聚合，幂等 UPSERT） */
  async refreshMaterialized(view: string): Promise<void> {
    if (view !== "owner_stats_daily") throw new Error(`unknown materialized view: ${view}`);
    await this.ds.write().execute(sql`
      INSERT INTO owner_stats_daily (pond_id, day, orders, gmv, used_cnt)
      SELECT pond_id,
             DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
             COUNT(*) AS orders,
             COALESCE(SUM(total_amount), 0) AS gmv,
             COALESCE(SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END), 0) AS used_cnt
      FROM orders
      GROUP BY pond_id, DATE_FORMAT(created_at, '%Y-%m-%d')
      ON DUPLICATE KEY UPDATE
        orders = VALUES(orders),
        gmv = VALUES(gmv),
        used_cnt = VALUES(used_cnt)
    `);
  }
}

let instance: AnalyticsStore | null = null;

export function getAnalytics(): AnalyticsStore {
  if (!instance) instance = new SqlAnalyticsStore(getDataSource());
  return instance;
}
