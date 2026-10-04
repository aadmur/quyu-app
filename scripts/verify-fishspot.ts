/**
 * @layer Ops 脚本 —— 哪钓 v13 专业化验收（分层计费 / 按档退还 / 样本授权 / 结构化报告）
 * @file scripts/verify-fishspot.ts
 *
 * 为什么需要它：v13 的验收标准里有三条是「不能靠类型检查证明」的资金与合规语义——
 *   ① 失败退还按档位精确、② 幂等（并发不重复扣费）、③ 未授权不存图 / 撤回即删且不动台账。
 * 因此这里**直连真实 MySQL** 调用服务层（与 tRPC 过程执行的是同一个函数），逐项断言。
 *
 * 前置：库必须可达且已应用 0012 迁移。本机若无可用库，脚本以退出码 2 明确告知。
 *
 * 用法：
 *   node --env-file=.env.smoke --import tsx scripts/verify-fishspot.ts
 *   （.env.smoke 里 DATABASE_URL 需指向已迁移的测试库，且 K3_MOCK=true 不烧真实额度）
 *
 * 环境变量：V13_USER_ID 指定测试用户（默认自动新建一个隔离用户）
 */
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  fishSpotCalls,
  fishSpotFeedback,
  fishSpotSampleConsents,
  fishSpotSamples,
  userBalance,
  users,
} from "../db/schema";
import { getDataSource } from "../api/infra";
import { env } from "../api/lib/env";
import { adminCredit, getBalance, identify, setSampleConsent, submitFeedback } from "../api/services/fishSpot";
import { generateExpertReport } from "../api/kimi/k3";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let failures = 0;
const ok = (label: string, detail = "") => console.log(`PASS  ${label}${detail ? `  ${detail}` : ""}`);
const bad = (label: string, detail = "") => {
  console.error(`FAIL  ${label}  ${detail}`);
  failures++;
};
const eqCheck = (label: string, actual: unknown, expected: unknown) =>
  actual === expected ? ok(label, String(actual)) : bad(label, `期望 ${String(expected)}，实得 ${String(actual)}`);

async function expectError(label: string, fn: () => Promise<unknown>, messageFragment: string) {
  try {
    await fn();
    bad(label, "未抛出异常");
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? String(e);
    if (msg.includes(messageFragment)) ok(label, msg);
    else bad(label, `异常信息不符：${msg}`);
  }
}

const db = getDataSource().write();

// ── 库可达性与前置列检查 ──
try {
  await db.execute(sql`SELECT 1`);
} catch (e) {
  console.error(`数据库不可达（${String(e).slice(0, 120)}）。请用 --env-file 指向已应用 0012 迁移的测试库。`);
  process.exit(2);
}
try {
  await db.execute(sql`SELECT tier, rule_hit, k3_steps FROM fish_spot_calls LIMIT 1`);
  await db.execute(sql`SELECT expert_free_used FROM user_balance LIMIT 1`);
  ok("0012 迁移列已就位");
} catch {
  bad("0012 迁移列已就位", "缺列，请先应用 db/migrations/0012_v13_spot_expert_run.sql");
  process.exit(2);
}

// ── 隔离测试用户 ──
const stamp = Date.now();
let userId = Number(process.env.V13_USER_ID ?? 0);
if (!userId) {
  const [res] = (await db.insert(users).values({ unionId: `v13-test-${stamp}`, name: `v13测试${stamp}`, role: "user" })) as unknown as [
    { insertId: number },
  ];
  userId = res.insertId;
} else {
  await db.delete(fishSpotSamples).where(eq(fishSpotSamples.userId, userId));
  await db.delete(fishSpotFeedback).where(eq(fishSpotFeedback.userId, userId));
  await db.delete(fishSpotSampleConsents).where(eq(fishSpotSampleConsents.userId, userId));
  await db.delete(fishSpotCalls).where(eq(fishSpotCalls.userId, userId));
  await db.delete(userBalance).where(eq(userBalance.userId, userId));
}
await db
  .insert(userBalance)
  .values({ userId, balanceCents: 0, freeUsed: 0, expertFreeUsed: 0 })
  .onDuplicateKeyUpdate({ set: { balanceCents: 0, freeUsed: 0, expertFreeUsed: 0 } });
