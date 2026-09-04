import {
  mysqlTable, mysqlEnum, serial, varchar, text, int, bigint, timestamp,
  decimal, boolean, json, uniqueIndex, index,
} from "drizzle-orm/mysql-core";

// ============ 用户（后端嫁接自带） ============
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============ 钓场 ============
export const ponds = mysqlTable("ponds", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(), // qinglong / ludao / laozhou / yunxi
  name: varchar("name", { length: 128 }).notNull(),
  region: varchar("region", { length: 128 }).notNull(),       // 武汉·江夏
  distanceKm: decimal("distance_km", { precision: 5, scale: 1 }).notNull().default("0"),
  rating: decimal("rating", { precision: 2, scale: 1 }).notNull().default("4.5"),
  reviewCount: int("review_count").notNull().default(0),
  priceFrom: int("price_from").notNull().default(68),         // 起价（元）
  cover: varchar("cover", { length: 255 }).notNull(),
  album: json("album").$type<string[]>().notNull(),
  tags: json("tags").$type<string[]>().notNull(),             // ["夜钓","斤塘"]
  fishSpecies: json("fish_species").$type<string[]>().notNull(),
  intro: text("intro"),
  openHours: varchar("open_hours", { length: 64 }).notNull().default("06:00–22:00"),
  isOpen: boolean("is_open").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ponds_region_rating").on(t.region, t.rating),
]);

// ============ 票种 ============
export const ticketTypes = mysqlTable("ticket_types", {
  id: serial("id").primaryKey(),
  pondId: bigint("pond_id", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 64 }).notNull(),   // 全天票
  price: int("price").notNull(),                      // 元
  durationDesc: varchar("duration_desc", { length: 64 }), // 6小时 / 18:00–24:00
  isHot: boolean("is_hot").notNull().default(false),
}, (t) => [index("idx_ticket_pond").on(t.pondId)]);

// ============ 钓位 ============
export const seats = mysqlTable("seats", {
  id: serial("id").primaryKey(),
  pondId: bigint("pond_id", { mode: "number", unsigned: true }).notNull(),
  seatNo: int("seat_no").notNull(),         // 1–24
  isVip: boolean("is_vip").notNull().default(false),
  // 遗留列：不再参与占用判定/展示口径（占用按 (pondId, visitDate, seatNo) 从订单实时计算，
  // 见 services/pond.ts occupiedSeats）。保留列仅为不动既有表结构，查询层一律覆盖计算。
  isSold: boolean("is_sold").notNull().default(false),
}, (t) => [
  uniqueIndex("uq_seat").on(t.pondId, t.seatNo),
  index("idx_seats_pond_sold").on(t.pondId, t.isSold),
]);

