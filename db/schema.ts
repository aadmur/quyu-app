import {
  mysqlTable, mysqlEnum, serial, varchar, text, int, bigint, timestamp,
  decimal, boolean, json, uniqueIndex, index, double,
} from "drizzle-orm/mysql-core";

// ============ 用户（后端嫁接自带） ============
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  // 个人简介（v8.6.0）：个人主页展示，NULL 时前端显示默认文案
  bio: varchar("bio", { length: 200 }),
  // 主页封面（v8.8.0）：自定义上传或内置封面 URL，NULL 时前端用默认封面
  cover: varchar("cover", { length: 255 }),
  // 账号密码登录（v8.2.0）：scrypt 加盐哈希，格式 scrypt:<saltHex>:<hashHex>；Kimi OAuth 用户为 NULL
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // 账号注销冷静期（QY-E-005）：非 NULL 表示已申请注销，7 天冷静期到期后由定时任务匿名化；
  // 匿名化完成后置回 NULL（unionId 已改为 deleted:<id>:<ts>，无法再登录，天然不会被重复扫描）
  deletionRequestedAt: timestamp("deletion_requested_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
}, (t) => [
  index("idx_users_deletion").on(t.deletionRequestedAt),
]);

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
  // 自助认领码（#6）：塘主凭码在 /owner 页自助绑定钓场；NULL 表示未开放认领
  claimCode: varchar("claim_code", { length: 32 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ponds_region_rating").on(t.region, t.rating),
]);