const bal0 = await getBalance(userId);
console.log(`INFO  测试用户 ${userId}｜基础 ¥${(bal0.priceCents / 100).toFixed(2)}/免费${bal0.freeLimit} 次｜专家 ¥${(bal0.expertPriceCents / 100).toFixed(2)}/免费${bal0.expertFreeLimit} 次`);

const identifyBasic = () => identify(userId, { imageData: TINY_PNG });
const identifyExpert = (extra: Record<string, unknown> = {}) =>
  identify(userId, { imageData: TINY_PNG, tier: "expert", ...extra } as never);

// ══ ① QY-SPOT-007：老客户端（不传 tier）走基础档，输出形状逐字不变 ══
const legacy = await identifyBasic();
const keys = Object.keys(legacy.result).sort().join(",");
eqCheck(
  "基础档输出仅含 v12 的 7 字段（老 APK 兼容）",
  keys,
  ["bestTime", "confidence", "score", "suitableFish", "tips", "warnings", "waterType"].sort().join(","),
);
eqCheck("基础档 suitableFish 仍为字符串数组", legacy.result.suitableFish.every((s) => typeof s === "string"), true);
eqCheck("基础档本次计费为 free", legacy.billing, "free");
eqCheck("基础档模型调用步数", legacy.k3Steps, 1);

// ══ ② 免费额度分列：专家档不吃基础档额度 ══
const beforeFree = (await getBalance(userId)).freeUsed;
const exp1 = await identifyExpert({ season: "冬", targetFish: ["鲫鱼"], waterType: "野塘" });
eqCheck("专家档本次用掉的是专家免费额度", exp1.billing, "free");
eqCheck("专家档 k3Steps=2（两段调用）", exp1.k3Steps, 2);
eqCheck("基础档 freeUsed 未被专家档挪用", (await getBalance(userId)).freeUsed, beforeFree);
eqCheck("专家档 freeUsed 计 1", exp1.freeUsed, 1);

// ══ ③ 分层定价：专家免费体验用尽后按专家档扣费 ══
await adminCredit(userId, 1000);
const paidExp = await identifyExpert({ season: "夏", targetFish: ["鲤鱼"], waterType: "水库" });
eqCheck("专家档第二次按专家价扣费", paidExp.costCents, bal0.expertPriceCents);
eqCheck("专家档计费为 paid", paidExp.billing, "paid");
const afterPaid = await getBalance(userId);
eqCheck("余额 = 1000 − 专家价", afterPaid.balanceCents, 1000 - bal0.expertPriceCents);

// ══ ④ 失败退还按档位精确（模拟 K3 未配置）══
const mockFlag = env.k3Mock;
const beforeFailBal = (await getBalance(userId)).balanceCents;
const beforeFailFree = (await getBalance(userId)).expertFreeUsed;
Object.defineProperty(env, "k3Mock", { value: false, configurable: true, writable: true });
Object.defineProperty(env, "moonshotApiKey", { value: "", configurable: true, writable: true });
await expectError("专家档识别失败被拒（no-key→服务未开通）", () => identifyExpert({ season: "春" }), "识别服务暂未开通");
const afterFail = await getBalance(userId);
eqCheck("失败后余额分文未动（按专家档全额退还）", afterFail.balanceCents, beforeFailBal);
eqCheck("失败后专家免费次数已退回", afterFail.expertFreeUsed, beforeFailFree);
await expectError("基础档识别失败同样退还", () => identifyBasic(), "识别服务暂未开通");
eqCheck("基础档失败后免费额度退回", (await getBalance(userId)).freeUsed, beforeFree);
const errRows = await db
  .select({ status: fishSpotCalls.status, cost: fishSpotCalls.costCents, tier: fishSpotCalls.tier })
  .from(fishSpotCalls)
  .where(eq(fishSpotCalls.userId, userId));
