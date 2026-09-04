/**
 * @layer Data Access Layer —— RWDataSource Port（读写分离抽象）
 * @file api/infra/datasource.ts
 *
 * 当前 read()/write() 指向同一 mysql2 pool（单实例 TiDB）；
 * 未来切只读副本时只需改 read() 装配，业务零改动（design/arch-v5.md §5.6）。
 * withTx 提供 UnitOfWork 事务边界（订单/库存等强一致写必须走它）。
 */
import { getDb } from "../queries/connection";
import { log, warnSlowQuery } from "./logger";

export type Db = ReturnType<typeof getDb>;

export interface RWDataSource {
  /** 读连接：当前 = 主库；未来 = 从库/只读端点（DB_READ_URL） */
  read(): Db;
  /** 写连接：永远主库 */
  write(): Db;
  /** 事务包裹（UnitOfWork） */
  withTx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

class SinglePoolDataSource implements RWDataSource {
  read(): Db {
    return getDb();
  }
  write(): Db {
    return getDb();
  }
  async withTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    // drizzle mysql2 事务：内部自动 BEGIN/COMMIT/ROLLBACK
    return (getDb() as unknown as { transaction: <R>(f: (tx: Db) => Promise<R>) => Promise<R> }).transaction(fn);
  }
}

let instance: RWDataSource | null = null;

export function getDataSource(): RWDataSource {
  if (!instance) {
    // 预留：DB_READ_URL 存在时装配只读副本连接（当前同 pool）
    instance = new SinglePoolDataSource();
    log("debug", "datasource initialized", { driver: "single-pool", readReplica: Boolean(process.env.DB_READ_URL) });
  }
  return instance;
}

/** 唯一索引冲突判定（ER_DUP_ENTRY，1062；drizzle 会包装 mysql2 原始错误到 cause，递归检查） */
export function isDupEntry(err: unknown): boolean {
  let e = err as { code?: string; errno?: number; message?: string; cause?: unknown } | null;
  while (e) {
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
    if (/Duplicate entry/i.test(String(e.message ?? ""))) return true;
    e = (e.cause ?? null) as typeof e;
  }
  return false;
}

/** 带慢查询告警的读执行辅助（热点查询使用） */
export async function timedRead<T>(digest: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn(getDataSource().read());
  } finally {
    warnSlowQuery(digest, performance.now() - start);
  }
}
