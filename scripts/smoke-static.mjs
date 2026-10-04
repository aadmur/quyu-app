/**
 * 本地冒烟验证脚本（v12 静态资源中间件）
 * 单进程内启动生产服务并逐项验证压缩协商 / 缓存头 / SPA fallback / 304。
 * 用法：node --env-file=.env.smoke scripts/smoke-static.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.PORT || "3100";
const BASE = `http://127.0.0.1:${PORT}`;
/** 冒烟样本写到这里，不污染 logs/ 里的真实采样（QY-PERF-008） */
const SMOKE_PERF_DIR = path.join(os.tmpdir(), "qy-smoke-perf");

/** 从产物目录发现实际文件名，避免 hash 变化导致断言失效 */
function discoverAssets() {
  const assetDir = path.resolve("dist/public/assets");
  const files = fs.readdirSync(assetDir).filter((f) => f.endsWith(".js") || f.endsWith(".css"));
  const jsName = files
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ f, size: fs.statSync(path.join(assetDir, f)).size }))
    .sort((a, b) => b.size - a.size)[0].f;
  const cssName = files.filter((f) => f.endsWith(".css"))[0];
  const variants = (name) => {
    const raw = fs.statSync(path.join(assetDir, name)).size;
    const br = fs.existsSync(path.join(assetDir, `${name}.br`))
      ? fs.statSync(path.join(assetDir, `${name}.br`)).size
      : null;
    const gz = fs.existsSync(path.join(assetDir, `${name}.gz`))
      ? fs.statSync(path.join(assetDir, `${name}.gz`)).size
      : null;
    return { raw, br, gz };
  };
  return { jsName, cssName, js: variants(jsName), css: variants(cssName) };
}

const ASSETS = discoverAssets();

