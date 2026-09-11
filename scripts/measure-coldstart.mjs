#!/usr/bin/env node
/**
 * 冷启动首屏实测（QY-PERF-008 验收工具）
 * ============================================================================
 * 为什么需要它：功能需求清单里「冷启动首屏（APK）」长期是「待补测」，
 * 导致本轮 v12 传输层优化（首屏 1021 KB → 约 190 KB）拿不出前后对照。
 *
 * 测量方式：用 CDP（Chrome DevTools Protocol）驱动真实 Chromium，
 * 每次测量都**开一个全新浏览器实例 + 全新 user-data-dir**，因此磁盘缓存、
 * HTTP 缓存、JS 引擎都处于冷态；再叠加 CPU 节流与网络节流模拟中端安卓机。
 * 指标直接取应用内置埋点 window.__QY_PERF__（写在 src/lib/perf.ts），
 * 与真机 APK 用的是同一套埋点，口径一致。
 *
 * 零依赖：CDP 走 Node 内置 WebSocket，不引入 playwright/puppeteer。
 *
 * 用法：
 *   # 测本地已构建产物（自动拉起 dist/boot.js）
 *   node --env-file=.env.smoke scripts/measure-coldstart.mjs --serve --runs 10
 *
 *   # 测任意已在跑的站点（含生产 / 真机 WebView 转发端口）
 *   node scripts/measure-coldstart.mjs --url http://47.109.185.118:3000 --runs 10
 *
 *   # 直接连真机 WebView 的 DevTools 端口（见 docs/运营/真机冷启动测量SOP.md）
 *   node scripts/measure-coldstart.mjs --ws ws://127.0.0.1:9222/devtools/page/<id> --runs 10
 *
 *   # 输出 JSON 供报告引用
 *   node scripts/measure-coldstart.mjs --serve --runs 10 --json ../tmp-coldstart.json
 *
 * 常用参数：
 *   --runs  N        测量次数（默认 10）
 *   --cpu   N        CPU 节流倍数（默认 4，约等于中端安卓机）
 *   --net   PROFILE  网络档位：slow4g(默认) | fast4g | fast3g | slow3g | none
 *   --url   URL      目标地址（不给且未 --serve 时默认 http://127.0.0.1:3100）
 *   --serve          先在当前目录拉起 dist/boot.js 再测量
 *   --port  N        --serve 使用的端口（默认 3100）
 *   --log-dir DIR    实验室样本落盘目录（透传 PERF_LOG_DIR，默认进 logs/）
 *   --chrome PATH    指定 Chromium/Chrome 可执行文件
 *   --timeout MS     单次加载超时（默认 45000）
 *   --json  PATH     把逐次原始数据写为 JSON
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ------------------------------- CLI ---------------------------------- */
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) {
    args[key] = true;
  } else {
    args[key] = next;
    i++;
  }
}

const RUNS = Number(args.runs ?? 10);
const CPU = Number(args.cpu ?? 4);
const NET_NAME = String(args.net ?? "slow4g");
const PORT = Number(args.port ?? 3100);
const TIMEOUT = Number(args.timeout ?? 45000);
const URL = String(args.url ?? `http://127.0.0.1:${PORT}/`);
const JSON_OUT = typeof args.json === "string" ? args.json : null;

/** Chrome DevTools 内置网络档位（throughput 单位 bytes/s） */
const NET_PROFILES = {
  none: null,
  fast4g: { latency: 20, down: (4 * 1024 * 1024) / 8, up: (3 * 1024 * 1024) / 8, label: "Fast 4G 4Mbps/20ms" },
  slow4g: { latency: 300, down: (1.5 * 1024 * 1024) / 8, up: (750 * 1024) / 8, label: "Slow 4G 1.5Mbps/300ms" },
  fast3g: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, label: "Fast 3G 1.6Mbps/150ms" },
  slow3g: { latency: 2000, down: (400 * 1024) / 8, up: (400 * 1024) / 8, label: "Slow 3G 400kbps/2000ms" },
};
if (!(NET_NAME in NET_PROFILES)) {
  console.error(`未知网络档位 --net ${NET_NAME}，可选：${Object.keys(NET_PROFILES).join(" | ")}`);
  process.exit(2);
}
const NET = NET_PROFILES[NET_NAME];

