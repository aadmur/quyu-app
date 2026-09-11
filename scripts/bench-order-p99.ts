/**
 * @layer Ops 脚本 —— 下单接口 P99 补测（QY-PERF-008）
 * @file scripts/bench-order-p99.ts
 *
 * 背景：功能需求清单 4.1 里「下单接口 P99 < 500ms」长期是「待补测」。
 *
 * 测的是什么：直接调用服务层 `createOrder()` —— 也就是
 * `app.orders.create` 这个 tRPC 过程内部实际执行的同一个函数
 * （见 api/feature-router.ts：`return createOrder(ctx.user.id, input)`）。
 * 因此这里量到的是**服务端处理耗时**（含 MySQL 事务写入），
 * 不含公网 RTT 与限流中间件。要量「端到端」请配合 autocannon 打 HTTP 层，
 * 注意 orders.create 有 10 次/分钟的限流桶，单 actor 无法做高并发压测。
 *
 * 为什么串行（concurrency = 1）：下单是写操作，压测目的是拿到**单请求处理时延分布**，
 * 而不是吞吐。串行测量没有排队干扰，P99 反映的是最慢的那一次真实请求。
 *
 * 前置：库必须可达（DATABASE_URL 指向测试库）。本机若没有可用库，
 * 脚本会以退出码 2 明确告知，而不是抛栈。
 *
 * 用法：
 *   node --env-file=.env.smoke --import tsx scripts/bench-order-p99.ts
 *   node --env-file=.env.smoke --import tsx scripts/bench-order-p99.ts --iter 200
 *   node --env-file=.env.smoke --import tsx scripts/bench-order-p99.ts --cleanup
 *
 * 环境变量：
 *   BENCH_ITER          迭代次数（默认 100）
 *   BENCH_USER_ID       下单用户（默认 1）
 *   BENCH_POND_SLUG     钓场 slug（默认 qinglong）
 *   BENCH_TARGET_MS     验收线（默认 500）
 */
import { eq, like } from "drizzle-orm";
import { orders, ticketTypes } from "../db/schema";
import { getDataSource } from "../api/infra";
import { createOrder } from "../api/services/trade";

const ITER = Number(process.env.BENCH_ITER ?? 100);
const USER_ID = Number(process.env.BENCH_USER_ID ?? 1);
const SLUG = process.env.BENCH_POND_SLUG ?? "qinglong";
const TARGET_MS = Number(process.env.BENCH_TARGET_MS ?? 500);
const CLEANUP = process.argv.includes("--cleanup");
const RUN_ID = `bench-${Date.now().toString(36)}`;

/** 最近秩法分位数，与 measure-coldstart.mjs 口径一致 */
function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

async function main() {
  const ds = getDataSource();
  const db = ds.write();

  const [ticket] = await db.select().from(ticketTypes).where(eq(ticketTypes.pondId, 1)).limit(1);
  if (!ticket) {
    console.error("测试库缺少 pondId=1 的票种，无法下单。请先在测试库执行种子数据。");
    process.exit(2);
  }

  console.log("下单接口 P99 补测（QY-PERF-008）");
  console.log(`  用户 ${USER_ID} / 钓场 ${SLUG} / 票种 #${ticket.id}（单价 ¥${ticket.price}）`);
  console.log(`  串行迭代 ${ITER} 次，本次 runId=${RUN_ID}`);
  console.log(`  验收线 P99 < ${TARGET_MS} ms`);

  // 预热：排除首次建连 / 语句缓存 / JIT 带来的虚高
  await createOrder(USER_ID, {
    pondSlug: SLUG,
    ticketTypeId: ticket.id,
    visitDate: "2026-12-31",
    quantity: 1,
    seatNos: [],
    totalAmount: 0,
    idempotencyKey: `${RUN_ID}-warmup`,
  });

  const samples: number[] = [];
  const failures: string[] = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    try {
      await createOrder(USER_ID, {
        pondSlug: SLUG,
        ticketTypeId: ticket.id,
        visitDate: "2026-12-31",
        quantity: 1,
        seatNos: [],
        totalAmount: 0,
        idempotencyKey: `${RUN_ID}-${String(i).padStart(4, "0")}`,
      });
      samples.push(performance.now() - t0);
    } catch (err) {
      failures.push((err as Error).message.slice(0, 120));
    }
  }

  if (!samples.length) {
    console.error(`\n全部 ${ITER} 次下单失败，首条错误：${failures[0] ?? "(无)"}`);
    process.exit(1);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const fmt = (v: number) => v.toFixed(1).padStart(9);

  console.log(`\n有效样本 ${samples.length}/${ITER}${failures.length ? `，失败 ${failures.length}` : ""}`);
  console.log("  分位数        P50        P90        P95        P99        max       mean");
  console.log(
    `  毫秒     ${fmt(percentile(sorted, 50))}${fmt(percentile(sorted, 90))}` +
      `${fmt(percentile(sorted, 95))}${fmt(percentile(sorted, 99))}${fmt(sorted[sorted.length - 1]!)}${fmt(mean)}`,
  );

  const p99 = percentile(sorted, 99);
  console.log(`\n  结论：P99 = ${p99.toFixed(1)} ms，验收线 ${TARGET_MS} ms → ${p99 < TARGET_MS ? "达标" : "未达标"}`);
  if (failures.length) console.log(`  失败样例：${failures[0]}`);

  if (CLEANUP) {
    // 仅适用于可丢弃的测试库：清掉本次 run 写入的订单，避免污染后续统计
    const res = await db.delete(orders).where(like(orders.idempotencyKey, `${RUN_ID}-%`));
    console.log(`\n  已清理本次写入的订单：${JSON.stringify(res)}`);
  } else {
    console.log(`\n  提示：本次向测试库写入了 ${samples.length + 1} 笔订单（idempotencyKey 前缀 ${RUN_ID}-）。`);
    console.log("        如为一次性测试库可加 --cleanup 清理。");
  }

  process.exit(p99 < TARGET_MS ? 0 : 1);
}

main().catch((err) => {
  const msg = String((err as Error)?.message ?? err);
  if (/ECONNREFUSED|Access denied|ER_ACCESS_DENIED|getaddrinfo|ETIMEDOUT/.test(msg)) {
    console.error("测试库不可达或凭据无效，无法补测下单 P99。");
    console.error(`  DATABASE_URL 指向的不是可用实例：${msg.split("\n")[0]}`);
    console.error("  请改用可丢弃的测试库后再执行本脚本。");
    process.exit(2);
  }
  console.error("补测异常：", err);
  process.exit(1);
});
