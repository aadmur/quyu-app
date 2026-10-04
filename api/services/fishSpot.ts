/**
 * @layer Application Layer —— FishSpotService（哪钓：K3 钓点识别 + 预付费计费闭环 + 专业化链路）
 * @file api/services/fishSpot.ts
 *
 * 数据主权：user_balance / recharge_orders / fish_spot_calls / fish_spot_samples /
 *           fish_spot_feedback / fish_spot_sample_consents 唯一写方。
 *
 * 计费模型（分支⑤：用户付费 → 预付费余额/积分）：
 * - 前 FISH_SPOT_FREE_LIMIT 次免费（钩子，分支⑥），用完按 FISH_SPOT_PRICE_CENTS/次扣余额。
 * - QY-SPOT-007 分层：basic 档维持原价与原价免费额度；expert 档按 FISH_SPOT_EXPERT_PRICE_CENTS
 *   扣费、独立 FISH_SPOT_EXPERT_FREE_LIMIT 次免费体验。**免费额度按档位分列记账**，互不挪用。
 * - 扣费原子化：先 CAS 预扣（余额不足直接拒），识别失败**按所选档位全额退还**，杜绝「失败也收钱」。
 * - 台账 fish_spot_calls 只记元数据（评分/水型/档位/命中规则 id/token/费用），
 *   **不存卡片正文与图片**（合规最小化，与样本表物理分离）。
 *
 * 专业化链路（v13 QY-SPOT-001~005）：
 * - expert 档走 Step1 视觉特征 → Step2 本地规则检索 → Step3 结论生成；
 *   Step1 特征缺失时链路继续（规则检索退化为仅按现场参数命中），不因此报错。
 *
 * 样本沉淀（QY-SPOT-008，合规前置）：
 * - 默认**不存图**；仅当用户存在未撤回的授权记录（fish_spot_sample_consents）才写样本表；
 * - 撤回授权即刻删除该用户全部样本（含落盘图文件），**不影响计费台账**。
 *
 * 充值（分支⑤）：
 * - env.payMock=true：立即到账（仅开发/演示；生产必须 false，否则成自助印钞）。
 * - 商户号未就绪期间：运营用 adminCredit 人工加余额；真实微信/支付宝回调接 boot.ts Paths.payNotify。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, gte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  fishSpotCalls,
  fishSpotFeedback,
  fishSpotSampleConsents,
  fishSpotSamples,
  rechargeOrders,
  userBalance,
} from "@db/schema";
import { getDataSource, log } from "../infra";
import { env } from "../lib/env";
import {
  addUsage,
  extractSpotFeatures,
  generateExpertReport,
  identifyFishSpot,
  K3Error,
  type ExpertContext,
  type FishSpotExpertResult,
  type FishSpotResult,
  type K3Usage,
  type SpotFeatures,
} from "../kimi/k3";
import { knowledgeMeta, retrieveRules, type RuleMatch } from "../knowledge";
import {
  estimateWaterTempC,
  normalizeFish,
  seasonFromMonth,
  timeOfDayFromHour,
  type Clarity,
  type Flow,
  type Season,
  type TimeOfDay,
} from "../knowledge/fishingRules";
import { normalizeWaterType } from "../knowledge/fishingRules";

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

/** 确保余额行存在（首用建 0 余额行），后续 CAS 才有可更新的行 */
async function ensureBalanceRow(userId: number): Promise<void> {
  const db = getDataSource().write();
  await db
    .insert(userBalance)
    .values({ userId, balanceCents: 0, freeUsed: 0, expertFreeUsed: 0 })
    .onDuplicateKeyUpdate({ set: { userId } }); // 已存在则不动
}

export type SpotTier = "basic" | "expert";

export interface BalanceInfo {
  balanceCents: number;
  freeUsed: number;
  freeLimit: number;
  priceCents: number;
  /** QY-SPOT-007 分层：专家档价格与免费体验额度 */
  expertPriceCents: number;
  expertFreeUsed: number;
  expertFreeLimit: number;
  /** 样本授权状态（前端勾选框回填用） */
  sampleConsent: { granted: boolean; scope: "image" | "features" } | null;
}

