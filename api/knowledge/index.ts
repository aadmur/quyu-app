/**
 * @layer Domain —— 规则检索与热更（哪钓专业化 QY-SPOT-003 / 004 / 011）
 * @file api/knowledge/index.ts
 *
 * 两个职责：
 * 1. retrieveRules()：纯本地按维度打分检索 Top-N 规则（零 token），Step 2 用。
 * 2. 热更：env FISH_KNOWLEDGE_FILE 指向 JSON 规则数组，mtime 变化则重读；
 *    任何读/解析/校验失败保留旧表并记日志（可用性优先）。模式与 contentFilter 一致。
 *
 * 硬性过滤维度（缺省=不限）：season、waterType、fish。
 * 软性加分维度：flow / clarity / structures / tempRange / times / 审定状态。
 * 未达 MIN_HIT_SCORE 视为**未命中**，调用方须降级为通用建议，不得给出具体线号/钩型。
 */
import fs from "node:fs";
import path from "node:path";
import {
  BUILTIN_RULES,
  type Clarity,
  type FishingRule,
  type Flow,
  type Season,
  type TimeOfDay,
  normalizeFish,
} from "./fishingRules";

/** 命中门槛：低于此分不作专业依据（硬过滤命中一般 ≥45 分，弱组合会被拒） */
export const MIN_HIT_SCORE = 25;

export interface RuleQueryInput {
  waterType?: string;
  season?: Season;
  /** 水温（无实测时由 estimateWaterTempC 推得） */
  waterTempC?: number;
  timeOfDay?: TimeOfDay;
  clarity?: Clarity;
  flow?: Flow;
  /** Step 1 观察到的岸边/水底结构 */
  structures?: string[];
  /** 目标鱼（已归一）；空数组 = 不限 */
  targetFish?: string[];
}

export interface RuleMatch {
  rule: FishingRule;
  score: number;
  /** 命中的维度说明，供「专业依据」展示与调试 */
  reasons: string[];
}

// ── 规则表当前快照（内置 → 可被热更文件整体替换） ────────────────────────────
interface RuleSet {
  rules: FishingRule[];
  source: "builtin" | "file";
  file: string | null;
  mtimeMs: number | null;
  loadedAt: string;
  error: string | null;
}

let current: RuleSet = {
  rules: BUILTIN_RULES,
  source: "builtin",
  file: null,
  mtimeMs: null,
  loadedAt: new Date().toISOString(),
  error: null,
};

const REQUIRED_ADVICE = [
  "method",
  "lineSpec",
  "hookSpec",
  "floatSetup",
  "sinkerSpec",
  "bait",
  "nest",
  "strategy",
] as const;

/** 校验外部规则文件结构；返回可用规则或抛错信息 */
function validateRules(raw: unknown): { rules?: FishingRule[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "规则文件须为非空 JSON 数组" };
  const seen = new Set<string>();
  const out: FishingRule[] = [];
  for (const [i, item] of (raw as unknown[]).entries()) {
    const r = item as Partial<FishingRule>;
    if (!r || typeof r !== "object") return { error: `第 ${i} 条非对象` };
    if (typeof r.id !== "string" || !r.id) return { error: `第 ${i} 条缺 id` };
    if (seen.has(r.id)) return { error: `id 重复：${r.id}` };
    seen.add(r.id);
    if (typeof r.fish !== "string") return { error: `${r.id} 缺 fish` };
    if (!Array.isArray(r.seasons) || r.seasons.length === 0) return { error: `${r.id} 缺 seasons` };
    if (!Array.isArray(r.waterTypes) || r.waterTypes.length === 0) return { error: `${r.id} 缺 waterTypes` };
    const a = r.advice;
    if (!a || typeof a !== "object") return { error: `${r.id} 缺 advice` };
    for (const k of REQUIRED_ADVICE) {
      const v = (a as unknown as Record<string, unknown>)[k];
      if (typeof v !== "string" || !v.trim()) {
        return { error: `${r.id} 的建议字段 ${k} 缺失或为空` };
      }
    }
    out.push(r as FishingRule);
  }
  return { rules: out };
}

