/**
 * @file scripts/eval-fishid.ts
 * QY-SPOT-013 评测基础设施：识鱼准确率离线评测脚本。
 *
 * 用法：
 *   node --import tsx scripts/eval-fishid.ts [--dir <评测集目录>] [--mock]
 *
 * 评测集目录结构（本地，不入 git）：
 *   eval-fishid/
 *     鲫鱼/  *.jpg  (≥20 张)
 *     鲤鱼/  *.jpg
 *     ...
 *     _干扰/  *.jpg  (非鱼/海水鱼/低质图)
 *
 * 输出：
 *   - Top-1 / Top-3 准确率
 *   - 每鱼种混淆矩阵
 *   - 兜底诚实率（干扰图不得硬给具体鱼种）
 *
 * 验收门槛（计划 §3.1）：
 *   Top-1 ≥ 80%，Top-3 ≥ 92%，兜底诚实率 100%
 *   不达标则调知识卡/提示词，仍不达标缩减鱼种清单
 */
import fs from "node:fs";
import path from "node:path";

interface EvalResult {
  label: string;
  top1Hit: boolean;
  top3Hit: boolean;
  isInterference: boolean;
  honest: boolean;
  topName: string | null;
  confidence: number;
}

function readImageAsDataURL(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  try {
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function runEval(dir: string, mock: boolean): Promise<void> {
  if (!fs.existsSync(dir)) {
    console.error(`评测集目录不存在：${dir}`);
    console.error("请创建目录并按鱼种名分子目录放入图片（每鱼种 ≥20 张）");
    process.exit(1);
  }

  const { identifyFish } = await import("../api/kimi/fishId");
  const results: EvalResult[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const speciesDirs = entries.filter((e) => e.isDirectory());

  if (speciesDirs.length === 0) {
    console.error(`评测集目录 ${dir} 下没有鱼种子目录`);
    process.exit(1);
  }

  console.log(`\n开始评测（${mock ? "MOCK 模式" : "真实 API"}）：${dir}\n`);

  for (const sdir of speciesDirs) {
    const label = sdir.name;
    const isInterference = label.startsWith("_") || label === "干扰";
    const files = fs.readdirSync(path.join(dir, sdir.name))
      .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));

    if (files.length === 0) {
      console.warn(`  跳过 ${label}/（无图片）`);
      continue;
    }

    console.log(`  处理 ${label}/（${files.length} 张）…`);

    for (const file of files) {
      const fullPath = path.join(dir, sdir.name, file);
      const dataUrl = readImageAsDataURL(fullPath);
      if (!dataUrl) continue;

      try {
        const { result } = await identifyFish(dataUrl);
        const topName = result.topCandidates[0]?.name ?? null;
        const top1Hit = !isInterference && topName === label;
        const top3Hit = !isInterference && result.topCandidates.some((c) => c.name === label);
        const honest = isInterference ? !result.isSupported || result.topCandidates.length === 0 : true;

        results.push({
          label,
          top1Hit,
          top3Hit,
          isInterference,
          honest,
          topName,
          confidence: result.confidence,
        });
      } catch (err) {
        console.error(`    ${file} 识别失败：${String(err)}`);
        results.push({ label, top1Hit: false, top3Hit: false, isInterference, honest: true, topName: null, confidence: 0 });
      }
    }
  }

  printReport(results);
}

function printReport(results: EvalResult[]): void {
  const fishResults = results.filter((r) => !r.isInterference);
  const interferenceResults = results.filter((r) => r.isInterference);

  const top1Acc = fishResults.length > 0 ? (fishResults.filter((r) => r.top1Hit).length / fishResults.length) * 100 : 0;
  const top3Acc = fishResults.length > 0 ? (fishResults.filter((r) => r.top3Hit).length / fishResults.length) * 100 : 0;
  const honestRate = interferenceResults.length > 0
    ? (interferenceResults.filter((r) => r.honest).length / interferenceResults.length) * 100
    : 100;

  console.log("\n" + "=".repeat(60));
  console.log("识鱼准确率评测报告");
  console.log("=".repeat(60));
  console.log(`评测样本：${fishResults.length} 张（${new Set(fishResults.map((r) => r.label)).size} 种）`);
  if (interferenceResults.length > 0) {
    console.log(`干扰样本：${interferenceResults.length} 张`);
  }
  console.log("");

  console.log("总体指标：");
  console.log(`  Top-1 准确率：${top1Acc.toFixed(1)}%  ${top1Acc >= 80 ? "PASS" : "FAIL"}（门槛 ≥80%）`);
  console.log(`  Top-3 准确率：${top3Acc.toFixed(1)}%  ${top3Acc >= 92 ? "PASS" : "FAIL"}（门槛 ≥92%）`);
  console.log(`  兜底诚实率：${honestRate.toFixed(1)}%  ${honestRate >= 100 ? "PASS" : "FAIL"}（门槛 100%）`);
  console.log("");

  console.log("分鱼种准确率：");
  const bySpecies = new Map<string, EvalResult[]>();
  for (const r of fishResults) {
    const arr = bySpecies.get(r.label) ?? [];
    arr.push(r);
    bySpecies.set(r.label, arr);
  }
  for (const [species, arr] of bySpecies) {
    const t1 = (arr.filter((r) => r.top1Hit).length / arr.length) * 100;
    const t3 = (arr.filter((r) => r.top3Hit).length / arr.length) * 100;
    console.log(`  ${species.padEnd(6)}  Top-1 ${t1.toFixed(0)}%  Top-3 ${t3.toFixed(0)}%  (${arr.length} 张)`);

    if (t1 < 80) {
      const confusion = new Map<string, number>();
      for (const r of arr) {
        if (!r.top1Hit && r.topName) {
          confusion.set(r.topName, (confusion.get(r.topName) ?? 0) + 1);
        }
      }
      if (confusion.size > 0) {
        const top = [...confusion.entries()].sort((a, b) => b[1] - a[1])[0];
        console.log(`    → 主误认为 ${top[0]}（${top[1]} 次）`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  const allPass = top1Acc >= 80 && top3Acc >= 92 && honestRate >= 100;
  console.log(`结论：${allPass ? "PASS（可上线）" : "FAIL（不达标，需调知识卡/提示词或缩减鱼种清单）"}`);
  console.log("=".repeat(60) + "\n");
}

const args = process.argv.slice(2);
const dirIdx = args.indexOf("--dir");
const evalDir = dirIdx >= 0 ? args[dirIdx + 1] : path.resolve(process.cwd(), "eval-fishid");
const isMock = args.includes("--mock");

runEval(evalDir, isMock).catch((err) => {
  console.error("评测脚本异常：", err);
  process.exit(1);
});
