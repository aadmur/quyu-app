/**
 * @layer Ops 脚本 —— 历史帖 base64 图片回填为磁盘 URL（ADR-0002 / backlog B-14）
 * @file scripts/migrate-post-images.mjs
 *
 * 为什么需要它：v14 起新发帖的图片走 imageStore 落盘，但**迭代前已入库的帖子**，
 * `posts.images` 里存的仍是整段 dataURL（单张可达数百 KB）。后果有两层：
 *   1. 单行 JSON 逼近 MySQL max_allowed_packet，且全列查询时 MB 级字符串会被
 *      推荐召回缓存（recall:hot，200 行）捞进进程内存；
 *   2. postCoverSql 对首图 **>512 字符判 cover=null**（刻意的守卫），
 *      所以这些老帖在信息流里**没有封面**，只有详情页能看到图。
 *
 * 安全前提（ADR-0002 拍板的口径）：
 *   - 先备份、再原地改写；改写前的原值完整导出为 JSON，回滚靠这份备份写回；
 *   - 幂等：已经是 `/uploads/...` 形态的行直接跳过，可重复执行；
 *   - **默认 dry-run**，必须显式 `--apply` 才写库写盘。
 *
 * 用法：
 *   node scripts/migrate-post-images.mjs                  # ① 预检：有多少行、多少体积
 *   node scripts/migrate-post-images.mjs --apply          # ② 真回填（自动先落备份文件）
 *   node scripts/migrate-post-images.mjs --rollback <备份文件.json>   # ③ 回滚
 *
 * 环境变量：DATABASE_URL（必填）
 *
 * 与部署的顺序：**必须在 0013 迁移之后、在把 dist 切过去之前跑**。
 * 回填只动 `posts.images` 的内容形态，不改表结构，因此不需要停机，但要在
 * 新代码上线前完成，否则新老形态混在一起，排查封面缺失时会更难判断原因。
 */
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

const args = process.argv.slice(2)
const get = (flag) => {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}
const APPLY = args.includes('--apply')
const ROLLBACK = get('--rollback')
const url = process.env.DATABASE_URL
if (!url) {
  console.error('缺少 DATABASE_URL')
  process.exit(2)
}

// 与 api/services/imageStore.ts 同一口径：目录相对 process.cwd()，由 boot.ts 的
// /uploads/* 静态路由伺服。**不要**改这里的路径形态，否则和运行时写盘位置分叉。
const SUB_DIR = 'legacy'
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'posts')
const BACKUP_DIR = path.resolve(process.cwd(), 'uploads', 'posts-backups')

/** dataURL → { mime, ext, buf }；只接受 image 类型，其余一律拒绝（不猜、不兜底） */
function decodeDataUrl(value) {
  const m = /^data:image\/(png|jpe?g|webp);base64,([\s\S]+)$/.exec(String(value ?? '').trim())
  if (!m) return null
  const subtype = m[1] === 'jpeg' || m[1] === 'jpg' ? 'jpg' : m[1]
  let buf
  try {
    buf = Buffer.from(m[2], 'base64')
  } catch {
    return null
  }
  // base64 解码是宽容的：非法字符会被忽略而不是抛错，所以要验"解出来非空"
  if (buf.length === 0) return null
  return { ext: subtype, buf }
}

/**
 * "已经是可伺服的引用"的判据。
 * 注意**不能**只认 `/uploads/`：种子与历史数据里大量图片是 `/feed-N.webp` 这类
 * `public/` 静态路径，它们同样是合法 URL 引用，必须原样保留。
 * 若把它们误判成"形态未知"，日志会刷一片假警告，真出问题的行反而被埋掉。
 */
const isStoredUrl = (v) =>
  typeof v === 'string' && (v.startsWith('/') || /^https?:\/\//.test(v))

const conn = await mysql.createConnection(url)

// ── ③ 回滚 ──
if (ROLLBACK) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(ROLLBACK), 'utf8'))
  const rows = Array.isArray(raw) ? raw : raw.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error('备份文件里没有可用行')
    process.exit(1)
  }
  let n = 0
  for (const r of rows) {
    // 只接受 { id, images } 形态；images 原样写回，不做任何"顺手规范化"
    if (typeof r?.id !== 'number' || !Array.isArray(r?.images)) continue
    await conn.query('UPDATE posts SET images = ? WHERE id = ?', [JSON.stringify(r.images), r.id])
    n++
  }
  await conn.end()
  console.log(`回滚完成：${n} 行已写回备份中的原值。`)
  console.log('注意：回滚不会删除已落盘的 .webp/.png 文件，也不会改 uploads 目录结构。')
  process.exit(0)
}

