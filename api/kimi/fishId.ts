/**
 * @layer Application Layer —— Moonshot K3 鱼类识别中转（识鱼 · QY-FISH-002）
 * @file api/kimi/fishId.ts
 *
 * 设计要点（与 k3.ts 同构，但只调一次模型）：
 * - Key 只读 env.moonshotApiKey，绝不进 APK / 代码库 / 前端 bundle（服务端单向中转）。
 * - OpenAI 兼容 Chat Completions + 严格 JSON Schema 结构化输出。
 * - 图片以 dataURL 直接随请求上送（同 k3.ts 口径）。
 * - 系统提示词注入鱼种知识卡（speciesPromptBlock，本地零 token 检索），压幻觉。
 * - 输出 Top-3 候选 + 置信度 + 鉴别依据；低置信时诚实降级，不硬猜。
 * - env.k3Mock=true 时不真实调用，返回模拟结果（不烧真实额度）。
 *
 * 与钓点识别的区别：
 * - 钓点识别（k3.ts）：评估"这是不是好钓点"——输出水型/鱼种/钓组建议。
 * - 识鱼（本文件）：识别"这是什么鱼"——输出 Top-3 鱼种名 + 置信度。
 * - 两者共用同一套计费余额与调用基础设施（callK3/K3Usage/K3Error），但台账与定价独立。
 */
import { env } from "../lib/env";
import { callK3, K3Error, type K3Usage } from "./k3";
import {
  FISH_ID_MIN_CONFIDENCE,
  SUPPORTED_FISH,
  speciesPromptBlock,
} from "../knowledge/fishSpecies";

export { K3Error, type K3Usage };

export interface FishIdCandidate {
  /** 鱼种标准名（与 normalizeFish 归一结果对齐） */
  name: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 一句鉴别依据（来自知识卡 + 图像观察） */
  keyFeature: string;
}

export interface FishIdResult {
  /** Top-3 候选（按置信度降序） */
  topCandidates: FishIdCandidate[];
  /** Top-1 置信度（无候选时为 0） */
  confidence: number;
  /** 是否为首发支持的淡水垂钓鱼种 */
  isSupported: boolean;
  /** 兜底说明（低置信/非淡水鱼/非鱼时给用户可读的提示） */
  fallbackNote: string;
}

/** 严格 JSON Schema：识鱼结果结构化输出 */
const FISH_ID_SCHEMA = {
  name: "fish_identification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        description: "按置信度降序排列的 Top-3 鱼种候选",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", description: "鱼种标准名" },
            confidence: { type: "number", description: "置信度 0-1" },
            keyFeature: { type: "string", description: "一句鉴别依据" },
          },
          required: ["name", "confidence", "keyFeature"],
        },
        maxItems: 3,
      },
      isSupported: {
        type: "boolean",
        description: "是否为淡水常见垂钓鱼种（非海水鱼/非观赏鱼/非其他生物）",
      },
      fallbackNote: {
        type: "string",
        description: "兜底说明：低置信或不支持时给用户的可读提示，正常识别时为空串",
      },
    },
    required: ["candidates", "isSupported", "fallbackNote"],
  },
  } as const;

const FISH_ID_SYSTEM_PROMPT =
  "你是淡水鱼类识别专家。根据用户拍摄的鱼照片，从以下鱼种知识库中识别最可能的 Top-3 鱼种。\n" +
  "鱼种知识库（标准名 + 形态特征 + 鉴别要点 + 相似种区分）：\n" +
  speciesPromptBlock() +
  "\n\n规则：\n" +
  "1. 只从知识库的 16 种淡水鱼中给出候选；如果照片明显不是鱼、是海水鱼、是观赏鱼，" +
  "isSupported 设为 false 并在 fallbackNote 说明，candidates 给空数组或置信度极低的推测；\n" +
  "2. 每个 candidate 的 name 必须用知识库中的标准名（不可用别名）；\n" +
  "3. keyFeature 要引用形态/鉴别要点中可见的特征（如'体高而侧扁、无须、背鳍硬棘粗壮'）；\n" +
  "4. confidence 反映你对识别的确信程度，非知识库鱼种的置信度不得高于 0.4；\n" +
  "5. 只输出符合 JSON Schema 的对象，不要输出多余文字。";