// ============ 塘主-钓场绑定（#6：多钓场绑定 + 自助认证） ============
export const pondAdmins = mysqlTable("pond_admins", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  pondId: bigint("pond_id", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_pond_admin").on(t.userId, t.pondId),
  index("idx_pond_admin_pond").on(t.pondId),
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
  // 发布定位（v8.5.0）：用户开启「显示定位」时记录真实 GPS 坐标
  latitude: double("latitude"),
  longitude: double("longitude"),
  // 定位可读地址（v8.6.0）：逆地理编码结果，展示用；为空时前端回退坐标
  locationText: varchar("location_text", { length: 128 }),
  likeCount: int("like_count").notNull().default(0),
  commentCount: int("comment_count").notNull().default(0),
  impressionCount: int("impression_count").notNull().default(0), // 冗余列：曝光计数由事件消费者累加
  // 软删（QY-COMM-004）：NULL=正常；删除后置为删除时间，点赞/评论等互动数据保留
  deletedAt: timestamp("deleted_at"),
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

// ============ 关注关系（QY-COMM-005：follower 关注 followee） ============
export const follows = mysqlTable("follows", {
  id: serial("id").primaryKey(),
  followerId: bigint("follower_id", { mode: "number", unsigned: true }).notNull(),
  followeeId: bigint("followee_id", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_follow").on(t.followerId, t.followeeId),
  index("idx_follow_followee").on(t.followeeId),
]);

// ============ 评论 ============
export const comments = mysqlTable("comments", {
  id: serial("id").primaryKey(),
  postId: bigint("post_id", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  authorName: varchar("author_name", { length: 64 }).notNull(),
  // v14：对齐 posts/reviews 的冗余模式，消除前端 (userId+id)%7 假头像
  authorAvatar: varchar("author_avatar", { length: 255 }).notNull().default("/avatar-1.png"),
  content: varchar("content", { length: 500 }).notNull(),
  // 评论图片（v14）：落盘 URL 数组，发布前过机审（ADR-0003）
  images: json("images").$type<string[]>().notNull(),
  // 楼中楼（QY-COMM-006）：NULL=顶层评论；回复时指向所属顶层评论（最多两层）
  parentId: bigint("parent_id", { mode: "number", unsigned: true }),
  likeCount: int("like_count").notNull().default(0),
  // 软删（v14，与 posts.deletedAt 同语义）：删除后置为时间，渲染「该评论已删除」占位，
  // 关键是保留楼中楼结构不塌陷（硬删顶层会让子回复孤儿化）
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_comments_post_created").on(t.postId, t.createdAt),
  // 热门排序分页（v14）：与最新排序各走一套游标，互不共用
  index("idx_comments_post_like").on(t.postId, t.likeCount, t.createdAt),
  // 楼中楼取子回复（v14）
  index("idx_comments_parent").on(t.parentId, t.createdAt),
]);

// ============ 评论点赞（v14，ADR-0004：不复用 likes 表） ============
// likes 是 post 专用且 backlog B-06 记有其 INSERT 与 likeCount 累加非同事务的隐患，
// 不在未修复前往上叠加改造。代价是系统里存在两张点赞表。
export const commentLikes = mysqlTable("comment_likes", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  commentId: bigint("comment_id", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_comment_like").on(t.userId, t.commentId),
  index("idx_comment_like_comment").on(t.commentId),
]);

// ============ 帖子收藏（v14，归集到 /favorites 的「帖子」Tab） ============
export const postFavorites = mysqlTable("post_favorites", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  postId: bigint("post_id", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_post_favorite").on(t.userId, t.postId),
  index("idx_favorite_user_created").on(t.userId, t.createdAt),
]);

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

// ============ 钓场收藏/订阅（fav 收藏 | news 订阅鱼讯） ============
export const pondMarks = mysqlTable("pond_marks", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  pondId: bigint("pond_id", { mode: "number", unsigned: true }).notNull(),
  kind: varchar("kind", { length: 8 }).notNull(), // fav 收藏 / news 订阅鱼讯
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_pond_mark").on(t.userId, t.pondId, t.kind),
  index("idx_marks_user").on(t.userId),
]);

// ============ 消息中心通知（点赞/评论/核销） ============
export const notifications = mysqlTable("notifications", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(), // 接收者
  type: varchar("type", { length: 16 }).notNull(), // like / comment / reply / verify / refund
  actorName: varchar("actor_name", { length: 64 }).notNull(), // 动作发起者昵称
  refId: bigint("ref_id", { mode: "number", unsigned: true }).notNull(), // 帖子 id 或订单 id
  preview: varchar("preview", { length: 255 }).notNull().default(""), // 内容摘要（前 50 字）
  // 注意：MySQL 中 read 是保留字，列名用 is_read
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_notifications_user_read").on(t.userId, t.isRead),
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

// ============ 内容举报（v8.8.0 社区内容安全） ============
export const reports = mysqlTable("reports", {
  id: serial("id").primaryKey(),
  reporterId: bigint("reporter_id", { mode: "number", unsigned: true }).notNull(), // 举报人
  postId: bigint("post_id", { mode: "number", unsigned: true }).notNull(),         // 被举报帖子
  // 评论级举报（v14）：**0 = 举报整帖**，非 0 = 举报该帖下的某条评论。
  // 刻意用 NOT NULL DEFAULT 0 而不是 nullable：MySQL 唯一索引里 NULL <> NULL，
  // 若做成 NULL 列并入 uq_report，同一人对同帖的重复举报将不再被去重（幂等性失效）。
  commentId: bigint("comment_id", { mode: "number", unsigned: true }).notNull().default(0),
  reason: varchar("reason", { length: 255 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending/ignored/actioned
  handledBy: bigint("handled_by", { mode: "number", unsigned: true }),
  handledAt: timestamp("handled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_report").on(t.reporterId, t.postId, t.commentId), // 同一人对同一目标重复举报幂等
  index("idx_reports_status").on(t.status),
]);

// ============ 塘主入驻申请（QY-D-002） ============
export const pondApplications = mysqlTable("pond_applications", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(), // 申请人
  pondName: varchar("pond_name", { length: 128 }).notNull(),
  region: varchar("region", { length: 128 }).notNull(),       // 地区，如 武汉·江夏
  address: varchar("address", { length: 255 }).notNull(),     // 详细地址（ponds 表无地址列，仅留在申请档案）
  contactPhone: varchar("contact_phone", { length: 32 }).notNull(),
  ticketDesc: varchar("ticket_desc", { length: 255 }).notNull(), // 票种意向（自由文本）
  photos: json("photos").$type<string[]>().notNull(),          // ≤4 张，/uploads/applications/* URL
  note: varchar("note", { length: 500 }),                      // 补充说明（可空）
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending/approved/rejected
  reviewNote: varchar("review_note", { length: 255 }),         // 审批备注（拒绝必填）
  reviewedBy: bigint("reviewed_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  reviewedAt: timestamp("reviewed_at"),
}, (t) => [
  index("idx_pond_apps_user_status").on(t.userId, t.status),
]);

// ============ 哪钓 · 用户余额（预付费，识别按次扣费；单位：分） ============
export const userBalance = mysqlTable("user_balance", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull().unique(),
  balanceCents: int("balance_cents").notNull().default(0),
  // 已用免费识别次数（配合 FISH_SPOT_FREE_LIMIT 的「前 N 次免费」钩子）
  freeUsed: int("free_used").notNull().default(0),
  // 已用免费专家报告次数（QY-SPOT-007 分层定价，与基础档免费额度分列记账）
  expertFreeUsed: int("expert_free_used").notNull().default(0),
  // 已用免费识鱼次数（QY-FISH-003，与钓点各档免费额度分列记账，互不挪用）
  fishIdFreeUsed: int("fish_id_free_used").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_user_balance_user").on(t.userId),
]);

// ============ 哪钓 · 充值订单（mock/wechat/alipay/manual） ============
export const rechargeOrders = mysqlTable("recharge_orders", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  amountCents: int("amount_cents").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending/paid/failed
  provider: varchar("provider", { length: 16 }).notNull().default("mock"), // mock/wechat/alipay/manual
  outTradeNo: varchar("out_trade_no", { length: 64 }).notNull().unique(),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_recharge_user").on(t.userId, t.createdAt),
]);

// ============ 哪钓 · 识别台账（计费对账；仅存元数据，不存卡片正文/图片，合规最小化） ============
export const fishSpotCalls = mysqlTable("fish_spot_calls", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),      // ok / error
  billing: varchar("billing", { length: 8 }).notNull(),     // free / paid
  costCents: int("cost_cents").notNull().default(0),        // 向用户收取（免费=0）
  tier: varchar("tier", { length: 8 }).notNull().default("basic"), // basic / expert（QY-SPOT-007）
  score: int("score"),                                      // 综合评分（冗余，便于对账/运营）
  waterType: varchar("water_type", { length: 32 }),
  /** 知识库是否命中规则（QY-SPOT-003 命中率统计口径；仅布尔元数据，不存规则正文） */
  ruleHit: boolean("rule_hit"),
  /** 命中的规则 id 串（逗号分隔，可审计；正文仍不落库） */
  ruleIds: varchar("rule_ids", { length: 128 }),
  /** 本次识别步数：基础档 1、专家档 2（成本核算口径） */
  k3Steps: int("k3_steps").notNull().default(1),
  promptTokens: int("prompt_tokens").notNull().default(0),
  completionTokens: int("completion_tokens").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_fishspot_user_created").on(t.userId, t.createdAt),
]);

// ============ 哪钓 · 样本存图授权（QY-SPOT-008 合规：默认不存，显式授权才存） ============
// 与计费台账物理分离：fish_spot_calls 永远不存图与正文，授权状态单列此处。
export const fishSpotSampleConsents = mysqlTable("fish_spot_sample_consents", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull().unique(),
  /** 授权范围：image=存原图，features=仅存结构化特征与报告（不含图） */
  scope: varchar("scope", { length: 16 }).notNull().default("image"),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
}, (t) => [
  index("idx_spot_consent_user").on(t.userId),
]);

// ============ 哪钓 · 识别样本（二期 LoRA 微调备料；仅在显式授权下写入） ============
export const fishSpotSamples = mysqlTable("fish_spot_samples", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  /** 关联台账行（可空：台账写失败不应阻断样本，反之删除样本不得动台账） */
  callId: int("call_id"),
  tier: varchar("tier", { length: 8 }).notNull().default("basic"),
  /** 授权后落盘的样本图路径（/uploads/spots/...）；scope=features 或未存图时为 null */
  imagePath: varchar("image_path", { length: 255 }),
  /** 用户提交的现场参数（季节/水温/天气/目标鱼等），JSON */
  inputs: json("inputs"),
  /** Step 1 视觉特征，JSON */
  features: json("features"),
  /** 命中规则 id 串，便于按规则版本回溯 */
  ruleIds: varchar("rule_ids", { length: 128 }),
  /** 最终结构化报告，JSON（微调监督目标） */
  report: json("report"),
  /** 样本状态：collected=已入库，labeled=已人工标注，exported=已导出 */
  status: varchar("status", { length: 16 }).notNull().default("collected"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_spot_sample_user_created").on(t.userId, t.createdAt),
  index("idx_spot_sample_status").on(t.status),
]);

// ============ 哪钓 · 报告质量反馈（不存图，用于筛选高质量样本） ============
export const fishSpotFeedback = mysqlTable("fish_spot_feedback", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  sampleId: int("sample_id"),
  /** 无样本授权时也可反馈，按台账行关联 */
  callId: int("call_id"),
  /** useful=有用 / inaccurate=不准 / bait_miss=饵料或钓组不符实际 */
  rating: varchar("rating", { length: 16 }).notNull(),
  note: varchar("note", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_spot_feedback_user").on(t.userId, t.createdAt),
  index("idx_spot_feedback_rating").on(t.rating),
]);

export type UserBalance = typeof userBalance.$inferSelect;
export type RechargeOrder = typeof rechargeOrders.$inferSelect;
export type FishSpotCall = typeof fishSpotCalls.$inferSelect;
export type FishSpotSample = typeof fishSpotSamples.$inferSelect;
export type FishSpotFeedback = typeof fishSpotFeedback.$inferSelect;
export type FishSpotSampleConsent = typeof fishSpotSampleConsents.$inferSelect;

// ============ 识鱼 · 识别台账（计费对账；仅存元数据，不存图片/正文，合规最小化） ============
export const fishIdCalls = mysqlTable("fish_id_calls", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),      // ok / error
  billing: varchar("billing", { length: 8 }).notNull(),     // free / paid
  costCents: int("cost_cents").notNull().default(0),        // 向用户收取（免费=0）
  /** Top-1 鱼种名（冗余，便于对账/运营） */
  topFishName: varchar("top_fish_name", { length: 32 }),
  /** Top-1 置信度 0-1 */
  topConfidence: double("top_confidence"),
  promptTokens: int("prompt_tokens").notNull().default(0),
  completionTokens: int("completion_tokens").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_fishid_user_created").on(t.userId, t.createdAt),
]);

