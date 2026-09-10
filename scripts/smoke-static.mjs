/**
 * 本地冒烟验证脚本（v12 静态资源中间件）
 * 单进程内启动生产服务并逐项验证压缩协商 / 缓存头 / SPA fallback / 304。
 * 用法：node --env-file=.env.smoke scripts/smoke-static.mjs
 */
import { spawn } from "node:child_process";

const PORT = process.env.PORT || "3100";
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn(
  process.execPath,
  ["-e", 'import("./dist/boot.js")'],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "production", PORT } },
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
  for (const [enc, expectLen] of [["br", 214587], ["gzip", 264454], ["identity", 943532]]) {
    const res = await head("/assets/index-u0P2kqnp.js", { "Accept-Encoding": enc });
    check(`Accept-Encoding: ${enc} → content-encoding`, res.headers.get("content-encoding") || "identity", enc === "identity" ? "identity" : enc);
    check(`Accept-Encoding: ${enc} → content-length`, Number(res.headers.get("content-length")), expectLen);
  }

  console.log("\n── 缓存头 ──");
  const css = await head("/assets/index-CpoC8fk_.css", { "Accept-Encoding": "br" });
  check("带 hash 的资源 → cache-control", css.headers.get("cache-control"), "public, max-age=31536000, immutable");
  check("带 hash 的资源 → Vary", css.headers.get("vary"), "Accept-Encoding");

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

  console.log("\n── ETag / 304 协商 ──");
  const first = await head("/assets/index-u0P2kqnp.js", { "Accept-Encoding": "br" });
  const etag = first.headers.get("etag");
  check("响应含 ETag", Boolean(etag), true, etag ?? "");
  if (etag) {
    const revalidated = await head("/assets/index-u0P2kqnp.js", { "Accept-Encoding": "br", "If-None-Match": etag });
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