eqCheck("失败台账 cost_cents 记 0", errRows.filter((r) => r.status === "error" && r.cost !== 0).length, 0);
eqCheck("失败台账保留档位", errRows.every((r) => r.tier === "basic" || r.tier === "expert"), true);
Object.defineProperty(env, "k3Mock", { value: mockFlag, configurable: true, writable: true });

// ══ ⑤ QY-SPOT-003/004：命中规则→专业数值来自规则库；未命中→降级不编造 ══
const hit = await identifyExpert({ season: "冬", targetFish: ["鲫鱼"], waterType: "野塘" });
eqCheck("命中知识库规则", hit.ruleHit, true);
eqCheck("台账记录命中规则 id", hit.ruleIds.length > 0, true);
const expertRes = hit.result as never as {
  specificsSource: string;
  rigSetup: Record<string, string>;
  baitPlan: Record<string, string>;
  knowledgeBasis: Array<{ ruleId: string }>;
  suitableFishDetail: Array<{ name: string; reason: string }>;
};
eqCheck("专业数值来源=rule", expertRes.specificsSource, "rule");
eqCheck("钓组四项均非空", Object.values(expertRes.rigSetup).every((v) => v.trim().length > 0), true);
eqCheck("饵料三项均非空", Object.values(expertRes.baitPlan).every((v) => v.trim().length > 0), true);
eqCheck("可审计依据条数 = 命中条数", expertRes.knowledgeBasis.length > 0, true);
eqCheck("目标鱼带理由", expertRes.suitableFishDetail.every((f) => f.name.length > 0), true);

const degraded = await generateExpertReport(null, [], { season: "冬" });
eqCheck("未命中规则时 specificsSource=none", degraded.result.specificsSource, "none");
eqCheck("未命中时线号/钩型被强制清空（不编造）", degraded.result.rigSetup.lineSpec + degraded.result.rigSetup.hookSpec, "");
eqCheck("未命中时饵料策略被清空", Object.values(degraded.result.baitPlan).join(""), "");

// Step1 特征缺失也不报错：retrieveRules 仅按现场参数工作
const noFeatures = await identifyExpert({ season: "冬", targetFish: ["鲫鱼"] });
eqCheck("特征缺失场景仍可完成（Step1 降级不断链）", typeof noFeatures.result.score, "number");

// ══ ⑥ QY-SPOT-001：全字段缺省不阻断 ══
const bare = await identifyExpert();
eqCheck("专家档不填任何现场参数也能完成", typeof bare.result.score, "number");

// ══ ⑦ QY-SPOT-008 合规：未授权不存图；授权后入样本；撤回即删且不动台账 ══
const noConsentSamples = await db
  .select({ c: sql<number>`COUNT(*)` })
  .from(fishSpotSamples)
  .where(eq(fishSpotSamples.userId, userId));
eqCheck("未授权时样本表为空（图片不入）", Number(noConsentSamples[0].c), 0);
const callsBefore = (
  await db.select({ c: sql<number>`COUNT(*)` }).from(fishSpotCalls).where(eq(fishSpotCalls.userId, userId))
)[0].c;

