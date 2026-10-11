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
  /** 基础档单次调用超时（v12 语义，保持不变） */
  k3TimeoutMs: optInt("K3_TIMEOUT_MS", 60_000),
  /** 专家档单步超时：两步累加即端到端预算（设计指标 P95 < 40s → 默认 20s/步） */
  k3StepTimeoutMs: optInt("K3_STEP_TIMEOUT_MS", 20_000),

  // ── 哪钓 · 计费（单位：分） ──
  fishSpotPriceCents: optInt("FISH_SPOT_PRICE_CENTS", 50),
  fishSpotFreeLimit: optInt("FISH_SPOT_FREE_LIMIT", 3),
  /** QY-SPOT-007 分层定价：专家报告档位价（方案建议 ¥2.00–3.00，默认取下限，可 env 热调） */
  fishSpotExpertPriceCents: optInt("FISH_SPOT_EXPERT_PRICE_CENTS", 200),
  /** 专家报告免费体验次数（与基础档免费次数分列记账） */
  fishSpotExpertFreeLimit: optInt("FISH_SPOT_EXPERT_FREE_LIMIT", 1),

  // ── 识鱼 · 计费（单位：分；单次调用成本低于钓点基础档） ──
  fishIdPriceCents: optInt("FISH_ID_PRICE_CENTS", 30),
  fishIdFreeLimit: optInt("FISH_ID_FREE_LIMIT", 3),
  /** 低置信阈值：Top-1 置信度低于此值时诚实降级（不硬猜） */
  fishIdMinConfidence: optInt("FISH_ID_MIN_CONFIDENCE_X100", 55) / 100,

  // ── 内容安全 · 阿里云图片机审（v14，AK/Secret 只进服务器 .env，绝不进 APK/代码库） ──
  // 未配置 Key 或未显式启用时的行为（重要，这是产品决策不是 bug）：
  // 图片照常落盘、帖子/评论照常发布，同时向 reports 写一条 [系统] 待人工复核记录——
  // 即「放行 + 标记待审」而不是拒绝发布。理由：现状本来就没有任何图片机审，
  // fail-closed 会让未开通服务的部署直接丧失发图能力（对照 MOONSHOT_API_KEY 的「服务未开通」降级口径）。
  // ⚠️ 提交方式已由官方文档核实（2026-10-06 复核 help.aliyun.com 的 70292「图片同步检测」与
  // 53413「公共参数」，以及增强版 2022-03-02 ImageModeration）：两个版本**都只接受可被服务端
  // 拉取的图片 URL，均不支持 base64 二进制提交**。
  // 因此机审必须发生在落盘之后（用 /uploads 公网 URL），也因此必须有 PUBLIC_MEDIA_BASE_URL；
  // 该值未配置时整条机审链路退化为「放行 + 待审」，与未开通时等价。
  aliyunAccessKeyId: process.env.ALICLOUD_ACCESS_KEY_ID ?? "",
  aliyunAccessKeySecret: process.env.ALICLOUD_ACCESS_KEY_SECRET ?? "",
  aliyunGreenEndpoint: process.env.ALICLOUD_GREEN_ENDPOINT ?? "https://green.cn-shanghai.aliyuncs.com",
  /**
   * 审核服务端拉图时使用的公网前缀，例：`http://120.x.x.x:3000`（无尾斜杠）。
   * 必须是**阿里云能访问到**的地址；留空 = 机审不可用（降级为待审，不是报错）。
   */
  publicMediaBaseUrl: (process.env.PUBLIC_MEDIA_BASE_URL ?? "").replace(/\/$/, ""),
  /** 控制台创建的业务线，留空 = 用默认通用业务 */
  aliyunGreenBizType: process.env.ALICLOUD_GREEN_BIZ_TYPE ?? "",
  /** 场景取值 porn/terrorism/ad 已按官方文档核对（该接口另有 live/qrcode/logo） */
  aliyunGreenScenes: process.env.ALICLOUD_GREEN_SCENES ?? "porn,terrorism,ad",
  imageModerationEnabled: process.env.IMAGE_MODERATION_ENABLED === "true",
  /** 单张图片提交超时（并行提交，故一次发布的审核墙钟 ≈ 该值） */
  imageModerationTimeoutMs: optInt("IMAGE_MODERATION_TIMEOUT_MS", 3_000),
  /** 整批总预算：fetch 不响应 abort 的极端兜底，超预算未决的图片转人工队列，绝不卡死发布链路 */
  imageModerationDeadlineMs: optInt("IMAGE_MODERATION_DEADLINE_MS", 8_000),

  // ── 哪钓 · 充值 ──
  /** true = 充值立即到账（无需真实支付，仅开发/演示；生产必须 false，否则成自助印钞）。
   *  商户号未就绪期间，运营用 adminCredit 人工加余额。 */
  payMock: process.env.PAY_MOCK === "true",
};
