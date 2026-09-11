/**
 * 图片资产校验（QY-PERF-004）
 *
 * 目的：图片引用分布在**三层**，任何一层改名都可能造成线上 404，而构建期
 * 不会报错（public/ 是原样拷贝，Vite 不解析其中的字符串引用）：
 *   1. 前端 src/ 的 <img src> 与数据文件里的路径
 *   2. 服务端 api/ 的兜底常量（如默认头像、默认钓场封面）
 *   3. **db/ 的种子数据**（db/seed.ts 的字面量）——v8.10.0 图片 404 事故正是
 *      漏了这一层：位图改名 .webp 后，数据库已落库的历史路径仍指向旧名。
 *
 * 教训（v8.10.1）：文件名被「代码层 + 数据层」双重固化，改名必须两层一起改。
 * 生产库路径已于 2026-09-12 迁移到 .webp（见 _archive/migrate-images-to-webp.sql），
 * 因此不再需要「旧名兼容副本」；若将来回滚迁移，用 scripts/restore-legacy-images.py
 * 重新生成兼容副本即可。
 *
 * 校验三条：
 *  A. src/、api/、db/ 里出现的每个 `/x.ext` 图片路径，都必须在 public/ 存在；
 *  B. 位图必须已完成瘦身：public/ 下不应再有未经处理的原始 jpg/png
 *     （ALLOW_LEGACY 白名单除外——它们因被 DB 列默认值/服务端常量固化而保留原扩展名，
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

/** 因被数据库**列默认值 / 服务端常量**固化而必须保留原文件名与格式的资产。
 *  内容已原地降采样重编码，仅扩展名不变。新增项须同步 api/ 与迁移 SQL。
 *  数据库**行**里的历史路径已迁移到 .webp，故这里只有两个列默认值保留名。 */
const ALLOW_LEGACY = new Set(['avatar-1.png', 'pond-yunxi-1.jpg'])

/** 被扫描的源码目录：db/ 必须在内（v8.10.0 事故教训——漏扫 db/ 导致漏检） */
const SCAN_DIRS = ['src', 'api', 'db']

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

const unconverted = raster.filter((n) => /\.(jpg|jpeg|png)$/i.test(n) && !ALLOW_LEGACY.has(n))
const staleLegacy = [...ALLOW_LEGACY].filter((n) => !fs.existsSync(path.join(publicDir, n)))

if (unconverted.length === 0) {
  pass(
    `位图均已瘦身（webp ${raster.filter((n) => n.endsWith('.webp')).length} 个；DB 固化保留名 ${ALLOW_LEGACY.size} 个）`,
  )
} else {
  fail('以下位图未处理为 WebP，且不在保留白名单内：')
  for (const n of unconverted) console.error(`        ${n}`)
}
if (staleLegacy.length > 0) {
  fail(`白名单资产已不存在（若 DB 已迁移，请同步从 ALLOW_LEGACY 移除）：${staleLegacy.join(', ')}`)
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