const child = spawn(
  process.execPath,
  ["-e", 'import("./dist/boot.js")'],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "production", PORT, PERF_LOG_DIR: SMOKE_PERF_DIR } },
);
child.stdout.on("data", () => {});
child.stderr.on("data", () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, actual, expected, extra = "") {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} ${String(actual).padEnd(22)} ${extra}`);
}

async function head(path, headers = {}) {
  const res = await fetch(BASE + path, { headers });
  return res;
}

try {
  await sleep(3500);

  console.log("\n── 压缩协商 ──");
  console.log(`     主 JS = ${ASSETS.jsName}  主 CSS = ${ASSETS.cssName}`);
  const jsPath = `/assets/${ASSETS.jsName}`;
  for (const [enc, expectLen] of [
    ["br", ASSETS.js.br],
    ["gzip", ASSETS.js.gz],
    ["identity", ASSETS.js.raw],
  ]) {
    const res = await head(jsPath, { "Accept-Encoding": enc });
    check(`Accept-Encoding: ${enc} → content-encoding`, res.headers.get("content-encoding") || "identity", enc === "identity" ? "identity" : enc);
    check(`Accept-Encoding: ${enc} → content-length`, Number(res.headers.get("content-length")), expectLen);
  }

  console.log("\n── 缓存头 ──");
  const css = await head(`/assets/${ASSETS.cssName}`, { "Accept-Encoding": "br" });
  check("带 hash 的资源 → cache-control", css.headers.get("cache-control"), "public, max-age=31536000, immutable");
  check("带 hash 的资源 → Vary", css.headers.get("vary"), "Accept-Encoding");
  check("CSS 压缩后体积", Number(css.headers.get("content-length")), ASSETS.css.br);

  const root = await head("/", { Accept: "text/html" });
  check("首页 / → status", root.status, 200);
  check("首页 / → cache-control", root.headers.get("cache-control"), "no-cache");
  check("首页 / → 返回 HTML", root.headers.get("content-type"), (v) => String(v).includes("text/html"));

  console.log("\n── SPA history fallback ──");
  for (const p of ["/post/123", "/me", "/owner", "/moderation", "/pond/7", "/terms"]) {
    const res = await head(p, { Accept: "text/html" });
    const body = await res.text();
    check(`${p} → 200 + HTML 入口`, `${res.status}/${body.length}`, (v) => v.startsWith("200/") && body.includes("<div id=\"root\">"));
  }

  console.log("\n── 非 HTML 的未知路径应 404 ──");
  const missing = await head("/not-exist.json");
  check("/not-exist.json → 404", missing.status, 404);

  console.log("\n── 目录穿越防护 ──");
  const traversal = await head("/../../package.json");
  check("目录穿越被拒", traversal.status, (v) => v === 404 || v === 400);

  console.log("\n── 自托管字体（QY-PERF-003）──");
  for (const f of ["/fonts/oswald-latin.woff2", "/fonts/bebas-neue-400.woff2"]) {
    const res = await head(f);
    check(`${f} → 200 + woff2 MIME`, `${res.status}/${res.headers.get("content-type")}`, (v) =>
      v.startsWith("200/") && v.includes("font/woff2"),
    );
  }

  console.log("\n── 图片资产（QY-PERF-004）──");
  // WebP 需正确的 MIME 与长缓存；同时验证「保留原名」的兼容资产仍可访问
  const publicDir = path.resolve("dist/public");
  const webp = fs.existsSync(publicDir)
    ? fs.readdirSync(publicDir).filter((f) => f.endsWith(".webp"))
    : [];
  check("产物含 WebP 图片", webp.length > 0, true, `${webp.length} 个`);
  if (webp.length > 0) {
    const res = await head(`/${webp[0]}`);
    check(
      `/${webp[0]} → 200 + image/webp`,
      `${res.status}/${res.headers.get("content-type")}`,
      (v) => v.startsWith("200/") && v.includes("image/webp"),
    );
  }
  for (const legacy of ["/avatar-1.png", "/pond-yunxi-1.jpg"]) {
    const res = await head(legacy);
    check(`${legacy}（DB/服务端固化的原名）→ 200`, res.status, 200);
  }

  // 数据库图片路径已迁移到 .webp（2026-09-12）：抽样验证 .webp 可达，
  // 确保「数据层路径」不再依赖旧文件名。全量由 check-images.mjs 的 db/ 扫描把关。
  for (const webpDb of ["/feed-1.webp", "/avatar-2.webp", "/prod-rod.webp", "/pond-qinglong-1.webp", "/review-1.webp"]) {
    const res = await head(webpDb);
    check(`${webpDb}（数据库迁移后的路径）→ 200`, res.status, 200);
  }

  console.log("\n── 入口 HTML 无外链字体、含字体 preload ──");
  const htmlRes = await head("/", { Accept: "text/html" });
  const html = await htmlRes.text();
  check("不含 googleapis/gstatic", /fonts\.(googleapis|gstatic)\.com/.test(html) ? "含外链" : "干净", "干净");
  check("preload 自托管 Oswald", html.includes("/fonts/oswald-latin.woff2"), true);
  check("preload 自托管 Bebas", html.includes("/fonts/bebas-neue-400.woff2"), true);

  console.log("\n── 体积预算（QY-PERF-001/003/007）──");
  const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
  // CSS：删除 shadcn 组件层后实测 br 6.3 KB，设 12 KB 预算（QY-PERF-007 验收线）
  check("CSS brotli ≤ 12 KB", kb(ASSETS.css.br), (v) => v <= 12, "KB");
  // 首屏主 JS：预压缩后实测 ~50.8 KB，设 70 KB 预算
  check("主 JS brotli ≤ 70 KB", kb(ASSETS.js.br), (v) => v <= 70, "KB");
  // 字体合计 ≤ 40 KB（QY-PERF-003 验收线）
  const fontDir = path.resolve("dist/public/fonts");
  const fontBytes = fs.existsSync(fontDir)
    ? fs.readdirSync(fontDir).reduce((sum, f) => sum + fs.statSync(path.join(fontDir, f)).size, 0)
    : 0;
  check("自托管字体合计 ≤ 40 KB", kb(fontBytes), (v) => v > 0 && v <= 40, "KB");

  console.log("\n── 哪钓 v13 现场参数表单与专业报告按需加载（QY-SPOT-001/006）──");
  // 验收线：首屏体积不得回退 → 新增的表单区与报告区必须是独立 chunk，且不被 index.html 静态引用
  const assetsDir = path.resolve("dist/public/assets");
  const chunkFiles = fs.readdirSync(assetsDir);
  for (const name of ["SpotFieldForm", "SpotExpertReport"]) {
    const chunk = chunkFiles.filter((f) => f.startsWith(`${name}-`) && f.endsWith(".js"));
    check(`${name} 独立 chunk 存在`, chunk.length > 0, true, chunk[0] ?? "");
    if (chunk[0]) {
      check(`${chunk[0]} 未被入口 HTML 静态引用`, html.includes(chunk[0]), false);
      const brPath = path.join(assetsDir, `${chunk[0]}.br`);
      const br = fs.existsSync(brPath) ? kb(fs.statSync(brPath).size) : null;
      check(`${name} chunk br ≤ 12 KB`, br, (v) => v !== null && v <= 12, "KB");
    }
  }
  check("FishSpot 页本身仍为路由级懒加载", chunkFiles.some((f) => /FishSpot-.*\.js$/.test(f)), true);

  console.log("\n── 冷启动埋点上报（QY-PERF-008）──");
  // 采样必须「匿名可上报、清洗后落盘、失败也不影响客户端」。
  // 注意落盘目录是 SMOKE_PERF_DIR（见上方 spawn 的 PERF_LOG_DIR），
  // 合成探针值绝不能写进 logs/ 与真实用户样本混在一起。
  const perfLog = path.join(SMOKE_PERF_DIR, `perf-${new Date().toISOString().slice(0, 10)}.jsonl`);
  // 先清掉上一次冒烟的残留，让下面几条体积断言是确定性的
  try {
    fs.rmSync(perfLog, { force: true });
  } catch {
    /* ignore */
  }
  const sizeOf = () => (fs.existsSync(perfLog) ? fs.statSync(perfLog).size : 0);
  const beforeSize = sizeOf();
  check("冒烟样本与真实日志目录隔离", perfLog.startsWith(SMOKE_PERF_DIR), true);

  const beacon = await fetch(BASE + "/api/perf", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "QY-Smoke/1.0 (cold-start)" },
    body: JSON.stringify({
      fcpMs: 812,
      lcpMs: 1340,
      interactiveMs: 1602,
      transferBytes: 421300,
      requestCount: 24,
      effectiveType: "4g",
      path: "/",
      // 以下两条是「注入面」探针：白名单外键 / 类型不符的值都不得落盘
      evil: "<script>alert(1)</script>",
      ttfbMs: "not-a-number",
    }),
  });
  check("/api/perf → 204", beacon.status, 204);
  check("采样已落盘", sizeOf() > beforeSize, true, path.basename(perfLog));

  let last = null;
  if (sizeOf() > beforeSize) {
    const lines = fs.readFileSync(perfLog, "utf8").trim().split("\n");
    last = JSON.parse(lines[lines.length - 1]);
  }
  check("白名单外字段被丢弃（evil）", last ? "evil" in last : "无样本", false);
  check("类型不符字段被丢弃（ttfbMs）", last ? "ttfbMs" in last : "无样本", false);
  check("数值字段正常保留（fcpMs）", last?.fcpMs, 812);
  check("服务端补写 UA", last?.ua, (v) => typeof v === "string" && v.length > 0);

  // 缺少首屏指标的样本无意义，应被拒（不落盘）
  const beforeNoise = sizeOf();
  await fetch(BASE + "/api/perf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "/no-metrics" }),
  });
  check("无首屏指标的样本不落盘", sizeOf(), beforeNoise);

  // 非法 JSON 也必须 204：埋点不得把错误反射回客户端
  const badJson = await fetch(BASE + "/api/perf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not-json{",
  });
  check("非法 JSON → 仍 204", badJson.status, 204);

  console.log("\n── ETag / 304 协商 ──");
  const first = await head(jsPath, { "Accept-Encoding": "br" });
  const etag = first.headers.get("etag");
  check("响应含 ETag", Boolean(etag), true, etag ?? "");
  if (etag) {
    const revalidated = await head(jsPath, { "Accept-Encoding": "br", "If-None-Match": etag });
    check("If-None-Match 命中 → 304", revalidated.status, 304);
    const revalidatedBody = await revalidated.text();
    check("304 无实体", revalidatedBody.length, 0);
  }

  console.log(`\n${failures === 0 ? "全部通过" : `存在 ${failures} 项失败`}`);
} catch (err) {
  console.error("验证脚本异常：", err);
  failures += 1;
} finally {
  child.kill();
  process.exit(failures === 0 ? 0 : 1);
}
