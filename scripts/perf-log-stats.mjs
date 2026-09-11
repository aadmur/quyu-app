#!/usr/bin/env node
/**
 * 冷启动采样聚合统计（QY-PERF-008）
 * ============================================================================
 * 读取服务端落盘的 logs/perf-YYYY-MM-DD.jsonl（由 api/lib/perfLog.ts 写入），
 * 按真机维度算出分位数。
 *
 * 为什么需要它：release APK 的 WebView 远程调试默认关闭
 * （Capacitor 的 android.webContentsDebuggingEnabled 缺省值 = isDebug），
 * 所以「真机冷启动实测」的主力路径是**靠应用自己上报**，而不是接 DevTools。
 * 采样是从真实用户真实设备来的，比实验室数据更可信。
 *
 * 用法：
 *   node scripts/perf-log-stats.mjs                          # 读 logs/ 下全部文件
 *   node scripts/perf-log-stats.mjs logs/perf-2026-09-11.jsonl
 *   node scripts/perf-log-stats.mjs --since 2026-09-10       # 只统计指定日期起
 *   node scripts/perf-log-stats.mjs --path /                # 只看首页
 *   node scripts/perf-log-stats.mjs --group cpu              # 按 CPU 核数分档
 *   node scripts/perf-log-stats.mjs --group net              # 按网络档位分档
 *   node scripts/perf-log-stats.mjs --json out.json
 *
 * 口径说明：
 * - 默认只统计 sessionKind === 'navigate'（排除 reload / back_forward），
 *   这才是「冷启动」；用 --all-sessions 关闭该过滤。
 * - 分位数用最近秩法，与 scripts/measure-coldstart.mjs 一致。
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const files = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  } else {
    files.push(a);
  }
}

const LOG_DIR = path.resolve("logs");
const JSON_OUT = typeof flags.json === "string" ? flags.json : null;

function discover() {
  if (files.length) return files.map((f) => path.resolve(f));
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs
    .readdirSync(LOG_DIR)
    .filter((f) => /^perf-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .map((f) => path.join(LOG_DIR, f));
}

const percentile = (values, p) => {
  const s = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

/* ------------------------------ 读取 -------------------------------- */
const targets = discover();
if (!targets.length) {
  console.error("未找到采样文件。默认查找 <cwd>/logs/perf-YYYY-MM-DD.jsonl");
  console.error("若生产在 ECS 上，请先把 /opt/quyu/logs/ 下的文件拉回本地，或直接在服务器上运行本脚本。");
  process.exit(2);
}

const since = typeof flags.since === "string" ? flags.since : null;
let samples = [];
let badLines = 0;
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const day = path.basename(file).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
  if (since && day && day < since) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      samples.push(JSON.parse(t));
    } catch {
      badLines++;
    }
  }
}

console.log("冷启动采样聚合（QY-PERF-008）");
console.log(`  来源文件    ${targets.length} 个${since ? `（since ${since}）` : ""}`);
console.log(`  原始样本    ${samples.length} 条${badLines ? `（跳过损坏行 ${badLines}）` : ""}`);

/* ------------------------------ 过滤 -------------------------------- */
if (!flags["all-sessions"]) {
  const before = samples.length;
  samples = samples.filter((s) => s.sessionKind == null || s.sessionKind === "navigate");
  console.log(`  冷启动过滤  保留 sessionKind=navigate：${before} → ${samples.length}`);
}
if (typeof flags.path === "string") {
  samples = samples.filter((s) => s.path === flags.path);
  console.log(`  路径过滤    path=${flags.path} → ${samples.length}`);
}
if (samples.length === 0) {
  console.error("\n过滤后无样本。");
  process.exit(1);
}

