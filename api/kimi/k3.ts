/**
 * @layer Application Layer —— Moonshot K3 视觉识别中转（哪钓 · 钓点评估）
 * @file api/kimi/k3.ts
 *
 * 设计要点：
 * - Key 只读 env.moonshotApiKey，绝不进 APK / 代码库 / 前端 bundle（服务端单向中转）。
 * - OpenAI 兼容 Chat Completions + 严格 JSON Schema 结构化输出，保证前端卡片可解析。
 * - 图片以 dataURL 直接随请求上送（生产为内网 IP 无公网回源，Moonshot 无法反拉 /uploads）。
 * - 非流式（分支③）：一次性拿结果；超时 + 网络/5xx 重试。
 * - env.k3Mock=true 时不真实调用，返回模拟结果（开发/演示用，不烧真实额度）。
 *
 * v13 专业化（QY-SPOT-004 / 005）：
 * - **基础档**仍走单轮 identifyFishSpot()，Schema 与提示词**逐字不变**——老 APK 行为零变化。
 * - **专家档**走三段式：extractSpotFeatures()（只看图，只出观察不出建议）
 *   → 知识库规则检索（本地零 token，见 api/knowledge）→ generateExpertReport()
 *   （只喂特征 + 规则文本，**不再重传图片**，避免图像 token 翻倍）。
 * - 专业数值（线号/钩型/调目）以规则库为准：模型漏写由规则兜底填充；规则未命中则**清空具体数值**
 *   并要求模型自述依据不足，从链路上杜绝幻觉线号。
 */
import { env } from "../lib/env";
import { type Clarity, type Season, type TimeOfDay } from "../knowledge/fishingRules";
import { ruleBasis, rulesToPromptBlock, type RuleMatch } from "../knowledge";

export interface FishSpotResult {
  /** 综合评分 0-100（越高越是好钓点） */
  score: number;
  /** 水体类型：湖泊/河流/水库/野塘/沟渠… */
  waterType: string;
  /** 适宜目标鱼种 */
  suitableFish: string[];
  /** 建议作钓时段 */
  bestTime: string;
  /** 钓法/装备建议 */
  tips: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 注意事项 / 不利因素 */
  warnings: string;
}

/** QY-SPOT-005：专家档的结构化专业报告（基础 7 字段保留，鱼种/时段升级为带理由项） */
export interface SuitableFishItem {
  name: string;
  /** 1 = 首选 */
  priority: number;
  reason: string;
}

export interface BestTimeItem {
  period: string;
  reason: string;
}

export interface WaterAnalysis {
  clarity: string;
  colorDesc: string;
  structure: string;
  flowDesc: string;
}

export interface RigSetup {
  lineSpec: string;
  hookSpec: string;
  floatSetup: string;
  sinkerSpec: string;
}

export interface BaitPlan {
  bait: string;
  nest: string;
  strategy: string;
}

export interface FishSpotExpertResult extends FishSpotResult {
  suitableFishDetail: SuitableFishItem[];
  bestTimeDetail: BestTimeItem[];
  waterAnalysis: WaterAnalysis;
  rigSetup: RigSetup;
  baitPlan: BaitPlan;
  /** 钓位选择建议（独立于 tips，前端专业报告区展示） */
  spotPick: string;
  /** 本次专业数值的来源：rule=规则库兜底/校验，model=模型给出但无规则支撑，none=未命中已降级 */
  specificsSource: "rule" | "model" | "none";
  /** 服务端注入的可审计依据（不经模型，防止模型编造规则 id） */
  knowledgeBasis: ReturnType<typeof ruleBasis>;
}

/** QY-SPOT-001/004：Step 1 的视觉观察结果（不含任何建议） */
export interface SpotFeatures {
  waterColor: string;
  clarity: Clarity | string;
  weedCoverage: string;
  bankStructure: string;
  inletOutlet: string;
  light: string;
  surfaceActivity: string;
  /** 归一结构标签，用于规则检索（深浅交界/水草区/进出水口/障碍物/开阔水面/岸坡/乱石） */
  structures: string[];
  waterTypeGuess: string;
  confidence: number;
}

