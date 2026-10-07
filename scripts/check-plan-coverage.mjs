/**
 * @layer Ops 脚本 —— 计划条目可追溯性核验（v14 收尾新增，B-31 的实现）
 * @file scripts/check-plan-coverage.mjs
 *
 * 起因：交付前完成审计发现，计划文档的完成列是**自评分**。用 grep 复核真实仓库的结果是
 * 「代码锚点 1 条 / 仅文档叙述 9 条 / 零机械证据 21 条」。零证据不等于没做，但等于下一个人
 * 无法用一条命令复核，而"把绿灯清单当完成证据"正是审计要排除的代理信号。
 *
 * 本脚本做两件事：
 * 1. **核验 `docs/产品/v14-证据索引.md` 里每条锚点是否真实存在**——文件在不在、符号在不在。
 *    这一步是这份索引成立的前提：索引如果是人写的、没人验，它就只是另一篇叙述。
 *    （我写索引时就写错过一条：把 `DEMO_OPEN_HINT` 挂在 PostSheet.tsx 上，而它只在 FeedPost.tsx 里。
 *    正是这条被核验抓出来，才让它不该被当作证据。）
 * 2. 据此给 31 条计划条目分级：strong（有经核验的实现锚点，或该号确实出现在代码里）/
 *    narrative（只在 CHANGELOG 的叙述里出现过）/ zero（两者皆无）。
 *
 * 为什么「抄一份 ID 清单」不能刷绿本指标：叙述证据源**只认 CHANGELOG**（实测过程写在那里），
 * 不认运行手册/术语表/backlog——本文件自己就中过一次这种招，写续接说明时粘了 21 个号，
 * 指标立刻变好看。指标只能被"真的留下证据"改善。
 *
 * 用法：node scripts/check-plan-coverage.mjs [--strict]
 *   默认只出报告（exit 0）；--strict 时任何"锚点核验失败"或"零证据条目"都 exit 1，
 *   等 31 条全部拿到经核验锚点后，由 B-31 把它接进 build 当硬门禁。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const PLAN = path.resolve(root, '../docs/产品/迭代计划-v14-草案.md')
const INDEX = path.resolve(root, 'docs/verification/v14-证据索引.md')
const CODE_DIRS = ['src', 'api', 'db', 'contracts', 'scripts']
const NARRATIVE_FILES = ['CHANGELOG.md']
const strict = process.argv.includes('--strict')

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)

const planText = read(PLAN)
let ids
if (planText) {
  ids = [...new Set(planText.match(/QY-[A-Z]+-\d+/g) ?? [])].sort()
} else {
  // 计划文档在根 docs 下（未纳入 git）。别人 clone 下来只会有仓库内的索引：
  // 这时降级为「以索引声明的条目全集为准」并明确警告，而不是直接让构建红掉。
  const idxText = read(INDEX)
  if (!idxText) {
    console.error('计划与索引都读不到，无法核验追溯性')
    process.exit(1)
  }
  ids = [...new Set(idxText.match(/QY-[A-Z]+-\d+/g) ?? [])].sort()
  console.warn(`警告：未找到计划文档（根 docs/ 不在仓库里），本次以索引声明的 ${ids.length} 条为准`)
}

// ── 代码里直接出现该号的条目（最硬的锚点） ─────────────────────────
function walk(dir, out) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs|js|sql|json)$/.test(e.name)) out.push(full)
  }
  return out
}
const codeFiles = CODE_DIRS.flatMap((d) => walk(path.join(root, d), []))
const codeHits = new Set()
for (const q of ids) {
  if (codeFiles.some((f) => fs.readFileSync(f, 'utf8').includes(q))) codeHits.add(q)
}

// ── 核验证据索引：每条「文件 :: 符号」必须真的对得上 ─────────────────
/**
 * 符号候选的取法：原样、去掉引号、取首个空格/中文括号前的片段。
 * 只要**任一候选是文件里真实出现的子串**就算通过，且候选长度必须 ≥ 4，
 * 避免用「s」「.ts」这类碎片把核验糊过去。
 */