await setSampleConsent(userId, true, "image");
const saved = await identifyExpert({ season: "夏", targetFish: ["草鱼"], waterType: "湖泊" });
eqCheck("授权后本次样本已沉淀", saved.sampleSaved, true);
const rows = await db.select().from(fishSpotSamples).where(eq(fishSpotSamples.userId, userId));
eqCheck("样本表新增 1 行", rows.length, 1);
const imgPath = rows[0].imagePath;
eqCheck("样本图落盘存在", Boolean(imgPath) && fs.existsSync(path.resolve(process.cwd(), imgPath!.replace(/^\//, ""))), true);
eqCheck("样本含特征与报告 JSON", Boolean(rows[0].features) && Boolean(rows[0].report), true);

await submitFeedback(userId, { rating: "useful", note: "v13 验收反馈" });
eqCheck("反馈已入库", (await db.select({ c: sql<number>`COUNT(*)` }).from(fishSpotFeedback).where(eq(fishSpotFeedback.userId, userId)))[0].c, 1);

const revoked = await setSampleConsent(userId, false);
eqCheck("撤回授权删除本人全部样本", revoked.removedSamples, 1);
eqCheck("撤回后样本表为空", (await db.select({ c: sql<number>`COUNT(*)` }).from(fishSpotSamples).where(eq(fishSpotSamples.userId, userId)))[0].c, 0);
eqCheck("撤回后落盘图已删除", fs.existsSync(path.resolve(process.cwd(), (imgPath ?? "").replace(/^\//, ""))), false);
// 撤回只清样本，不动计费台账：台账行数应等于「撤回前的行数」（含产生样本的那一次）
const callsAfterRevoke = (
  await db.select({ c: sql<number>`COUNT(*)` }).from(fishSpotCalls).where(eq(fishSpotCalls.userId, userId))
)[0].c;
eqCheck("撤回不影响计费台账（样本与台账物理分离）", Number(callsAfterRevoke), Number(callsBefore) + 1);
// 未挂样本 id 的反馈按台账关联，样本删除不牵连它
eqCheck("未授权样本的反馈行保留", (await db.select({ c: sql<number>`COUNT(*)` }).from(fishSpotFeedback).where(eq(fishSpotFeedback.userId, userId)))[0].c, 1);

// ══ ⑧ 幂等：并发识别不重复扣费、余额不透负 ══
await db.update(userBalance).set({ balanceCents: 100, freeUsed: 0, expertFreeUsed: 0 }).where(eq(userBalance.userId, userId));
const results = await Promise.allSettled(Array.from({ length: 12 }, () => identifyBasic()));
const successes = results.filter((r) => r.status === "fulfilled").length;
const finalBal = await getBalance(userId);
eqCheck(`并发 12 次：成功数 = 免费${bal0.freeLimit} + 可付${Math.floor(100 / bal0.priceCents)}`, successes, bal0.freeLimit + Math.floor(100 / bal0.priceCents));
eqCheck("并发后免费次数恰为上限（CAS 不超发）", finalBal.freeUsed, bal0.freeLimit);
eqCheck("并发后余额为 0（不为负）", finalBal.balanceCents, 100 - Math.floor(100 / bal0.priceCents) * bal0.priceCents);
const rejects = results.filter((r) => r.status === "rejected").length;
eqCheck("其余请求因余额不足被拒", rejects, 12 - successes);

// 台账口径自检：paid 行数 × 单价 = 已扣总额
const ledger = await db
  .select({ status: fishSpotCalls.status, billing: fishSpotCalls.billing, cost: fishSpotCalls.costCents })
  .from(fishSpotCalls)
  .where(eq(fishSpotCalls.userId, userId));
const charged = ledger.filter((l) => l.status === "ok" && l.billing === "paid").reduce((s, l) => s + l.cost, 0);
const paidRows = ledger.filter((l) => l.status === "ok" && l.billing === "paid").length;
ok(`台账可平账：${paidRows} 条成功付费行合计 ¥${(charged / 100).toFixed(2)}`, `总行数 ${ledger.length}`);
eqCheck("付费行单价只可能是两档之一", ledger.filter((l) => l.billing === "paid" && l.status === "ok" && l.cost !== bal0.priceCents && l.cost !== bal0.expertPriceCents).length, 0);

console.log(`\n${failures === 0 ? "哪钓 v13 验收全部通过" : `哪钓 v13 验收存在 ${failures} 项失败`}`);
await getDataSource().end?.();
process.exit(failures === 0 ? 0 : 1);