export interface K3Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type K3ErrorCode = "no-key" | "bad-image" | "http" | "timeout" | "parse";

export class K3Error extends Error {
  code: K3ErrorCode;
  constructor(code: K3ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function addUsage(a: K3Usage, b: K3Usage): K3Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** 严格 JSON Schema：前端卡片字段的单一可信来源（基础档，逐字保持 v12） */
const RESULT_SCHEMA = {
  name: "fish_spot_assessment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      score: { type: "integer", description: "综合评分 0-100" },
      waterType: { type: "string", description: "水体类型" },
      suitableFish: { type: "array", items: { type: "string" }, description: "适宜目标鱼种" },
      bestTime: { type: "string", description: "建议作钓时段" },
      tips: { type: "string", description: "钓法/装备建议" },
      confidence: { type: "number", description: "置信度 0-1" },
      warnings: { type: "string", description: "注意事项/不利因素，无则空串" },
    },
    required: ["score", "waterType", "suitableFish", "bestTime", "tips", "confidence", "warnings"],
  },
} as const;

const SYSTEM_PROMPT =
  "你是资深钓鱼钓点评估专家。根据用户拍摄的眼前水体照片，判断该位置是否为好钓点。" +
  "从水体类型、水色/透明度、岸边结构、水草/遮蔽、进出水口、光照时段等角度分析，" +
  "给出可执行的作钓建议。务必只输出符合给定 JSON Schema 的结构化结果，不要输出任何多余文字。";

/** Step 1：只允许「观察」，任何建议都不许出现在这一轮（避免幻觉进入决策链） */
const FEATURE_SCHEMA = {
  name: "fish_spot_features",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      waterTypeGuess: { type: "string", description: "水体类型判断：湖泊/河流/水库/野塘/沟渠/黑坑 之一或具体描述" },
      waterColor: { type: "string", description: "水色，如 黄绿/墨绿/泥黄/灰蓝" },
      clarity: { type: "string", description: "透明度：清澈/中等/浑浊/肥水 四选一" },
      weedCoverage: { type: "string", description: "水草/浮萍覆盖程度描述" },
      bankStructure: { type: "string", description: "岸边与近岸结构：缓坡/陡坎/护坡/乱石/泥底/芦苇" },
      inletOutlet: { type: "string", description: "有无进水口/出水口/闸口，无则写 未见" },
      light: { type: "string", description: "光照条件：全日晒/树荫/背阴/明暗交界" },
      surfaceActivity: { type: "string", description: "水面动静：波纹/鱼星/炸水/平静" },
      structures: {
        type: "array",
        items: { type: "string" },
        description: "从以下标签中选实际可见项：水草区/深浅交界/进出水口/障碍物/开阔水面/岸坡/乱石/芦苇边/湾汊",
      },
      confidence: { type: "number", description: "观察置信度 0-1" },
    },
    required: [
      "waterTypeGuess",
      "waterColor",
      "clarity",
      "weedCoverage",
      "bankStructure",
      "inletOutlet",
      "light",
      "surfaceActivity",
      "structures",
      "confidence",
    ],
  },
} as const;

const FEATURE_SYSTEM_PROMPT =
  "你是垂钓水域现场勘察员。只看照片做客观观察并结构化记录，" +
  "**严禁输出任何钓法、线号、钩型、饵料或建议**——建议由后续规则引擎负责。" +
  "看不清的项写「无法判断」，不得臆造。只输出符合 JSON Schema 的对象。";

