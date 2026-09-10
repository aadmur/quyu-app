/**
 * @layer Application Layer —— ShopService（商品/商城）
 * @file api/services/shop.ts
 *
 * 数据主权：products 表唯一写方。
 * P0 修复：列表全表内存过滤 → category 条件下推 SQL（命中 idx_products_category）+ 结果缓存 120s。
 */
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { productOrders, products, type Product, type ProductOrder } from "@db/schema";
import { getCache, getDataSource, isDupEntry, timedRead } from "../infra";
import { pushNotification } from "./notify";

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

/** 商品列表：category 下推 SQL + 缓存（TTL 120s） */
export async function listProducts(category?: string): Promise<Product[]> {
  const cache = getCache();
  const key = `product:list:${category ?? "all"}`;
  return cache.getOrSet(key, 120, () =>
    timedRead("products.list", (db) =>
      category
        ? db.select().from(products).where(eq(products.category, category)).orderBy(desc(products.sales))
        : db.select().from(products).orderBy(desc(products.sales)),
    ),
  );
}

/** 商品搜索：名称/描述/分类 LIKE 检索（SearchIndex 语义，预留 ES 切换） */
export async function searchProducts(keyword: string): Promise<Product[]> {
  const kw = `%${keyword.trim()}%`;
  if (!keyword.trim()) return listProducts();
  return timedRead("products.search", (db) =>
    db
      .select()
      .from(products)
      .where(or(like(products.name, kw), like(products.desc, kw), like(products.category, kw)))
      .orderBy(desc(products.sales)),
  );
}

export interface CartItemInput {
  productId: number;
  qty: number;
}

/** 商品下单：服务端按 productId 重算金额（不信任前端），幂等键防重复提交。
 *  订单 insert 与销量累加在同一事务（参照 trade.ts withTx）：任一步失败整体回滚，
 *  不会出现"有单无销量"或"有销量无单"的中间态。 */
