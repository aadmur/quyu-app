export const Session = {
  cookieName: "kimi_sid",
  /** OAuth state nonce 防 CSRF cookie（HttpOnly，短期 10 分钟） */
  oauthNonceCookieName: "kimi_oauth_nonce",
  oauthNonceMaxAgeSec: 600,
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  oauthCallback: "/api/oauth/callback",
  /** 登录 CSRF 防护：前端跳转授权前先取 nonce（写 HttpOnly cookie） */
  oauthNonce: "/api/oauth/nonce",
} as const;
