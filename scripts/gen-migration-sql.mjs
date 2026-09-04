/**
 * 一次性工具：由 db/migrations/meta 快照对生成缺失的迁移 .sql
 * （仓库曾只提交 meta 快照而未提交 drizzle-kit generate 产出的 SQL 文件）。
 * 用法：node scripts/gen-migration-sql.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateMySQLMigration } from "drizzle-kit/api";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metaDir = path.join(root, "db/migrations/meta");
const outDir = path.join(root, "db/migrations");

const readSnap = (name) => JSON.parse(readFileSync(path.join(metaDir, name), "utf8"));

// 空快照（迁移起点）：结构与 mysql 快照一致、无任何表
const empty = {
  version: "5",
  dialect: "mysql",
  id: "00000000-0000-0000-0000-000000000000",
  prevId: "00000000-0000-0000-0000-000000000000",
  tables: {},
  views: {},
  _meta: { schemas: {}, tables: {}, columns: {} },
};

const pairs = [
  { tag: "0000_remarkable_sasquatch", prev: empty, cur: readSnap("0000_snapshot.json") },
  { tag: "0001_arch_v5", prev: readSnap("0000_snapshot.json"), cur: readSnap("0001_snapshot.json") },
  { tag: "0002_product_orders", prev: readSnap("0001_snapshot.json"), cur: readSnap("0002_snapshot.json") },
];

for (const { tag, prev, cur } of pairs) {
  const stmts = await generateMySQLMigration(prev, cur);
  const sql = stmts.map((s) => s.trimEnd()).join("\n--> statement-breakpoint\n") + "\n";
  const file = path.join(outDir, `${tag}.sql`);
  writeFileSync(file, sql, "utf8");
  console.log(`${tag}.sql: ${stmts.length} statements`);
}
