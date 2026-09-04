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
import { toggleLike, addComment, listComments, listNews, createPost } from "./services/community";
import { listPonds, getPondDetail, publishNews } from "./services/pond";
import { createOrder, myOrders, verifyOrder, reviewOrder } from "./services/trade";
import { ownerStats } from "./services/ownerService";
import { listProducts, searchProducts, createProductOrder, myProductOrders } from "./services/shop";
import { recommendFeed, trackEvent } from "./services/recommendService";
import { getProfile, updateUserProfile } from "./services/profileService";

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
    // 塘主发布鱼讯（需登录 + admin 审核员）；pondSlug 必传（前端传真实选中钓场）
    publishNews: tracedPublic
      .input(z.object({ pondSlug: z.string().min(1).max(64), content: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅钓场审核员可发布鱼讯" });
        return publishNews(input.pondSlug, input.content);
      }),
  }),

  // ============ 帖子互动 ============
  posts: createRouter({
    like: tracedPublic
      .use(rateLimit({ capacity: 30, refillPerSec: 1, key: actorKey }))
      .input(z.object({ postId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        return toggleLike(uid(ctx), input.postId);
      }),
    comment: tracedPublic
      .use(rateLimit({ capacity: 10, refillPerSec: 0.2, key: actorKey, message: "评论太频繁了，休息一下" }))
      .input(z.object({ postId: z.number(), content: z.string().min(1).max(500), authorName: z.string().default("钓友") }))
      .mutation(async ({ ctx, input }) => {
        await addComment(uid(ctx), input.postId, input.content, input.authorName);
        return { ok: true };
      }),
    comments: tracedPublic
      .input(z.object({ postId: z.number() }))
      .query(async ({ input }) => {
        return listComments(input.postId);
      }),
    create: tracedPublic
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: actorKey, message: "发布太频繁，请稍后再试" }))
      .input(z.object({
        content: z.string().min(1).max(1000),
        images: z.array(z.string()).default([]),
        pondSlug: z.string().optional(),
        fishSpecies: z.string().optional(),
        weightJin: z.number().optional(),
        authorName: z.string().max(64).default("钓友"),
      }))
      .mutation(async ({ ctx, input }) => {
        const userId = uid(ctx);
        const name = ctx.user?.name ?? input.authorName;
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
        return createOrder(uid(ctx), input);
      }),
    mine: tracedPublic.query(async ({ ctx }) => {
      return myOrders(uid(ctx));
    }),
    verify: tracedPublic
      // 核销是资金敏感操作：必须登录（匿名 401，不走 DEMO_USER 兜底）。
      // 塘主审核员认证：仅 role=admin 的账号可核销（unionId 命中 OWNER_UNION_ID 时建档即授 admin），
      // 其余登录用户 403，防止普通用户核销他人门票。
      // 核销码 6 位数字可爆破 → IP + 用户双维度 5 次/min 严格限流（arch-v5 §8 P2 缓解），
      // IP 取真实连接地址（socket），不信任客户端可伪造的 XFF。
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: ipKey, message: "核销尝试过于频繁" }))
      // 用户维度独立成桶（匿名共享 "anon" 桶），避免与 ipKey 回落同 key 重复扣减
      .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: (ctx) => `u:${ctx.user?.id ?? "anon"}`, message: "核销尝试过于频繁" }))
      .input(z.object({ code: z.string().length(6) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再核销" });
        }
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "核销仅限钓场审核员账号，请完成塘主认证" });
        }
        return verifyOrder(input.code);
      }),
    review: tracedPublic
      .input(z.object({ orderId: z.number(), rating: z.number().min(1).max(5), content: z.string().max(500), tags: z.array(z.string()).default([]), images: z.array(z.string()).default([]) }))
      .mutation(async ({ ctx, input }) => {
        // authorName 取登录用户昵称（演示兜底用户无昵称时回退"我"）
        const authorName = ctx.user?.name?.trim() || "我";
        await reviewOrder(uid(ctx), authorName, input);
        return { ok: true };
      }),
    // 塘主端看板：含核销码与营收，必须登录且 role=admin（校验写法对照 orders.verify）
    ownerStats: tracedPublic.query(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再查看塘主看板" });
      }
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "塘主看板仅限钓场审核员账号" });
      }
      return ownerStats();
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
        return createProductOrder(uid(ctx), input.items, input.idempotencyKey);
      }),
    mine: tracedPublic.query(async ({ ctx }) => {
      return myProductOrders(uid(ctx));
    }),
  }),

  users: createRouter({
    // 资料修改仅限真实登录用户（不走匿名演示兜底），并按 actorKey 限流
    update: tracedPublic
      .use(rateLimit({ capacity: 10, refillPerSec: 10 / 60, key: actorKey, message: "资料修改太频繁，请稍后再试" }))
      .input(z.object({ name: z.string().min(1).max(64).optional(), avatar: z.string().max(255).optional(), avatarData: z.string().max(2_800_000).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录后再修改资料" });
        }
        return updateUserProfile(ctx.user.id, input);
      }),
  }),
});
