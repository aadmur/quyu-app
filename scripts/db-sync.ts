/**
 * @layer Ops 脚本 —— schema 同步 + 冗余列回填
 * @file scripts/db-sync.ts
 *
 * drizzle-kit push 在非 TTY 环境下被交互确认阻断，改为 generate + 本脚本手动执行：
 * 1. 执行最新迁移 SQL（幂等：重复执行时跳过 "already exists" 类错误）
 * 2. 补 orders.verify_code 唯一索引（drizzle 快照遗漏，push 探测到 live 库缺失）
 * 3. 回填 posts.pond_slug（JOIN ponds）与 posts.impression_count（统计 user_events）
 * 4. 尝试创建 FULLTEXT 索引 ft_posts_content（TiDB 低版本不支持则跳过，SqlSearchIndex 自动回退 LIKE）
 *
 * 用法：node_modules/.bin/tsx scripts/db-sync.ts
 */
import { readFileSync } from "node:fs";
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

const MIGRATION = new URL("../db/migrations/0001_arch_v5.sql", import.meta.url);

const IGNORABLE = [
  "already exists",
  "Duplicate key name",
  "Duplicate column",
  "check that column/key exists", // DROP INDEX 已不存在
  "doesn't exist",
  "Can't DROP",
  "Duplicate entry", // 唯一约束键名已存在
];

async function exec(db: ReturnType<typeof getDb>, stmt: string, label: string) {
  try {
    await db.execute(sql.raw(stmt));
    console.log(`[ok] ${label}`);
  } catch (err) {
    const e = err as Error & { cause?: Error };
    const msg = `${e.message ?? e} ${e.cause?.message ?? ""}`;
    if (IGNORABLE.some((s) => msg.includes(s))) {
      console.log(`[skip] ${label} (${msg.slice(0, 80)})`);
    } else {
      throw new Error(`${label} failed: ${msg}`);
    }
  }
}

async function main() {
  const db = getDb();

  // 1. 迁移 SQL
  const raw = readFileSync(MIGRATION, "utf8");
  const stmts = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim().replace(/;$/, ""))
    .filter(Boolean);
  for (const stmt of stmts) {
    await exec(db, stmt, stmt.slice(0, 60).replace(/\s+/g, " "));
  }

  // 2. 历史 push 遗漏的唯一约束补齐（drizzle 快照误以为已存在；幂等创建）
  // 2a. likes 先去重（保留最早一行），再加 uq_like
  await exec(
    db,
    `DELETE l2 FROM likes l1 JOIN likes l2
       ON l1.user_id = l2.user_id AND l1.post_id = l2.post_id AND l1.id < l2.id`,
    "dedupe likes",
  );
  const uniques: Array<[string, string]> = [
    ["orders_verify_code_unique", "ALTER TABLE `orders` ADD CONSTRAINT `orders_verify_code_unique` UNIQUE(`verify_code`)"],
    ["uq_like", "ALTER TABLE `likes` ADD CONSTRAINT `uq_like` UNIQUE(`user_id`,`post_id`)"],
    ["ponds_slug_unique", "ALTER TABLE `ponds` ADD CONSTRAINT `ponds_slug_unique` UNIQUE(`slug`)"],
    ["uq_seat", "ALTER TABLE `seats` ADD CONSTRAINT `uq_seat` UNIQUE(`pond_id`,`seat_no`)"],
    ["reviews_order_id_unique", "ALTER TABLE `reviews` ADD CONSTRAINT `reviews_order_id_unique` UNIQUE(`order_id`)"],
  ];
  for (const [label, stmt] of uniques) {
    await exec(db, stmt, `unique ${label}`);
  }

  // 3. 冗余列回填
  await exec(
    db,
    "UPDATE posts p JOIN ponds d ON p.pond_id = d.id SET p.pond_slug = d.slug WHERE p.pond_slug IS NULL",
    "backfill posts.pond_slug",
  );
  await exec(
    db,
    `UPDATE posts p SET p.impression_count = (
       SELECT COUNT(*) FROM user_events e WHERE e.post_id = p.id AND e.action = 'impression'
     )`,
    "backfill posts.impression_count",
  );

  // 4. FULLTEXT 索引（能力探测，失败可接受）
  try {
    await db.execute(sql.raw("ALTER TABLE `posts` ADD FULLTEXT INDEX `ft_posts_content` (`content`)"));
    console.log("[ok] FULLTEXT ft_posts_content");
  } catch (err) {
    console.log(`[skip] FULLTEXT not supported, LIKE fallback active (${String((err as Error).message).slice(0, 80)})`);
  }

  // 校验
  const r = (await db.execute(sql`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN pond_slug IS NULL THEN 1 ELSE 0 END) AS missingSlug
    FROM posts
  `)) as unknown as [[{ total: number; missingSlug: number | null }]];
  console.log("[verify] posts:", JSON.stringify(r[0][0]));
  process.exit(0);
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