/* ------------------------------ 统计 -------------------------------- */
const METRICS = [
  ["ttfbMs", "TTFB", "ms"],
  ["fcpMs", "FCP", "ms"],
  ["lcpMs", "LCP", "ms"],
  ["interactiveMs", "首屏可交互", "ms"],
  ["loadMs", "load", "ms"],
  ["transferBytes", "传输量", "KB", (v) => v / 1024],
];

function summaryOf(rows) {
  const out = {};
  for (const [key, label, unit, xform] of METRICS) {
    const vals = rows.map((r) => r[key]);
    if (vals.filter((v) => typeof v === "number").length === 0) continue;
    const t = (v) => (xform ? xform(v) : v);
    out[key] = {
      label,
      unit,
      n: vals.filter((v) => typeof v === "number").length,
      p50: Math.round(t(percentile(vals, 50))),
      p90: Math.round(t(percentile(vals, 90))),
      p95: Math.round(t(percentile(vals, 95))),
      p99: Math.round(t(percentile(vals, 99))),
      max: Math.round(t(Math.max(...vals.filter((v) => typeof v === "number")))),
    };
  }
  return out;
}

function printSummary(title, rows) {
  const s = summaryOf(rows);
  console.log(`\n  ${title}（n=${rows.length}）`);
  console.log(
    "    指标".padEnd(16) +
      "样本".padStart(6) +
      "P50".padStart(10) +
      "P90".padStart(10) +
      "P95".padStart(10) +
      "P99".padStart(10) +
      "最大".padStart(10),
  );
  for (const key of Object.keys(s)) {
    const m = s[key];
    console.log(
      `    ${m.label.padEnd(14)}${String(m.n).padStart(6)}${String(m.p50).padStart(10)}${String(m.p90).padStart(10)}` +
        `${String(m.p95).padStart(10)}${String(m.p99).padStart(10)}${String(m.max).padStart(10)}   ${m.unit}`,
    );
  }
  return s;
}

const overall = printSummary("全部样本", samples);

/* ---------------------------- 分档统计 ------------------------------ */
const groups = [];
if (flags.group === "cpu") {
  const buckets = new Map();
  for (const s of samples) {
    const c = s.hardwareConcurrency ?? 0;
    const key = c >= 8 ? "≥8 核" : c >= 6 ? "6-7 核" : c >= 4 ? "4-5 核" : "<4 核/未知";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  for (const [k, v] of [...buckets.entries()].sort()) groups.push([`按 CPU 分档：${k}`, v]);
} else if (flags.group === "net") {
  const buckets = new Map();
  for (const s of samples) {
    const key = s.effectiveType ?? "未知";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  for (const [k, v] of [...buckets.entries()].sort()) groups.push([`按网络分档：${k}`, v]);
}
const groupSummaries = {};
for (const [label, rows] of groups) {
  if (rows.length < 5) {
    console.log(`\n  ${label}：样本仅 ${rows.length} 条，样本量不足以给分位数（跳过）`);
    continue;
  }
  groupSummaries[label] = printSummary(label, rows);
}

/* ---------------------------- 环境画像 ------------------------------ */
const uaTop = new Map();
for (const s of samples) {
  const ua = String(s.ua ?? "未知");
  const key = ua.includes("Android")
    ? `Android ${ua.match(/Android\s([\d.]+)/)?.[1] ?? ""} / Chrome ${ua.match(/Chrome\/(\d+)/)?.[1] ?? "?"}`
    : ua.slice(0, 60);
  uaTop.set(key, (uaTop.get(key) ?? 0) + 1);
}
console.log("\n  设备/UA 分布（前 5）");
for (const [k, v] of [...uaTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log(`    ${String(v).padStart(6)}  ${k}`);
}

if (JSON_OUT) {
  fs.writeFileSync(
    path.resolve(JSON_OUT),
    JSON.stringify({ generatedAt: new Date().toISOString(), files: targets, total: samples.length, overall, groups: groupSummaries }, null, 2),
    "utf8",
  );
  console.log(`\n  已写入 ${path.resolve(JSON_OUT)}`);
}
