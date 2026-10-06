/**
 * @layer Ops 脚本 —— 计划条目可追溯性报告（v14 收尾时新增）
 * @file scripts/check-plan-coverage.mjs
 *
 * 起因：交付前做完成审计时发现，计划文档里的 ✅ 是**自评分**——
 * `grep -rl QY-xxx src api db` 对 31 条里的 30 条**零命中**，CHANGELOG 里也只引用了 10 条。
 * 也就是说"某项已完成"目前无法机械复核，只能靠读叙述。这不等于没做，但等于没有证据链。
 *
 * 本脚本把这条缺口变成可量化的报告：每个 QY 号必须在下列之一留下锚点
 *   1) 代码/迁移/脚本里出现该号（真正的实现锚点）
 *   2) CHANGELOG / NEXT-ITERATION / backlog 里出现该号（叙述性证据，弱一档）
 * 两者都没有 → 计入"零证据"。
 *
 * 刻意**不**做成 fail-the-build 门禁（现在跑必然红），先当报告用；
 * 补齐锚点后由 backlog B-31 把它升级成硬门禁（exit 1）。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const planPath = path.resolve(root, '../docs/产品/迭代计划-v14-草案.md')
const CODE_DIRS = ['src', 'api', 'db', 'contracts', 'scripts']
/**
 * 「叙述证据」只认 CHANGELOG：那里写的是实测过程（浏览器探针、真库冒烟、单测结果）。
 * 曾把 backlog / NEXT-ITERATION / CONTEXT 也算作证据源，结果只是「在文档里抄了一份 ID 清单」
 * 就能把零证据数刷成 0——本文件自己就中过一次这个招（写续接说明时粘了 21 个号，指标立刻变好看）。
 * 指标必须只能被「真的留下证据」改善，不能被「提到这件事」改善。
 */
const DOC_FILES = ['CHANGELOG.md']

const plan = fs.readFileSync(planPath, 'utf8')
const ids = [...new Set(plan.match(/QY-[A-Z]+-\d+/g) ?? [])].sort()

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs|js|sql|json)$/.test(e.name)) out.push(full)
  }
  return out
}

const codeFiles = CODE_DIRS.flatMap((d) => walk(path.join(root, d), []))
const docTexts = DOC_FILES.map((f) => {
  const p = path.join(root, f)
  return fs.existsSync(p) ? { f, text: fs.readFileSync(p, 'utf8') } : null
}).filter(Boolean)

let strong = 0
let narrative = 0
const zero = []
for (const id of ids) {
  const inCode = codeFiles.filter((f) => fs.readFileSync(f, 'utf8').includes(id))
  const inDocs = docTexts.filter((d) => d.text.includes(id))
  if (inCode.length) strong++
  else if (inDocs.length) narrative++
  else zero.push(id)
}

console.log(`计划条目 ${ids.length} 条：代码锚点 ${strong}，仅文档叙述 ${narrative}，零证据 ${zero.length}`)
if (zero.length) console.log('零证据条目：', zero.join(', '))
console.log(
  '说明：零证据 ≠ 未实现，而是「无法机械复核」。要补的是锚点（代码注释里的 QY 号，或在 CHANGELOG 第八/十节写上该号）。',
)