export type FishIdCall = typeof fishIdCalls.$inferSelect;

// ============ 识鱼 · 识别样本（微调备料；仅在显式授权下写入，默认不存图） ============
export const fishIdSamples = mysqlTable("fish_id_samples", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  /** 关联台账行（可空：台账写失败不应阻断样本） */
  callId: int("call_id"),
  /** 授权后落盘的样本图路径（/uploads/spots/...）；未存图时为 null */
  imagePath: varchar("image_path", { length: 255 }),
  /** 完整识鱼结果 JSON（Top-3 候选 + 置信度 + 兜底说明） */
  result: json("result"),
  /** Top-1 鱼种名（冗余，便于检索与统计） */
  topFishName: varchar("top_fish_name", { length: 32 }),
  /** 用户纠正后的鱼种名（高价值标注；null = 未纠正） */
  correctedFish: varchar("corrected_fish", { length: 32 }),
  /** 样本状态：collected=已入库，labeled=已人工标注，exported=已导出 */
  status: varchar("status", { length: 16 }).notNull().default("collected"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_fishid_sample_user_created").on(t.userId, t.createdAt),
  index("idx_fishid_sample_status").on(t.status),
]);

export type FishIdSample = typeof fishIdSamples.$inferSelect;

export type Report = typeof reports.$inferSelect;
export type PondApplication = typeof pondApplications.$inferSelect;

export type Pond = typeof ponds.$inferSelect;
export type PondAdmin = typeof pondAdmins.$inferSelect;
export type PondMark = typeof pondMarks.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Follow = typeof follows.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type TicketType = typeof ticketTypes.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductOrder = typeof productOrders.$inferSelect;
