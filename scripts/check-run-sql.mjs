#!/usr/bin/env node
/**
 * @layer Ops 脚本 —— 静态核对生产直跑版迁移（`db/migrations/*_run.sql`）
 * @file scripts/check-run-sql.mjs
 *
 * 为什么需要它：0013/0014 的直跑版才是上线那一刻真正执行的 SQL，而 CI 的测试库是先
 * `db:migrate` 建好的——那意味着直跑版里每条 ALTER 的 information_schema 守卫都会走 skip 分支，
 * **ALTER 本身在 CI 里从没被执行过**（见 backlog B-34，本机起不了 mysqld，所以也补不了动态覆盖）。
 * 这里退一步，把 ALTER 里最容易出的两类错误做成静态判据：
 *   ① 守卫指向一张当时根本不存在的表（拼错表名 → 生产上那条 ALTER 直接 ERROR）；
 *   ② `NOT NULL` 新列没带 DEFAULT（老代码的 INSERT 不写这列就会失败，回滚代码也就回不去了）。
 * 明确说清它**抓不到**什么：SQL 语法错、TiDB 与 MySQL 8 的语义差异、回填 UPDATE 的数据正确性。
 * 用法：node scripts/check-run-sql.mjs [--verbose]
 * 退出码 = 失败项数。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
// --dir 只为"变异测试"存在：把 migrations 复制到临时目录改坏一处，验证这判据真的会变红。
const dir = resolve(root, arg('dir', 'db/migrations'))
const files = readdirSync(dir)
const runFiles = files.filter((f) => /_run\.sql$/.test(f)).sort()
if (runFiles.length === 0) {
  console.error('FAIL  一个 *_run.sql 都没找到——探针没跑起来，不是"没问题"')
  process.exitCode = 1
}

// 0012 及之前建立起来的表集合（直跑版的 ALTER 只能指向这里面的表）
const baseIdx = 12
const known = new Set()
for (const f of files) {
  const m = f.match(/^(\d{4})_(.+)\.sql$/)
  if (!m || m[1].includes('run') || /_run\.sql$/.test(f)) continue
  if (Number(m[1]) > baseIdx) continue
  const sql = readFileSync(join(dir, f), 'utf8')
  for (const c of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`?([A-Za-z0-9_]+)`?/gi)) known.add(c[1].toLowerCase())
}
if (known.size < 10) {
  console.error(`FAIL  从 0000…0012 只认出 ${known.size} 张表，判据不可信（正则没匹配上≠没有表）`)
  process.exitCode = 1
}

let fails = 0
const bad = (m, extra) => {
  fails += 1
  console.error(`FAIL  ${m}${extra ? '  ' + extra : ''}`)
}
const ok = (m, extra) => console.log(`PASS  ${m}${extra ? '  ' + extra : ''}`)
const verbose = process.argv.includes('--verbose')

for (const f of runFiles) {
  const raw = readFileSync(join(dir, f), 'utf8')
  // 注释里也会出现 "ALTER TABLE ADD COLUMN / CREATE INDEX" 这种字样，直接拿原文解析会凭空多出表名
  // （第一版就被注释骗过一次，报出 "add" 是指向不存在的表）。判据只吃语句，不吃说明。
  const sql = raw.replace(/^\s*--.*$/gm, '')
  const idx = Number(f.slice(0, 4))
  if (idx <= baseIdx) continue // 基线之前的直跑版不参与"新 ALTER"核对

  const created = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`?([A-Za-z0-9_]+)`?/gi)]
  const createdNames = new Set(created.map((c) => c[1].toLowerCase()))
  const knownHere = new Set([...known, ...createdNames]) // 同一份文件里刚建的表当然可以引用

  // ① 守卫与 ALTER 指向的表必须是当时存在的表（含本文件内新建的）
  const guarded = [...sql.matchAll(/TABLE_NAME\s*=\s*'([A-Za-z0-9_]+)'/gi)].map((m) => m[1].toLowerCase())
  const altered = [...sql.matchAll(/ALTER TABLE `?([A-Za-z0-9_]+)`?/gi)].map((m) => m[1].toLowerCase())
  const refs = [...new Set([...guarded, ...altered])]
  const unknown = refs.filter((t) => !knownHere.has(t))
  if (unknown.length === 0) ok(`${f} 引用的 ${refs.length} 张表都存在`, refs.join(','))
  else bad(`${f} 指向了当时不存在的表`, unknown.join(','))

  // ② CREATE TABLE 必须是新建表且带 IF NOT EXISTS
  for (const c of created) {
    const stmt = c[0]
    const t = c[1].toLowerCase()
    if (!/IF NOT EXISTS/i.test(stmt)) bad(`${f} 建 \`${c[1]}\` 没写 IF NOT EXISTS（重跑会 ERROR，幂等破掉）`)
    if (known.has(t)) bad(`${f} 想建已经存在的表 \`${c[1]}\``, '直跑版里出现这种语句多半是复制错了')
  }
  if (created.length > 0) ok(`${f} 的 ${created.length} 张新表均为 IF NOT EXISTS 且不与既有表同名`)

  // ③ 新列：NOT NULL 必须带 DEFAULT。先数 `ADD COLUMN` 字面量出现次数当作权威条数，
  //    解析到的条数比它少就报错——否则"少解析到一条"会安静地变成"少检查一条"（假绿）。
  const addLiteral = (sql.match(/ADD COLUMN/gi) || []).length
  // 声明体里可能出现**双写的引号**（SQL 字符串字面量里 `DEFAULT ''/avatar-1.png''`），
  // 用 `[^']+` 会在第一个引号处截断，导致这一列被静默跳过——所以按"非引号 或 两个引号"来吃。
  const adds = [...sql.matchAll(/ADD COLUMN `?([A-Za-z0-9_]+)`? ((?:[^']|'')+)/g)]
  let checked = 0
  for (const a of adds) {
    const [, col, declRaw] = a
    const decl = declRaw.replace(/''/g, "'")
    if (!/\S/.test(decl)) continue
    checked += 1
    const notNull = /NOT NULL/i.test(decl)
    const hasDefault = /DEFAULT\s+(\(now\(\)\)|\(JSON_ARRAY\(\)\)|'[^']*'|\S+)/i.test(decl)
    if (notNull && !hasDefault) bad(`${f}：\`${col}\` 是 NOT NULL 却没有 DEFAULT——老代码的 INSERT 不带这列会直接失败`, decl.slice(0, 60))
  }
  if (addLiteral === 0) console.log(`INFO  ${f} 没有 ADD COLUMN 语句`)
  else if (adds.length !== addLiteral) bad(`${f} 有 ${addLiteral} 条 ADD COLUMN，但只解析到 ${adds.length} 条`, '少解析=少检查，这条判据不可信（不是"通过"）')
  else if (checked !== adds.length) bad(`${f} 解析到 ${adds.length} 条但只核对了 ${checked} 条声明`, '同上：不能把没看过的算成通过')
  else ok(`${f} 的 ${addLiteral} 条 ADD COLUMN 全部解析并核对：NOT NULL 都带默认值`)

  // ④ 破坏性语句：直跑版原则上只做加法。DROP INDEX 允许，但**必须同名重建**——
  //    0014 就把 `uq_report(reporter_id,post_id)` 换成 `uq_report(reporter_id,post_id,comment_id)`，
  //    那是"替换"不是"删除"，可它的语义后果是真的：唯一性变宽了。所以这种替换必须显式提示，
  //    免得下一个人（就是上一轮的我）在文档里写下"v14 DDL 全是加法、回滚代码语义完全不变"。
  for (const kw of ['DROP TABLE', 'DROP COLUMN', 'MODIFY COLUMN', 'CHANGE COLUMN', 'TRUNCATE', 'DELETE FROM']) {
    if (new RegExp(kw, 'i').test(sql)) bad(`${f} 含破坏性语句 ${kw}——"回滚代码不动库"这个前提会被它打掉`)
  }
  for (const d of sql.matchAll(/DROP INDEX `?([A-Za-z0-9_]+)`?/gi)) {
    const name = d[1].toLowerCase()
    // 名字后面必须紧跟标识符边界，否则 `uq_report` 会当成 `uq_report_new` 的前缀匹配上——
    // 变异测试里我把重建改名成 uq_report_new，判据仍然报绿，就是这个漏洞被实抓了一次。
    const readded = new RegExp(`(ADD CONSTRAINT|ADD (?:UNIQUE )?INDEX)\\s+\`?${name}\`?(?![A-Za-z0-9_])`, 'i').test(sql)
    if (!readded) bad(`${f} DROP INDEX \`${d[1]}\` 之后没有同名重建——索引真的消失了`)
    else console.log(`WARN  ${f} 替换了索引 \`${d[1]}\`（唯一性列集变了）。注意这只影响**新代码**的前向语义：`
      + '老代码不传那一列时会落默认值 0，去重行为对它自己保持不变——要下判断得读写入路径，别只看 DDL。')
  }
  if (verbose) console.log(`  ${f}: 表 ${refs.length} 建 ${created.length} 加列 ${adds.length}，已知表基数 ${known.size}`)
}

if (fails === 0 && known.size >= 10) console.log(`\nRUN-SQL CHECK PASSED（基线表 ${known.size} 张，直跑版 ${runFiles.length} 份）`)
else console.log(`\nRUN-SQL CHECK FAILED：${fails} 项`)
process.exitCode = fails > 0 ? 1 : (process.exitCode ?? 0)
