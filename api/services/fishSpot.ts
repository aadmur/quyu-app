/**
 * @layer Application Layer —— FishSpotService（哪钓：K3 钓点识别 + 预付费计费闭环）
 * @file api/services/fishSpot.ts
 *
 * 数据主权：user_balance / recharge_orders / fish_spot_calls 三表唯一写方。
 *
 * 计费模型（分支⑤：用户付费 → 预付费余额/积分）：
 * - 前 FISH_SPOT_FREE_LIMIT 次免费（钩子，分支⑥），用完按 FISH_SPOT_PRICE_CENTS/次扣余额。
 * - 扣费原子化：先 CAS 预扣（余额不足直接拒），识别失败自动退还/退回免费次数，杜绝「失败也收钱」。
 * - 台账 fish_spot_calls 只记元数据（评分/水型/token/费用），不存卡片正文与图片（合规最小化）。
 *
 * 充值（分支⑤）：
 * - env.payMock=true：立即到账（仅开发/演示；生产必须 false，否则成自助印钞）。
 * - 商户号未就绪期间：运营用 adminCredit 人工加余额；真实微信/支付宝回调接 boot.ts Paths.payNotify。
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { fishSpotCalls, rechargeOrders, userBalance } from "@db/schema";
import { getDataSource, log } from "../infra";
import { env } from "../lib/env";
import { identifyFishSpot, K3Error, type FishSpotResult } from "../kimi/k3";

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

/** 确保余额行存在（首用建 0 余额行），后续 CAS 才有可更新的行 */
async function ensureBalanceRow(userId: number): Promise<void> {
  const db = getDataSource().write();
  await db
    .insert(userBalance)
    .values({ userId, balanceCents: 0, freeUsed: 0 })
    .onDuplicateKeyUpdate({ set: { userId } }); // 已存在则不动
}

export interface BalanceInfo {
  balanceCents: number;
  freeUsed: number;
  freeLimit: number;
  priceCents: number;
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
  };
}

export interface IdentifyInput {
  /** 客户端压缩后的 data:image/...;base64 图（随请求上送，不落盘） */
  imageData: string;
  latitude?: number;
  longitude?: number;
  locationText?: string;
}

export interface IdentifyOutput {
  result: FishSpotResult;
  billing: "free" | "paid";
  costCents: number;
  balanceCents: number;
  freeUsed: number;
  freeLimit: number;
}

/** 识别钓点：先占位（免费次数或预扣余额）→ 调 K3 → 失败退还 → 成功写台账 */
export async function identify(userId: number, input: IdentifyInput): Promise<IdentifyOutput> {
  if (!input.imageData.startsWith("data:image/")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片格式不正确" });
  }
  const db = getDataSource().write();
  await ensureBalanceRow(userId);

  // 1) 先尝试占用免费次数（原子 CAS）
  const freeRes = await db
    .update(userBalance)
    .set({ freeUsed: sql`${userBalance.freeUsed} + 1` })
    .where(and(eq(userBalance.userId, userId), sql`${userBalance.freeUsed} < ${env.fishSpotFreeLimit}`));

  let billing: "free" | "paid";
  let costCents = 0;
  if (affectedRows(freeRes) === 1) {
    billing = "free";
  } else {
    // 2) 免费用完，预扣余额（CAS：余额不足则 0 行受影响）
    const price = env.fishSpotPriceCents;
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

  // 3) 调用 K3（失败退还 + 记台账）
  try {
    const { result, usage } = await identifyFishSpot(input.imageData, {
      latitude: input.latitude,
      longitude: input.longitude,
      locationText: input.locationText,
    });
    await db.insert(fishSpotCalls).values({
      userId,
      status: "ok",
      billing,
      costCents,
      score: result.score,
      waterType: result.waterType,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    });
    const bal = await getBalance(userId);
    return {
      result,
      billing,
      costCents,
      balanceCents: bal.balanceCents,
      freeUsed: bal.freeUsed,
      freeLimit: bal.freeLimit,
    };
  } catch (err) {
    // 识别失败：全额退还（付费退余额 / 免费退回次数），不让用户为失败买单
    if (billing === "paid") {
      await db
        .update(userBalance)
        .set({ balanceCents: sql`${userBalance.balanceCents} + ${costCents}` })
        .where(eq(userBalance.userId, userId));
    } else {
      await db
        .update(userBalance)
        .set({ freeUsed: sql`GREATEST(${userBalance.freeUsed} - 1, 0)` })
        .where(eq(userBalance.userId, userId));
    }
    await db.insert(fishSpotCalls).values({ userId, status: "error", billing, costCents: 0 });
    if (err instanceof K3Error && err.code === "no-key") {
      log("warn", "fishspot identify: k3 not configured", { userId });
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "识别服务暂未开通，请稍后再试" });
    }
    log("warn", "fishspot identify failed", { userId, error: String(err) });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "识别失败，请换一张更清晰的照片重试" });
  }
}

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
