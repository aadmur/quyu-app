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
  /** 冷启动性能采样上报（QY-PERF-008）：匿名、无需登录，落 JSONL */
  perf: "/api/perf",
  /** 哪钓充值 · 支付结果异步回调（微信/支付宝 notify，验签后加余额；待商户号接入） */
  payNotify: "/api/pay/notify",
} as const;