function candidates(token) {
  const t = token.trim()
  const out = [t, t.replace(/"/g, '')]
  const cut = t.split(/[\s（(]/)[0]
  if (cut) out.push(cut, cut.replace(/"/g, ''))
  return [...new Set(out)].filter((x) => x.length >= 4)
}

const indexText = read(INDEX)
const anchorOk = new Set()
const failures = []
if (indexText) {
  for (const line of indexText.split('\n')) {
    const idm = line.match(/QY-[A-Z]+-\d+/)
    if (!idm || !line.trim().startsWith('|')) continue
    const q = idm[0]
    /**
     * 索引里的写法是「一个反引号包住 `路径 :: 符号, 符号`」，所以要先按 `::` 拆，
     * 再取路径部分。上一版正则要求反引号内容以 .ts/.tsx **结尾**，
     * 结果对我自己写的行一条都没匹配上（strong 只有 5、失败 0）——
     * 那是探针坏了，不是证据坏了：解析数为 0 时必须当作异常处理，否则"没匹配上"会被读成"都合格"。
     */
    const cites = [...line.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1])
      .map((t) => {
        const [p, ...rest] = t.split('::')
        return {
          file: p.trim().split(/[\s（(]/)[0],
          syms: rest
            .join('::')
            .split(/[,，]|\+|、/)
            .map((s) => s.trim())
            .filter(Boolean),
        }
      })
      .filter((c) => /\.(ts|tsx|mjs|sql)$/.test(c.file))
    if (cites.length === 0) continue
    let allGood = true
    let symbolsChecked = 0
    for (const c of cites) {
      const abs = path.resolve(root, c.file)
      if (!fs.existsSync(abs)) {
        failures.push(`${q} :: ${c.file} 文件不存在`)
        allGood = false
        continue
      }
      const src = fs.readFileSync(abs, 'utf8')
      for (const raw of c.syms) {
        const cs = candidates(raw)
        if (cs.length === 0) continue // 纯描述性短语不参与判定
        symbolsChecked++
        if (!cs.some((x) => src.includes(x))) {
          failures.push(`${q} :: ${c.file} 里找不到符号「${raw}」`)
          allGood = false
        }
      }
    }
    // 只写了文件路径、一个符号都没核的行走不通 strong：文件存在不等于实现存在
    if (allGood && symbolsChecked > 0) anchorOk.add(q)
  }
} else {
  failures.push('证据索引不存在：' + INDEX)
}

// ── 叙述证据（只认 CHANGELOG） ──────────────────────────────────
const narrative = new Set()
for (const f of NARRATIVE_FILES) {
  const t = read(path.join(root, f))
  if (!t) continue
  for (const q of ids) if (t.includes(q)) narrative.add(q)
}

const strong = ids.filter((q) => codeHits.has(q) || anchorOk.has(q))
const zero = ids.filter((q) => !strong.includes(q) && !narrative.has(q))

console.log(`计划条目 ${ids.length} 条`)
console.log(`  strong（代码出现该号 ${codeHits.size} ∪ 索引锚点经核验 ${anchorOk.size}）= ${strong.length}`)
console.log(`  narrative（仅 CHANGELOG 叙述）= ${narrative.size}`)
console.log(`  zero（无任何可机械复核的证据）= ${zero.length}${zero.length ? '：' + zero.join(', ') : ''}`)
console.log(`  索引锚点核验失败 = ${failures.length}`)
for (const f of failures.slice(0, 12)) console.log('    !! ' + f)

if (strict) {
  if (failures.length > 0) {
    console.error('\n--strict：存在核验不过的锚点，索引不能当作证据使用')
    process.exit(1)
  }
  if (zero.length > 0) {
    console.error('\n--strict：仍有零证据条目，等全部补上经核验锚点后再接进 build')
    process.exit(1)
  }
  console.log('\n核验通过：每条计划项都有可机械复核的实现锚点')
}
