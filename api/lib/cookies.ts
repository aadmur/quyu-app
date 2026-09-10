import type { CookieOptions } from "hono/utils/cookie";

/** 仅当站点经 HTTPS 提供时才可发 Secure 标记，否则浏览器直接丢弃 Cookie。
 *  判定：优先 x-forwarded-proto（反代场景），其次 Host 形态——
 *  localhost / 127.0.0.1 / 纯 IP 地址（裸机测试无 TLS）一律按非安全上下文处理。 */
function isSecureContext(headers: Headers): boolean {
  const proto = (headers.get("x-forwarded-proto") || "").toLowerCase();
  if (proto) return proto === "https";
  const host = headers.get("host") || "";
  const hostname = host.split(":")[0];
  if (hostname === "localhost" || hostname === "127.0.0.1") return false;
  // 纯 IPv4 地址视为非 TLS 裸机部署
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  return true;
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const secureCtx = isSecureContext(headers);

  return {
    httpOnly: true,
    path: "/",
    // 非安全上下文（http/IP/localhost）：Lax 即可，OAuth 回调是顶层 GET 导航会带 Cookie；
    // 安全上下文（https 域名）：None+Secure，兼容 WebView/跨站场景
    sameSite: secureCtx ? "None" : "Lax",
    secure: secureCtx,
  };
}
