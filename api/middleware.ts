/**
 * @layer Cross-cutting —— tRPC 中间件：认证/RBAC + 限流(TokenBucket) + 结构化日志 + 慢请求告警
 * @file api/middleware.ts
 *
 * 保持 superjson 序列化约定不变；对外 procedure 契约不变。
 * 限流走 CacheStore Port（当前进程内令牌桶，多实例部署时切 Redis 实现，业务零改动）。
 */
import { randomUUID } from "node:crypto";
import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getCache, log } from "./infra";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

// ============ 结构化访问日志 + 慢请求告警（RequestID 贯穿） ============
const SLOW_REQUEST_MS = 500;

export const traced = t.middleware(async ({ ctx, path, type, next }) => {
  const traceId = randomUUID();
  const start = performance.now();
  const result = await next();
  const durationMs = Math.round(performance.now() - start);
  const fields = {
    traceId,
    userId: ctx.user?.id,
    route: path,
    type,
    durationMs,
    status: result.ok ? "ok" : "error",
  };
  if (!result.ok) {
    log("warn", "trpc error", { ...fields, error: String(result.error.message) });
  } else if (durationMs > SLOW_REQUEST_MS) {
    log("warn", "slow request", fields);
  } else {
    log("info", "trpc", fields);
  }
  return result;
});

// ============ 限流：TokenBucket（状态存 CacheStore，语义对齐 Redis 实现） ============
interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitOptions {
  /** 桶容量（突发上限） */
  capacity: number;
  /** 每秒补充速率 */
  refillPerSec: number;
  /** 限流维度 key（如 userId / IP / 核销码） */
  key: (ctx: TrpcContext) => string;
  message?: string;
}

export function rateLimit(opts: RateLimitOptions) {
  return t.middleware(async ({ ctx, path, next }) => {
    const cache = getCache();
    const dim = `rate:${path}:${opts.key(ctx)}`;
    const now = Date.now();
    const bucket = (await cache.get<Bucket>(dim)) ?? { tokens: opts.capacity, updatedAt: now };
    const tokens = Math.min(opts.capacity, bucket.tokens + ((now - bucket.updatedAt) / 1000) * opts.refillPerSec);
    if (tokens < 1) {
      await cache.set(dim, { tokens, updatedAt: now }, Math.ceil(opts.capacity / opts.refillPerSec) * 2);
      log("warn", "rate limited", { route: path, userId: ctx.user?.id });
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: opts.message ?? "请求过于频繁，请稍后再试" });
    }
    await cache.set(dim, { tokens: tokens - 1, updatedAt: now }, Math.ceil(opts.capacity / opts.refillPerSec) * 2);
    return next();
  });
}

export const authedQuery = t.procedure.use(requireAuth);
export const adminQuery = authedQuery.use(requireRole("admin"));

/** 带日志追踪的公共 procedure（路由层统一使用，对外契约不变） */
export const tracedPublic = publicQuery.use(traced);
