/**
 * @layer Ops 脚本 —— 最小冒烟测试（连真实库）
 * @file scripts/smoke.ts
 *
 * 覆盖：
 * 1. recommendService.recommendFeed —— 返回结构（items/score/hasMore/profile）
 * 2. trade.createOrder —— 幂等键重复提交返回原单、金额服务端重算
 * 3. trade.verifyOrder —— CAS 核销，二次核销幂等失败
 * 4. community.toggleLike —— 唯一索引去重（like/unlike）
 * 5. 埋点异步入队 → flush 后落库 user_events + impression_count 累加
 * 6. ownerService.ownerStats / shop.listProducts / pond.getPondDetail 结构
 *
 * 用法：node_modules/.bin/tsx scripts/smoke.ts
 */
import assert from "node:assert";
import { eq, sql } from "drizzle-orm";
import { orders, seats, ticketTypes } from "../db/schema";
import { getDataSource, getQueue } from "../api/infra";
import { recommendFeed, trackEvent } from "../api/services/recommendService";
import { createOrder, verifyOrder, myOrders } from "../api/services/trade";
import { toggleLike } from "../api/services/community";
import { ownerStats } from "../api/services/ownerService";
import { listProducts } from "../api/services/shop";
import { getPondDetail, listPonds } from "../api/services/pond";

const SMOKE_USER = 1;
const idem = `smoke-${Date.now()}`;