export async function getBalance(userId: number): Promise<BalanceInfo> {
  await ensureBalanceRow(userId);
  const db = getDataSource().read();
  const [row] = await db.select().from(userBalance).where(eq(userBalance.userId, userId)).limit(1);
  return {
    balanceCents: row?.balanceCents ?? 0,
    freeUsed: row?.freeUsed ?? 0,
    freeLimit: env.fishSpotFreeLimit,
    priceCents: env.fishSpotPriceCents,
    expertPriceCents: env.fishSpotExpertPriceCents,
    expertFreeUsed: row?.expertFreeUsed ?? 0,
    expertFreeLimit: env.fishSpotExpertFreeLimit,
    sampleConsent: await getSampleConsent(userId),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// QY-SPOT-001/002/003：现场参数 → 规则检索入参归一
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldParamsInput {
  season?: Season;
  waterTemp?: number;
  airTemp?: number;
  weather?: string;
  windLevel?: number;
  /** 用户选择的作钓时刻（小时 0-23），缺省取当前时间 */
  hour?: number;
  targetFish?: string[];
  /** 用户自填水型（无观察结果时兜底） */
  waterType?: string;
  clarity?: Clarity;
}

export interface IdentifyInput extends FieldParamsInput {
  imageData: string;
  latitude?: number;
  longitude?: number;
  locationText?: string;
  /** QY-SPOT-007：缺省 basic —— 老 APK（v11）不传该字段，链路行为逐字不变 */
  tier?: SpotTier;
}

const CLARITY_VALUES: Clarity[] = ["清澈", "中等", "浑浊", "肥水"];

function asClarity(v: string | undefined | null): Clarity | undefined {
  if (!v) return undefined;
  const hit = CLARITY_VALUES.find((c) => v.includes(c));
  return hit;
}

/** 从观察特征粗判流态：进出水口/水面动静文本里的「急/流水/闸」等线索 */
function inferFlow(features: SpotFeatures | null): Flow | undefined {
  if (!features) return undefined;
  const text = `${features.inletOutlet ?? ""} ${features.surfaceActivity ?? ""}`;
  if (/急流|湍急|闸门开流|白浪/.test(text)) return "急流";
  if (/进水口|出水口|缓流|流动|波纹/.test(text)) return "缓流";
  if (/静止|平静|无流|死水/.test(text)) return "静水";
  return undefined;
}

/** 现场参数 + 观察特征 → 规则检索查询（观察缺失也能工作） */
function buildRuleQuery(input: FieldParamsInput, features: SpotFeatures | null, now: Date) {
  const season: Season = input.season ?? seasonFromMonth(now.getMonth() + 1);
  const timeOfDay: TimeOfDay =
    typeof input.hour === "number" ? timeOfDayFromHour(input.hour) : timeOfDayFromHour(now.getHours());
  const waterTempC =
    typeof input.waterTemp === "number" ? input.waterTemp : estimateWaterTempC(season, input.airTemp);
  const waterType = normalizeWaterType(features?.waterTypeGuess || input.waterType || "");
  const clarity = input.clarity ?? asClarity(typeof features?.clarity === "string" ? features.clarity : undefined);
  const targetFish = (input.targetFish ?? []).map(normalizeFish).filter(Boolean);
  return {
    waterType: waterType || undefined,
    season,
    timeOfDay,
    waterTempC,
    clarity,
    flow: inferFlow(features),
    structures: features?.structures ?? [],
    targetFish,
  };
}

function expertContext(input: IdentifyInput, now: Date): ExpertContext {
  const season = input.season ?? seasonFromMonth(now.getMonth() + 1);
  return {
    season,
    waterTempC: typeof input.waterTemp === "number" ? input.waterTemp : estimateWaterTempC(season, input.airTemp),
    airTempC: typeof input.airTemp === "number" ? input.airTemp : undefined,
    weather: input.weather,
    windLevel: typeof input.windLevel === "number" ? input.windLevel : undefined,
    timeOfDay: typeof input.hour === "number" ? timeOfDayFromHour(input.hour) : timeOfDayFromHour(now.getHours()),
    targetFish: (input.targetFish ?? []).map(normalizeFish).filter(Boolean),
    locationText: input.locationText,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 识别主流程
// ─────────────────────────────────────────────────────────────────────────────

export interface IdentifyOutput {
  result: FishSpotResult | FishSpotExpertResult;
  tier: SpotTier;
  billing: "free" | "paid";
  costCents: number;
  balanceCents: number;
  freeUsed: number;
  freeLimit: number;
  /** 知识库命中情况（QY-SPOT-003 命中率口径 + 前端「依据 N 条规则」展示） */
  ruleHit: boolean;
  ruleIds: string[];
  /** 本次模型调用步数（成本核算） */
  k3Steps: number;
  /** 样本是否已沉淀（授权用户才为 true） */
  sampleSaved: boolean;
}

/** 档位定价与免费额度 */
function tierPricing(tier: SpotTier) {
  const isExpert = tier === "expert";
  return {
    price: isExpert ? env.fishSpotExpertPriceCents : env.fishSpotPriceCents,
    freeLimit: isExpert ? env.fishSpotExpertFreeLimit : env.fishSpotFreeLimit,
    // 两档免费额度分列记账，互不挪用
    usedColumn: isExpert ? "expertFreeUsed" : "freeUsed",
  };
}

/** 识别钓点：先占位（该档免费次数或预扣余额）→ 走链路 → 失败按档退还 → 成功写台账/样本 */
export async function identify(userId: number, input: IdentifyInput): Promise<IdentifyOutput> {
  if (!input.imageData.startsWith("data:image/")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片格式不正确" });
  }
  const tier: SpotTier = input.tier === "expert" ? "expert" : "basic";
  const now = new Date();
  const db = getDataSource().write();
  await ensureBalanceRow(userId);

  const { price, freeLimit, usedColumn } = tierPricing(tier);
  const freeCol = usedColumn === "expertFreeUsed" ? userBalance.expertFreeUsed : userBalance.freeUsed;

  // 1) 先尝试占用该档免费次数（原子 CAS）
  const freeRes = await db
    .update(userBalance)
    .set(tier === "expert"
      ? { expertFreeUsed: sql`${userBalance.expertFreeUsed} + 1` }
      : { freeUsed: sql`${userBalance.freeUsed} + 1` })
    .where(and(eq(userBalance.userId, userId), sql`${freeCol} < ${freeLimit}`));

  let billing: "free" | "paid";
  let costCents = 0;
  if (affectedRows(freeRes) === 1) {
    billing = "free";
  } else {
    // 2) 该档免费用完，预扣余额（CAS：余额不足则 0 行受影响）
    const payRes = await db
      .update(userBalance)
      .set({ balanceCents: sql`${userBalance.balanceCents} - ${price}` })
      .where(and(eq(userBalance.userId, userId), sql`${userBalance.balanceCents} >= ${price}`));
    if (affectedRows(payRes) !== 1) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "余额不足，请先充值" });
    }
    billing = "paid";
    costCents = price;
  }

  // 3) 调用识别链路（失败按档退还 + 记台账）
  try {
    let result: FishSpotResult | FishSpotExpertResult;
    let usage: K3Usage;
    let steps: number;
    let features: SpotFeatures | null = null;
    let matches: RuleMatch[] = [];

    if (tier === "expert") {
      // Step 1 视觉特征（失败降级为空特征，链路不断）
      const s1 = await extractSpotFeatures(input.imageData, {
        latitude: input.latitude,
        longitude: input.longitude,
        locationText: input.locationText,
      });
      features = s1.features;
      // Step 2 本地规则检索（零 token）
      matches = retrieveRules(buildRuleQuery(input, features, now), 3);
      // Step 3 结论生成（不再送图）
      const s3 = await generateExpertReport(features, matches, expertContext(input, now));
      result = s3.result;
      usage = addUsage(s1.usage, s3.usage);
      steps = 2;
    } else {
      const single = await identifyFishSpot(input.imageData, {
        latitude: input.latitude,
        longitude: input.longitude,
        locationText: input.locationText,
      });
      result = single.result;
      usage = single.usage;
      steps = 1;
    }

    const ruleIds = matches.map((m) => m.rule.id);
    await db.insert(fishSpotCalls).values({
      userId,
      status: "ok",
      billing,
      costCents,
      tier,
      score: result.score,
      waterType: result.waterType.slice(0, 32),
      ruleHit: tier === "expert" ? ruleIds.length > 0 : null,
      ruleIds: ruleIds.join(",").slice(0, 128) || null,
      k3Steps: steps,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    });

    // 样本沉淀仅在显式授权下发生（QY-SPOT-008）
    const sampleSaved = await maybeSaveSample(userId, {
      tier,
      imageData: input.imageData,
      inputs: pickInputs(input),
      features,
      ruleIds,
      report: result,
    });

    const bal = await getBalance(userId);
    return {
      result,
      tier,
      billing,
      costCents,
      balanceCents: bal.balanceCents,
      freeUsed: tier === "expert" ? bal.expertFreeUsed : bal.freeUsed,
      freeLimit: tier === "expert" ? bal.expertFreeLimit : bal.freeLimit,
      ruleHit: ruleIds.length > 0,
      ruleIds,
      k3Steps: steps,
      sampleSaved,
    };
  } catch (err) {
    // 识别失败：按所选档位全额退还（付费退该档金额 / 免费退回该档次数），不让用户为失败买单
    if (billing === "paid") {
      await db
        .update(userBalance)
        .set({ balanceCents: sql`${userBalance.balanceCents} + ${costCents}` })
        .where(eq(userBalance.userId, userId));
    } else {
      await db
        .update(userBalance)
        .set(tier === "expert"
          ? { expertFreeUsed: sql`GREATEST(${userBalance.expertFreeUsed} - 1, 0)` }
          : { freeUsed: sql`GREATEST(${userBalance.freeUsed} - 1, 0)` })
        .where(eq(userBalance.userId, userId));
    }
    await db.insert(fishSpotCalls).values({ userId, status: "error", billing, costCents: 0, tier, k3Steps: tier === "expert" ? 2 : 1 });
    if (err instanceof K3Error && err.code === "no-key") {
      log("warn", "fishspot identify: k3 not configured", { userId, tier });
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "识别服务暂未开通，请稍后再试" });
    }
    log("warn", "fishspot identify failed", { userId, tier, error: String(err) });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "识别失败，请换一张更清晰的照片重试" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// QY-SPOT-008 样本沉淀与授权撤回
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_IMAGE_LIMIT = 1024 * 1024; // 单张样本图上限 1 MB，防爆库防爆盘

async function getSampleConsent(userId: number): Promise<{ granted: boolean; scope: "image" | "features" } | null> {
  const db = getDataSource().read();
  const [row] = await db.select().from(fishSpotSampleConsents).where(eq(fishSpotSampleConsents.userId, userId)).limit(1);
  if (!row || row.revokedAt) return null;
  return { granted: true, scope: row.scope === "features" ? "features" : "image" };
}

/** 授权/撤回（撤回即删除该用户全部样本与落盘图；计费台账不动） */
export async function setSampleConsent(
  userId: number,
  granted: boolean,
  scope: "image" | "features" = "image",
): Promise<{ granted: boolean; scope: string; removedSamples: number }> {
  const db = getDataSource().write();
  if (!granted) {
    const removed = await deleteUserSamples(userId);
    // 撤回时若从无授权记录（异常路径）也要留下 revoked 行；grantedAt 用当前时刻，
    // MySQL TIMESTAMP 不接受 epoch 0（早于 1970-01-01 00:00:01 下界）
    await db
      .insert(fishSpotSampleConsents)
      .values({ userId, scope, grantedAt: new Date(), revokedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { revokedAt: new Date() } });
    return { granted: false, scope, removedSamples: removed };
  }
  await db
    .insert(fishSpotSampleConsents)
    .values({ userId, scope, grantedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { scope, grantedAt: new Date(), revokedAt: null } });
  return { granted: true, scope, removedSamples: 0 };
}

/** 删除用户全部样本（含落盘图文件），返回删除条数 */
async function deleteUserSamples(userId: number): Promise<number> {
  const db = getDataSource().write();
  const rows = await db
    .select({ id: fishSpotSamples.id, imagePath: fishSpotSamples.imagePath })
    .from(fishSpotSamples)
    .where(eq(fishSpotSamples.userId, userId));
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  await db.delete(fishSpotFeedback).where(
    sql`${fishSpotFeedback.sampleId} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
  );
  await db.delete(fishSpotSamples).where(eq(fishSpotSamples.userId, userId));
  for (const r of rows) {
    if (!r.imagePath) continue;
    // 只允许删本服务写在 uploads/spots 下的文件，杜绝路径穿越删到别处
    const rel = r.imagePath.replace(/^\/uploads\//, "");
    if (rel.includes("..") || !rel.startsWith("spots/")) continue;
    const abs = path.resolve(process.cwd(), "uploads", rel);
    try {
      fs.rmSync(abs, { force: true });
    } catch {
      /* 文件删不掉不影响样本行已删除的合规结果 */
    }
  }
  return rows.length;
}

function pickInputs(input: IdentifyInput) {
  return {
    season: input.season,
    waterTemp: input.waterTemp,
    airTemp: input.airTemp,
    weather: input.weather,
    windLevel: input.windLevel,
    hour: input.hour,
    targetFish: input.targetFish,
    waterType: input.waterType,
    clarity: input.clarity,
    locationText: input.locationText,
    latitude: input.latitude,
    longitude: input.longitude,
  };
}

/** dataURL 落盘为样本图；目录独立于构建产物，由 boot.ts 的 /uploads/* 静态路由伺服 */
function saveSampleImage(dataUrl: string, userId: number): string | null {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.byteLength === 0 || buf.byteLength > SAMPLE_IMAGE_LIMIT) return null;
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const dir = path.resolve(process.cwd(), "uploads/spots");
  const fname = `s${userId}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fname), buf);
  return `/uploads/spots/${fname}`;
}