export async function createProductOrder(
  userId: number,
  items: CartItemInput[],
  idempotencyKey?: string,
): Promise<ProductOrder> {
  if (!items.length) throw new Error("购物车为空");
  const ds = getDataSource();
  const db = ds.write();

  // 服务端按商品 ID 查价重算（金额安全：前端值不再信任）
  const ids = items.map((i) => i.productId);
  const rows = await db.select().from(products).where(sql`${products.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  const priceById = new Map(rows.map((r) => [r.id, r]));
  let total = 0;
  const snap = items.map((i) => {
    const p = priceById.get(i.productId);
    if (!p) throw new Error(`商品不存在: ${i.productId}`);
    total += p.price * i.qty;
    return { productId: p.id, name: p.name, price: p.price, qty: i.qty };
  });

  try {
    const insertId = await ds.withTx(async (tx) => {
      const res = await tx.insert(productOrders).values({
        userId,
        items: snap,
        totalAmount: total,
        idempotencyKey: idempotencyKey ?? null,
      });
      const id = ((res as unknown as [{ insertId?: number }])[0]?.insertId) ?? 0;
      // 销量累加（原子，与订单同事务）
      for (const i of items) {
        await tx.update(products).set({ sales: sql`${products.sales} + ${i.qty}` }).where(eq(products.id, i.productId));
      }
      return id;
    });
    const [order] = await db.select().from(productOrders).where(eq(productOrders.id, insertId));
    return order;
  } catch (err) {
    // 幂等撞键：返回原单
    if (isDupEntry(err) && idempotencyKey) {
      const [exist] = await db.select().from(productOrders).where(eq(productOrders.idempotencyKey, idempotencyKey));
      if (exist) return exist;
    }
    throw err;
  }
}

/** 我的商品订单 */
export async function myProductOrders(userId: number): Promise<ProductOrder[]> {
  return timedRead("productOrders.mine", (db) =>
    db.select().from(productOrders).where(eq(productOrders.userId, userId)).orderBy(desc(productOrders.createdAt)),
  );
}

/** 商品订单退款（MVP 无真实支付渠道，退款即状态迁移，refundAmount 供前端展示）。
 *  状态机：pending/paid→refunded，单条 CAS UPDATE，并发只有一方成功；
 *  已 refunded 幂等返回成功（不重复退）；shipped/done 引导客服退款。
 *  写法对照 trade.ts refundOrder。 */
export async function refundProductOrder(
  userId: number,
  productOrderId: number,
): Promise<{ orderId: number; refundAmount: number }> {
  const db = getDataSource().write();
  // 本人订单限定：查不到视为不存在（不泄露他人订单存在性）
  const [o] = await db
    .select()
    .from(productOrders)
    .where(and(eq(productOrders.id, productOrderId), eq(productOrders.userId, userId)))
    .limit(1);
  if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
  // 幂等快路径：已退款直接返回成功，不重复退
  if (o.status === "refunded") return { orderId: o.id, refundAmount: o.totalAmount };
  if (o.status !== "pending" && o.status !== "paid") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "已发货订单请联系客服退款" });
  }

  // 单条 CAS UPDATE（状态机 pending/paid→refunded）：并发只有一方影响 1 行
  const res = await db.execute(
    sql`UPDATE product_orders SET status = 'refunded' WHERE id = ${productOrderId} AND status IN ('pending', 'paid')`,
  );
  if (affectedRows(res) === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "订单状态已变更，请刷新后重试" });
  }

  // 消息中心：通知用户退款已受理（失败不阻断退款主流程，写法对照 trade.ts refundOrder）
  try {
    await pushNotification(
      {
        userId,
        type: "refund",
        actorName: "系统",
        refId: o.id,
        preview: `你的商品订单退款已受理，金额 ¥${o.totalAmount}`,
      },
      db,
    );
  } catch {
    // 通知失败不阻断主流程
  }
  return { orderId: o.id, refundAmount: o.totalAmount };
}

/** 确认收货：shipped→done（CAS，仅本人）；不在 shipped 状态直接 BAD_REQUEST。 */
export async function confirmProductOrder(
  userId: number,
  productOrderId: number,
): Promise<{ orderId: number; status: string }> {
  const db = getDataSource().write();
  const [o] = await db
    .select()
    .from(productOrders)
    .where(and(eq(productOrders.id, productOrderId), eq(productOrders.userId, userId)))
    .limit(1);
  if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
  if (o.status !== "shipped") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "订单未发货，暂不可确认收货" });
  }

  const res = await db.execute(
    sql`UPDATE product_orders SET status = 'done' WHERE id = ${productOrderId} AND status = 'shipped'`,
  );
  if (affectedRows(res) === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "订单状态已变更，请刷新后重试" });
  }
  return { orderId: o.id, status: "done" };
}

/** 模拟卖家侧状态推进（MVP 无卖家后台，测试用途）：pending→paid→shipped，每调一次推进一步。
 *  仅本人订单；done/refunded 已到终态，BAD_REQUEST。 */
export async function advanceProductOrder(
  userId: number,
  productOrderId: number,
): Promise<{ orderId: number; status: string }> {
  const db = getDataSource().write();
  const [o] = await db
    .select()
    .from(productOrders)
    .where(and(eq(productOrders.id, productOrderId), eq(productOrders.userId, userId)))
    .limit(1);
  if (!o) throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
  const next: Record<string, string> = { pending: "paid", paid: "shipped" };
  const target = next[o.status];
  if (!target) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "订单已到终态，无法推进" });
  }

  const res = await db.execute(
    sql`UPDATE product_orders SET status = ${target} WHERE id = ${productOrderId} AND status = ${o.status}`,
  );
  if (affectedRows(res) === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "订单状态已变更，请刷新后重试" });
  }
  return { orderId: o.id, status: target };
}