/** Step 3：结论生成 Schema（专业报告） */
const EXPERT_SCHEMA = {
  name: "fish_spot_expert_report",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      score: { type: "integer", description: "综合评分 0-100" },
      waterType: { type: "string", description: "水体类型" },
      confidence: { type: "number", description: "置信度 0-1" },
      tips: { type: "string", description: "综合建议（一句话可执行结论）" },
      warnings: { type: "string", description: "注意事项/不利因素，无则空串" },
      suitableFish: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", description: "鱼种标准名" },
            priority: { type: "integer", description: "优先级，1=首选" },
            reason: { type: "string", description: "依据现场条件的一句话理由" },
          },
          required: ["name", "priority", "reason"],
        },
        description: "适宜目标鱼（带优先级与理由）",
      },
      bestTime: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            period: { type: "string", description: "时段，如 晨/午/昏/夜 或具体时间区间" },
            reason: { type: "string", description: "该时段开口好的原因" },
          },
          required: ["period", "reason"],
        },
        description: "分时段作钓建议",
      },
      waterAnalysis: {
        type: "object",
        additionalProperties: false,
        properties: {
          clarity: { type: "string" },
          colorDesc: { type: "string" },
          structure: { type: "string" },
          flowDesc: { type: "string" },
        },
        required: ["clarity", "colorDesc", "structure", "flowDesc"],
      },
      rigSetup: {
        type: "object",
        additionalProperties: false,
        properties: {
          lineSpec: { type: "string", description: "主线/子线号数，必须照抄规则库数值" },
          hookSpec: { type: "string", description: "钩型与号数，必须照抄规则库数值" },
          floatSetup: { type: "string", description: "调漂目数与抓口，必须照抄规则库数值" },
          sinkerSpec: { type: "string", description: "铅坠配重，必须照抄规则库数值" },
        },
        required: ["lineSpec", "hookSpec", "floatSetup", "sinkerSpec"],
      },
      baitPlan: {
        type: "object",
        additionalProperties: false,
        properties: {
          bait: { type: "string", description: "钓饵，照抄规则库" },
          nest: { type: "string", description: "打窝策略，照抄规则库" },
          strategy: { type: "string", description: "作钓策略，照抄规则库" },
        },
        required: ["bait", "nest", "strategy"],
      },
      spotPick: { type: "string", description: "钓位选择（结合观察到的结构与规则策略）" },
    },
    required: [
      "score",
      "waterType",
      "confidence",
      "tips",
      "warnings",
      "suitableFish",
      "bestTime",
      "waterAnalysis",
      "rigSetup",
      "baitPlan",
      "spotPick",
    ],
  },
} as const;

const EXPERT_SYSTEM_PROMPT =
  "你是垂钓技术教练。输入是「现场观察特征」+「知识库专业规则」。你的任务：\n" +
  "1. 专业数值（线号/钩型/调目钓目/铅重/饵料/打窝）**只能照抄规则库**，不得自行替换或补充数值；\n" +
  "2. 规则库未提供的部分才可给方向性建议；若规则库标注未命中，则不得给出任何具体数值，" +
  "并在 tips 中说明「本次现场条件未匹配到专业规则，仅给方向性建议」；\n" +
  "3. 结论必须与观察特征自洽（如观察到急流却建议钓浮需说明）；\n" +
  "4. 只输出符合 JSON Schema 的对象，不要输出多余文字。";

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function buildBody(imageDataUrl: string, hintText: string) {
  return {
    model: env.k3Model,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `请评估这个钓点。${hintText}` },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    response_format: { type: "json_schema", json_schema: RESULT_SCHEMA },
  };
}

function parseResult(raw: string): FishSpotResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new K3Error("parse", "K3 返回内容非 JSON");
  }
  const r = obj as Partial<FishSpotResult>;
  if (typeof r?.score !== "number" || !Array.isArray(r?.suitableFish)) {
    throw new K3Error("parse", "K3 返回结构不符合预期");
  }
  return {
    score: Math.max(0, Math.min(100, Math.round(r.score))),
    waterType: String(r.waterType ?? "未知水体"),
    suitableFish: (r.suitableFish as unknown[]).map((s) => String(s)).slice(0, 8),
    bestTime: String(r.bestTime ?? ""),
    tips: String(r.tips ?? ""),
    confidence: Math.max(0, Math.min(1, Number(r.confidence ?? 0))),
    warnings: String(r.warnings ?? ""),
  };
}

function mockResult(): { result: FishSpotResult; usage: K3Usage } {
  return {
    result: {
      score: 78,
      waterType: "天然湖泊",
      suitableFish: ["鲫鱼", "鲤鱼", "翘嘴"],
      bestTime: "清晨 05:30–08:00 / 傍晚 17:00–19:30",
      tips: "近岸水草边下竿，腥香饵打底，浮漂调四钓二；注意保持安静。",
      confidence: 0.82,
      warnings: "岸边坡度较陡，注意防滑；午后顶光鱼口偏慢。",
    },
    usage: { promptTokens: 1150, completionTokens: 220, totalTokens: 1370 },
  };
}

