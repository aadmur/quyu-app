/**
 * 冷启动埋点接线校验（QY-PERF-008）
 *
 * 目的：埋点是「静默」的——接线断了不会报错、不会白屏，只会让
 * window.__QY_PERF__ 永远为空，于是性能数据静默消失，验收时才发现无据可依。
 * 因此把接线写成构建门禁。
 *
 * 校验四条不变量：
 * 1. src/main.tsx 在 createRoot() 之前调用 initPerfMonitor()
 *    （晚于渲染会漏掉已经发生的 paint 条目，FCP 拿不到）
 * 2. src/components/Layout.tsx 调用 markFirstInteractive()
 *    （首屏可交互没有第二个可观测来源）
 * 3. api/boot.ts 中埋点路由注册在 app.all("/api/*") 兜底之前
 *    （否则被 404 吃掉，客户端永远拿不到 204）
 * 4. 客户端上报路径与服务端路由常量一致（两侧各写一份，最容易写歪）
 *
 * 用法：node scripts/check-perf-wiring.mjs
 * 已接入 build 前置门禁。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let failures = 0
const fail = (msg) => {
  console.error(`FAIL  ${msg}`)
  failures++
}
const pass = (msg) => console.log(`PASS  ${msg}`)

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

/** 剥掉注释，避免文档里的示例文字被当成代码 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ── 不变量 1：initPerfMonitor 必须早于 createRoot ──────────────────────
{
  const src = stripComments(read('src/main.tsx'))
  const initIdx = src.indexOf('initPerfMonitor()')
  const rootIdx = src.indexOf('createRoot(')
  if (initIdx < 0) {
    fail('src/main.tsx 未调用 initPerfMonitor()，冷启动埋点不会启动')
  } else if (rootIdx < 0) {
    fail('src/main.tsx 中找不到 createRoot( ，无法校验调用顺序')
  } else if (initIdx > rootIdx) {
    fail('initPerfMonitor() 晚于 createRoot()：会漏掉已发生的 paint 条目，FCP 恒为空')
  } else {
    pass('src/main.tsx 在 createRoot() 之前启动埋点')
  }
  if (!/from\s+['"]@\/lib\/perf['"]/.test(src)) {
    fail('src/main.tsx 未从 @/lib/perf 导入（可能改了模块路径）')
  }
}

// ── 不变量 2：Layout 必须打「首屏可交互」点 ─────────────────────────────
{
  const src = stripComments(read('src/components/Layout.tsx'))
  if (!src.includes('markFirstInteractive()')) {
    fail('src/components/Layout.tsx 未调用 markFirstInteractive()，首屏可交互指标会缺失')
  } else {
    pass('src/components/Layout.tsx 已打首屏可交互点')
  }
}

// ── 不变量 3：埋点路由必须在 /api/* 兜底之前注册 ───────────────────────
{
  const src = stripComments(read('api/boot.ts'))
  const perfIdx = src.indexOf('Paths.perf')
  const catchAllIdx = src.indexOf('app.all("/api/*"')
  if (perfIdx < 0) {
    fail('api/boot.ts 未注册 Paths.perf 路由，上报会被 /api/* 兜底吃掉')
  } else if (catchAllIdx < 0) {
    fail('api/boot.ts 找不到 app.all("/api/*") 兜底，无法校验注册顺序')
  } else if (perfIdx > catchAllIdx) {
    fail('Paths.perf 注册在 app.all("/api/*") 之后，会被 404 吞掉')
  } else {
    pass('api/boot.ts 埋点路由注册在 /api/* 兜底之前')
  }
  if (!src.includes('sanitizeSample')) {
    fail('api/boot.ts 未对上报体做白名单清洗（sanitizeSample）')
  }
}

// ── 不变量 4：客户端上报路径与服务端常量一致 ───────────────────────────
{
  const constants = read('contracts/constants.ts')
  const m = constants.match(/perf:\s*["']([^"']+)["']/)
  const client = read('src/lib/perf.ts').match(/PERF_ENDPOINT\s*=\s*["']([^"']+)["']/)
  if (!m) {
    fail('contracts/constants.ts 缺少 Paths.perf')
  } else if (!client) {
    fail('src/lib/perf.ts 缺少 PERF_ENDPOINT 常量')
  } else if (m[1] !== client[1]) {
    fail(`上报路径不一致：服务端 Paths.perf=${m[1]}，客户端 PERF_ENDPOINT=${client[1]}`)
  } else {
    pass(`上报路径两侧一致（${m[1]}）`)
  }
}

console.log()
if (failures > 0) {
  console.error(`冷启动埋点接线校验未通过：${failures} 项`)
  process.exit(1)
}
console.log('冷启动埋点接线校验通过')
