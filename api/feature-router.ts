/**
 * @layer Application Layer —— tRPC 薄路由层（只做参数校验与服务调用）
 * @file api/feature-router.ts
 *
 * 业务逻辑已下沉到 api/services/*（Community/PondCatalog/Order/Shop/Recommend/OwnerDashboard）。
 * 对外契约（路径/入参/出参）与改造前完全一致，前端零改动。
 * 横切：traced（结构化日志）+ rateLimit（TokenBucket，见 api/middleware.ts）。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, rateLimit, tracedPublic } from "./middleware";
import { toggleLike, addComment, listComments, listNews, createPost, getPost, deletePost, editPost, searchPosts, getShareCard } from "./services/community";
import { toggleFollow, followState, followStats, followersList, followingList } from "./services/social";
import { reportPost, listReports, handleReport } from "./services/moderation";
import { submitApplication, myApplication, listPendingApplications, reviewApplication, pendingApplicationCount } from "./services/pondApplication";
import { listPonds, getPondDetail, publishNews, toggleMark, myMarks, myFavoritePonds, listPondReviews } from "./services/pond";
import { createOrder, myOrders, refundOrder, reviewOrder } from "./services/trade";
import { listNotifications, unreadCount, markAllRead } from "./services/notify";
import { ownerStatsScoped, ownerWeekly, verifyOrderScoped } from "./services/ownerService";
import { claimPond, myPonds, type OwnerUser } from "./services/ownerBinding";
import { listProducts, searchProducts, createProductOrder, myProductOrders, refundProductOrder, confirmProductOrder, advanceProductOrder } from "./services/shop";
import { recommendFeed, followingFeed, trackEvent } from "./services/recommendService";
import { getProfile, updateUserProfile, getProfileOverview } from "./services/profileService";
import { getVersionInfo } from "./services/appVersion";
import { adminCredit, getBalance, identify, knowledgeStatus, recharge, setSampleConsent, submitFeedback } from "./services/fishSpot";

/**
 * MVP 演示用户：未登录时以 userId=1 体验完整链路。
 * 生产收紧：ALLOW_DEMO_USER=false 时未登录 mutation 直接 401（P0 权限缺口的开关化隔离，
 * 默认开启以维持现有前端演示体验，独立部署时必须关闭）。
 */
const DEMO_USER_ID = 1;
const ALLOW_DEMO_USER = (process.env.ALLOW_DEMO_USER ?? "true") !== "false";

function uid(ctx: { user?: { id: number } | null }) {
  if (ctx.user) return ctx.user.id;
  if (ALLOW_DEMO_USER) return DEMO_USER_ID;
  throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
}

/** 限流 key：登录用户按 userId，匿名按真实连接 IP（ctx.ip 来自 socket，不信任可伪造的 XFF） */
function actorKey(ctx: { user?: { id: number } | null; ip?: string }) {
  if (ctx.user) return `u:${ctx.user.id}`;
  return `ip:${ctx.ip ?? "unknown"}`;
}

/** IP 维度限流 key（核销码防爆破的双维度之一，匿名/登录都按真实连接 IP 计） */
function ipKey(ctx: { ip?: string }) {
  return `ip:${ctx.ip ?? "unknown"}`;
}

/** 塘主门禁（v8.6.0 多钓场绑定）：全局 admin 或 pond_admins 有任何绑定的塘主。
 *  返回规范化 OwnerUser 供下游作用域过滤；不满足抛 403。 */
async function requireManager(ctx: { user?: { id: number; role: string } | null }): Promise<OwnerUser> {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  const user: OwnerUser = { id: ctx.user.id, role: ctx.user.role };
  if (user.role === "admin") return user;
  if ((await myPonds(user)).length > 0) return user;
  throw new TRPCError({ code: "FORBIDDEN", message: "仅限钓场审核员或已绑定塘主" });
}