// ============ 鱼讯 ============
export const fishNews = mysqlTable("fish_news", {
  id: serial("id").primaryKey(),
  pondId: bigint("pond_id", { mode: "number", unsigned: true }).notNull(),
  content: varchar("content", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_news_pond_created").on(t.pondId, t.createdAt)]);

// ============ 帖子（社区信息流） ============
export const posts = mysqlTable("posts", {
  id: serial("id").primaryKey(),
  authorId: bigint("author_id", { mode: "number", unsigned: true }),
  authorName: varchar("author_name", { length: 64 }).notNull(),
  authorAvatar: varchar("author_avatar", { length: 255 }).notNull(),
  content: text("content").notNull(),
  images: json("images").$type<string[]>().notNull(),
  pondId: bigint("pond_id", { mode: "number", unsigned: true }),
  pondSlug: varchar("pond_slug", { length: 64 }), // 冗余列：写入时填充，消除推荐召回的相关子查询 N+1
  fishSpecies: varchar("fish_species", { length: 32 }),
  weightJin: decimal("weight_jin", { precision: 5, scale: 1 }),
  likeCount: int("like_count").notNull().default(0),
  commentCount: int("comment_count").notNull().default(0),
  impressionCount: int("impression_count").notNull().default(0), // 冗余列：曝光计数由事件消费者累加
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_posts_created").on(t.createdAt),
  index("idx_posts_pond").on(t.pondId),
]);

// ============ 订单 ============
export const orders = mysqlTable("orders", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  pondId: bigint("pond_id", { mode: "number", unsigned: true }).notNull(),
  ticketTypeId: bigint("ticket_type_id", { mode: "number", unsigned: true }).notNull(),
  visitDate: varchar("visit_date", { length: 10 }).notNull(),  // 2026-09-05
  quantity: int("quantity").notNull().default(1),
  seatNos: json("seat_nos").$type<number[]>().notNull(),
  totalAmount: int("total_amount").notNull(),
  verifyCode: varchar("verify_code", { length: 6 }).notNull().unique(),
  idempotencyKey: varchar("idempotency_key", { length: 64 }).unique(), // 客户端 ULID，重复提交返回原单
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending/used/completed/refunded
  createdAt: timestamp("created_at").notNull().defaultNow(),
  usedAt: timestamp("used_at"),
}, (t) => [
  index("idx_orders_user_created").on(t.userId, t.createdAt),
  index("idx_orders_pond").on(t.pondId),
  index("idx_orders_status_pond").on(t.status, t.pondId, t.createdAt),
]);

// ============ 点赞 ============
export const likes = mysqlTable("likes", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  postId: bigint("post_id", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_like").on(t.userId, t.postId),
  index("idx_likes_post").on(t.postId),
]);

// ============ 评论 ============
export const comments = mysqlTable("comments", {
  id: serial("id").primaryKey(),
  postId: bigint("post_id", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  authorName: varchar("author_name", { length: 64 }).notNull(),
  content: varchar("content", { length: 500 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_comments_post_created").on(t.postId, t.createdAt)]);

// ============ 评价（订单核销后） ============
export const reviews = mysqlTable("reviews", {
  id: serial("id").primaryKey(),
  orderId: bigint("order_id", { mode: "number", unsigned: true }).notNull().unique(),
  pondId: bigint("pond_id", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  authorName: varchar("author_name", { length: 64 }).notNull(),
  authorAvatar: varchar("author_avatar", { length: 255 }).notNull().default("/avatar-1.png"),
  rating: int("rating").notNull(),          // 1–5
  content: varchar("content", { length: 500 }),
  tags: json("tags").$type<string[]>().notNull(),
  images: json("images").$type<string[]>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_reviews_pond_created").on(t.pondId, t.createdAt)]);

// ============ 商品 ============
export const products = mysqlTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  category: varchar("category", { length: 32 }).notNull(), // 鱼竿/浮漂/灯具/座椅/鱼护/饵料
  price: int("price").notNull(),
  image: varchar("image", { length: 255 }).notNull(),
  desc: varchar("desc", { length: 255 }),
  sales: int("sales").notNull().default(0),
}, (t) => [
  index("idx_products_category").on(t.category, t.sales),
]);

// ============ 用户画像（推荐算法输入） ============
export const userProfiles = mysqlTable("user_profiles", {
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull().unique(),
  fishPrefs: json("fish_prefs").$type<Record<string, number>>().notNull(),  // {翘嘴:0.42}
  pondPrefs: json("pond_prefs").$type<Record<string, number>>().notNull(),  // {qinglong:0.3}
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ============ 行为事件（曝光/点击/完播/点赞…） ============
export const userEvents = mysqlTable("user_events", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  postId: bigint("post_id", { mode: "number", unsigned: true }).notNull(),
  action: varchar("action", { length: 16 }).notNull(), // impression/click/like/comment/favorite/complete
  durationMs: int("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_events_user").on(t.userId),
  index("idx_events_post_action").on(t.postId, t.action),
  index("idx_events_created").on(t.createdAt),
]);

// ============ Outbox 事件表（EventQueue 的持久化兜底，与业务写同事务） ============
export const outboxEvents = mysqlTable("outbox_events", {
  id: serial("id").primaryKey(),
  eventId: varchar("event_id", { length: 64 }).notNull(), // ULID，幂等键
  topic: varchar("topic", { length: 64 }).notNull(),
  payload: json("payload").$type<Record<string, unknown>>().notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending/done/failed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
}, (t) => [
  index("idx_outbox_status").on(t.status, t.id),
]);

// ============ 消费幂等去重表（at-least-once 投递下的 handler 去重） ============
export const processedEvents = mysqlTable("processed_events", {
  id: serial("id").primaryKey(),
  eventId: varchar("event_id", { length: 64 }).notNull().unique(),
  topic: varchar("topic", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============ 塘主看板每日汇总表（AnalyticsStore 物化视图，定时重算） ============
export const ownerStatsDaily = mysqlTable("owner_stats_daily", {
  id: serial("id").primaryKey(),
  pondId: bigint("pond_id", { mode: "number", unsigned: true }).notNull(),
  day: varchar("day", { length: 10 }).notNull(), // YYYY-MM-DD
  orders: int("orders").notNull().default(0),
  gmv: int("gmv").notNull().default(0),
  usedCnt: int("used_cnt").notNull().default(0),
  refreshedAt: timestamp("refreshed_at").notNull().defaultNow().onUpdateNow(),
}, (t) => [
  uniqueIndex("uq_stats").on(t.pondId, t.day),
]);

// ============ 商品订单（商城交易，独立于钓场门票订单） ============
export const productOrders = mysqlTable("product_orders", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  items: json("items").$type<{ productId: number; name: string; price: number; qty: number }[]>().notNull(),
  totalAmount: int("total_amount").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending/paid/shipped/done
  idempotencyKey: varchar("idempotency_key", { length: 64 }).unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_porders_user").on(t.userId, t.createdAt),
]);

export type Pond = typeof ponds.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type TicketType = typeof ticketTypes.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductOrder = typeof productOrders.$inferSelect;