function buildBody(imageDataUrl: string) {
  return {
    model: env.k3Model,
    temperature: 0.2,
    messages: [
      { role: "system", content: FISH_ID_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "请识别这条鱼的品种。" },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    response_format: { type: "json_schema", json_schema: FISH_ID_SCHEMA },
  };
}

/** 全字段兜底解析——单字段缺失不报错（≥99% 解析成功率红线，同 k3.ts parseExpert） */
function parseFishResult(raw: string): FishIdResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new K3Error("parse", "K3 识鱼返回非 JSON");
  }
  const r = obj as Partial<{ candidates: unknown[]; isSupported: boolean; fallbackNote: string }>;
  if (!r || typeof r !== "object") throw new K3Error("parse", "K3 识鱼返回结构异常");

  const candsRaw = Array.isArray(r.candidates) ? r.candidates : [];
  const topCandidates: FishIdCandidate[] = candsRaw
    .map((it) => {
      const o = (it ?? {}) as Partial<FishIdCandidate>;
      return {
        name: String(o.name ?? "").trim(),
        confidence: Math.max(0, Math.min(1, Number(o.confidence ?? 0))),
        keyFeature: String(o.keyFeature ?? "").trim(),
      };
    })
    .filter((c) => c.name)
    .slice(0, 3)
    .sort((a, b) => b.confidence - a.confidence);

  const confidence = topCandidates.length > 0 ? topCandidates[0].confidence : 0;
  const isSupported =
    typeof r.isSupported === "boolean" ? r.isSupported : topCandidates.length > 0;

  let fallbackNote = String(r.fallbackNote ?? "").trim();
  // 低置信诚实降级（不硬猜）——与 v13「规则未命中则降级不编造」同一红线
  if (topCandidates.length === 0) {
    fallbackNote = fallbackNote || "未能识别鱼种，请补拍侧面全身照后重试。";
  } else if (confidence < FISH_ID_MIN_CONFIDENCE && !fallbackNote) {
    fallbackNote = `识别置信度较低（${Math.round(confidence * 100)}%），可能是${topCandidates[0].name}但不确信，建议补拍侧面全身照重试。`;
  }

  return {
    topCandidates,
    confidence,
    isSupported,
    fallbackNote,
  };
}

function mockFishResult(): { result: FishIdResult; usage: K3Usage } {
  return {
    result: {
      topCandidates: [
        { name: "鲫鱼", confidence: 0.88, keyFeature: "体高而侧扁、无须、背鳍硬棘粗壮、鳃盖后橙红色斑" },
        { name: "鳊鱼", confidence: 0.42, keyFeature: "菱形体型但腹棱在全腹而非仅腹鳍后，与鲫鱼腹圆有差异" },
        { name: "鲤鱼", confidence: 0.15, keyFeature: "体型偏长圆，若有须则为鲤鱼，本图未见须" },
      ],
      confidence: 0.88,
      isSupported: true,
      fallbackNote: "",
    },
    usage: { promptTokens: 800, completionTokens: 150, totalTokens: 950 },
  };
}

function emptyUsage(): K3Usage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/**
 * 识鱼：单次 K3 视觉调用 + Top-3 候选 + 兜底降级。
 * @param imageDataUrl 客户端压缩后的 data:image/...;base64 图
 */
export async function identifyFish(
  imageDataUrl: string,
): Promise<{ result: FishIdResult; usage: K3Usage }> {
  if (env.k3Mock) return mockFishResult();
  if (!env.moonshotApiKey) throw new K3Error("no-key", "识别服务未配置 API Key");
  if (!imageDataUrl.startsWith("data:image/")) throw new K3Error("bad-image", "图片格式不正确");

  const { content, usage } = await callK3(buildBody(imageDataUrl), {
    timeoutMs: env.k3TimeoutMs,
    attempts: 2,
  });
  return { result: parseFishResult(content), usage };
}

/** 判断识鱼结果是否为"有效识别"（Top-1 置信度达标且为支持鱼种） */
export function isHighConfidence(result: FishIdResult): boolean {
  return (
    result.isSupported &&
    result.topCandidates.length > 0 &&
    result.topCandidates[0].confidence >= env.fishIdMinConfidence
  );
}

export { emptyUsage };

/** 导出支持鱼种列表供服务层做归一校验 */
export { SUPPORTED_FISH };