// ── ① 预检 ──
const [stats] = await conn.query(`
  SELECT COUNT(*) AS posts_total,
         SUM(JSON_SEARCH(images, 'one', 'data:image%') IS NOT NULL) AS base64_posts,
         ROUND(SUM(OCTET_LENGTH(images)) / 1024 / 1024, 2) AS images_mb
    FROM posts
`)
const s = stats[0]
console.log('── 预检 ──')
console.log(`  帖子总数            ${s.posts_total}`)
console.log(`  含 base64 图的帖子  ${s.base64_posts ?? 0}`)
console.log(`  images 列合计体积   ${s.images_mb ?? 0} MB`)

if (Number(s.base64_posts ?? 0) === 0) {
  console.log('\n结论：库里没有 base64 形态的帖子图片，**本脚本无需执行**。')
  console.log('（种子数据用的是 /feed-N.webp 静态路径，属正常情况。）')
  await conn.end()
  process.exit(0)
}

// 逐帖统计待处理的图片张数与体积，给"要不要现在做"提供依据
const [candidates] = await conn.query(`
  SELECT id, JSON_LENGTH(images) AS n, OCTET_LENGTH(images) AS bytes
    FROM posts
   WHERE JSON_SEARCH(images, 'one', 'data:image%') IS NOT NULL
   ORDER BY bytes DESC
`)
console.log(`  最大单帖            ${(Number(candidates[0]?.bytes ?? 0) / 1024).toFixed(1)} KB（${candidates[0]?.n} 张）`)
console.log(`  待处理帖子          ${candidates.length} 个`)

// ── ② 回填 ──
const [rows] = await conn.query(
  `SELECT id, images FROM posts WHERE JSON_SEARCH(images, 'one', 'data:image%') IS NOT NULL ORDER BY id`,
)

let converted = 0
let skipped = 0
let failed = 0
const backupRows = []
const writtenFiles = []

for (const row of rows) {
  const original = typeof row.images === 'string' ? JSON.parse(row.images) : row.images
  if (!Array.isArray(original)) {
    console.warn(`  跳过帖 ${row.id}：images 不是数组（${typeof row.images}）`)
    skipped++
    continue
  }
  backupRows.push({ id: Number(row.id), images: original })

  const next = []
  let touched = false
  let rowFailed = false
  for (const [idx, value] of original.entries()) {
    if (isStoredUrl(value)) {
      next.push(value) // 已落盘，保持原样 → 幂等
      continue
    }
    const decoded = decodeDataUrl(value)
    if (!decoded) {
      // 既不是 URL 也不是可识别的 dataURL：**原样保留并在报告里点名**，
      // 绝不静默丢弃或伪造占位图——静默替换会让图片永久丢失。
      console.warn(`  ⚠️ 帖 ${row.id} 第 ${idx + 1} 项形态未知，原样保留：${String(value).slice(0, 48)}`)
      next.push(value)
      rowFailed = true
      continue
    }
    // 文件名完全由服务端生成：不取任何来自数据的名字，杜绝路径穿越
    const fname = `legacy-${row.id}-${idx}.${decoded.ext}`
    const fpath = path.join(UPLOAD_ROOT, fname)
    if (APPLY) {
      fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
      // 已存在同名文件说明上次跑过：直接复用，不重复写
      if (!fs.existsSync(fpath)) fs.writeFileSync(fpath, decoded.buf)
      writtenFiles.push(fpath)
    }
    next.push(`/uploads/posts/${fname}`)
    touched = true
  }

  if (!touched) {
    skipped++
    continue
  }
  if (APPLY) {
    await conn.query('UPDATE posts SET images = ? WHERE id = ?', [JSON.stringify(next), row.id])
  }
  if (rowFailed) failed++
  converted++
  console.log(`  ${APPLY ? '已改写' : '将改写'} 帖 ${row.id}：${original.length} 张 → ${next.length} 个 URL`)
}

let backupFile = null
if (APPLY && backupRows.length > 0) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  backupFile = path.join(BACKUP_DIR, `posts-images-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(backupFile, JSON.stringify({ table: 'posts', column: 'images', rows: backupRows }, null, 0))
}

await conn.end()

console.log('\n── 结果 ──')
console.log(`  ${APPLY ? '已回填' : '预演待回填'} ${converted} 帖，跳过 ${skipped}，形态不明仍保留原值的 ${failed}（这些帖不会丢图）`)
if (!APPLY) {
  console.log('\n这是 dry-run（未写库、未写盘）。确认无误后执行：')
  console.log('  node scripts/migrate-post-images.mjs --apply')
  console.log('\n⚠️ 执行 --apply 前请先做一次全库备份：')
  console.log('  mysqldump --single-transaction -uquyu -p<密码> quyu > /opt/quyu/backups/quyu-before-image-backfill.sql')
} else {
  console.log(`\n原值备份：${backupFile}`)
  console.log(`落盘文件：${writtenFiles.length} 个于 ${UPLOAD_ROOT}`)
  console.log('回滚：node scripts/migrate-post-images.mjs --rollback ' + backupFile)
  console.log('\n⚠️ 仍建议手工做一次 mysqldump 全库备份——本脚本的备份只覆盖 posts.images 这一列。')
}
