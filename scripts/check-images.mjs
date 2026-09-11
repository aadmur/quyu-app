/**
 * 图片资产校验（QY-PERF-004）
 *
 * 目的：图片引用分布在三层，任何一层改名都可能造成线上 404，而构建期
 * 不会报错（public/ 是原样拷贝，Vite 不解析其中的字符串引用）：
 *   1. 前端 src/ 的 <img src> 与数据文件里的路径
 *   2. 服务端 api/ 的兜底常量（如默认头像、默认钓场封面）
 *   3. 数据库列默认值（posts.author_avatar）——历史行里已存了旧路径
 *
 * 校验三条：
 *  A. src/ 与 api/ 里出现的每个 `/x.ext` 图片路径，都必须在 public/ 存在；
 *  B. 位图必须已完成瘦身：public/ 下不应再有未经处理的原始 jpg/png
 *     （ALLOW_LEGACY 白名单除外——它们因被 DB/服务端固化而保留原扩展名，
 *      但内容已原地降采样重编码）；
 *  C. 体积预算：public/ ≤ 1.2 MB。
 *
 * 用法：node scripts/check-images.mjs（已接入 build 前置门禁）
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const publicDir = path.join(root, 'public')

/** 因被数据库默认值 / 服务端常量固化而**必须保留原文件名与格式**的资产。
 *  内容已原地降采样重编码，仅扩展名不变。新增项须同步 api/ 与迁移 SQL。 */
const ALLOW_LEGACY = new Set(['avatar-1.png', 'pond-yunxi-1.jpg'])

const BUDGET_PUBLIC_KB = 1228 // 1.2 MB

let failures = 0
const fail = (m) => {
  console.error(`FAIL  ${m}`)
  failures++
}
const pass = (m) => console.log(`PASS  ${m}`)

// ── 收集源码中被引用的图片路径 ────────────────────────────────────────
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const REF_RE = /["'`](\/[A-Za-z0-9_-]+\.(?:webp|jpg|jpeg|png|svg))["'`]/g
const referenced = new Map() // path → [files]

for (const f of [...walk(path.join(root, 'src')), ...walk(path.join(root, 'api'))]) {
  const src = fs.readFileSync(f, 'utf8')
  let m
  while ((m = REF_RE.exec(src))) {
    const rel = path.relative(root, f)
    if (!referenced.has(m[1])) referenced.set(m[1], [])
    referenced.get(m[1]).push(rel)
  }
}

// ── A. 引用可达性 ─────────────────────────────────────────────────────
const missing = []
for (const [p, sources] of referenced) {
  if (!fs.existsSync(path.join(publicDir, p.slice(1)))) {
    missing.push(`${p}  ← ${[...new Set(sources)].join(', ')}`)
  }
}

if (missing.length === 0) {
  pass(`图片引用全部可达（${referenced.size} 个路径，来自 src/ 与 api/）`)
} else {
  fail('存在指向不存在文件的图片引用（线上会 404）：')
  for (const m of missing) console.error(`        ${m}`)
}

// ── B. 位图瘦身覆盖率 ─────────────────────────────────────────────────
const raster = fs
  .readdirSync(publicDir, { withFileTypes: true })
  .filter((e) => e.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(e.name))
  .map((e) => e.name)

const unconverted = raster.filter((n) => /\.(jpg|jpeg|png)$/i.test(n) && !ALLOW_LEGACY.has(n))
const staleLegacy = [...ALLOW_LEGACY].filter((n) => !fs.existsSync(path.join(publicDir, n)))

if (unconverted.length === 0) {
  pass(`位图均已瘦身（webp ${raster.filter((n) => n.endsWith('.webp')).length} 个；白名单保留 ${ALLOW_LEGACY.size} 个）`)
} else {
  fail(`以下位图未处理为 WebP，且不在保留白名单内：`)
  for (const n of unconverted) console.error(`        ${n}`)
}
if (staleLegacy.length > 0) {
  fail(`白名单资产已不存在（若 DB 已迁移到 .webp，请同步从 ALLOW_LEGACY 移除）：${staleLegacy.join(', ')}`)
}

// ── C. 体积预算 ───────────────────────────────────────────────────────
let total = 0
for (const e of fs.readdirSync(publicDir, { withFileTypes: true, recursive: true })) {
  const p = e.parentPath ? path.join(e.parentPath, e.name) : path.join(publicDir, e.name)
  if (e.isFile()) total += fs.statSync(p).size
}
const kb = Math.round((total / 1024) * 10) / 10
if (kb <= BUDGET_PUBLIC_KB) pass(`public/ 体积 ${kb} KB ≤ ${BUDGET_PUBLIC_KB} KB`)
else fail(`public/ 体积 ${kb} KB 超出预算 ${BUDGET_PUBLIC_KB} KB`)

console.log()
if (failures > 0) {
  console.error(`图片资产校验未通过：${failures} 项`)
  process.exit(1)
}
console.log('图片资产校验通过')
