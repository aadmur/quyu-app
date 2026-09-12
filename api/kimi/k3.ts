/**
 * @layer Application Layer —— Moonshot K3 视觉识别中转（哪钓 · 钓点评估）
 * @file api/kimi/k3.ts
 *
 * 设计要点：
 * - Key 只读 env.moonshotApiKey，绝不进 APK / 代码库 / 前端 bundle（服务端单向中转）。
 * - OpenAI 兼容 Chat Completions + 严格 JSON Schema 结构化输出，保证前端卡片可解析。
 * - 图片以 dataURL 直接随请求上送（生产为内网 IP 无公网回源，Moonshot 无法反拉 /uploads）。
 * - 非流式（分支③）：一次性拿结果；超时 60s + 网络/5xx 重试一次。
 * - env.k3Mock=true 时不真实调用，返回模拟结果（开发/演示用，不烧真实额度）。
 */
import { env } from "../lib/env";

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

/** 严格 JSON Schema：前端卡片字段的单一可信来源 */
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

/**
 * 调用 K3 评估钓点。
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

  const hintText = hint?.locationText
    ? `拍摄地点参考：${hint.locationText}。`
    : hint?.latitude != null && hint?.longitude != null
      ? `拍摄坐标参考：${hint.latitude.toFixed(4)}, ${hint.longitude.toFixed(4)}。`
      : "";

  const url = `${env.moonshotBaseUrl}/chat/completions`;
  const body = JSON.stringify(buildBody(imageDataUrl, hintText));

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.moonshotApiKey}`,
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const text = (await resp.text()).slice(0, 300);
        // 4xx 多为请求/配额问题，不重试；5xx 重试一次
        if (resp.status >= 500 && attempt === 0) {
          lastErr = new K3Error("http", `K3 HTTP ${resp.status}: ${text}`);
          continue;
        }
        throw new K3Error("http", `K3 HTTP ${resp.status}: ${text}`);
      }
      const data = (await resp.json()) as ChatCompletion;
      const content = data.choices?.[0]?.message?.content ?? "";
      const usage: K3Usage = {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      };
      return { result: parseResult(content), usage };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof K3Error) throw err;
      const isAbort = (err as { name?: string })?.name === "AbortError";
      lastErr = isAbort ? new K3Error("timeout", "K3 识别超时") : err;
      if (attempt === 0) continue; // 网络抖动重试一次
    }
  }
  if (lastErr instanceof K3Error) throw lastErr;
  throw new K3Error("http", `K3 调用失败：${String(lastErr)}`);
}
