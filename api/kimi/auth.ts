import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomUUID } from "node:crypto";
import * as jose from "jose";
import * as cookie from "cookie";
import { env } from "../lib/env";
import { getSessionCookieOptions } from "../lib/cookies";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { signSessionToken, verifySessionToken } from "./session";
import { users as kimiUsers } from "./platform";
import { findUserByUnionId, upsertUser } from "../queries/users";
import type { TokenResponse } from "./types";

async function exchangeAuthCode(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.appId,
    redirect_uri: redirectUri,
    client_secret: env.appSecret,
  });

  const resp = await fetch(`${env.kimiAuthUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<TokenResponse>;
}

// 惰性创建 JWKS：模块加载时 env.kimiAuthUrl 可能为空（本地开发未配置 OAuth），
// 顶层 new URL("") 会直接抛 Invalid URL 导致整个服务启动失败。
// 改为首次校验 token 时才构建；未配置时给出明确错误而非启动崩溃。
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    if (!env.kimiAuthUrl) {
      throw new Error("KIMI_AUTH_URL is not configured");
    }
    jwks = jose.createRemoteJWKSet(
      new URL(`${env.kimiAuthUrl}/api/.well-known/jwks.json`),
    );
  }
  return jwks;
}

async function verifyAccessToken(
  accessToken: string,
): Promise<{ userId: string; clientId: string }> {
  const { payload } = await jose.jwtVerify(accessToken, getJwks());
  const userId = payload.user_id as string;
  const clientId = payload.client_id as string;
  if (!userId) {
    throw new Error("user_id missing from access token");
  }
  return { userId, clientId };
}

export async function authenticateRequest(headers: Headers) {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) {
    console.warn("[auth] No session cookie found in request.");
    throw Errors.forbidden("Invalid authentication token.");
  }
  const claim = await verifySessionToken(token);
  if (!claim) {
    throw Errors.forbidden("Invalid authentication token.");
  }
  const user = await findUserByUnionId(claim.unionId);
  if (!user) {
    throw Errors.forbidden("User not found. Please re-login.");
  }
  return user;
}

/**
 * GET /api/oauth/nonce —— 登录 CSRF 防护（state nonce）+ 下发公开 OAuth 配置。
 * 生成随机 nonce，写 HttpOnly 短期 cookie（SameSite/Secure 规则与会话 cookie 一致，10 分钟过期），
 * 并返回给前端；前端跳转授权页时携带 state=base64(JSON{r: redirectUri, n: nonce})，
 * 回调时服务端校验 state.n 与该 cookie 一致（cookie 的 Max-Age 即过期机制）。
 * 同时返回 authUrl/appId（OAuth client_id 与授权地址均为公开信息），
 * 使前端无需构建期注入 VITE_KIMI_AUTH_URL / VITE_APP_ID。
 */
export function createOAuthNonceHandler() {
  return async (c: Context) => {
    const nonce = randomUUID();
    const cookieOpts = getSessionCookieOptions(c.req.raw.headers);
    setCookie(c, Session.oauthNonceCookieName, nonce, {
      ...cookieOpts,
      maxAge: Session.oauthNonceMaxAgeSec,
    });
    return c.json({ nonce, authUrl: env.kimiAuthUrl, appId: env.appId });
  };
}

/**
 * 解析并校验 OAuth state（CSRF 防护）：
 * - 新格式 state=base64(JSON{r,n})：必须与服务端 nonce cookie 一致，否则 400；
 * - 旧格式 state=base64(redirectUri)（纯字符串，非 JSON）：前端并行改造期间兼容放行 + warn 日志。
 * 校验通过后 nonce cookie 立即作废（一次性）。
 */
function resolveRedirectUri(c: Context, state: string): { redirectUri: string } | { error: string } {
  let decoded: string;
  try {
    decoded = atob(state);
  } catch {
    return { error: "invalid state encoding" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === "object" && typeof (parsed as { r?: unknown }).r === "string") {
    const { r, n } = parsed as { r: string; n?: unknown };
    const cookieNonce = getCookie(c, Session.oauthNonceCookieName);
    if (typeof n !== "string" || !cookieNonce || cookieNonce !== n) {
      return { error: "state nonce mismatch" };
    }
    // 一次性 nonce：用后即废，防重放
    deleteCookie(c, Session.oauthNonceCookieName, { path: "/" });
    return { redirectUri: r };
  }
  // 旧格式兼容：整个 decoded 即 redirectUri（前端改造完成前放行，避免登录中断）
  console.warn("[OAuth] legacy state format accepted (no nonce); please migrate frontend to /api/oauth/nonce flow");
  return { redirectUri: decoded };
}

export function createOAuthCallbackHandler() {
  return async (c: Context) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");
    const errorDescription = c.req.query("error_description");

    if (error) {
      if (error === "access_denied") {
        return c.redirect("/", 302);
      }
      return c.json(
        { error, error_description: errorDescription },
        400,
      );
    }

    if (!code || !state) {
      return c.json({ error: "code and state are required" }, 400);
    }

    try {
      const resolved = resolveRedirectUri(c, state);
      if ("error" in resolved) {
        return c.json({ error: resolved.error }, 400);
      }
      const tokenResp = await exchangeAuthCode(code, resolved.redirectUri);
      const { userId } = await verifyAccessToken(tokenResp.access_token);
      const userProfile = await kimiUsers.getProfile(tokenResp.access_token);
      if (!userProfile) {
        throw new Error("Failed to fetch user profile from Kimi Open");
      }

      await upsertUser({
        unionId: userId,
        name: userProfile.name,
        avatar: userProfile.avatar_url,
        lastSignInAt: new Date(),
      });

      const token = await signSessionToken({
        unionId: userId,
        clientId: env.appId,
      });

      const cookieOpts = getSessionCookieOptions(c.req.raw.headers);
      setCookie(c, Session.cookieName, token, {
        ...cookieOpts,
        maxAge: Session.maxAgeMs / 1000,
      });

      return c.redirect("/", 302);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      return c.json({ error: "OAuth callback failed" }, 500);
    }
  };
}

export { exchangeAuthCode, verifyAccessToken };
