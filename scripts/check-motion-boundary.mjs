/**
 * 动画能力边界校验（QY-PERF-005）
 *
 * 目的：防止后续迭代无意中把 domMax 的能力（layout / drag / useMotionValue）
 * 引入**首屏静态闭包**，导致 framer-motion 的 LazyMotion 收益静默归零。
 *
 * 校验三条不变量：
 * 1. 首屏静态闭包（index.html → 静态 import 链）中不得出现 layoutId / layout=
 *    / drag= / useMotionValue / useTransform 的**实际使用**。
 * 2. 每个使用了上述能力的**页面**必须在 App.tsx 的 LazyMax 名单里。
 * 3. 产物中 domMax 的实现必须不在 index.html 静态引用的 chunk 内
 *    （即必须是动态 import 的可延迟 chunk）。
 *
 * 用法：node scripts/check-motion-boundary.mjs
 * 已接入 build 前置门禁。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const srcRoot = path.join(root, 'src')
const distPublic = path.join(root, 'dist/public')

let failures = 0
const fail = (msg) => {
  console.error(`FAIL  ${msg}`)
  failures++
}
const pass = (msg) => console.log(`PASS  ${msg}`)

// ── 收集 src 下所有 tsx ────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(p)
  }
  return out
}

/** 能力特征：layout 投影 / drag 手势 / MotionValue 数值驱动 */
const CAPABILITY_PATTERNS = [
  { name: 'layoutId', re: /\blayoutId=/ },
  { name: 'layout=', re: /\blayout=\{?"?(position|size|x|y)/ },
  { name: 'drag=', re: /\bdrag=\{?"?["xy]/ },
  { name: 'useMotionValue', re: /\buseMotionValue\s*\(/ },
  { name: 'useTransform', re: /\buseTransform\s*\(/ },
]

const files = walk(srcRoot)

// ── 不变量 1：首屏静态闭包不得出现高级能力 ────────────────────────────
// 首屏静态闭包 = App.tsx 静态 import 的模块 + 其传递静态依赖
function resolveImports(file, seen = new Set()) {
  if (seen.has(file)) return seen
  seen.add(file)
  const src = fs.readFileSync(file, 'utf8')
  const re = /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g
  let m
  while ((m = re.exec(src))) {
    const spec = m[1]
    if (spec.startsWith('@/')) {
      const base = path.join(srcRoot, spec.slice(2))
      for (const cand of [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand)) {
          resolveImports(cand, seen)
          break
        }
      }
    } else if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(file), spec)
      for (const cand of [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand)) {
          resolveImports(cand, seen)
          break
        }
      }
    }
  }
  return seen
}

