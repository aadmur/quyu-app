/**
 * @layer Application Layer —— ShopService（商品/商城）
 * @file api/services/shop.ts
 *
 * 数据主权：products 表唯一写方。
 * P0 修复：列表全表内存过滤 → category 条件下推 SQL（命中 idx_products_category）+ 结果缓存 120s。
 */
import { desc, eq, like, or, sql } from "drizzle-orm";
import { productOrders, products, type Product, type ProductOrder } from "@db/schema";
import { getCache, getDataSource, isDupEntry, timedRead } from "../infra";

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