async function maybeSaveSample(
  userId: number,
  args: {
    tier: SpotTier;
    imageData: string;
    inputs: ReturnType<typeof pickInputs>;
    features: SpotFeatures | null;
    ruleIds: string[];
    report: FishSpotResult | FishSpotExpertResult;
  },
): Promise<boolean> {
  const consent = await getSampleConsent(userId);
  if (!consent) return false; // 未授权：图片与正文一律不入样本表
  const imagePath = consent.scope === "image" ? saveSampleImage(args.imageData, userId) : null;
  const db = getDataSource().write();
  await db.insert(fishSpotSamples).values({
    userId,
    tier: args.tier,
    imagePath,
    inputs: args.inputs,
    features: args.features,
    ruleIds: args.ruleIds.join(",").slice(0, 128) || null,
    report: args.report,
  });
  return true;
}

export async function submitFeedback(
  userId: number,
  input: { rating: "useful" | "inaccurate" | "bait_miss"; note?: string; sampleId?: number },
): Promise<{ ok: true }> {
  if (input.rating !== "useful" && input.rating !== "inaccurate" && input.rating !== "bait_miss") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "反馈类型不合法" });
  }
  const db = getDataSource().write();
  const [latest] = await db
    .select({ id: fishSpotCalls.id })
    .from(fishSpotCalls)
    .where(and(eq(fishSpotCalls.userId, userId), eq(fishSpotCalls.status, "ok")))
    .orderBy(sql`${fishSpotCalls.id} desc`)
    .limit(1);
  const note = (input.note ?? "").trim().slice(0, 200);
  await db.insert(fishSpotFeedback).values({
    userId,
    rating: input.rating,
    note: note || null,
    sampleId: input.sampleId ?? null,
    callId: latest?.id ?? null,
  });
  return { ok: true };
}

