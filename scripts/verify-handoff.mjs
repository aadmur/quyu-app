#!/usr/bin/env node
/**
 * 上线前"交接物"自检：把交付时刻依赖的每个事实都变成能变红的断言。
 * 为什么要它：这次上线是"一次性的"，而它依赖的东西散在仓库外（产物 tar）与仓库内（三个脚本、
 * 迁移 SQL、文档里的 sha）。这类"文档写一个 sha、磁盘上是另一个"的漂移本项目已经踩过一次
 * （服务器上的 ca1c4a00… 因机审返工而失效）。凡是这里能机械核对的，就不该留给人眼。
 *
 * 用法：node scripts/verify-handoff.mjs [--tar E:/tmp/dist-v8.12.0-r8.tar.gz]
 * 退出码 = 失败项数；OPEN 项（只有真机/真实云账号能验的）不计失败，但会明确列出来。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}

let fails = 0
let opens = 0
const pass = (m, extra) => console.log(`  PASS  ${m}${extra ? '  ' + extra : ''}`)
const bad = (m, extra) => {
  fails += 1
  console.log(`  FAIL  ${m}${extra ? '  ' + extra : ''}`)
}
const open = (m, extra) => {
  opens += 1
  console.log(`  OPEN  ${m}${extra ? '  ' + extra : ''}`)
}
const shasum = (buf) => createHash('sha256').update(buf).digest('hex')
// Git Bash 的 tar 会把 `E:\tmp\x.tar` 读成"远程主机 E:"，必须先转成 /e/tmp/x.tar。
// node 自己的 fs 不受影响，所以只有传给子进程的路径要转。
const forSh = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):\/+/, (_m, d) => '/' + d.toLowerCase() + '/')

const TAR = resolve(arg('tar', 'E:/tmp/dist-v8.12.0-r8.tar.gz'))
const TAR_SH = forSh(TAR)

const tarLines = (args) => {
  try {
    return execFileSync('tar', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean)
  } catch (e) {
    bad('tar 调用失败，后面的产物断言无法进行', String(e.stderr || e.message).split(/\r?\n/)[0])
    return null
  }
}

// ── 1. 产物本体 ──
console.log('1) 产物与文档 sha 是否一致')
if (!existsSync(TAR)) bad('产物 tar 不存在（换机器跑要先 --tar 指对路径）', TAR)
else {
  const buf = readFileSync(TAR)
  const sha = shasum(buf)
  const docs = ['CHANGELOG.md', join(root, '../docs/NEXT-ITERATION.md')].filter(existsSync)
  const inDocs = docs.filter((d) => readFileSync(d, 'utf8').includes(sha))
  if (inDocs.length === 0)
    bad('文档里没有记录这份 tar 的 sha——要么产物变了没同步文档，要么指错了 tar', `实际=${sha}`)
  else pass(`tar sha 与文档记录一致`, `${sha.slice(0, 16)}… 见于 ${inDocs.map((d) => d.split(/[\\/]/).pop()).join(',')}`)

  const need = ['dist/boot.js', 'dist/public/index.html']
  const listing = tarLines(['-tzf', TAR_SH])
  if (listing) {
    for (const n of need) (listing.includes(n) ? pass : bad)(`tar 含 ${n}`, `${listing.length} 条目`)
    const br = listing.filter((p) => p.endsWith('.br')).length
    br >= 30 ? pass(`tar 内 .br = ${br}（闸门 ≥30）`) : bad(`tar 内 .br 只有 ${br}，部署后首屏会退化为未压缩`)
    const back = listing.filter((p) => p.includes('\\')).length
    back === 0 ? pass('无 Windows 反斜杠路径') : bad(`${back} 个条目带反斜杠，Linux 解包会得到错误文件名`)
    const dbg = listing.filter((p) => p.includes('data-dbg')).length
    dbg === 0 ? pass('无 data-dbg 调试残留') : bad(`${dbg} 个条目带 data-dbg`)
    const shipped = listing.filter((p) => /(^|\/)package\.json$/.test(p) || p.startsWith('scripts/'))
    shipped.length === 0
      ? pass('包里没有 package.json/scripts（仓库侧脚本改动不需要重出产物）')
      : bad('包里居然含 package.json 或 scripts/ —— "改文档不影响产物"的推断不再成立', shipped.join(','))
  }

  // 整棵 dist 与交付包逐文件比对。为什么不止比 boot.js：入口一致只能证明后端壳子对得上，
  // 前端是内容哈希分块，少传/多传/传错某一块都可能让线上跑到旧 chunk 而首页看起来正常。
  const localDist = join(root, 'dist')
  if (!existsSync(localDist)) open('本机没有 dist/，无法做整树比对（先跑 npm run build）')
  else {
    const tmp = join(root, '.handoff-tmp')
    try {
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(tmp, { recursive: true })
      execFileSync('tar', ['-xzf', TAR_SH, '-C', forSh(tmp)], { maxBuffer: 64 * 1024 * 1024 })
      const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const f = join(d, e.name)
        return e.isDirectory() ? walk(f) : [f]
      })
      const tree = (base) => new Map(walk(base).map((f) => [
        relative(base, f).split(sep).join('/'),
        shasum(readFileSync(f)),
      ]))
      const A = tree(localDist)
      const B = tree(join(tmp, 'dist'))
      const onlyLocal = [...A.keys()].filter((k) => !B.has(k))
      const onlyTar = [...B.keys()].filter((k) => !A.has(k))
      const mismatch = [...A.keys()].filter((k) => B.has(k) && A.get(k) !== B.get(k))
      const n = onlyLocal.length + onlyTar.length + mismatch.length
      if (n === 0) pass(`交付包与本机构建逐文件一致（${A.size} 个文件，含 boot.js 与全部分块）`,
        `boot.js=${(A.get('boot.js') ?? '').slice(0, 16)}…`)
      else {
        bad(`整树比对有 ${n} 处不同：仅本机 ${onlyLocal.length}、仅包内 ${onlyTar.length}、同名不同内容 ${mismatch.length}`)
        for (const l of [...onlyLocal, ...onlyTar, ...mismatch].slice(0, 6)) console.log(`        ${l}`)
      }
      rmSync(tmp, { recursive: true, force: true })
    } catch (e) {
      bad('整树比对没做成（解包或读取失败）', String(e.stderr || e.message).split(/\r?\n/)[0])
      rmSync(tmp, { recursive: true, force: true }) // 失败也要收尾，否则仓库里留一个 2.6MB 的垃圾目录
    }
  }
}

// ── 2. 要上传的脚本 ──
console.log('2) 交接脚本是否真的可用')
for (const f of ['scripts/v14-resync-sha.sh', 'scripts/v14-rollback.sh', 'scripts/v14-rollback-drill.sh']) {
  const p = join(root, f)
  if (!existsSync(p)) {
    bad(`${f} 不在仓库里（上线/回滚那一刻拿不到它）`)
    continue
  }
  const buf = readFileSync(p)
  const cr = [...buf].filter((x) => x === 0x0d).length
  if (cr !== 0) bad(`${f} 含 ${cr} 个 CR，Linux 上 bash 会报 $'\\r'`, )
  else {
    try {
      execFileSync('bash', ['-n', p], { stdio: 'pipe' })
      pass(`${f} 存在、纯 LF、bash -n 通过`, `${buf.length} 字节`)
    } catch (e) {
      bad(`${f} bash -n 语法不过`, String(e.stderr || e.message).slice(0, 90))
    }
  }
}

// ── 3. 迁移文件与 journal ──
console.log('3) 迁移面')
const migDir = join(root, 'db/migrations')
const journal = JSON.parse(readFileSync(join(migDir, 'meta/_journal.json'), 'utf8'))
const files = readdirSync(migDir)
// drizzle 的 journal.tag 本身就带数字前缀（实测 tag="0000_remarkable_sasquatch"），
// 不要再拼一次 padStart——那样每条都会被判成"缺文件"。（第一版就是这么错的，
// 报出 15 条全缺，看着像迁移链炸了，实际是探针把文件名拼重了。）
const missing = journal.entries.filter((e) => !files.includes(`${e.tag}.sql`))
const mislabeled = journal.entries.filter((e) => !e.tag.startsWith(String(e.idx).padStart(4, '0') + '_'))
missing.length === 0 && mislabeled.length === 0
  ? pass(`journal 的 ${journal.entries.length} 条都有对应 .sql 且 idx 与文件名前缀一致`)
  : bad('迁移链与 journal 对不上', `缺文件=${missing.map((m) => m.tag).join(',')} 前缀不符=${mislabeled.map((m) => m.idx + ':' + m.tag).join(',')}`)
for (const tag of ['0013_v14_post_interaction', '0014_v14_comment_report']) {
  for (const suf of ['.sql', '_run.sql']) {
    existsSync(join(migDir, tag + suf)) ? pass(`${tag}${suf} 就位`) : bad(`缺 ${tag}${suf}`, '生产直跑版缺失＝上线无 SQL 可跑')
  }
}
const last = journal.entries[journal.entries.length - 1]
last.idx === 14 ? pass(`journal 最后一条是 0014（v14 已进迁移链）`) : bad('journal 最后一条不是 0014', `实际 idx=${last.idx}`)

// ── 4. env 变量是否都有文档 ──
console.log('4) 环境变量口径')
const envSrc = readFileSync(join(root, 'api/lib/env.ts'), 'utf8')
const keys = [...new Set([...envSrc.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))]
const example = readFileSync(join(root, '.env.example'), 'utf8')
const absent = keys.filter((k) => !example.includes(k))
if (keys.length < 5) bad(`只从 env.ts 解析到 ${keys.length} 个变量名——探针不可信，别把它当通过`, keys.join(','))
else if (absent.length === 0) pass(`env.ts 读到的 ${keys.length} 个变量全部在 .env.example 里有说明`)
else bad(`${absent.length} 个变量没进 .env.example`, absent.join(','))

// ── 5. 追溯门禁现跑一次 ──
console.log('5) 计划条目的可追溯性（现跑，不引用旧结果）')
try {
  execFileSync(process.execPath, [join(root, 'scripts/check-plan-coverage.mjs'), '--strict'], { stdio: 'pipe' })
  pass('check-plan-coverage --strict 退出 0（每条计划项都有已核验的实现锚点）')
} catch (e) {
  bad('check-plan-coverage --strict 不过', String(e.stdout || e.message).split(/\r?\n/).slice(-3).join(' / '))
}

// ── 6. 只有人或真实云账号能验的东西：显式列出，不刷绿 ──
console.log('6) 本命令无法替你验证的（保持 OPEN，别当成已覆盖）')
open('三条 UI 行为：举报弹层重开是否干净 / 关注乐观态是否被 refetch 盖回 / 退出登录是否清前账号高亮')
open('阿里云内容安全真实网关（QY-SAFE-003）+ fail-open 还是 fail-closed 的拍板')
open('生产库真实引擎版本与小版本（本机连不上生产，TiDB 口径与 MySQL 8 在文档里仍有冲突）')
open('迁移直跑版在生产那份库上的 ALTER 分支（CI 那步只会走 skip，见 B-34）')

console.log(`\n结论：失败 ${fails} 项，OPEN（需人/需云）${opens} 项`)
if (fails > 0) console.log('交接物本身有问题——先修这些再上线，别让部署那一刻成为第一次核对。')
process.exitCode = fails > 0 ? 1 : 0