async function main() {
  const db = getDataSource().write();

  // ---- 1. 推荐 feed ----
  const feed = await recommendFeed(SMOKE_USER, 1, 5);
  assert(Array.isArray(feed.items) && feed.items.length > 0, "feed.items 非空");
  assert(typeof feed.items[0].score === "number", "item.score 为 number");
  assert("pondSlug" in feed.items[0], "item 含 pondSlug");
  assert(typeof feed.hasMore === "boolean", "hasMore 为 boolean");
  console.log(`[ok] recommendFeed: ${feed.items.length} items, first score=${feed.items[0].score}`);

  // ---- 2. 下单（幂等 + 金额重算） ----
  const [ticket] = await db.select().from(ticketTypes).where(eq(ticketTypes.pondId, 1)).limit(1);
  assert(ticket, "存在票种");
  const qty = 2;
  /**
   * seatNos 必须与 quantity 等长——`createOrder` 是**无条件**校验的（1 票 1 位），
   * 而上一版这里传 `seatNos: []` 配 qty=2，于是第 2 节必抛「钓位数量必须与购票数量一致」，
   * `main()` 当场退出，**§3–§7 从来没被执行过**（smoke 也没挂在任何 npm 脚本上，所以没人发现）。
   * 取该塘真实钓位；visitDate 用远期日期，避开按 (pondId, visitDate, seatNo) 实时计算的占用。
   */
  const visitDate = "2030-01-05";
  const seatRows = await db.select({ seatNo: seats.seatNo }).from(seats).where(eq(seats.pondId, 1)).limit(qty);
  assert(seatRows.length === qty, `该钓场需有至少 ${qty} 个钓位（先跑 db/seed.ts 生成座位）`);
  const seatNos = seatRows.map((r) => Number(r.seatNo));
  const o1 = await createOrder(SMOKE_USER, {
    pondSlug: "qinglong",
    ticketTypeId: ticket.id,
    visitDate,
    quantity: qty,
    seatNos,
    totalAmount: 1, // 故意传错，验证服务端重算
    idempotencyKey: idem,
  });
  assert(o1.orderId > 0, "返回 orderId");
  const o2 = await createOrder(SMOKE_USER, {
    pondSlug: "qinglong",
    ticketTypeId: ticket.id,
    visitDate,
    quantity: qty,
    seatNos,
    totalAmount: 1,
    idempotencyKey: idem,
  });
  assert.strictEqual(o2.orderId, o1.orderId, "幂等键重复提交返回原单");
  const [created] = await db.select().from(orders).where(eq(orders.id, o1.orderId)).limit(1);
  assert.strictEqual(created.totalAmount, ticket.price * qty, "金额按服务端 price×quantity 重算");
  const smokeOrderId = o1.orderId
  console.log(`[ok] createOrder 幂等 + 金额重算: orderId=${o1.orderId}, amount=${created.totalAmount}, seats=${seatNos.join("/")}`);

  // ---- 3. 核销 CAS（二次核销幂等失败） ----
  const v1 = await verifyOrder(created.verifyCode);
  assert(v1.ok === true, "首次核销成功");
  const v2 = await verifyOrder(created.verifyCode);
  assert(v2.ok === false && v2.reason.includes("已核销"), "二次核销幂等失败");
  console.log(`[ok] verifyOrder CAS: first=${v1.ok}, second ok=${v2.ok}`);

  // ---- 4. 点赞去重 ----
  const postId = (feed.items[0] as { id: number }).id;
  const l1 = await toggleLike(SMOKE_USER, postId);
  const l2 = await toggleLike(SMOKE_USER, postId);
  assert.notStrictEqual(l1.liked, l2.liked, "重复点赞切换状态（去重生效）");
  console.log(`[ok] toggleLike: ${l1.liked} -> ${l2.liked}`);

  // ---- 5. 埋点异步入队 → 落库 ----
  const before = (await db.execute(
    sql`SELECT COUNT(*) AS c FROM user_events WHERE user_id = ${SMOKE_USER} AND post_id = ${postId} AND action = 'click'`,
  )) as unknown as [[{ c: number }]];
  await trackEvent(SMOKE_USER, postId, "click", 1234);
  await getQueue().flush(); // 等待 dispatcher 批量落库
  const after = (await db.execute(
    sql`SELECT COUNT(*) AS c FROM user_events WHERE user_id = ${SMOKE_USER} AND post_id = ${postId} AND action = 'click'`,
  )) as unknown as [[{ c: number }]];
  assert(Number(after[0][0].c) > Number(before[0][0].c), "埋点事件经队列异步落库");
  console.log(`[ok] track 异步落库: click ${before[0][0].c} -> ${after[0][0].c}`);

  // ---- 6. 其他服务结构 ----
  const mine = await myOrders(SMOKE_USER);
  assert(mine.some((o) => o.id === o1.orderId), "mine 包含新订单");
  const stats = await ownerStats();
  assert(typeof stats.totalOrders === "number" && Array.isArray(stats.pendingList), "ownerStats 结构");
  const prods = await listProducts();
  assert(Array.isArray(prods) && prods.length > 0, "products.list 非空");
  const detail = await getPondDetail("qinglong");
  assert(detail && Array.isArray(detail.tickets) && Array.isArray(detail.seats), "pond detail 聚合结构");
  console.log(`[ok] mine=${mine.length}, ownerStats.totalOrders=${stats.totalOrders}, products=${prods.length}, pondDetail=${detail!.name}`);

  // ---- 7. 关键词搜索（SearchIndex ORDER BY 拼接防回归：曾线上必现 500） ----
  const kw = await listPonds({ keyword: "青" });
  assert(Array.isArray(kw) && kw.length > 0, "keyword 搜索返回非空");
  assert(
    kw.some((p) => p.name.includes("青") || p.region.includes("青") || p.fishSpecies.some((f) => f.includes("青"))),
    "keyword 搜索结果与关键词相关",
  );
  console.log(`[ok] listPonds keyword=青: ${kw.length} hits`);

  // 清场：冒烟自己下的单要收掉。座位占用是按 (pondId, visitDate, seatNo) 从订单实时算的，
  // 留着它下次再跑同一 visitDate 就会被判「钓位已被预订」——但必须放在 §3 之后，
  // 因为核销那节要读这单的 verify_code。
  await db.delete(orders).where(eq(orders.id, smokeOrderId));
  getQueue().stop();
  console.log("\nSMOKE PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