/** 知识库运行态（命中率/覆盖率的观测口，仅 admin） */
export async function knowledgeStatus() {
  const db = getDataSource().read();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [row] = await db
    .select({
      expertTotal: sql<number>`SUM(CASE WHEN ${fishSpotCalls.tier} = 'expert' AND ${fishSpotCalls.status} = 'ok' THEN 1 ELSE 0 END)`,
      expertHit: sql<number>`SUM(CASE WHEN ${fishSpotCalls.tier} = 'expert' AND ${fishSpotCalls.ruleHit} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(fishSpotCalls)
    .where(gte(fishSpotCalls.createdAt, since));
  return {
    meta: knowledgeMeta(),
    last7d: {
      expertCalls: Number(row?.expertTotal ?? 0),
      ruleHits: Number(row?.expertHit ?? 0),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 充值与人工加余额（v12 语义不变）
// ─────────────────────────────────────────────────────────────────────────────

const RECHARGE_MIN = 100;      // ¥1
const RECHARGE_MAX = 100000;   // ¥1000

export interface RechargeOutput {
  status: "paid" | "pending";
  outTradeNo: string;
  balanceCents: number;
  /** 真实支付拉起参数（待商户号接入；当前恒 null） */
  payUrl: string | null;
}

/** 充值下单：mock 立即到账；否则建 pending 单（真实拉起待商户号） */
export async function recharge(userId: number, amountCents: number): Promise<RechargeOutput> {
  if (!Number.isInteger(amountCents) || amountCents < RECHARGE_MIN || amountCents > RECHARGE_MAX) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "充值金额不合法" });
  }
  const db = getDataSource().write();
  const outTradeNo = `R${Date.now()}${randomUUID().slice(0, 8)}`;
  const provider = env.payMock ? "mock" : "wechat";
  await db.insert(rechargeOrders).values({ userId, amountCents, status: "pending", provider, outTradeNo });

  if (env.payMock) {
    await getDataSource().withTx(async (tx) => {
      await tx
        .update(rechargeOrders)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(rechargeOrders.outTradeNo, outTradeNo));
      await tx
        .insert(userBalance)
        .values({ userId, balanceCents: amountCents, freeUsed: 0 })
        .onDuplicateKeyUpdate({ set: { balanceCents: sql`${userBalance.balanceCents} + ${amountCents}` } });
    });
    const bal = await getBalance(userId);
    return { status: "paid", outTradeNo, balanceCents: bal.balanceCents, payUrl: null };
  }
  // 真实支付：商户号就绪后在此返回拉起参数，到账由 boot.ts Paths.payNotify 回调完成
  const bal = await getBalance(userId);
  return { status: "pending", outTradeNo, balanceCents: bal.balanceCents, payUrl: null };
}

/** 人工加余额（运营/商户号未就绪期间的充值兜底；路由层已限 admin） */
export async function adminCredit(targetUserId: number, amountCents: number): Promise<{ balanceCents: number }> {
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > RECHARGE_MAX) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "金额不合法" });
  }
  const outTradeNo = `M${Date.now()}${randomUUID().slice(0, 8)}`;
  await getDataSource().withTx(async (tx) => {
    await tx.insert(rechargeOrders).values({ userId: targetUserId, amountCents, status: "paid", provider: "manual", outTradeNo, paidAt: new Date() });
    await tx
      .insert(userBalance)
      .values({ userId: targetUserId, balanceCents: amountCents, freeUsed: 0 })
      .onDuplicateKeyUpdate({ set: { balanceCents: sql`${userBalance.balanceCents} + ${amountCents}` } });
  });
  const bal = await getBalance(targetUserId);
  return { balanceCents: bal.balanceCents };
}
