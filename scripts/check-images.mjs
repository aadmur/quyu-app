/**
 * 图片资产校验（QY-PERF-004 / 修复 v8.10.1）
 *
 * 目的：图片引用分布在**四层**，任何一层改名都可能造成线上 404，而构建期
 * 不会报错（public/ 是原样拷贝，Vite 不解析其中的字符串引用）：
 *   1. 前端 src/ 的 <img src> 与数据文件里的路径
 *   2. 服务端 api/ 的兜底常量（如默认头像、默认钓场封面）
 *   3. **db/ 的种子数据**（db/seed.ts 的字面量）
 *   4. **已经落进数据库的历史行**（posts.images / author_avatar、products.image、
 *      ponds.cover、reviews.images …）——第 4 层无法在构建期读取，
 *      由 scripts/image-legacy-compat.json 这份**清单**代为声明
 *
 * 教训：v8.10.0 上线时只覆盖了 1、2 层，把位图改名为 .webp 之后第 3、4 层
 * 全部 404，线上「图片都加载不出来」。因此本文件新增 D 段校验，并**强制**
 * 扫描 db/。
 *
 * 校验四条：
 *  A. src/、api/、db/ 里出现的每个 `/x.ext` 图片路径，都必须在 public/ 存在；
 *  B. 位图必须已完成瘦身：除了 ALLOW_LEGACY（因 DB 默认值固化而保留原名）
 *     与 image-legacy-compat.json 清单内的兼容副本外，不应再有原始 jpg/png；
 *  C. 体积预算：public/ ≤ 2.6 MB（含兼容副本）；
 *  D. 兼容副本清单完整性：清单内每个路径都必须存在，且必须有同名 .webp 孪生
 *     （防止有人删掉 webp 只留兼容副本，把「兼容」变成「唯一」）。
 *
 * 用法：node scripts/check-images.mjs（已接入 build 前置门禁）
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const publicDir = path.join(root, 'public')
const manifestPath = path.join(__dirname, 'image-legacy-compat.json')

/** 因被数据库**列默认值 / 服务端常量**固化而必须保留原文件名与格式的资产
 *  （它们没有 .webp 孪生，是永久保留项）。新增项须同步 api/ 与迁移 SQL。
 *  — 数据库**行**里的历史路径不写在这里，走 image-legacy-compat.json。 */
const ALLOW_LEGACY = new Set(['avatar-1.png', 'pond-yunxi-1.jpg'])

/** 被扫描的源码目录：db/ 必须在内，否则种子数据的旧路径引用会漏检 */
const SCAN_DIRS = ['src', 'api', 'db']

const BUDGET_PUBLIC_KB = 2662 // 2.6 MB（含 29 个兼容副本 ≈ 985 KB）

let failures = 0
const fail = (m) => {
  console.error(`FAIL  ${m}`)
  failures++
}
const pass = (m) => console.log(`PASS  ${m}`)

// ── 兼容副本清单 ───────────────────────────────────────────────────────
let compatPaths = []
if (!fs.existsSync(manifestPath)) {
  fail('scripts/image-legacy-compat.json 不存在（数据库历史路径无声明，无法校验）')
} else {
  try {
    const j = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    compatPaths = Array.isArray(j.paths) ? j.paths : []
    if (compatPaths.length === 0) fail('image-legacy-compat.json 的 paths 为空')
  } catch (e) {
    fail(`image-legacy-compat.json 解析失败：${e.message}`)
  }
}
const compatNames = new Set(compatPaths.map((p) => path.basename(p)))

// ── 收集源码中被引用的图片路径 ────────────────────────────────────────
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const REF_RE = /["'`](\/[A-Za-z0-9_-]+\.(?:webp|jpg|jpeg|png|svg))["'`]/g
const referenced = new Map() // path → [files]

for (const dir of SCAN_DIRS) {
  for (const f of walk(path.join(root, dir))) {
    const src = fs.readFileSync(f, 'utf8')
    let m
    while ((m = REF_RE.exec(src))) {
      const rel = path.relative(root, f)
      if (!referenced.has(m[1])) referenced.set(m[1], [])
      referenced.get(m[1]).push(rel)
    }
  }
}

// ── A. 引用可达性（src/ + api/ + db/） ────────────────────────────────
const missing = []
for (const [p, sources] of referenced) {
  if (!fs.existsSync(path.join(publicDir, p.slice(1)))) {
    missing.push(`${p}  ← ${[...new Set(sources)].join(', ')}`)
  }
}

if (missing.length === 0) {
  pass(`图片引用全部可达（${referenced.size} 个路径，来自 ${SCAN_DIRS.join('/')}）`)
} else {
  fail('存在指向不存在文件的图片引用（线上会 404）：')
  for (const m of missing) console.error(`        ${m}`)
}

// ── B. 位图瘦身覆盖率 ─────────────────────────────────────────────────
const raster = fs
  .readdirSync(publicDir, { withFileTypes: true })
  .filter((e) => e.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(e.name))
  .map((e) => e.name)

const unconverted = raster.filter(
  (n) =>
    /\.(jpg|jpeg|png)$/i.test(n) && !ALLOW_LEGACY.has(n) && !compatNames.has(n),
)
const staleLegacy = [...ALLOW_LEGACY].filter(
  (n) => !fs.existsSync(path.join(publicDir, n)),
)

if (unconverted.length === 0) {
  pass(
    `位图均已瘦身（webp ${raster.filter((n) => n.endsWith('.webp')).length} 个；` +
      `DB 固化名 ${ALLOW_LEGACY.size} 个；兼容副本 ${compatNames.size} 个）`,
  )
} else {
  fail('以下位图未处理为 WebP，且不在保留白名单/兼容清单内：')
  for (const n of unconverted) console.error(`        ${n}`)
}
if (staleLegacy.length > 0) {
  fail(
    `白名单资产已不存在（若 DB 已迁移，请同步从 ALLOW_LEGACY 移除）：${staleLegacy.join(', ')}`,
  )
}

// ── D. 兼容副本清单完整性 ─────────────────────────────────────────────
const compatMissing = []
const compatNoTwin = []
for (const p of compatPaths) {
  const name = path.basename(p)
  const file = path.join(publicDir, name)
  if (!fs.existsSync(file)) {
    compatMissing.push(p)
    continue
  }
  const twin = name.replace(/\.(jpg|jpeg|png)$/i, '.webp')
  if (!fs.existsSync(path.join(publicDir, twin))) compatNoTwin.push(`${p}（缺 ${twin}）`)
}

if (compatMissing.length === 0 && compatNoTwin.length === 0) {
  pass(`兼容副本清单完整（${compatPaths.length} 个旧路径均可达，且都有 .webp 孪生）`)
} else {
  if (compatMissing.length > 0) {
    fail('兼容副本缺失（数据库里的历史路径会 404，图片将加载不出来）：')
    for (const m of compatMissing) console.error(`        ${m}`)
  }
  if (compatNoTwin.length > 0) {
    fail('兼容副本缺同名 .webp 孪生（该名字已成唯一副本，改名/清理会连带失效）：')
    for (const m of compatNoTwin) console.error(`        ${m}`)
  }
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
