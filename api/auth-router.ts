import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, tracedPublic } from "./middleware";

export const authRouter = createRouter({
  // 宽松化：未登录返回 null（前端据此弹登录引导层），而不是 401。
  // 字段裁剪：只暴露前端用到的字段（src 实际引用 id/name/avatar/role/email——
  // AuthLayout 侧栏展示 email），unionId/lastSignInAt/createdAt/updatedAt 不再下发。
  me: tracedPublic.query((opts) => {
    const u = opts.ctx.user;
    if (!u) return null;
    return { id: u.id, name: u.name, email: u.email, avatar: u.avatar, role: u.role };
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