function mockFeatures(): SpotFeatures {
  return {
    waterTypeGuess: "天然湖泊",
    waterColor: "黄绿",
    clarity: "中等",
    weedCoverage: "近岸浅水有零散芦苇与浮草，开阔水面无草",
    bankStructure: "缓坡入水，局部碎石护坡",
    inletOutlet: "左侧可见小进水口，水流不明显",
    light: "上午全日照，午后岸边有树荫",
    surfaceActivity: "水面轻波纹，近岸有零星鱼星",
    structures: ["水草区", "深浅交界", "进出水口", "岸坡"],
    confidence: 0.8,
  };
}

function emptyUsage(): K3Usage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/** 统一调用 K3：超时 + 5xx/网络抖动重试；attempts=1 时不重试 */
export async function callK3(
  body: unknown,
  opts: { timeoutMs: number; attempts: number },
): Promise<{ content: string; usage: K3Usage }> {
  const url = `${env.moonshotBaseUrl}/chat/completions`;
  const payload = JSON.stringify(body);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.moonshotApiKey}`,
        },
        body: payload,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const text = (await resp.text()).slice(0, 300);
        // 4xx 多为请求/配额问题，不重试；5xx 重试
        if (resp.status >= 500 && attempt < opts.attempts - 1) {
          lastErr = new K3Error("http", `K3 HTTP ${resp.status}: ${text}`);
          continue;
        }
        throw new K3Error("http", `K3 HTTP ${resp.status}: ${text}`);
      }
      const data = (await resp.json()) as ChatCompletion;
      return {
        content: data.choices?.[0]?.message?.content ?? "",
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
      };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof K3Error) throw err;
      const isAbort = (err as { name?: string })?.name === "AbortError";
      lastErr = isAbort ? new K3Error("timeout", "K3 识别超时") : err;
      if (attempt < opts.attempts - 1) continue; // 网络抖动重试
    }
  }
  if (lastErr instanceof K3Error) throw lastErr;
  throw new K3Error("http", `K3 调用失败：${String(lastErr)}`);
}

function hintTextOf(hint?: { latitude?: number; longitude?: number; locationText?: string }): string {
  if (hint?.locationText) return `拍摄地点参考：${hint.locationText}。`;
  if (hint?.latitude != null && hint?.longitude != null) {
    return `拍摄坐标参考：${hint.latitude.toFixed(4)}, ${hint.longitude.toFixed(4)}。`;
  }
  return "";
}

/**
 * 基础档识别（v12 链路，保持逐字不变）。
 * @param imageDataUrl 客户端压缩后的 data:image/...;base64 图
 * @param hint 可选定位/文字线索，帮助模型判断（不强制）
 */
export async function identifyFishSpot(
  imageDataUrl: string,
  hint?: { latitude?: number; longitude?: number; locationText?: string },
): Promise<{ result: FishSpotResult; usage: K3Usage }> {
  if (env.k3Mock) return mockResult();
  if (!env.moonshotApiKey) throw new K3Error("no-key", "识别服务未配置 API Key");
  if (!imageDataUrl.startsWith("data:image/")) throw new K3Error("bad-image", "图片格式不正确");

  const { content, usage } = await callK3(buildBody(imageDataUrl, hintTextOf(hint)), {
    timeoutMs: env.k3TimeoutMs,
    attempts: 2,
  });
  return { result: parseResult(content), usage };
}

/**
 * QY-SPOT-004 Step 1：视觉特征提取。只出观察、不出建议。
 * 解析失败不抛（返回空特征）——规则检索与结论生成应基于已得信息继续工作。
 */
export async function extractSpotFeatures(
  imageDataUrl: string,
  hint?: { latitude?: number; longitude?: number; locationText?: string },
): Promise<{ features: SpotFeatures | null; usage: K3Usage }> {
  if (env.k3Mock) return { features: mockFeatures(), usage: emptyUsage() };
  if (!env.moonshotApiKey) throw new K3Error("no-key", "识别服务未配置 API Key");
  if (!imageDataUrl.startsWith("data:image/")) throw new K3Error("bad-image", "图片格式不正确");

  const body = {
    model: env.k3Model,
    temperature: 0.2,
    messages: [
      { role: "system", content: FEATURE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `请客观记录这片水域的现场特征。${hintTextOf(hint)}` },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    response_format: { type: "json_schema", json_schema: FEATURE_SCHEMA },
  };
  try {
    const { content, usage } = await callK3(body, { timeoutMs: env.k3StepTimeoutMs, attempts: 2 });
    return { features: parseFeatures(content), usage };
  } catch (err) {
    // no-key / bad-image 属真实故障须上抛；解析与超时降级为空特征
    if (err instanceof K3Error && (err.code === "no-key" || err.code === "bad-image")) throw err;
    return { features: null, usage: emptyUsage() };
  }
}

function parseFeatures(raw: string): SpotFeatures | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = obj as Partial<SpotFeatures>;
  if (!r || typeof r !== "object") return null;
  return {
    waterTypeGuess: String(r.waterTypeGuess ?? ""),
    waterColor: String(r.waterColor ?? ""),
    clarity: String(r.clarity ?? ""),
    weedCoverage: String(r.weedCoverage ?? ""),
    bankStructure: String(r.bankStructure ?? ""),
    inletOutlet: String(r.inletOutlet ?? ""),
    light: String(r.light ?? ""),
    surfaceActivity: String(r.surfaceActivity ?? ""),
    structures: Array.isArray(r.structures) ? (r.structures as unknown[]).map(String).slice(0, 8) : [],
    confidence: Math.max(0, Math.min(1, Number(r.confidence ?? 0))),
  };
}

/** Step 3 的现场参数叙述（把用户填的可选字段变成模型能读的中文线索） */
export interface ExpertContext {
  season?: Season;
  waterTempC?: number;
  airTempC?: number;
  weather?: string;
  windLevel?: number;
  timeOfDay?: TimeOfDay;
  targetFish?: string[];
  locationText?: string;
}

function contextToText(ctx: ExpertContext): string {
  const bits: string[] = [];
  if (ctx.season) bits.push(`季节=${ctx.season}`);
  if (typeof ctx.waterTempC === "number") bits.push(`水温≈${ctx.waterTempC}℃`);
  if (typeof ctx.airTempC === "number") bits.push(`气温${ctx.airTempC}℃`);
  if (ctx.weather) bits.push(`天气=${ctx.weather}`);
  if (typeof ctx.windLevel === "number") bits.push(`风力=${ctx.windLevel}级`);
  if (ctx.timeOfDay) bits.push(`作钓时段=${ctx.timeOfDay}`);
  if (ctx.targetFish?.length) bits.push(`目标鱼=${ctx.targetFish.join("/")}`);
  if (ctx.locationText) bits.push(`地点=${ctx.locationText}`);
  return bits.length ? `现场参数：${bits.join("；")}。` : "现场参数：用户未填写（按观察与通用季节推断）。";
}

function featuresToText(f: SpotFeatures | null): string {
  if (!f) return "观察特征：本轮视觉特征提取失败或缺失，请仅依据现场参数与规则库给出保守结论，并在 warnings 说明照片信息不足。";
  return [
    "观察特征（由视觉模型从照片提取，不含建议）：",
    `  水体类型判断：${f.waterTypeGuess || "无法判断"}`,
    `  水色：${f.waterColor || "无法判断"}；透明度：${f.clarity || "无法判断"}`,
    `  水草/浮萍：${f.weedCoverage || "无法判断"}`,
    `  岸边结构：${f.bankStructure || "无法判断"}`,
    `  进出水口：${f.inletOutlet || "无法判断"}`,
    `  光照：${f.light || "无法判断"}`,
    `  水面动静：${f.surfaceActivity || "无法判断"}`,
    `  可见结构标签：${f.structures.length ? f.structures.join("、") : "无"}`,
  ].join("\n");
}

const EMPTY_RIG: RigSetup = { lineSpec: "", hookSpec: "", floatSetup: "", sinkerSpec: "" };
const EMPTY_BAIT: BaitPlan = { bait: "", nest: "", strategy: "" };

function firstText(...vals: Array<string | undefined>): string {
  for (const v of vals) if (v && v.trim()) return v.trim();
  return "";
}

/**
 * QY-SPOT-004/005 Step 3：结论生成。
 * 只喂文本（特征 + 规则），不重传图片——图像 token 是一次性的，这是两次调用成本可控的关键。
 */
export async function generateExpertReport(
  features: SpotFeatures | null,
  matches: RuleMatch[],
  ctx: ExpertContext,
): Promise<{ result: FishSpotExpertResult; usage: K3Usage }> {
  const ruleBlock = rulesToPromptBlock(matches);
  if (env.k3Mock) {
    return { result: mockExpertResult(features, matches, ctx), usage: emptyUsage() };
  }
  if (!env.moonshotApiKey) throw new K3Error("no-key", "识别服务未配置 API Key");

  const body = {
    model: env.k3Model,
    temperature: 0.3,
    messages: [
      { role: "system", content: EXPERT_SYSTEM_PROMPT },
      { role: "user", content: `${featuresToText(features)}\n\n${contextToText(ctx)}\n\n知识库专业规则：\n${ruleBlock}` },
    ],
    response_format: { type: "json_schema", json_schema: EXPERT_SCHEMA },
  };
  const { content, usage } = await callK3(body, { timeoutMs: env.k3StepTimeoutMs, attempts: 1 });
  return { result: parseExpert(content, features, matches), usage };
}

/** 结构化字段解析成功率 ≥99% 的关键：所有缺失都有兜底，绝不因单字段缺失整体报错 */
function parseExpert(
  raw: string,
  features: SpotFeatures | null,
  matches: RuleMatch[],
): FishSpotExpertResult {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new K3Error("parse", "K3 专家报告非 JSON");
  }
  if (!obj || typeof obj !== "object") throw new K3Error("parse", "K3 专家报告结构异常");

  const topRule = matches[0]?.rule;

  // 鱼种：带优先级与理由的结构项；模型漏写时退回规则鱼种或观察推断
  const fishRaw = Array.isArray(obj.suitableFish) ? (obj.suitableFish as unknown[]) : [];
  const suitableFishDetail: SuitableFishItem[] = fishRaw
    .map((it, i) => {
      const o = (it ?? {}) as Partial<SuitableFishItem>;
      return {
        name: String(o.name ?? "").trim(),
        priority: Number.isFinite(Number(o.priority)) ? Math.max(1, Math.round(Number(o.priority))) : i + 1,
        reason: String(o.reason ?? "").trim(),
      };
    })
    .filter((f) => f.name)
    .slice(0, 8)
    .sort((a, b) => a.priority - b.priority);

  const timeRaw = Array.isArray(obj.bestTime) ? (obj.bestTime as unknown[]) : [];
  const bestTimeDetail: BestTimeItem[] = timeRaw
    .map((it) => {
      const o = (it ?? {}) as Partial<BestTimeItem>;
      return { period: String(o.period ?? "").trim(), reason: String(o.reason ?? "").trim() };
    })
    .filter((t) => t.period)
    .slice(0, 6);

  const wa = (obj.waterAnalysis ?? {}) as Partial<WaterAnalysis>;
  const waterAnalysis: WaterAnalysis = {
    clarity: firstText(wa.clarity, typeof features?.clarity === "string" ? features.clarity : ""),
    colorDesc: firstText(wa.colorDesc, features?.waterColor, ""),
    structure: firstText(wa.structure, features?.bankStructure, features?.weedCoverage, ""),
    flowDesc: firstText(wa.flowDesc, features?.inletOutlet, features?.surfaceActivity, ""),
  };

  const mr = (obj.rigSetup ?? {}) as Partial<RigSetup>;
  const mb = (obj.baitPlan ?? {}) as Partial<BaitPlan>;

  // 专业数值来源裁决：命中规则 → 以规则值兜底/校验；未命中 → 强制清空具体数值（不编造）
  let rigSetup: RigSetup;
  let baitPlan: BaitPlan;
  let specificsSource: FishSpotExpertResult["specificsSource"];
  if (matches.length > 0) {
    const a = topRule!.advice;
    rigSetup = {
      lineSpec: firstText(a.lineSpec, mr.lineSpec),
      hookSpec: firstText(a.hookSpec, mr.hookSpec),
      floatSetup: firstText(a.floatSetup, mr.floatSetup),
      sinkerSpec: firstText(a.sinkerSpec, mr.sinkerSpec),
    };
    baitPlan = {
      bait: firstText(a.bait, mb.bait),
      nest: firstText(a.nest, mb.nest),
      strategy: firstText(a.strategy, mb.strategy),
    };
    specificsSource = "rule";
  } else {
    rigSetup = { ...EMPTY_RIG };
    baitPlan = { ...EMPTY_BAIT };
    specificsSource = "none";
  }

  const scoreNum = Math.round(Number(obj.score));
  const fishNames = suitableFishDetail.map((f) => f.name);
  return {
    score: Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, scoreNum)) : 60,
    waterType: String(obj.waterType ?? features?.waterTypeGuess ?? "未知水体"),
    // 兼容基础字段：专家档同时给出扁平鱼种串，便于台账与老组件复用
    suitableFish: fishNames.length ? fishNames : (topRule && topRule.fish !== "*" ? [topRule.fish] : []),
    bestTime: bestTimeDetail.map((t) => (t.reason ? `${t.period}（${t.reason}）` : t.period)).join("；"),
    tips: String(obj.tips ?? ""),
    confidence: Math.max(0, Math.min(1, Number(obj.confidence ?? features?.confidence ?? 0))),
    warnings: String(obj.warnings ?? ""),
    suitableFishDetail,
    bestTimeDetail,
    waterAnalysis,
    rigSetup,
    baitPlan,
    spotPick: String(obj.spotPick ?? topRule?.advice.strategy ?? ""),
    specificsSource,
    knowledgeBasis: ruleBasis(matches),
  };
}

function mockExpertResult(features: SpotFeatures | null, matches: RuleMatch[], ctx: ExpertContext): FishSpotExpertResult {
  const r = parseExpert(
    JSON.stringify({
      score: 78,
      waterType: features?.waterTypeGuess || "天然湖泊",
      confidence: features?.confidence ?? 0.82,
      tips: "近岸水草边缘与深浅交界下竿，按规则线组小钩细线，保持安静。",
      warnings: "岸边坡度较陡注意防滑；午后顶光口慢。",
      suitableFish: [
        { name: ctx.targetFish?.[0] ?? "鲫鱼", priority: 1, reason: "现场有水草与缓坡，符合鲫鱼类觅食结构" },
        { name: "鲤鱼", priority: 2, reason: "淤泥底缓坡利于鲤鱼拱食" },
      ],
      bestTime: [
        { period: "晨 05:30–08:30", reason: "光线弱、近岸溶氧好，鱼靠边觅食" },
        { period: "昏 17:00–19:30", reason: "水温回落，鱼二次开口" },
      ],
      waterAnalysis: {
        clarity: String(features?.clarity ?? "中等"),
        colorDesc: features?.waterColor ?? "黄绿",
        structure: features?.bankStructure ?? "缓坡入水",
        flowDesc: features?.inletOutlet ?? "未见明显进出水口",
      },
      rigSetup: {
        lineSpec: "主线 0.8～1.0 号，子线 0.4～0.6 号",
        hookSpec: "袖钩 3～4 号",
        floatSetup: "调 4～5 目钓 2 目",
        sinkerSpec: "细身铅 0.8～1.2 克",
      },
      baitPlan: {
        bait: "腥香拉饵或红虫",
        nest: "酒米小窝 20～30 克，勤补少补",
        strategy: "背风向阳、水草边缘，先浅后深",
      },
      spotPick: "左侧进水口两侧的深浅交界处，避开正对急流的主线位",
    }),
    features,
    matches,
  );
  return { ...r, knowledgeBasis: ruleBasis(matches) };
}
