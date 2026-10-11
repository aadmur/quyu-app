/**
 * @layer Application Layer —— FishIdService（识鱼：K3 鱼类识别 + 预付费计费闭环）
 * @file api/services/fishId.ts
 *
 * 计费模型（与 fishSpot.ts 同构，但定价与免费额度独立）：
 * - 前 FISH_ID_FREE_LIMIT 次免费，用完按 FISH_ID_PRICE_CENTS/次扣余额。
 * - 余额与钓点识别共用 userBalance.balanceCents；免费次数 fishIdFreeUsed 独立记账，互不挪用。
 * - 扣费原子化：先 CAS 预扣（余额不足直接拒），识别失败全额退还。
 * - 台账 fish_id_calls 只存元数据（Top-1 鱼名/置信度/token/费用），不存图片/正文（合规最小化）。
 *
 * 与 fishSpot.ts 的关系：
 * - 共用 userBalance 表（同一用户同一余额），但 ensureBalanceRow 各自调用（幂等）。
 * - 计费/退还/台账逻辑同构，但表和列独立（fishIdCalls / fishIdFreeUsed）。
 * - C5 将扩展样本沉淀（fish_id_samples）与纠正反馈，授权体系复用 fishSpot 的 consent 模式。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { fishIdCalls, fishIdSamples, fishSpotSampleConsents, userBalance } from "@db/schema";
import { getDataSource, log } from "../infra";
import { env } from "../lib/env";
import { identifyFish, K3Error, type FishIdResult, type K3Usage } from "../kimi/fishId";

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

/** 确保余额行存在（首用建 0 余额行），后续 CAS 才有可更新的行 */
async function ensureBalanceRow(userId: number): Promise<void> {
  const db = getDataSource().write();
  await db
    .insert(userBalance)
    .values({ userId, balanceCents: 0, freeUsed: 0, expertFreeUsed: 0, fishIdFreeUsed: 0 })
    .onDuplicateKeyUpdate({ set: { userId } }); // 已存在则不动
}

// ─────────────────────────────────────────────────────────────────────────────
// QY-FISH-006 样本沉淀与授权撤回（复用 fish_spot_sample_consents 授权体系）
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_IMAGE_LIMIT = 1024 * 1024; // 单张样本图上限 1 MB

async function getSampleConsent(userId: number): Promise<{ granted: boolean; scope: string } | null> {
  const db = getDataSource().read();
  const [row] = await db.select().from(fishSpotSampleConsents).where(eq(fishSpotSampleConsents.userId, userId)).limit(1);
  if (!row || row.revokedAt) return null;
  return { granted: true, scope: row.scope };
}