function loadFromFile(file: string): void {
  let st: fs.Stats | null = null;
  try {
    st = fs.statSync(file);
    if (current.source === "file" && current.mtimeMs === st.mtimeMs) return; // 未变，避免每请求重复解析
    const parsed = validateRules(JSON.parse(fs.readFileSync(file, "utf8")));
    if (parsed.error) {
      // 文件坏了：保留旧表只记错误（可用性优先），并记住 mtime 避免每请求刷屏重读
      current = { ...current, mtimeMs: st.mtimeMs, error: parsed.error };
      return;
    }
    current = {
      rules: parsed.rules!,
      source: "file",
      file,
      mtimeMs: st.mtimeMs,
      loadedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    // 读/解析失败同样记住 mtime（若 stat 成功），否则每个识别都会重复读同一个坏文件
    current = { ...current, mtimeMs: st?.mtimeMs ?? current.mtimeMs, error: `读取规则文件失败：${String(err)}` };
  }
}

/** 热更入口：每次识别前调用，stat 比对 mtime（沿用 contentFilter 的按需 stat） */
export function refreshRules(): void {
  const file = process.env.FISH_KNOWLEDGE_FILE;
  if (!file) return;
  loadFromFile(path.resolve(file));
}

export function getRules(): FishingRule[] {
  return current.rules;
}

export function knowledgeMeta() {
  return {
    source: current.source,
    count: current.rules.length,
    file: current.file,
    mtimeMs: current.mtimeMs,
    loadedAt: current.loadedAt,
    error: current.error,
  };
}

/** 水型字面量 → 规则表水型口径（与 fishingRules.normalizeWaterType 同义，此处只做包含式宽松匹配） */
function waterTypeCompatible(ruleWaterTypes: string[], query: string): boolean {
  return ruleWaterTypes.some((w) => query === w || query.includes(w) || w.includes(query));
}

function scoreRule(rule: FishingRule, q: RuleQueryInput): { matched: boolean; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // ── 硬过滤：季节 ──
  if (q.season) {
    if (!rule.seasons.includes(q.season)) return { matched: false, score: 0, reasons };
    score += 20;
    reasons.push(`季节:${q.season}`);
  }

  // ── 硬过滤：水体类型 ──
  if (q.waterType) {
    if (!waterTypeCompatible(rule.waterTypes, q.waterType)) return { matched: false, score: 0, reasons };
    score += 15;
    reasons.push(`水型:${q.waterType}`);
  }

  // ── 硬过滤：目标鱼（规则为 "*" 时视为通用/结构性规则，不排除） ──
  const fishList = (q.targetFish ?? []).map(normalizeFish).filter(Boolean);
  if (fishList.length > 0 && rule.fish !== "*") {
    if (!fishList.includes(normalizeFish(rule.fish))) return { matched: false, score: 0, reasons };
    score += 40;
    reasons.push(`鱼种:${rule.fish}`);
  } else if (rule.fish === "*") {
    score += 10;
    reasons.push("通用结构规则");
  } else {
    score += 6; // 用户未指定目标鱼，规则自带鱼种仍有参考价值
  }

  // ── 软加分：流态 ──
  if (q.flow && rule.flows) {
    if (rule.flows.includes(q.flow)) {
      score += 10;
      reasons.push(`流态:${q.flow}`);
    }
  }

  // ── 软加分：水色/透明度 ──
  if (q.clarity && rule.clarity) {
    if (rule.clarity.includes(q.clarity)) {
      score += 8;
      reasons.push(`水色:${q.clarity}`);
    }
  }

  // ── 软加分：观察到的结构（任一命中即加，封顶 12） ──
  if (q.structures?.length && rule.structures?.length) {
    const hit = rule.structures.filter((s) => q.structures!.some((obs) => obs.includes(s) || s.includes(obs)));
    if (hit.length > 0) {
      score += Math.min(12, hit.length * 4);
      reasons.push(`结构:${hit.join("/")}`);
    }
  }

  // ── 软加分：水温 ──
  if (typeof q.waterTempC === "number" && rule.tempRange) {
    const [lo, hi] = rule.tempRange;
    if (q.waterTempC >= lo && q.waterTempC <= hi) {
      score += 10;
      reasons.push(`水温${q.waterTempC}℃在区间`);
    } else if (q.waterTempC >= lo - 3 && q.waterTempC <= hi + 3) {
      score += 4;
      reasons.push(`水温${q.waterTempC}℃接近区间`);
    } else {
      score -= 8;
    }
  }

  // ── 软加分：时段 ──
  if (q.timeOfDay && rule.times?.includes(q.timeOfDay)) {
    score += 8;
    reasons.push(`时段:${q.timeOfDay}`);
  }

  // ── 已审定规则优先 ──
  if (rule.reviewStatus === "approved") score += 2;

  return { matched: score >= MIN_HIT_SCORE, score, reasons };
}

/** 同鱼种最多保留 maxPerFish 条，避免 Top-N 全被同一鱼种占满 */
function diversify(matches: RuleMatch[], topN: number, maxPerFish = 2): RuleMatch[] {
  const byFish = new Map<string, number>();
  const out: RuleMatch[] = [];
  for (const m of matches) {
    const key = m.rule.fish;
    const used = byFish.get(key) ?? 0;
    if (used >= maxPerFish) continue;
    byFish.set(key, used + 1);
    out.push(m);
    if (out.length >= topN) break;
  }
  if (out.length < topN) {
    for (const m of matches) {
      if (out.length >= topN) break;
      if (!out.includes(m)) out.push(m);
    }
  }
  return out;
}

/**
 * Step 2 规则检索：本地打分，零 token。
 * 返回按分降序、鱼种多样化后的 Top-N；**空数组表示未命中，调用方须降级**。
 */
export function retrieveRules(query: RuleQueryInput, topN = 3): RuleMatch[] {
  refreshRules();
  const q: RuleQueryInput = {
    ...query,
    waterType: query.waterType?.trim() || undefined,
    targetFish: (query.targetFish ?? []).filter(Boolean),
  };
  const matches: RuleMatch[] = [];
  for (const rule of current.rules) {
    const r = scoreRule(rule, q);
    if (r.matched) matches.push({ rule, score: r.score, reasons: r.reasons });
  }
  matches.sort((a, b) => b.score - a.score || a.rule.id.localeCompare(b.rule.id));
  return diversify(matches, topN);
}

/** 覆盖主流鱼种 × 主流水型 × 四季的覆盖率检查用：某组合是否有规则 */
export function hasRuleFor(fish: string, season: Season, waterType: string): boolean {
  refreshRules();
  const f = normalizeFish(fish);
  return current.rules.some(
    (r) =>
      r.seasons.includes(season) &&
      waterTypeCompatible(r.waterTypes, waterType) &&
      (r.fish === "*" || normalizeFish(r.fish) === f),
  );
}

/** 把命中规则压成给 Step 3 模型的「专业依据」文本块（只给结论素材，不让模型自由发挥） */
export function rulesToPromptBlock(matches: RuleMatch[]): string {
  if (matches.length === 0) return "（本次未命中知识库规则：只给通用性、方向性建议，**严禁编造具体线号、钩号、调目钓目等数值**，并在 tips 中说明依据不足。）";
  return matches
    .map((m, i) => {
      const a = m.rule.advice;
      return [
        `规则${i + 1}（id=${m.rule.id}，鱼种=${m.rule.fish}，命中维度=${m.reasons.join("·")}）`,
        `  钓法：${a.method}`,
        `  线号：${a.lineSpec}`,
        `  钩型：${a.hookSpec}`,
        `  调漂：${a.floatSetup}`,
        `  铅坠：${a.sinkerSpec}`,
        `  饵料：${a.bait}`,
        `  打窝：${a.nest}`,
        `  策略：${a.strategy}`,
        a.timeNote ? `  时段：${a.timeNote}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

/** 命中规则的可审计摘要，回传给前端展示「依据 N 条规则」 */
export function ruleBasis(matches: RuleMatch[]) {
  return matches.map((m) => ({
    ruleId: m.rule.id,
    fish: m.rule.fish,
    score: m.score,
    matchedOn: m.reasons,
    reviewStatus: m.rule.reviewStatus,
  }));
}