export const featureRouter = createRouter({
  // ============ 推荐信息流（抖音式算法） ============
  feed: tracedPublic
    .input(z.object({ page: z.number().min(1).default(1), pageSize: z.number().min(1).max(20).default(5) }))
    .query(async ({ ctx, input }) => {
      return recommendFeed(uid(ctx), input.page, input.pageSize);
    }),

  // 行为埋点：曝光/点击/完播/点赞入队即返回，异步批量落库
  track: tracedPublic
    .input(z.object({ postId: z.number(), action: z.enum(["impression", "click", "complete", "like", "comment", "favorite"]), durationMs: z.number().default(0) }))
    .mutation(async ({ ctx, input }) => {
      await trackEvent(uid(ctx), input.postId, input.action, input.durationMs);
      return { ok: true };
    }),

  // 用户画像（前端「推荐依据」可视化）
  profileInsight: tracedPublic.query(async ({ ctx }) => {
    const p = await getProfile(uid(ctx));
    return p ?? { fishPrefs: {}, pondPrefs: {} };
  }),

  // ============ APP 版本检查（QY-G-003） ============
  // APK 壳版本信息：{ latestApkVersion, apkUrl, notes, force }。
  // 数据源：APP_VERSION_FILE JSON 文件（mtime 热更）→ env 兜底 → latestApkVersion: null。
  // 纯增量公共接口，未配置时前端不打扰；读取失败 fail-open，不影响其他接口。
  versionInfo: tracedPublic.query(async () => {
    return getVersionInfo();
  }),

  // ============ 钓场 ============
  ponds: createRouter({
    list: tracedPublic
      .input(z.object({ keyword: z.string().optional(), tag: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return listPonds(input);
      }),
    detail: tracedPublic
      .input(
        z.object({
          slug: z.string(),
          // 可选：座位占用口径的游玩日（YYYY-MM-DD），缺省按"今天"（DB 会话时区）
          visitDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "visitDate 格式须为 YYYY-MM-DD")
            .optional(),
        }),
      )
      .query(async ({ input }) => {
        return getPondDetail(input.slug, input.visitDate);
      }),
    news: tracedPublic.query(async () => {
      return listNews();
    }),
    // 钓场评价列表（v8.8.0）：分页 + 评分分布聚合
    reviews: tracedPublic
      .input(z.object({ slug: z.string(), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(50).default(10) }))
      .query(async ({ input }) => {
        return listPondReviews(input.slug, input.page, input.pageSize);
      }),
    // 塘主发布鱼讯：全局 admin 可发任意钓场；绑定塘主仅可发自己绑定的钓场
    publishNews: tracedPublic
      .input(z.object({ pondSlug: z.string().min(1).max(64), content: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        const user = await requireManager(ctx);
        if (user.role !== "admin") {
          const owned = await myPonds(user);
          if (!owned.some((p) => p.slug === input.pondSlug)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "只能给自己绑定的钓场发布鱼讯" });
          }
        }
        return publishNews(input.pondSlug, input.content, user.id);
      }),
    // 收藏 / 订阅鱼讯切换（匿名走演示用户兜底，与 posts.like 同口径）
    toggleMark: tracedPublic
      .use(rateLimit({ capacity: 30, refillPerSec: 30 / 60, key: actorKey }))
      .input(z.object({ pondSlug: z.string(), kind: z.enum(["fav", "news"]) }))
      .mutation(async ({ ctx, input }) => {
        return toggleMark(uid(ctx), input.pondSlug, input.kind);
      }),
    // 我的收藏/订阅 slug 集合：{ fav: string[], news: string[] }
    myMarks: tracedPublic.query(async ({ ctx }) => {
      return myMarks(uid(ctx));
    }),
    // 我收藏的钓场完整列表（按收藏时间倒序）
    myFavorites: tracedPublic.query(async ({ ctx }) => {
      return myFavoritePonds(uid(ctx));
    }),
  }),

  // ============ 消息中心（点赞/评论/核销通知） ============
  notify: createRouter({
    // 通知列表（近 50 条倒序）
    list: tracedPublic.query(async ({ ctx }) => {
      return listNotifications(uid(ctx));
    }),
    // 未读数：{ count: number }
    unreadCount: tracedPublic.query(async ({ ctx }) => {
      return unreadCount(uid(ctx));
    }),
    // 全部标记已读
    markAllRead: tracedPublic.mutation(async ({ ctx }) => {
      await markAllRead(uid(ctx));
      return { ok: true };
    }),
  }),

  // ============ 帖子互动 ============
  posts: createRouter({
    like: tracedPublic
      .use(rateLimit({ capacity: 30, refillPerSec: 1, key: actorKey }))
      .input(z.object({ postId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再点赞" });
        return toggleLike(ctx.user.id, input.postId, ctx.user.name ?? "钓友");
      }),
    comment: tracedPublic
      .use(rateLimit({ capacity: 10, refillPerSec: 0.2, key: actorKey, message: "评论太频繁了，休息一下" }))
      .input(z.object({ postId: z.number(), content: z.string().min(1).max(500), authorName: z.string().default("钓友"), parentId: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再评论" });
        await addComment(ctx.user.id, input.postId, input.content, ctx.user.name ?? input.authorName, ctx.user.name ?? "钓友", input.parentId);
        return { ok: true };
      }),
    // 帖子删除（软删）：仅作者本人，必须登录
    delete: tracedPublic
      .input(z.object({ postId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        return deletePost(ctx.user.id, input.postId);
      }),
    // 帖子编辑：仅作者本人，必须登录
    edit: tracedPublic
      .input(z.object({
        postId: z.number(),
        content: z.string().min(1).max(1000).optional(),
        images: z.array(z.string()).optional(),
        fishSpecies: z.string().optional(),
        weightJin: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        const { postId, ...rest } = input;
        return editPost(ctx.user.id, postId, rest);
      }),
    // 帖子搜索（v8.7.0）：关键词匹配内容/鱼种，分页
    search: tracedPublic
      .input(z.object({ keyword: z.string().min(1).max(64), page: z.number().min(1).default(1), pageSize: z.number().min(1).max(20).default(10) }))
      .query(async ({ input }) => {
        return searchPosts(input.keyword, input.page, input.pageSize);
      }),
    // 关注/取关（v8.7.0）
    toggleFollow: tracedPublic
      .use(rateLimit({ capacity: 30, refillPerSec: 1, key: actorKey }))
      .input(z.object({ targetUserId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再关注" });
        return toggleFollow(ctx.user.id, input.targetUserId);
      }),
    // 关注状态 + 粉丝数
    followState: tracedPublic
      .input(z.object({ targetUserId: z.number() }))
      .query(async ({ ctx, input }) => {
        return followState(uid(ctx), input.targetUserId);
      }),
    // 关注动态流（v8.8.0）：仅我关注作者的帖子，时间倒序
    followingFeed: tracedPublic
      .input(z.object({ page: z.number().min(1).default(1), pageSize: z.number().min(1).max(20).default(5) }))
      .query(async ({ ctx, input }) => {
        return followingFeed(uid(ctx), input.page, input.pageSize);
      }),
    // 粉丝 / 关注列表（viewerId 用真实登录态，匿名 isFollowingBack 恒 false）
    followersList: tracedPublic.query(async ({ ctx }) => {
      return followersList(uid(ctx), ctx.user?.id ?? null);
    }),
    followingList: tracedPublic.query(async ({ ctx }) => {
      return followingList(uid(ctx), ctx.user?.id ?? null);
    }),
    comments: tracedPublic
      .input(z.object({ postId: z.number() }))
      .query(async ({ input }) => {
        return listComments(input.postId);
      }),
    // 帖子详情页：单帖查询（不存在返回 404）
    detail: tracedPublic
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const post = await getPost(input.id);
        if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在或已删除" });
        return post;
      }),
    // 渔获分享卡片（QY-COMM-009）：渲染卡片所需数据 + 落地页二维码 DataURL（失败降级 null）
    shareCard: tracedPublic
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const card = await getShareCard(input.id);
        if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在或已删除" });
        return card;
      }),
    create: tracedPublic
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: actorKey, message: "发布太频繁，请稍后再试" }))
      .input(z.object({
        content: z.string().min(1).max(1000),
        images: z.array(z.string()).default([]),
        pondSlug: z.string().optional(),
        fishSpecies: z.string().optional(),
        weightJin: z.number().optional(),
        // 发布定位（可选）：真实 GPS 坐标
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        // 定位可读地址（逆地理编码结果，可选）
        locationText: z.string().max(128).optional(),
        authorName: z.string().max(64).default("钓友"),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再发布" });
        const userId = ctx.user.id;
        const name = ctx.user.name ?? input.authorName;
        const avatar = (ctx.user as { avatar?: string } | undefined)?.avatar ?? "/avatar-1.png";
        return createPost({ id: userId, name, avatar }, input);
      }),
  }),

  // ============ 订单（真实下单/核销/评价） ============
  orders: createRouter({
    create: tracedPublic
      .use(rateLimit({ capacity: 10, refillPerSec: 10 / 60, key: actorKey, message: "下单太频繁，请稍后再试" }))
      .input(z.object({
        pondSlug: z.string(),
        ticketTypeId: z.number(),
        visitDate: z.string(),
        quantity: z.number().min(1).max(4),
        seatNos: z.array(z.number()).default([]),
        totalAmount: z.number(),
        // 新增可选幂等键（向后兼容：旧前端不传时服务端生成）
        idempotencyKey: z.string().max(64).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再下单" });
        return createOrder(ctx.user.id, input);
      }),
    mine: tracedPublic.query(async ({ ctx }) => {
      return myOrders(uid(ctx));
    }),
    // 退款（v8.6.0）：仅本人待使用订单可退，CAS 状态机迁移；必须真实登录
    refund: tracedPublic
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: actorKey, message: "退款操作太频繁，请稍后再试" }))
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再退款" });
        return refundOrder(ctx.user.id, input.orderId);
      }),
    // 我绑定的钓场（塘主多钓场绑定）；登录即可调，零绑定返回空数组驱动前端认领引导
    myPonds: tracedPublic.query(async ({ ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      return myPonds({ id: ctx.user.id, role: ctx.user.role });
    }),
    // 自助认领钓场：认领码防爆破，用户+IP 双维度 5 次/min
    claimPond: tracedPublic
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: ipKey, message: "认领尝试过于频繁" }))
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: (ctx) => `u:${ctx.user?.id ?? "anon"}`, message: "认领尝试过于频繁" }))
      .input(z.object({ slug: z.string().min(1).max(64), code: z.string().min(4).max(32) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再绑定钓场" });
        return claimPond(ctx.user.id, input.slug, input.code);
      }),
    verify: tracedPublic
      // 核销是资金敏感操作：必须登录（匿名 401，不走 DEMO_USER 兜底）。
      // 塘主认证（v8.6.0 多钓场）：全局 admin 或 pond_admins 绑定塘主，且仅能核销自己管理钓场的订单。
      // 核销码 6 位数字可爆破 → IP + 用户双维度 5 次/min 严格限流（arch-v5 §8 P2 缓解），
      // IP 取真实连接地址（socket），不信任客户端可伪造的 XFF。
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: ipKey, message: "核销尝试过于频繁" }))
      // 用户维度独立成桶（匿名共享 "anon" 桶），避免与 ipKey 回落同 key 重复扣减
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: (ctx) => `u:${ctx.user?.id ?? "anon"}`, message: "核销尝试过于频繁" }))
      .input(z.object({ code: z.string().length(6) }))
      .mutation(async ({ ctx, input }) => {
        const user = await requireManager(ctx);
        return verifyOrderScoped(user, input.code);
      }),
    review: tracedPublic
      .input(z.object({ orderId: z.number(), rating: z.number().min(1).max(5), content: z.string().max(500), tags: z.array(z.string()).default([]), images: z.array(z.string()).default([]) }))
      .mutation(async ({ ctx, input }) => {
        // authorName 取登录用户昵称（演示兜底用户无昵称时回退"我"）
        const authorName = ctx.user?.name?.trim() || "我";
        await reviewOrder(uid(ctx), authorName, input);
        return { ok: true };
      }),
    // 塘主端看板（v8.6.0 作用域化）：全局 admin 看全站（可选 pondId 过滤）；
    // 绑定塘主仅看自己绑定的钓场；零绑定返回全 0 看板（前端另有认领引导）
    ownerStats: tracedPublic
      .input(z.object({ pondId: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const user = await requireManager(ctx);
        return ownerStatsScoped(user, input?.pondId);
      }),
    // 经营周报（v8.6.0）：接 owner_stats_daily 物化表，近 7 天 + 环比上周
    ownerWeekly: tracedPublic
      .input(z.object({ pondId: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const user = await requireManager(ctx);
        return ownerWeekly(user, input?.pondId);
      }),
  }),

  // ============ 商品 ============
  products: createRouter({
    list: tracedPublic
      .input(z.object({ category: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return listProducts(input?.category);
      }),
    search: tracedPublic
      .input(z.object({ keyword: z.string().max(64) }))
      .query(async ({ input }) => {
        return searchProducts(input.keyword);
      }),
    order: tracedPublic
      .use(rateLimit({ capacity: 10, refillPerSec: 10 / 60, key: actorKey, message: "下单太频繁，请稍后再试" }))
      .input(z.object({
        items: z.array(z.object({ productId: z.number(), qty: z.number().min(1).max(99) })).min(1),
        idempotencyKey: z.string().max(64).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再下单" });
        return createProductOrder(ctx.user.id, input.items, input.idempotencyKey);
      }),
    mine: tracedPublic.query(async ({ ctx }) => {
      return myProductOrders(uid(ctx));
    }),
    // 商品订单退款（v8.7.0）：仅本人 pending/paid 可退，CAS + 幂等（口径对照门票退款）
    refund: tracedPublic
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: actorKey, message: "退款操作太频繁，请稍后再试" }))
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再退款" });
        return refundProductOrder(ctx.user.id, input.orderId);
      }),
    // 确认收货：shipped → done
    confirm: tracedPublic
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        return confirmProductOrder(ctx.user.id, input.orderId);
      }),
    // 模拟发货进度（测试用途）：pending → paid → shipped
    advance: tracedPublic
      .use(rateLimit({ capacity: 10, refillPerSec: 10 / 60, key: actorKey }))
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        return advanceProductOrder(ctx.user.id, input.orderId);
      }),
  }),

  users: createRouter({
    // 个人主页总览（真实统计）：发帖数/获赞/待使用票券/渔获墙/鱼种分布/等级/简介
    overview: tracedPublic.query(async ({ ctx }) => {
      return getProfileOverview(uid(ctx));
    }),
    // 关注统计（v8.7.0）：{ followers, following }
    followStats: tracedPublic.query(async ({ ctx }) => {
      return followStats(uid(ctx));
    }),
    // 资料修改仅限真实登录用户（不走匿名演示兜底），并按 actorKey 限流
    update: tracedPublic
      .use(rateLimit({ capacity: 10, refillPerSec: 10 / 60, key: actorKey, message: "资料修改太频繁，请稍后再试" }))
      .input(z.object({ name: z.string().min(1).max(64).optional(), avatar: z.string().max(255).optional(), avatarData: z.string().max(2_800_000).optional(), bio: z.string().max(200).optional(), cover: z.string().max(255).optional(), coverData: z.string().max(5_000_000).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再修改资料" });
        }
        return updateUserProfile(ctx.user.id, input);
      }),
  }),

  // ============ 塘主入驻申请（QY-D-002） ============
  pondApply: createRouter({
    // 提交入驻申请：必须真实登录；每用户 3 次/天限流；有 pending 申请时服务端幂等拒绝
    submit: tracedPublic
      .use(rateLimit({ capacity: 3, refillPerSec: 3 / 86400, key: (ctx) => `u:${ctx.user?.id ?? "anon"}`, message: "每天最多提交 3 次入驻申请" }))
      .input(z.object({
        pondName: z.string().min(1, "请填写塘名").max(64),
        region: z.string().min(1, "请填写地区").max(64),
        address: z.string().min(1, "请填写详细地址").max(128),
        contactPhone: z.string().min(5, "请填写联系电话").max(32),
        ticketDesc: z.string().min(1, "请填写票种意向").max(255),
        note: z.string().max(500).optional(),
        photoData: z.array(z.string().max(2_000_000)).max(4).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再提交入驻申请" });
        return submitApplication(ctx.user.id, input);
      }),
    // 我的最近一次申请状态（表单页顶部状态卡；approved 时含 pondSlug/claimCode）
    mine: tracedPublic.query(async ({ ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      return myApplication(ctx.user.id);
    }),
    // 待审列表：仅全局 admin（塘主 FORBIDDEN，与 /moderation 举报队列的塘主作用域不同）
    list: tracedPublic.query(async ({ ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅限平台管理员审核入驻申请" });
      return listPendingApplications();
    }),
    // 待审数角标：仅 admin
    pendingCount: tracedPublic.query(async ({ ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅限平台管理员" });
      return pendingApplicationCount();
    }),
    // 审批：通过（事务内建塘 + 认领码 + 通知）/ 拒绝（备注必填 + 通知）；CAS 幂等
    review: tracedPublic
      .input(z.object({
        applicationId: z.number(),
        action: z.enum(["approve", "reject"]),
        reviewNote: z.string().max(255).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅限平台管理员审核入驻申请" });
        return reviewApplication({ id: ctx.user.id }, input.applicationId, input.action, input.reviewNote);
      }),
  }),

  // ============ 内容举报与审核（v8.8.0） ============
  moderation: createRouter({
    // 举报帖子：必须真实登录；同一人同帖幂等（uq_report）
    report: tracedPublic
      .use(rateLimit({ capacity: 10, refillPerSec: 10 / 60, key: actorKey, message: "举报太频繁，请稍后再试" }))
      .input(z.object({ postId: z.number(), reason: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再举报" });
        return reportPost(ctx.user.id, input.postId, input.reason);
      }),
    // 审核队列：admin 全站；绑定塘主仅自己钓场的帖子
    list: tracedPublic.query(async ({ ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      return listReports({ id: ctx.user.id, role: ctx.user.role });
    }),
    // 处理举报：忽略 / 下架帖子（CAS 防并发重复处理）
    handle: tracedPublic
      .input(z.object({ reportId: z.number(), action: z.enum(["ignore", "delete"]) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        return handleReport({ id: ctx.user.id, role: ctx.user.role }, input.reportId, input.action);
      }),
  }),

  // ============ 哪钓 · K3 钓点识别 + 预付费余额 ============
  fishSpot: createRouter({
    // 余额/免费次数：资金相关，必须真实登录
    balance: tracedPublic.query(async ({ ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      return getBalance(ctx.user.id);
    }),
    // 拍照识别钓点：先占免费/预扣余额 → 调 K3 → 失败退还 → 成功出卡片
    identify: tracedPublic
      .use(rateLimit({ capacity: 30, refillPerSec: 30 / 3600, key: actorKey, message: "识别太频繁，请稍后再试" }))
      .input(z.object({
        imageData: z.string().max(6_000_000),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        locationText: z.string().max(128).optional(),
        // QY-SPOT-007 分层：缺省 basic（老 APK 不传，链路逐字不变）
        tier: z.enum(["basic", "expert"]).optional(),
        // QY-SPOT-001 现场参数：全部可选，缺省不阻断识别
        season: z.enum(["春", "夏", "秋", "冬"]).optional(),
        waterTemp: z.number().min(-5).max(45).optional(),
        airTemp: z.number().min(-50).max(55).optional(),
        weather: z.string().max(24).optional(),
        windLevel: z.number().int().min(0).max(12).optional(),
        hour: z.number().int().min(0).max(23).optional(),
        targetFish: z.array(z.string().max(16)).max(6).optional(),
        waterType: z.string().max(24).optional(),
        clarity: z.enum(["清澈", "中等", "浑浊", "肥水"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再识别" });
        return identify(ctx.user.id, input);
      }),
    // QY-SPOT-008 样本沉淀授权：默认不存图；撤回即删除本人全部样本（台账不动）
    sampleConsent: tracedPublic
      .input(z.object({ granted: z.boolean(), scope: z.enum(["image", "features"]).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        return setSampleConsent(ctx.user.id, input.granted, input.scope ?? "image");
      }),
    // 报告质量反馈（不存图，用于筛选高质量微调样本）
    feedback: tracedPublic
      .use(rateLimit({ capacity: 30, refillPerSec: 30 / 3600, key: actorKey, message: "操作太频繁，请稍后再试" }))
      .input(z.object({
        rating: z.enum(["useful", "inaccurate", "bait_miss"]),
        note: z.string().max(200).optional(),
        sampleId: z.number().int().positive().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        return submitFeedback(ctx.user.id, input);
      }),
    // 知识库运行态（规则来源/条数 + 近 7 日命中率）：仅 admin
    knowledgeStatus: tracedPublic.query(async ({ ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅限平台管理员" });
      return knowledgeStatus();
    }),
    // 充值下单：mock 立即到账；否则建 pending 单（真实拉起待商户号，到账走 Paths.payNotify）
    recharge: tracedPublic
      .use(rateLimit({ capacity: 20, refillPerSec: 20 / 3600, key: actorKey, message: "操作太频繁，请稍后再试" }))
      .input(z.object({ amountCents: z.number().int().min(100).max(100000) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再充值" });
        return recharge(ctx.user.id, input.amountCents);
      }),
    // 人工加余额（运营兜底，商户号未就绪期间使用）：仅 admin
    adminCredit: tracedPublic
      .input(z.object({ targetUserId: z.number(), amountCents: z.number().int().min(1).max(100000) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅限平台管理员" });
        return adminCredit(input.targetUserId, input.amountCents);
      }),
  }),
});