/* --------------------------- 浏览器定位 -------------------------------- */
function resolveChrome() {
  if (typeof args.chrome === "string") return args.chrome;
  const candidates = [];
  // Playwright 缓存（本机已有）
  const pwRoot = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (fs.existsSync(pwRoot)) {
    for (const d of fs.readdirSync(pwRoot).filter((n) => n.startsWith("chromium-"))) {
      for (const sub of ["chrome-win64", "chrome-win", "chrome-linux", "chrome-mac"]) {
        candidates.push(path.join(pwRoot, d, sub, "chrome.exe"));
        candidates.push(path.join(pwRoot, d, sub, "chrome"));
      }
    }
  }
  candidates.push(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

/* ------------------------------ 工具 ---------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 分位数（最近秩法）：P50 = 中位数，与 SOP 中「取中位数」口径一致 */
function percentile(values, p) {
  const s = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

/* --------------------------- CDP 客户端 ------------------------------- */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP 超时：${method}`));
      }, TIMEOUT);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }
  on(fn) {
    this.listeners.add(fn);
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => reject(new Error("CDP WebSocket 连接超时")), 15000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve(new Cdp(ws));
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error(`CDP 连接失败：${wsUrl}`));
    });
  });
}

/** 启动一个全新 Chromium 实例，返回其浏览器级 DevTools WebSocket 地址 */
function launchChrome(executable, profileDir) {
  const chromeArgs = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    // 无头容器/CI 环境常缺沙箱依赖，显式关闭；仅用于本地性能测量
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-extensions",
    "--disable-component-update",
    "--disable-client-side-phishing-detection",
    "--disable-default-apps",
    "--mute-audio",
    "--no-pings",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--window-size=390,844",
    "about:blank",
  ];
  const child = spawn(executable, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`等待 DevTools 端点超时\n${buf.slice(-400)}`)), 30000);
    child.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ child, wsUrl: m[1] });
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome 提前退出（code ${code}）\n${buf.slice(-400)}`));
    });
  });
}

/* --------------------------- 单次冷启动 ------------------------------- */
async function runOnce(executable) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "qy-cold-"));
  let child = null;
  let cdp = null;
  try {
    const launched = await launchChrome(executable, profileDir);
    child = launched.child;
    cdp = await connect(launched.wsUrl);

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
      sessionId,
    );
    if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU }, sessionId);
    if (NET) {
      await cdp.send(
        "Network.emulateNetworkConditions",
        { offline: false, latency: NET.latency, downloadThroughput: NET.down, uploadThroughput: NET.up },
        sessionId,
      );
    }

    // 先挂监听再导航，避免 load 事件早于监听器注册
    const loadFired = new Promise((resolve) => {
      const t = setTimeout(resolve, TIMEOUT);
      cdp.on((msg) => {
        if (msg.sessionId === sessionId && msg.method === "Page.loadEventFired") {
          clearTimeout(t);
          resolve();
        }
      });
    });

    const navStart = Date.now();
    await cdp.send("Page.navigate", { url: URL }, sessionId);
    await loadFired;
    // 应用埋点在 load 后 1200ms 上报，这里留足余量再读
    await sleep(2200);

    const { result } = await cdp.send(
      "Runtime.evaluate",
      { expression: "JSON.stringify(window.__QY_PERF__ || null)", returnByValue: true },
      sessionId,
    );
    const metrics = result?.value ? JSON.parse(result.value) : null;
    if (!metrics) throw new Error("页面未产出 window.__QY_PERF__（埋点未生效或被 qy_perf_off 关闭）");
    metrics.__wallClockMs = Date.now() - navStart;
    return metrics;
  } finally {
    cdp?.close();
    if (child) child.kill();
    // 清掉临时 profile，保证下一次仍是冷缓存
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* Windows 下偶发文件占用，忽略 */
    }
  }
}

