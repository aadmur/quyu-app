/**
 * 首屏payload核算（QY-PERF-002 验收工具）
 * 用法：node scripts/measure-firstload.mjs
 *
 * 计算「打开首页」真正需要下载的资源总量：
 * index.html 引用的入口 chunk + 其静态 import 链 + CSS + 字体。
 * 懒加载的页面 chunk 不计入——它们只在用户导航到对应路由时才下载。
 */
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("dist/public");
const assetsDir = path.join(dist, "assets");

const size = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);
const brSize = (p) => {
  const b = `${p}.br`;
  return fs.existsSync(b) ? fs.statSync(b).size : size(p);
};

const html = fs.readFileSync(path.join(dist, "index.html"), "utf-8");
const entryFiles = [...html.matchAll(/\/assets\/([^"']+)/g)].map((m) => m[1]);

/** 解析 chunk 之间的静态 import 依赖（Rollup 产物为 `from"./xxx.js"`） */
function staticDeps(file) {
  const p = path.join(assetsDir, file);
  if (!fs.existsSync(p)) return [];
  const code = fs.readFileSync(p, "utf-8");
  const matches = [
    ...code.matchAll(/(?:from|import)\s*["']\.\/([A-Za-z0-9_\-]+\.js)["']/g),
  ].map((m) => m[1]);
  return [...new Set(matches)];
}

const firstLoad = new Set();
const queue = [...entryFiles];
while (queue.length) {
  const f = queue.shift();
  if (firstLoad.has(f)) continue;
  firstLoad.add(f);
  // 只沿静态 import 链展开；动态 import 是懒加载，不进入首屏
  for (const d of staticDeps(f)) if (!firstLoad.has(d)) queue.push(d);
}

let rawTotal = 0;
let brTotal = 0;
const rows = [];
for (const f of firstLoad) {
  const p = path.join(assetsDir, f);
  if (!fs.existsSync(p)) continue;
  rawTotal += size(p);
  brTotal += brSize(p);
  rows.push({ f, raw: size(p), br: brSize(p) });
}

// 字体为 preload，属首屏关键路径
const fonts = ["oswald-latin.woff2", "bebas-neue-400.woff2"].map((n) => {
  const p = path.join(dist, "fonts", n);
  return { f: `fonts/${n}`, raw: size(p), br: size(p) };
});
for (const f of fonts) {
  rawTotal += f.raw;
  brTotal += f.br;
  rows.push(f);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
rows.sort((a, b) => b.raw - a.raw);
console.log("首屏必需资源（入口及静态 import 链 + 字体，不含懒加载页面）");
console.log("");
for (const r of rows) {
  console.log(`  ${r.f.padEnd(38)} ${kb(r.raw).padStart(10)}   br ${kb(r.br).padStart(10)}`);
}
console.log(`\n  ${"合计".padEnd(36)} ${kb(rawTotal).padStart(10)}   br ${kb(brTotal).padStart(10)}`);
console.log(`\n  首屏资源个数：${firstLoad.size} 个 chunk + ${fonts.length} 个字体`);

// 全量产物（含懒加载）用于对比
const all = fs
  .readdirSync(assetsDir)
  .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
  .reduce((n, f) => n + size(path.join(assetsDir, f)), 0);
console.log(`  全部 chunk（未压缩内容，含懒加载）：${kb(all)}`);
console.log(`  懒加载节省：${kb(all - rawTotal + fonts.reduce((n, f) => n + f.raw, 0))}`);
