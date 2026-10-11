/**
 * @layer Ops 脚本 —— 一键聚合校验（v14 收尾）
 * @file scripts/verify-all.mjs
 *
 * 为什么要有它：本轮发现 `scripts/smoke.ts` 的 §3–§7 **从来没跑过**（§2 必抛，且它没挂在任何
 * npm 脚本上）。教训是"没被入口引用的测试会安静地腐烂"。而现在校验项已经散成 9 个命令
 * （tsc / eslint / vitest / 5 个 check-* / verify:smoke / verify:images / verify:static），
 * 记不住就等于不会跑——所以给一个总入口，并且**规定：跳过必须显式说明理由，
 * 绝不能靠"没跑"伪装成"通过"**（本轮我在覆盖率脚本上就犯过"匹配到 0 条却报告 0 失败"）。
 *
 * 用法：
 *   node scripts/verify-all.mjs                 # 只跑不依赖外部服务的静态门禁
 *   node scripts/verify-all.mjs --db            # 追加依赖数据库的冒烟（需 .env.smoke 可达）
 *   node scripts/verify-all.mjs --server        # 追加依赖真实服务的静态/载荷校验（会自起服务）
 *   node scripts/verify-all.mjs --strict        # 任何 SKIP 也算失败（给 CI 用）
 *
 * 退出码：0 = 跑掉的都通过；1 = 有失败项，或在 --strict 下存在跳过项。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const want = (flag) => process.argv.includes(flag)
const strict = want('--strict')

const SUITE = [
  // 两个 shell 演练：Windows 上 spawnSync('bash') 能不能命中取决于 Git Bash 是否在 PATH，
  // 命不中会以 exit=-1 出现——那是**探针失败**，不能读成"演练通过"，所以下面把 -1 单独说明。
  { name: '回滚演练（v14 夹具）', cmd: 'bash', args: ['scripts/v14-rollback-drill.sh'], needs: 'static' },
  { name: '部署闸门演练（v15 夹具）', cmd: 'bash', args: ['scripts/v15-deploy-drill.sh'], needs: 'static' },
  { name: 'tsc 类型检查', cmd: 'node', args: ['node_modules/typescript/bin/tsc', '-b'], needs: 'static' },
  { name: 'eslint', cmd: 'node', args: ['node_modules/eslint/bin/eslint.js', '.'], needs: 'static' },
  { name: '单元测试（vitest）', cmd: 'node', args: ['node_modules/vitest/vitest.mjs', 'run'], needs: 'static' },
  { name: '字体预算', cmd: 'node', args: ['scripts/check-fonts.mjs'], needs: 'static' },
  { name: '图片引用与预算', cmd: 'node', args: ['scripts/check-images.mjs'], needs: 'static' },
  { name: '埋点接线', cmd: 'node', args: ['scripts/check-perf-wiring.mjs'], needs: 'static' },
  { name: '知识库规则', cmd: 'node', args: ['--import', 'tsx', 'scripts/check-knowledge.ts'], needs: 'static' },
  { name: '动画能力边界', cmd: 'node', args: ['scripts/check-motion-boundary.mjs'], needs: 'static' },
  { name: '计划条目可追溯性', cmd: 'node', args: ['scripts/check-plan-coverage.mjs', '--strict'], needs: 'static' },
  { name: '文档指针有效性', cmd: 'node', args: ['scripts/check-doc-pointers.mjs'], needs: 'static' },
  { name: '直跑版迁移静态核对', cmd: 'node', args: ['scripts/check-run-sql.mjs'], needs: 'static' },
  { name: '真实库冒烟（smoke.ts）', cmd: 'node', args: ['--env-file=.env.smoke', '--import', 'tsx', 'scripts/smoke.ts'], needs: 'db' },
  { name: '图片发布链路冒烟', cmd: 'node', args: ['--env-file=.env.smoke', '--import', 'tsx', 'scripts/smoke-images.ts'], needs: 'db' },
  { name: '静态协商与体积预算（起服务）', cmd: 'node', args: ['--env-file=.env.smoke', 'scripts/smoke-static.mjs'], needs: 'server' },
]

const wanted = new Set(['static'])
if (want('--db')) wanted.add('db')
if (want('--server')) wanted.add('server')

if (!fs.existsSync(path.join(root, '.env.smoke'))) {
  console.log('提示：缺少 .env.smoke，依赖数据库/服务的校验都会被显式 SKIP（不会当作通过）')
}

const rows = []
let failed = 0
let skipped = 0
for (const step of SUITE) {
  if (!wanted.has(step.needs)) {
    skipped += 1
    rows.push(['SKIP', step.name, `未开启（跑它需要 --${step.needs === 'db' ? 'db' : 'server'}）`])
    continue
  }
  const r = spawnSync(step.cmd, step.args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const code = r.status ?? -1
  if (code === 0) {
    rows.push(['PASS', step.name, ''])
  } else {
    failed += 1
    const tail = ((r.stderr || r.stdout || '').trim().split('\n').filter(Boolean).slice(-3) || []).join(' / ')
    rows.push(['FAIL', step.name, `exit=${code}  ${tail.slice(0, 160)}`])
  }
}

const width = Math.max(...rows.map((r) => r[1].length))
console.log('\n聚合校验结果：')
for (const [st, name, note] of rows) console.log(`  ${st.padEnd(4)} ${name.padEnd(width)}  ${note}`)
console.log(`\n  通过 ${rows.filter((x) => x[0] === 'PASS').length} / 失败 ${failed} / 跳过 ${skipped}`)

if (failed > 0) {
  console.error('结论：有失败项')
  process.exitCode = 1
} else if (strict && skipped > 0) {
  console.error(`结论：--strict 下 ${skipped} 项被跳过，视为未覆盖`)
  process.exitCode = 1
} else {
  console.log('结论：已运行的校验全部通过' + (skipped ? `（${skipped} 项按开关跳过，非通过）` : ''))
  process.exitCode = 0
}