/* ----------------------------- 主流程 --------------------------------- */
async function main() {
  const executable = resolveChrome();
  if (!executable) {
    console.error("未找到 Chromium/Chrome。请用 --chrome <路径> 指定，或安装 Chrome。");
    process.exit(2);
  }

  let server = null;
  if (args.serve) {
    if (!fs.existsSync(path.resolve("dist/boot.js"))) {
      console.error("dist/boot.js 不存在，请先 npm run build");
      process.exit(2);
    }
    server = spawn(process.execPath, ["-e", 'import("./dist/boot.js")'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT),
        // 实验室样本默认单独落盘，避免与真机样本混在一起算分位数
        ...(typeof args["log-dir"] === "string" ? { PERF_LOG_DIR: path.resolve(args["log-dir"]) } : {}),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    server.stderr.on("data", () => {});
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/`);
        if (r.status < 500) {
          ready = true;
          break;
        }
      } catch {
        /* 尚未监听 */
      }
    }
    if (!ready) {
      server.kill();
      console.error("本地服务 30s 内未就绪");
      process.exit(2);
    }
  }

  console.log("冷启动首屏实测（QY-PERF-008）");
  console.log(`  目标        ${URL}`);
  console.log(`  浏览器      ${executable}`);
  console.log(`  网络档位    ${NET ? NET.label : "不限速"}`);
  console.log(`  CPU 节流    ${CPU}x`);
  console.log(`  测量次数    ${RUNS}（每次全新实例 + 全新 profile = 真冷缓存）`);
  console.log("");

  const samples = [];
  for (let i = 1; i <= RUNS; i++) {
    try {
      const m = await runOnce(executable);
      samples.push(m);
      const f = (v) => (v == null ? "  -  " : String(v).padStart(5));
      console.log(
        `  #${String(i).padStart(2)}  ttfb ${f(m.ttfbMs)}  fcp ${f(m.fcpMs)}  lcp ${f(m.lcpMs)}  ` +
          `interactive ${f(m.interactiveMs)}  load ${f(m.loadMs)}  ` +
          `传输 ${f(m.transferBytes && Math.round(m.transferBytes / 1024))}KB  ${f(m.requestCount)}req`,
      );
    } catch (err) {
      console.log(`  #${String(i).padStart(2)}  失败：${err.message.split("\n")[0]}`);
    }
  }

  if (!samples.length) {
    console.error("\n全部测量失败。");
    server?.kill();
    process.exit(1);
  }

  const fields = [
    ["ttfbMs", "TTFB 首字节", "ms"],
    ["fcpMs", "FCP 首次内容绘制", "ms"],
    ["lcpMs", "LCP 最大内容绘制", "ms"],
    ["interactiveMs", "首屏可交互", "ms"],
    ["loadMs", "load 完成", "ms"],
    ["transferBytes", "实际传输量", "KB", (v) => v / 1024],
    ["requestCount", "请求数", "个"],
    ["decodedBytes", "解码后体积", "KB", (v) => v / 1024],
  ];

  console.log(`\n有效样本 ${samples.length}/${RUNS}`);
  console.log("  指标".padEnd(22) + "P50(中位数)".padStart(12) + "P90".padStart(10) + "最小".padStart(10) + "最大".padStart(10));
  const summary = {};
  for (const [key, label, unit, xform] of fields) {
    const vals = samples.map((s) => s[key]).filter((v) => typeof v === "number");
    if (!vals.length) continue;
    const t = (v) => (xform ? xform(v) : v);
    const p50 = percentile(vals, 50);
    const p90 = percentile(vals, 90);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    summary[key] = { p50: Math.round(t(p50)), p90: Math.round(t(p90)), min: Math.round(t(min)), max: Math.round(t(max)), unit };
    console.log(
      `  ${label.padEnd(20)}${String(Math.round(t(p50))).padStart(12)}${String(Math.round(t(p90))).padStart(10)}${String(Math.round(t(min))).padStart(10)}${String(Math.round(t(max))).padStart(10)}   ${unit}`,
    );
  }

  // 设备画像（用于判断结果可比性）
  const first = samples[0];
  console.log(
    `\n  环境画像    dpr=${first.dpr}  cores=${first.hardwareConcurrency}  ` +
      `memory=${first.deviceMemoryGb ?? "-"}GB  effectiveType=${first.effectiveType ?? "-"}  sessionKind=${first.sessionKind ?? "-"}`,
  );

  // 埋点完整性自检：任何一个关键字段缺失/为 0，说明埋点本身坏了（实测踩过
  // 「导航时序在 init 阶段被读成 0」的坑），此时测出来的数不能用来做验收。
  const problems = [];
  for (const [key, label] of [
    ["fcpMs", "FCP"],
    ["lcpMs", "LCP"],
    ["interactiveMs", "首屏可交互"],
    ["loadMs", "load 完成"],
  ]) {
    const vals = samples.map((s) => s[key]).filter((v) => typeof v === "number");
    if (vals.length !== samples.length) problems.push(`${label} 有 ${samples.length - vals.length} 次缺失`);
    else if (vals.every((v) => v === 0)) problems.push(`${label} 恒为 0`);
  }
  if (problems.length) {
    console.log(`\n  ⚠ 埋点自检未通过：${problems.join("；")}`);
    console.log("    该结果不可用于验收，请先修埋点（src/lib/perf.ts）。");
  }

  const report = {
    measuredAt: new Date().toISOString(),
    url: URL,
    chrome: executable,
    network: NET ? NET.label : "none",
    cpuThrottle: CPU,
    runs: RUNS,
    validSamples: samples.length,
    summary,
    samples,
  };
  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true });
    fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(report, null, 2), "utf8");
    console.log(`\n  原始数据已写入 ${path.resolve(JSON_OUT)}`);
  }

  server?.kill();
  console.log("\n完成。");
}

main().catch((err) => {
  console.error("测量异常：", err);
  process.exit(1);
});
