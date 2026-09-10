import * as cookie from "cookie";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, tracedPublic, rateLimit } from "./middleware";
import { log } from "./infra";
import { env } from "./lib/env";
import { signSessionToken } from "./kimi/session";
import { findUserByUnionId, requestAccountDeletion, cancelAccountDeletion, upsertUser } from "./queries/users";
import { initProfile } from "./services/profileService";
import { scheduleDeletionSweep } from "./services/accountDeletion";

// QY-E-005：服务启动时挂载账号注销到期匿名化的 hourly 扫描任务（模块加载即注册一次）
scheduleDeletionSweep();

const scryptAsync = promisify(scrypt);

/** scrypt 加盐哈希（格式 scrypt:<saltHex>:<hashHex>），无需引入第三方依赖 */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const derived = (await scryptAsync(password, parts[1], 64)) as Buffer;
  const expected = Buffer.from(parts[2], "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

const credentialsInput = z.object({
  username: z
    .string()
    .trim()
    .min(2, "用户名至少 2 个字符")
    .max(20, "用户名最多 20 个字符")
    .regex(/^[\w\u4e00-\u9fa5-]+$/, "用户名仅限中英文、数字、下划线和短横线"),
  password: z.string().min(6, "密码至少 6 位").max(64, "密码最多 64 位"),
});

/** 账号密码用户的 unionId 命名空间（与 Kimi OAuth 的 unionId 隔离） */
const pwdUnionId = (username: string) => `pwd:${username}`;

/** 签发会话 Cookie（与 OAuth 回调同一套参数，自动适配 http/https 上下文） */
async function issueSessionCookie(ctx: { req: { headers: Headers }; resHeaders: Headers }, unionId: string) {
  const token = await signSessionToken({ unionId, clientId: env.appId });
  const opts = getSessionCookieOptions(ctx.req.headers);
  ctx.resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: Session.maxAgeMs / 1000,
    }),
  );
}

const publicUser = (u: { id: number; name: string | null; avatar: string | null; role: string }) => ({
  id: u.id,
  name: u.name,
  avatar: u.avatar,
  role: u.role,
});

export const authRouter = createRouter({
  // 宽松化：未登录返回 null（前端据此弹登录引导层），而不是 401。
  // 字段裁剪：只暴露前端用到的字段（src 实际引用 id/name/avatar/role/email——
  // AuthLayout 侧栏展示 email），unionId/lastSignInAt/createdAt/updatedAt 不再下发。
  me: tracedPublic.query((opts) => {
    const u = opts.ctx.user;
    if (!u) return null;
    // QY-E-005：增量字段 deletionRequestedAt（非 NULL 表示注销冷静期中），旧前端不受影响
    return { id: u.id, name: u.name, email: u.email, avatar: u.avatar, role: u.role, bio: u.bio ?? null, deletionRequestedAt: u.deletionRequestedAt ?? null };
  }),
  // 账号密码注册（v8.2.0）：自包含登录方式，供无法使用 Kimi OAuth 的部署环境
  register: tracedPublic
    .input(credentialsInput)
    .use(rateLimit({ capacity: 5, refillPerSec: 1 / 12, key: (ctx) => ctx.ip ?? "anon", message: "注册过于频繁，请稍后再试" }))
    .mutation(async ({ ctx, input }) => {
      const unionId = pwdUnionId(input.username);
      if (await findUserByUnionId(unionId)) {
        throw new TRPCError({ code: "CONFLICT", message: "该用户名已被注册，直接登录即可" });
      }
      const passwordHash = await hashPassword(input.password);
      await upsertUser({ unionId, name: input.username, avatar: "/avatar-1.png", passwordHash, lastSignInAt: new Date() });
      await issueSessionCookie(ctx, unionId);
      const user = await findUserByUnionId(unionId);
      // 首次注册初始化：空画像行落库（推荐冷启动有显式记录，个人主页/画像接口口径一致）
      if (user) await initProfile(user.id);
      return publicUser(user!);
    }),
  // 账号密码登录
  loginPassword: tracedPublic
    .input(credentialsInput)
    .use(rateLimit({ capacity: 5, refillPerSec: 1 / 12, key: (ctx) => ctx.ip ?? "anon", message: "尝试过于频繁，请稍后再试" }))
    .mutation(async ({ ctx, input }) => {
      const user = await findUserByUnionId(pwdUnionId(input.username));
      if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "用户名或密码错误" });
      }
      // QY-E-005：冷静期内重新登录视为撤回注销申请（产品已确认此行为），自动撤销
      if (user.deletionRequestedAt) {
        await cancelAccountDeletion(user.id);
      }
      await upsertUser({ unionId: user.unionId, lastSignInAt: new Date() });
      await issueSessionCookie(ctx, user.unionId);
      return publicUser(user);
    }),
  // QY-E-005 申请注销账号：进入 7 天冷静期，期间正常可用；到期由定时任务匿名化。
  // 幂等：重复申请不报错，返回原申请时间。admin 账号拒绝自助注销。
  requestDeletion: authedQuery
    .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: (ctx) => `u:${ctx.user!.id}`, message: "操作太频繁，请稍后再试" }))
    .mutation(async ({ ctx }) => {
      const user = ctx.user!;
      if (user.role === "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "管理员账号请联系平台处理" });
      }
      const deletionRequestedAt = await requestAccountDeletion(user.id);
      log("info", "account deletion requested", { userId: user.id });
      return { deletionRequestedAt };
    }),
  // QY-E-005 冷静期内撤销注销（幂等：未申请时同样返回成功）
  cancelDeletion: authedQuery
    .use(rateLimit({ capacity: 5, refillPerSec: 5 / 60, key: (ctx) => `u:${ctx.user!.id}`, message: "操作太频繁，请稍后再试" }))
    .mutation(async ({ ctx }) => {
      await cancelAccountDeletion(ctx.user!.id);
      log("info", "account deletion canceled", { userId: ctx.user!.id });
      return { success: true };
    }),
  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),
});
