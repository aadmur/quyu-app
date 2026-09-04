import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

// 连接池调优（arch-v5 §5.6）：远程 RTT ≈74ms 下写路径吞吐 = pool / 单请求占用时长，
// 10 连接在压测下被打满（track ~110 RPS 封顶），上调到 50；可用 DB_POOL_SIZE 覆盖。
// queueLimit=0 表示排队不设上限（排队等待优于直接报错）；idle 连接保留 10 个保活。
const POOL_SIZE = Math.max(1, parseInt(process.env.DB_POOL_SIZE ?? "50", 10) || 50);

function createDb() {
  const pool = mysql.createPool({
    uri: env.databaseUrl,
    connectionLimit: POOL_SIZE,
    waitForConnections: true,
    queueLimit: 0,
    maxIdle: 10,
    idleTimeout: 60_000,
    enableKeepAlive: true,
  });
  return drizzle(pool, {
    mode: "planetscale",
    schema: fullSchema,
  });
}

let instance: ReturnType<typeof createDb>;

export function getDb() {
  if (!instance) {
    instance = createDb();
  }
  return instance;
}