// 首屏静态入口：App.tsx 里非 lazy() 的 import
const appSrc = fs.readFileSync(path.join(srcRoot, 'App.tsx'), 'utf8')
const staticEntries = []
const importRe = /(?:^|\n)\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g
let im
while ((im = importRe.exec(appSrc))) {
  const clause = im[1]
  const spec = im[2]
  // lazy(() => import(...)) 的动态导入不在静态闭包内
  if (/lazy\s*\(/.test(clause)) continue
  if (spec.startsWith('@/')) {
    const base = path.join(srcRoot, spec.slice(2))
    for (const cand of [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
      if (fs.existsSync(cand)) {
        staticEntries.push(cand)
        break
      }
    }
  }
}

const firstLoadClosure = new Set()
for (const e of staticEntries) resolveImports(e, firstLoadClosure)

const violations = []
for (const f of firstLoadClosure) {
  const src = fs.readFileSync(f, 'utf8')
  // 剥掉注释与字符串常量，避免文档/注释里的示例被误判
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const cap of CAPABILITY_PATTERNS) {
    if (cap.re.test(code)) {
      violations.push(`${path.relative(root, f)} → ${cap.name}`)
    }
  }
}

if (violations.length === 0) {
  pass(`首屏静态闭包（${firstLoadClosure.size} 个文件）不含 layout/drag/useMotionValue`)
} else {
  fail('首屏静态闭包出现 domAnimation 不覆盖的能力，LazyMotion 收益将被抵消：')
  for (const v of violations) console.error(`        ${v}`)
}

// ── 不变量 2：用到高级能力的页面必须在 LazyMax 名单 ────────────────────
const lazyMaxRoutes = [...appSrc.matchAll(/<LazyMax><(\w+)\s*\/><\/LazyMax>/g)].map((m) => m[1])
const lazyMaxSet = new Set(lazyMaxRoutes)

// 扫描每个页面，看它是否（传递地）依赖高级能力文件
function depsOf(file, seen = new Set()) {
  if (seen.has(file)) return seen
  seen.add(file)
  const src = fs.readFileSync(file, 'utf8')
  const re = /from\s+["']([^"']+)["']/g
  let m
  while ((m = re.exec(src))) {
    const spec = m[1]
    // 别名与相对路径都要跟：只跟 `@/` 会让「页面用 ./X 引进一个 drag 组件」这种
    // 组合完全看不见，不变量 2 就形同虚设（本项目 90% 用 @/，但比例不是保证）。
    let base = null
    if (spec.startsWith('@/')) base = path.join(srcRoot, spec.slice(2))
    else if (spec.startsWith('./') || spec.startsWith('../')) base = path.resolve(path.dirname(file), spec)
    if (!base) continue // 裸包名（react / framer-motion …）不在项目图里
    for (const cand of [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
      if (fs.existsSync(cand)) {
        depsOf(cand, seen)
        break
      }
    }
  }
  return seen
}

const pagesDir = path.join(srcRoot, 'pages')
const pageFiles = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.tsx'))

const missingWrap = []
for (const pf of pageFiles) {
  const pageName = pf.replace(/\.tsx$/, '')
  const full = path.join(pagesDir, pf)
  const src = fs.readFileSync(full, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  // 自己也用了高级能力？
  let needsMax = CAPABILITY_PATTERNS.some((cap) => cap.re.test(code))
  // 或传递依赖了用了高级能力的组件？
  if (!needsMax) {
    for (const dep of depsOf(full)) {
      const dsrc = fs.readFileSync(dep, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      if (CAPABILITY_PATTERNS.some((cap) => cap.re.test(dsrc))) {
        needsMax = true
        break
      }
    }
  }

  if (needsMax && !lazyMaxSet.has(pageName)) {
    missingWrap.push(`${pageName}.tsx 需要 domMax，但 App.tsx 未用 <LazyMax> 包裹`)
  }
}

if (missingWrap.length === 0) {
  pass(`所有需要 domMax 的页面均已包裹（LazyMax: ${lazyMaxRoutes.join(', ')}）`)
} else {
  fail('存在未包裹 domMax 的页面：')
  for (const w of missingWrap) console.error(`        ${w}`)
}

// ── 不变量 3：产物中 domMax 实现不得进入首屏 chunk ────────────────────
if (fs.existsSync(distPublic)) {
  const indexPath = path.join(distPublic, 'index.html')
  const html = fs.readFileSync(indexPath, 'utf8')
  const eagerChunks = [...html.matchAll(/assets\/([A-Za-z0-9_-]+\.js)/g)].map((m) => m[1])

  const assetsDir = path.join(distPublic, 'assets')
  const allChunks = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'))

  // domMax 实现特征：feature bundle 定义（含 renderer + 投影系统）
  const DOM_MAX_SIGNATURE = /useDragControls|projectionNode|as domMax/

  const leaked = []
  for (const c of eagerChunks) {
    const p = path.join(assetsDir, c)
    if (!fs.existsSync(p)) continue
    const src = fs.readFileSync(p, 'utf8')
    // 只认「实现」而非「动态 import 调用点」：动态 import 长的形如
    //   import("./chunk.js")).then(e=>e.domMax)
    // 因此先把动态 import 调用点剔除再检测
    const stripped = src.replace(/import\("\.\/[A-Za-z0-9_-]+\.js"\)[\s\S]{0,80}?\.then\([^)]*\)/g, '')
    if (DOM_MAX_SIGNATURE.test(stripped)) {
      leaked.push(c)
    }
  }

  if (leaked.length === 0) {
    pass(`domMax 实现未进入首屏（静态引用 ${eagerChunks.length} 个 chunk 均为 domAnimation 级）`)
  } else {
    fail(`domMax 实现泄漏进首屏 chunk：${leaked.join(', ')}`)
  }

  // 额外：确认存在一个可延迟的 domMax chunk
  const hasDeferred = allChunks.some((c) => {
    if (eagerChunks.includes(c)) return false
    const src = fs.readFileSync(path.join(assetsDir, c), 'utf8')
    return /as domMax|useDragControls/.test(src)
  })
  if (hasDeferred) pass('存在独立的可延迟 domMax chunk')
  else fail('未找到独立的 domMax chunk —— 动态 import 可能被内联进入口')
} else {
  console.log('SKIP  产物校验（dist/public 不存在，请先 vite build）')
}

console.log()
if (failures > 0) {
  console.error(`动画能力边界校验未通过：${failures} 项`)
  process.exit(1)
}
console.log('动画能力边界校验通过')
