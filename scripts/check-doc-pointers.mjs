#!/usr/bin/env node
/**
 * @layer Ops 脚本 —— 核对文档里的指针是否还指着真实存在的东西
 * @file scripts/check-doc-pointers.mjs
 *
 * 为什么需要：本轮交付过程中我自己写错过好几处文档指针——猜过 `#app`（实际 `#root`）、
 * 猜过过程名 `commentList`（实际 `posts.comments`）、写过 `SHA_EXPECTED=$(sha256sum …)`
 * 这种"看起来是指令其实什么都不做"的话、还把"必须带 cookie"当成前置条件。
 * 这些都靠人眼复核不了：交接文档有几百行，下一个人只会照着敲。
 * 这里只判**机械可判**的一类：反引号里的路径、`file.ts:123` 这样的行号锚点、`npm run xxx` 脚本名。
 * 明确判不到的：句子的语义对不对、结论是否被实测支持（那要人读）。
 *
 * 用法：node scripts/check-doc-pointers.mjs [--verbose]
 * 退出码 = 失效指针数（0 = 全部指得中）。解析数为 0 时按探针失效处理，不当通过。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const verbose = process.argv.includes('--verbose')

const DOCS = [
  ['app/CHANGELOG.md', join(root, 'CHANGELOG.md')],
  ['docs/NEXT-ITERATION.md', join(root, '../docs/NEXT-ITERATION.md')],
  ['app/docs/verification/v14-证据索引.md', join(root, 'docs/verification/v14-证据索引.md')],
  ['app/docs/agile/product-backlog.md', join(root, 'docs/agile/product-backlog.md')],
]
const present = DOCS.filter(([, p]) => existsSync(p))
// --only <file>：只扫指定文件，给变异测试用（也方便以后按文件跑）。
const onlyIdx = process.argv.indexOf('--only')
if (onlyIdx >= 0 && process.argv[onlyIdx + 1]) {
  const p = resolve(process.argv[onlyIdx + 1])
  if (!existsSync(p)) {
    console.error(`FAIL  --only 指向不存在的文件 ${p}`)
    process.exit(1)
  }
  present.length = 0
  present.push([p, p])
}
if (present.length === 0) {
  console.error('FAIL  一份文档都读不到——探针没跑起来，这不是"通过"')
  process.exitCode = 1
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const scripts = new Set(Object.keys(pkg.scripts || {}))
// 根目录的 docs/ 不在 git 里，所以本仓库单独被 clone 时这些文件不存在：
// 指针只在"文档确实提到且该路径本应存在于本仓库"时才判失败。
const knownRoots = ['api/', 'src/', 'scripts/', 'db/', 'docs/', 'contracts/', '.github/']
// 历史遗留指针：文件确实被删了，但文档是在叙述当时那次事故，删掉文字等于篡改历史。
// 这类只能显式豁免并注明来由，不能靠"整段跳过"糊过去（否则真失效也会被同类跳过）。
const HISTORICAL = new Map([
  ['scripts/image-legacy-compat.json', '兼容副本与其清单已在 c39b1c1 一并下线；CHANGELOG/交接文档里的提及属事故叙述'],
])

let checked = 0
const dead = []
const exempt = new Set()
const seen = new Set()

for (const [docName, p] of present) {
  const text = readFileSync(p, 'utf8')
  const lines = text.split(/\r?\n/)

  lines.forEach((line, i) => {
    // ① 反引号包裹的内容里挑路径与脚本名
    for (const m of line.matchAll(/`([^`\n]{2,160})`/g)) {
      const tok = m[1].trim()

      // `api/foo.ts:12` 或 `scripts/x.mjs`（可能带 :: 符号后缀，按前段取路径）
      // 扩展名交替必须带**尾边界**，否则 `json` 会被 `js` 抢先截断、`tsx` 会被 `ts` 截断
      // ——第一版就是这么把三份完好文档判成失效的（`(ts|tsx)` 与 `(js|json)` 两处同型错误）。
      const pathPart = tok.split('::')[0].trim().match(/^([A-Za-z0-9_./-]+\.(?:tsx|jsx|json|mjs|cjs|yml|yaml|sql|html|css|md|ts|js|sh|py|png|webp)(?![A-Za-z0-9]))(?::(\d+))?/)
      if (pathPart && knownRoots.some((r) => pathPart[1].startsWith(r) || pathPart[1].startsWith('app/' + r))) {
        const rel = pathPart[1].replace(/^app\//, '')
        // 根 docs/ 不在仓库里（本项目的已知结构）：`docs/NEXT-ITERATION.md` 这类引用可能指向上层
        // 项目目录，两处都试，都不在才算失效。
        const target = existsSync(join(root, rel)) ? join(root, rel) : join(root, '..', rel)
        checked++
        if (!existsSync(target)) {
          if (HISTORICAL.has(rel)) exempt.add(rel)
          else dead.push(`${docName}:${i + 1} 指向不存在的文件 ${rel}`)
        }
        else if (pathPart[2]) {
          const n = Number(pathPart[2])
          const total = readFileSync(target, 'utf8').split(/\r?\n/).length
          checked++
          if (n > total) dead.push(`${docName}:${i + 1} 行号锚点 ${rel}:${n} 超出文件长度（共 ${total} 行）`)
        }
        continue
      }

      // 只写目录的引用（`db/migrations`、`apk-shell/` 这类），存在性同样可判
      const dirPart = tok.match(/^([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)\/$/)
      if (dirPart && knownRoots.concat(['apk-shell/', 'uploads/']).some((r) => dirPart[1].startsWith(r.replace(/\/$/, '')))) {
        const rel = dirPart[1].replace(/^app\//, '')
        if (rel === 'apk-shell') continue // 明确不在 git 里，文档已注明
        checked++
        if (!existsSync(join(root, rel))) dead.push(`${docName}:${i + 1} 指向不存在的目录 ${rel}/`)
      }
    }

    // ② `npm run xxx` 的脚本名必须真的在 package.json 里
    for (const m of line.matchAll(/npm run ([a-zA-Z][a-zA-Z0-9:_-]*)/g)) {
      checked++
      if (!scripts.has(m[1])) dead.push(`${docName}:${i + 1} 引用了不存在的脚本 npm run ${m[1]}`)
    }
  })
}

const uniq = [...new Set(dead)]
if (checked === 0) {
  console.error('FAIL  一条指针都没解析到——判据不可信（文档格式又变了？），不算通过')
  process.exitCode = 1
} else {
  console.log(`解析到 ${checked} 处可机械核对的文档指针，覆盖 ${present.map(([n]) => n).join(', ')}`)
  // 豁免必须打印出来：看不见名单，就等于有人往名单里塞真失效也不被发现。
  // （对 Set<string> 用 `[rel, why]` 解构会逐字符拆开，第一次就打印成 "s"——自己刚立的
  // "少解析=少检查要报红"，轮到我自己先把打印内容核对过再说。）
  for (const rel of exempt) console.log(`EXEMPT ${rel} ← ${HISTORICAL.get(rel) ?? '未注明来由（不该存在）'}`)
  if (uniq.length === 0) console.log('DOC POINTERS OK：全部指得中')
  else {
    for (const d of uniq) console.log(`FAIL  ${d}`)
    console.log(`DOC POINTERS FAILED：${uniq.length} 处失效`)
  }
}
if (verbose) console.log(`（提示：本检查不判断语义——句子对不对仍要人读）`)
process.exitCode = uniq.length > 0 ? 1 : (process.exitCode ?? 0)