function saveSampleImage(dataUrl: string, userId: number): string | null {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.byteLength === 0 || buf.byteLength > SAMPLE_IMAGE_LIMIT) return null;
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  const dir = path.resolve(process.cwd(), "uploads/spots");
  const fname = `f${userId}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fname), buf);
  return `/uploads/spots/${fname}`;
}

async function maybeSaveSample(
  userId: number,
  args: { imageData: string; callId: number | null; result: FishIdResult },
): Promise<boolean> {
  const consent = await getSampleConsent(userId);
  if (!consent) return false; // 未授权：图片与结果一律不入样本表
  const imagePath = consent.scope === "image" ? saveSampleImage(args.imageData, userId) : null;
  const db = getDataSource().write();
  await db.insert(fishIdSamples).values({
    userId,
    callId: args.callId,
    imagePath,
    result: args.result,
    topFishName: args.result.topCandidates[0]?.name ?? null,
  });
  return true;
}

/** 纠正反馈：用户指定"识错了，实际是 X"（高价值标注） */
export async function correctFish(
  userId: number,
  input: { correctedFish: string },
): Promise<{ ok: true }> {
  const db = getDataSource().write();
  const [latest] = await db
    .select({ id: fishIdSamples.id })
    .from(fishIdSamples)
    .where(eq(fishIdSamples.userId, userId))
    .orderBy(sql`${fishIdSamples.id} desc`)
    .limit(1);
  if (latest) {
    await db
      .update(fishIdSamples)
      .set({ correctedFish: input.correctedFish.slice(0, 32) })
      .where(eq(fishIdSamples.id, latest.id));
  }
  return { ok: true };
}

export interface FishIdBalanceInfo {
  balanceCents: number;
  fishIdFreeUsed: number;
  fishIdFreeLimit: number;
  fishIdPriceCents: number;
  /** 样本授权状态（前端勾选框回填用，复用 fish_spot_sample_consents） */
  sampleConsent: { granted: boolean; scope: string } | null;
}

export async function getFishIdBalance(userId: number): Promise<FishIdBalanceInfo> {
  await ensureBalanceRow(userId);
  const db = getDataSource().read();
  const [row] = await db.select().from(userBalance).where(eq(userBalance.userId, userId)).limit(1);
  return {
    balanceCents: row?.balanceCents ?? 0,
    fishIdFreeUsed: row?.fishIdFreeUsed ?? 0,
    fishIdFreeLimit: env.fishIdFreeLimit,
    fishIdPriceCents: env.fishIdPriceCents,
    sampleConsent: await getSampleConsent(userId),
  };
}

export interface FishIdInput {
  imageData: string;
}

export interface FishIdOutput {
  result: FishIdResult;
  billing: "free" | "paid";
  costCents: number;
  balanceCents: number;
  freeUsed: number;
  freeLimit: number;
  /** 样本是否已沉淀（授权用户才为 true） */
  sampleSaved: boolean;
}

/**
 * 识鱼：先占位（免费次数或预扣余额）→ 调 K3 → 失败退还 → 成功写台账
 */
export async function identifyFishCall(userId: number, input: FishIdInput): Promise<FishIdOutput> {
  if (!input.imageData.startsWith("data:image/")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片格式不正确" });
  }

  const db = getDataSource().write();
  await ensureBalanceRow(userId);

  const price = env.fishIdPriceCents;
  const freeLimit = env.fishIdFreeLimit;

  // 1) 先尝试占用免费次数（原子 CAS）
  const freeRes = await db
    .update(userBalance)
    .set({ fishIdFreeUsed: sql`${userBalance.fishIdFreeUsed} + 1` })
    .where(and(eq(userBalance.userId, userId), sql`${userBalance.fishIdFreeUsed} < ${freeLimit}`));

  let billing: "free" | "paid";
  let costCents = 0;
  if (affectedRows(freeRes) === 1) {
    billing = "free";
  } else {
    // 2) 免费用完，预扣余额（CAS：余额不足则 0 行受影响）
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

  // 3) 调用识别链路（失败全额退还 + 记台账）
  try {
    const { result, usage }: { result: FishIdResult; usage: K3Usage } = await identifyFish(input.imageData);

    await db.insert(fishIdCalls).values({
      userId,
      status: "ok",
      billing,
      costCents,
      topFishName: result.topCandidates[0]?.name?.slice(0, 32) ?? null,
      topConfidence: result.topCandidates[0]?.confidence ?? null,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    });

    // 样本沉淀仅在显式授权下发生（QY-FISH-006）
    const sampleSaved = await maybeSaveSample(userId, {
      imageData: input.imageData,
      callId: null,
      result,
    });

    const bal = await getFishIdBalance(userId);
    return {
      result,
      billing,
      costCents,
      balanceCents: bal.balanceCents,
      freeUsed: bal.fishIdFreeUsed,
      freeLimit: bal.fishIdFreeLimit,
      sampleSaved,
    };
  } catch (err) {
    // 识别失败：全额退还（付费退余额 / 免费退回次数）
    if (billing === "paid") {
      await db
        .update(userBalance)
        .set({ balanceCents: sql`${userBalance.balanceCents} + ${costCents}` })
        .where(eq(userBalance.userId, userId));
    } else {
      await db
        .update(userBalance)
        .set({ fishIdFreeUsed: sql`GREATEST(${userBalance.fishIdFreeUsed} - 1, 0)` })
        .where(eq(userBalance.userId, userId));
    }
    await db.insert(fishIdCalls).values({ userId, status: "error", billing, costCents: 0 });
    if (err instanceof K3Error && err.code === "no-key") {
      log("warn", "fishid identify: k3 not configured", { userId });
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "识别服务暂未开通，请稍后再试" });
    }
    log("warn", "fishid identify failed", { userId, error: String(err) });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "识别失败，请换一张更清晰的照片重试" });
  }
}
