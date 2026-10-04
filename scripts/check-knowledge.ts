/**
 * 垂类知识库门禁（QY-SPOT-003 / 011）
 *
 * 实测而非声明四项指标：
 * 1. 规则结构完整性（必填建议字段不得为空）
 * 2. 覆盖率：主流鱼种 × 主流水域 × 四季 ≥ 80%
 * 3. 命中率：典型现场组合（含缺参、含观察缺失）≥ 70%
 * 4. 未命中必须**降级**（0 条规则），链路不得凭空给具体数值
 * 5. mtime 热更：外部文件生效 + 坏文件保留旧表
 *
 * 用法：node --import tsx scripts/check-knowledge.ts（已接入 build 前置门禁）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAIN_FISH,
  MAIN_WATER_TYPES,
  seasonFromMonth,
  type FishingRule,
  type Season,
} from "../api/knowledge/fishingRules";
import { hasRuleFor, knowledgeMeta, refreshRules, retrieveRules, getRules } from "../api/knowledge";

let failures = 0;
const pass = (label: string, detail = "") => console.log(`PASS  ${label}${detail ? `  ${detail}` : ""}`);
const fail = (label: string, detail = "") => {
  console.error(`FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  failures++;
};

// ── 1. 结构完整性 ────────────────────────────────────────────────────────────
const ADVICE_KEYS = ["method", "lineSpec", "hookSpec", "floatSetup", "sinkerSpec", "bait", "nest", "strategy"] as const;
const rules = getRules();
const badShape = rules.filter((r) => {
  if (!r.id || !r.fish || !r.seasons?.length || !r.waterTypes?.length) return true;
  return ADVICE_KEYS.some((k) => !r.advice?.[k]?.trim());
});
if (rules.length >= 30) pass(`规则条数 ≥ 30`, `${rules.length} 条`);
else fail(`规则条数 ≥ 30`, `仅 ${rules.length} 条`);
if (badShape.length === 0) pass("每条规则 8 项建议字段齐全非空");
else fail("每条规则 8 项建议字段齐全非空", `${badShape.map((r) => r.id).join(",")} 缺字段`);

const dupIds = rules.length - new Set(rules.map((r) => r.id)).size;
if (dupIds === 0) pass("规则 id 唯一");
else fail("规则 id 唯一", `重复 ${dupIds} 个`);

// ── 2. 覆盖率 ────────────────────────────────────────────────────────────────
const seasons: Season[] = ["春", "夏", "秋", "冬"];
const combos: Array<{ fish: string; water: string; season: Season }> = [];
for (const fish of MAIN_FISH) for (const water of MAIN_WATER_TYPES) for (const season of seasons) combos.push({ fish, water, season });
const covered = combos.filter((c) => hasRuleFor(c.fish, c.season, c.water));
const coverage = covered.length / combos.length;
if (coverage >= 0.8) pass(`主流组合覆盖率 ≥ 80%`, `${(coverage * 100).toFixed(1)}% (${covered.length}/${combos.length})`);
else fail(`主流组合覆盖率 ≥ 80%`, `仅 ${(coverage * 100).toFixed(1)}%，缺：${combos.filter((c) => !covered.includes(c)).slice(0, 6).map((c) => `${c.fish}-${c.water}-${c.season}`).join(" / ")}`);

// 每个水型单独看（避免"集中在少数组合"却达标）
for (const water of MAIN_WATER_TYPES) {
  const sub = combos.filter((c) => c.water === water);
  const hit = sub.filter((c) => hasRuleFor(c.fish, c.season, c.water));
  const rate = hit.length / sub.length;
  if (rate >= 0.8) pass(`水型「${water}」覆盖率 ≥ 80%`, `${(rate * 100).toFixed(0)}%`);
  else fail(`水型「${water}」覆盖率 ≥ 80%`, `仅 ${(rate * 100).toFixed(0)}%`);
}

// ── 3. 命中率（典型现场组合，含缺参场景） ──────────────────────────────────
interface Scenario {
  name: string;
  q: Parameters<typeof retrieveRules>[0];
  expectHit: boolean;
}
const scenarios: Scenario[] = [
  { name: "野塘冬钓鲫鱼（验收用例）", q: { waterType: "野塘", season: "冬", targetFish: ["鲫鱼"], clarity: "清澈" }, expectHit: true },
  { name: "湖泊夏·水草区", q: { waterType: "湖泊", season: "夏", structures: ["水草区", "深浅交界"], clarity: "中等", waterTempC: 27 }, expectHit: true },
  { name: "河流缓流·目标鲤", q: { waterType: "河流", season: "春", flow: "缓流", targetFish: ["鲤鱼"] }, expectHit: true },
  { name: "水库春秋不限鱼种", q: { waterType: "水库", season: "秋" }, expectHit: true },
  { name: "沟渠浑浊·黄辣丁别名", q: { waterType: "沟渠", season: "夏", clarity: "浑浊", targetFish: ["黄辣丁"] }, expectHit: true },
  { name: "肥水塘鲢鳙（别名花鲢）", q: { waterType: "野塘", season: "夏", clarity: "肥水", targetFish: ["花鲢"] }, expectHit: true },
  { name: "仅水型（季节未填）", q: { waterType: "湖泊" }, expectHit: true },
  { name: "仅季节+水温", q: { season: "冬", waterTempC: 5 }, expectHit: true },
  { name: "水型缺失但季节与鱼种在", q: { season: "冬", targetFish: ["鲫鱼"], waterTempC: 5 }, expectHit: true },
  { name: "完全无参数（应降级，不得凭空给数值）", q: {}, expectHit: false },
  { name: "进出水口结构", q: { waterType: "水库", season: "夏", structures: ["进出水口"] }, expectHit: true },
  { name: "乱石夜钓鳜鱼", q: { waterType: "河流", season: "秋", structures: ["乱石"], flow: "急流", targetFish: ["桂鱼"] }, expectHit: true },
  { name: "刮风天开阔水面", q: { waterType: "湖泊", season: "春", structures: ["开阔水面"] }, expectHit: true },
  { name: "罗非别名非洲鲫", q: { waterType: "野塘", season: "夏", targetFish: ["非洲鲫"] }, expectHit: true },
  { name: "深海平台（未收录水型→应降级）", q: { waterType: "近海钓排", season: "夏", targetFish: ["海鲈"] }, expectHit: false },
  { name: "冰钓（超出规则表→应降级）", q: { waterType: "冰面", season: "冬", targetFish: ["虹鳟"] }, expectHit: false },
  { name: "未知鱼种+未知水型→应降级", q: { waterType: "地下暗河", season: "秋", targetFish: ["鲟鱼"] }, expectHit: false },
];
const hitResults = scenarios.map((s) => {
  const got = retrieveRules(s.q, 3);
  return { s, hit: got.length > 0, matches: got };
});
const hitRate = hitResults.filter((r) => r.s.expectHit && r.hit).length / hitResults.filter((r) => r.s.expectHit).length;
if (hitRate >= 0.7) pass(`规则命中率 ≥ 70%`, `${(hitRate * 100).toFixed(1)}%`);
else fail(`规则命中率 ≥ 70%`, `仅 ${(hitRate * 100).toFixed(1)}%`);
const wrongDegradation = hitResults.filter((r) => r.hit !== r.s.expectHit);
if (wrongDegradation.length === 0) pass("该命中的命中、不该命中的降级（全部场景符合预期）");
else fail("场景命中与预期不符", wrongDegradation.map((r) => `${r.s.name}→${r.hit ? "命中" : "未命中"}`).join(" / "));

// Top-N 数量与去重（同鱼种封顶）
const multi = retrieveRules({ waterType: "湖泊", season: "夏", structures: ["水草区"] }, 3);
if (multi.length <= 3) pass("Top-N 不超上限", `返回 ${multi.length} 条`);
else fail("Top-N 不超上限", `返回 ${multi.length} 条`);
const fishCounts = multi.reduce<Record<string, number>>((acc, m) => {
  acc[m.rule.fish] = (acc[m.rule.fish] ?? 0) + 1;
  return acc;
}, {});
if (Object.values(fishCounts).every((n) => n <= 2)) pass("Top-N 鱼种多样化（单鱼种 ≤ 2 条）", JSON.stringify(fishCounts));
else fail("Top-N 鱼种多样化（单鱼种 ≤ 2 条）", JSON.stringify(fishCounts));

// 验收用例逐字核对：野塘+冬+鲫 → 必须带钓组与饵料
const acceptance = retrieveRules({ waterType: "野塘", season: "冬", targetFish: ["鲫鱼"] }, 3);
const first = acceptance[0]?.rule;
if (first && first.advice.lineSpec && first.advice.bait) {
  pass("验收用例：野塘×冬×鲫鱼 返回含钓组与饵料的规则", `${first.id}｜线号=${first.advice.lineSpec}`);
} else {
  fail("验收用例：野塘×冬×鲫鱼 返回含钓组与饵料的规则", first ? `${first.id} 建议字段不全` : "未命中任何规则");
}

// ── 4. mtime 热更 ────────────────────────────────────────────────────────────
const tmp = path.join(os.tmpdir(), `qy-knowledge-check-${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
const goodFile = path.join(tmp, "rules.json");
const builtinCount = rules.length;
const override: FishingRule[] = [
  {
    id: "R-TEST-1", fish: "鲫鱼", seasons: ["冬"], waterTypes: ["野塘"],
    advice: {
      method: "测试钓法", lineSpec: "测试线号", hookSpec: "测试钩型", floatSetup: "测试调漂",
      sinkerSpec: "测试铅坠", bait: "测试饵", nest: "测试窝", strategy: "测试策略",
    },
    reviewStatus: "approved", source: "门禁自测",
  },
];
// mtime 精度是 Windows 上的真实风险：用 utimes 强制每次写入都有可区分的 mtime，
// 否则「未变化则跳过重读」的短路会让断言随运行时机时好时坏。
function writeRules(file: string, content: string, tick: number): void {
  fs.writeFileSync(file, content);
  const t = new Date(Date.now() + tick * 1000);
  fs.utimesSync(file, t, t);
}

writeRules(goodFile, JSON.stringify(override), 1);
process.env.FISH_KNOWLEDGE_FILE = goodFile;
refreshRules();
const metaAfterGood = knowledgeMeta();
if (metaAfterGood.source === "file" && metaAfterGood.count === 1) pass("热更：外部文件生效后规则表被替换", `count=${metaAfterGood.count}`);
else fail("热更：外部文件生效后规则表被替换", JSON.stringify(metaAfterGood));
if (retrieveRules({ waterType: "野塘", season: "冬", targetFish: ["鲫鱼"] }, 3)[0]?.rule.id === "R-TEST-1") {
  pass("热更：检索立即使用新规则");
} else fail("热更：检索立即使用新规则");

writeRules(goodFile, "{ not json ", 5);
refreshRules();
const metaAfterBad = knowledgeMeta();
if (metaAfterBad.count === 1 && metaAfterBad.error) pass("热更：坏文件保留旧表并记录错误", metaAfterBad.error.slice(0, 48));
else fail("热更：坏文件保留旧表并记录错误", JSON.stringify(metaAfterBad));

// 结构不合法的数组（缺 advice 字段）必须整批拒绝
writeRules(goodFile, JSON.stringify([{ id: "R-BAD", fish: "鲫鱼", seasons: ["冬"], waterTypes: ["野塘"] }]), 10);
refreshRules();
const metaAfterInvalid = knowledgeMeta();
if (metaAfterInvalid.count === 1 && metaAfterInvalid.error?.includes("advice")) {
  pass("热更：字段缺失的规则文件被拒并保留旧表", metaAfterInvalid.error);
} else fail("热更：字段缺失的规则文件被拒并保留旧表", JSON.stringify(metaAfterInvalid));

delete process.env.FISH_KNOWLEDGE_FILE;
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`INFO  季节推断：7 月→${seasonFromMonth(7)}，1 月→${seasonFromMonth(1)}；内置规则 ${builtinCount} 条`);

console.log(`\n${failures === 0 ? "知识库门禁全部通过" : `知识库门禁存在 ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
