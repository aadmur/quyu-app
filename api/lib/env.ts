import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function optInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  kimiAuthUrl: required("KIMI_AUTH_URL"),
  kimiOpenUrl: required("KIMI_OPEN_URL"),
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",

  // ── 哪钓 · Moonshot K3 视觉识别（服务端中转，Key 绝不进 APK/代码库） ──
  // 未配置时 identify 返回「服务未开通」；生产部署前在服务器 .env 注入。
  moonshotApiKey: process.env.MOONSHOT_API_KEY ?? "",
  moonshotBaseUrl: process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.cn/v1",
  k3Model: process.env.K3_MODEL ?? "kimi-k3",
  /** 开发兜底：true 时不真实调用 K3，返回模拟识别结果（不扣真实额度，但仍走计费闭环） */
  k3Mock: process.env.K3_MOCK === "true",

  // ── 哪钓 · 计费（单位：分） ──
  fishSpotPriceCents: optInt("FISH_SPOT_PRICE_CENTS", 50),
  fishSpotFreeLimit: optInt("FISH_SPOT_FREE_LIMIT", 3),

  // ── 哪钓 · 充值 ──
  /** true = 充值立即到账（无需真实支付，仅开发/演示；生产必须 false，否则成自助印钞）。
   *  商户号未就绪期间，运营用 adminCredit 人工加余额。 */
  payMock: process.env.PAY_MOCK === "true",
};
