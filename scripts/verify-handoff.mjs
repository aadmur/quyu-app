#!/usr/bin/env node
/**
 * 上线前"交接物"自检：把交付时刻依赖的每个事实都变成能变红的断言。
 * 为什么要它：这次上线是"一次性的"，而它依赖的东西散在仓库外（产物 tar）与仓库内（三个脚本、
 * 迁移 SQL、文档里的 sha）。这类"文档写一个 sha、磁盘上是另一个"的漂移本项目已经踩过一次
 * （服务器上的 ca1c4a00… 因机审返工而失效）。凡是这里能机械核对的，就不该留给人眼。
 *
 * 用法：node scripts/verify-handoff.mjs --tar E:/tmp/dist-v8.13.0-r1.tar.gz
 * **`--tar` 不给就硬失败**：这一项的默认值曾经写死成上一版产物（`dist-v8.12.0-r8.tar.gz`），
 * 那等于"换一次上线就会对着一份旧包报绿"。v14 上线当天真实踩到的就是这一族问题——
 * 服务器上的包是 `921d3f14…`，而部署脚本的期望 sha 已经跟着它自洽，整道闸门对着一份错包"通过"。
 * 所以这里宁可要求每次上线显式指认交付物。
 * 退出码 = 失败项数；OPEN 项（只有真机/真实云账号能验的）不计失败，但会明确列出来。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
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
// 传给 tar 的路径形式取决于**实际被解析到的是哪个 tar**：Git Bash 的 MSYS tar 认 /e/tmp/x.tar，
// 见到 `E:\tmp` 会当成"远程主机 E:"；而 System32 的 bsdtar 认 E:/tmp/x.tar，见到 /e/… 报 Cannot open。
// 两台机器可能选到不同的 tar，所以不猜：各试一次 `tar -tf`，用能读通的那一种；两种都不行就明确失败，
// 绝不因为"探针没跑起来"而把产物断言算成通过。
const TAR_ARG = arg('tar', '')
if (!TAR_ARG) {
  console.log('用法：node scripts/verify-handoff.mjs --tar <这次要上线的交付包>')
  console.log('E:/tmp 下现存的包（按修改时间倒序；**由你确认哪一份才是要上线的那份**）：')
  for (const line of candidates('/e/tmp')) console.log('  ' + line)
  console.log('  FAIL  缺 --tar。这里故意不给默认值：默认值一旦指到上一版产物，本命令就永远"通过"')
  process.exit(1)
}
function candidates(dir) {
  // Node 在 Windows 上不认 Git Bash 的 /e/tmp，而 shell 侧两种都可能用到 → 两种各试一次。
  // 这里失败不能静默：列不出候选就等于把人又推回"手敲路径"的坑，所以要打印原因。
  for (const d of [dir, 'E:/tmp', 'C:/tmp']) {
    try {
      return readdirSync(d)
        .filter((f) => f.endsWith('.tar.gz'))
        .map((f) => ({ f, m: statSync(join(d, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)
        .slice(0, 6)
        .map((x) => `${new Date(x.m).toISOString().slice(0, 16)}  ${x.f}   (${d})`)
    } catch { /* 换下一个目录形式 */ }
  }
  return ['(读不到 E:/tmp 或 /e/tmp——直接给你要上线的包路径)']
}
const TAR = resolve(TAR_ARG)
const FORMS = [
  (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):\/+/, (_m, d) => '/' + d.toLowerCase() + '/'),
  (p) => p.replace(/\\/g, '/'),
]
let TP = null
for (const f of FORMS) {
  try {
    execFileSync('tar', ['-tf', f(TAR)], { stdio: 'ignore' })
    TP = f
    break
  } catch { /* 换下一种路径形式 */ }
}
if (!TP) {
  bad('两种路径形式都读不通这份包（tar 不在 PATH、包损坏或路径写错）——产物侧断言全部不可信', TAR)
  TP = (p) => p // 让后面的调用照常进行，失败已经记上了，不会再冒充通过
}

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
  const listing = tarLines(['-tzf', TP(TAR)])
  if (listing) {
    for (const n of need) (listing.includes(n) ? pass : bad)(`tar 含 ${n}`, `${listing.length} 条目`)
    const br = listing.filter((p) => p.endsWith('.br')).length
    br >= 30 ? pass(`tar 内 .br = ${br}（闸门 ≥30）`) : bad(`tar 内 .br 只有 ${br}，部署后首屏会退化为未压缩`)
    // 服务器以 root 解包，所以条目路径必须都落在 dist/ 之下：绝对路径或 .. 会让 tar 写到目录之外。
    const escape = listing.filter((p) => p.startsWith('/') || p.includes('..') || !p.startsWith('dist/'))
    escape.length === 0
      ? pass('所有条目都在 dist/ 之下（无绝对路径、无 .. 穿越）')
      : bad(`${escape.length} 个条目会解到 dist/ 之外，root 解包时被污染的路径见下`, escape.slice(0, 3).join(', '))
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
      execFileSync('tar', ['-xzf', TP(TAR), '-C', TP(tmp)], { maxBuffer: 64 * 1024 * 1024 })
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
      // 内容安全检查：这份包要原样上传到一台公网服务器，所以先确认里面没有凭据痕迹、
      // 没有源码映射。命中只报**文件名与规则名**，绝不把命中的内容本身打到屏幕上。
      const RULES = [
        ['阿里云 AccessKeyId 形态', /LTAI[A-Za-z0-9]{12,24}/],
        ['私钥块', /-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----/],
        ['带口令的数据库连接串', /mysql:\/\/[^\s"'`)]{1,64}:[^\s"'`@)]{3,64}@/],
        ['写死的 APP_SECRET 值', /APP_SECRET["']?\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/],
      ]
      // 用"排除二进制"而不是"只挑几种文本"：白名单会把 `.env` 这种无扩展名又最可能藏凭据的文件放过
      // （我第一版就是这样，毒包里那份 .env 根本没进扫描——这条如果不测就是一次安静的假绿）。
      const BINARY = /\.(png|jpe?g|webp|gif|ico|avif|svgz|woff2?|ttf|otf|eot|mp4|webm|br|gz)$/
      const hits = []
      let maps = 0
      let scanned = 0
      for (const rel of B.keys()) {
        if (rel.endsWith('.map')) maps++
        if (BINARY.test(rel)) continue
        const buf = readFileSync(join(tmp, 'dist', rel))
        if (buf.length > 12 * 1024 * 1024) continue
        scanned++
        const text = buf.toString('latin1') // 只找 ASCII 特征，不必真的解码非 UTF-8 内容
        for (const [rule, re] of RULES) if (re.test(text)) hits.push(`${rel} ← ${rule}`)
      }
      maps === 0
        ? pass('包内没有 .map 源码映射（构建产物一旦带上就等于把源码上传到公网）')
        : bad(`包内有 ${maps} 个 .map 文件，会暴露源码结构`, [...B.keys()].filter((k) => k.endsWith('.map')).slice(0, 3).join(', '))
      hits.length === 0
        ? pass(`${scanned} 个文本类文件正文里没有凭据特征`, `规则 ${RULES.length} 条，跳过二进制 ${B.size - scanned}`)
        : bad(`包内疑似有凭据/秘密，先别上传`, hits.slice(0, 6).join(' | '))
      rmSync(tmp, { recursive: true, force: true })
    } catch (e) {
      bad('整树比对没做成（解包或读取失败）', String(e.stderr || e.message).split(/\r?\n/)[0])
      rmSync(tmp, { recursive: true, force: true }) // 失败也要收尾，否则仓库里留一个 2.6MB 的垃圾目录
    }
  }
}

// ── 2. 要上传的脚本 ──
console.log('2) 交接脚本是否真的可用')
// 不再写死 v14 那三个文件名：新增一版脚本却忘了纳管，正是"上线那一刻拿不到退路"的成因。
// 现在按前缀扫，v15/v16 的部署脚本一落地就自动进入这道闸门。
const deployScripts = readdirSync(join(root, 'scripts'))
  .filter((f) => /^v1\d-.*\.sh$/.test(f))
  .sort()
  .map((f) => 'scripts/' + f)
if (deployScripts.length === 0) bad('scripts/ 下一个 v1x-*.sh 都没有（部署/回滚脚本没纳管？）')
for (const f of deployScripts) {
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
// --mig 与 check-run-sql 的 --dir 同一个用途：给变异夹具指一份 migrations 的副本，
// 这样"新加的判据能不能变红"是可证的，而不是我相信它能。
const migDir = resolve(arg('mig', join(root, 'db/migrations')))
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
// 「每份手写生产直跑版都必须有同名的 journal 条目 + 生成版配对」。
// 这条是本轮新加的，起因是真实缺陷：识鱼的 0015_fish_id_run.sql 当时只有手写版，
// journal 停在 0014 —— 生产能建出表，而 CI 的空库路径永远建不出这两张表，两条 schema 会悄悄分叉。
const runFiles = files.filter((f) => f.endsWith('_run.sql')).sort()
const orphanRuns = runFiles.filter((f) => !journal.entries.some((e) => e.tag === f.slice(0, -'_run.sql'.length)))
orphanRuns.length === 0
  ? pass(`${runFiles.length} 份直跑版都进了 journal（tag 同名）`, runFiles.map((f) => f.replace('_run.sql', '')).join(','))
  : bad('有直跑版迁移没进 journal（CI 空库建不出这些表/列）', orphanRuns.join(','))
const unpaired = runFiles.filter((f) => !files.includes(f.replace(/_run\.sql$/, '.sql')))
unpaired.length === 0
  ? pass(`${runFiles.length} 份直跑版都有生成版配对`, 'drizzle 两条路径同构')
  : bad('直跑版缺生成版配对', unpaired.join(','))
for (const tag of ['0013_v14_post_interaction', '0014_v14_comment_report', '0015_fish_id']) {
  for (const suf of ['.sql', '_run.sql']) {
    existsSync(join(migDir, tag + suf)) ? pass(`${tag}${suf} 就位`) : bad(`缺 ${tag}${suf}`, '生产直跑版缺失＝上线无 SQL 可跑')
  }
}
const last = journal.entries[journal.entries.length - 1]
last.idx === journal.entries.length - 1
  ? pass(`journal 连续无洞，最后一条 idx=${last.idx}`, last.tag)
  : bad('journal 有洞（条数与最大 idx 不吻合）', `条数=${journal.entries.length} 最后 idx=${last.idx}`)

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
// v15 识鱼带来的新 OPEN：这几条不是"跑慢点就能过"，而是要 AK、要真机、要授权环境。
open('识鱼准确率**没有可复核的证据**：评测集实测 315 张（不是 534），scripts/eval-fishid.ts 只打印不落盘，results.json 不存在（B-37）')
open('识鱼入口无条件可见，但生产 .env 里没有 MOONSHOT_API_KEY → 一上线每人点进都拿 412；这是产品决定不是部署能解决的（B-43）')
open('识鱼钱路的 SQL 守卫（>= price、< limit、GREATEST）与"每条断言都能变红"都没验：前者要真库、后者要能注入变异的授权环境（B-39、B-40）')
open('verify:static 本轮只复验了 exit=0，仍未复验"它能变红"（B-44）')

console.log(`\n结论：失败 ${fails} 项，OPEN（需人/需云）${opens} 项`)
if (fails > 0) console.log('交接物本身有问题——先修这些再上线，别让部署那一刻成为第一次核对。')
process.exitCode = fails > 0 ? 1 : 0
