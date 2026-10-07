/**
 * @layer Ops 脚本 —— 上线后一键复核（v14）
 * @file scripts/verify-deploy.mjs
 *
 * 为什么需要它：v14 交付时仍有三条行为只有真机/浏览器能验，而且切代码 + 迁移是一次性的回滚单元。
 * "部署完打开首页看一眼"覆盖不了这些，也不覆盖"新代码硬依赖的列/表是否真的存在"。
 * 这个脚本把能在服务端验的东西压成一条命令：结构协商、静态资源可达、v14 新增端点存在、
 * 以及最容易出事的一环——**迁移没跑就切了代码**（会表现为特定接口 500，而不是白屏）。
 *
 * 用法：
 *   node scripts/verify-deploy.mjs --base http://120.x.x.x:3000 [--cookie 'session=...'] [--tar E:/tmp/dist-v8.12.0-r8.tar.gz]
 *   本地自测：node scripts/verify-deploy.mjs --base http://127.0.0.1:3100
 *
 * --tar 会把"服务器正在跑的入口 JS"与"本机交付包里那份"做字节级比对——
 * 这是本项目里唯一能直接回答"线上到底是这份 8.12.0 吗"的检查：
 * package.json 的 version 一直是 0.0.0，服务端也没有任何版本端点，版本号只活在文件名与 CHANGELOG 里。
 * 退出码：0 = 全通过；1 = 有失败项（每项都打印是什么、说明它意味着什么）。
 * 刻意不做的事：不写库、不下单、不发评论——线上跑这个脚本应当是只读的。
 */
const args = process.argv.slice(2)
const getArg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const base = (getArg('--base') ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const cookie = getArg('--cookie')
const tarPath = getArg('--tar')

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const shasum = (b) => createHash('sha256').update(b).digest('hex')
// Git Bash 的 tar 会把 E:\tmp\x.tar 读成"远程主机 E:"，传给孩子进程前先转 /e/tmp/x.tar
// tar 的路径形式取决于实际命中的是哪个 tar：Git Bash 的 MSYS tar 认 /e/tmp/x.tar（见 `E:\tmp`
// 会当成"远程主机 E:"），System32 的 bsdtar 认 E:/tmp/x.tar（见 /e/… 报 Cannot open）。
// 部署那一刻不该因为这种环境问题给出假 FAIL，所以两种形式各试一次，取能读通的那种。
const tarForms = [
  (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):\/+/, (_m, d) => '/' + d.toLowerCase() + '/'),
  (p) => p.replace(/\\/g, '/'),
]
const tarMemberBytes = (archive, member) => {
  let lastErr
  for (const f of tarForms) {
    try {
      return execFileSync('tar', ['-xzOf', f(archive), member], { maxBuffer: 64 * 1024 * 1024 })
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

let failed = 0
let skipped = 0
const ok = (msg, extra = '') => console.log(`PASS  ${msg}${extra ? '  ' + extra : ''}`)
const skip = (msg, extra = '') => {
  skipped += 1
  console.log(`SKIP  ${msg}${extra ? '  ' + extra : ''}`)
}
const bad = (msg, extra = '') => {
  failed += 1
  console.error(`FAIL  ${msg}${extra ? '  ' + extra : ''}`)
}

const headers = (extra = {}) => ({
  Accept: 'application/json',
  ...(cookie ? { Cookie: cookie } : {}),
  ...extra,
})

/** tRPC v11 httpBatchLink 的 GET 信封：input={"0":{"json":{…}}}，且必须带 batch=1 */
const trpcGet = (path, input) =>
  `${base}/api/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: input } }))}`

/**
 * 永不抛出的 fetch：网络层错误（服务没起来、--base 写错、DNS/端口不通）在这里折成
 * `{err, status:0}`，由调用方打成一行 FAIL。
 * 上一版这里直接 await fetch：一旦连不上就是未捕获的 TypeError，脚本带着 node 栈崩掉——
 * 退出码虽然是 1，但运维同学看到的是一堆内部栈而不是"地址错了/服务没起来"。
 */
const safeFetch = async (url, opts) => {
  try {
    const r = await fetch(url, opts)
    const text = await r.text()
    return { err: null, status: r.status, headers: r.headers, text, ok: r.ok }
  } catch (e) {
    return { err: String(e?.message ?? e), status: 0, headers: new Headers(), text: '', ok: false }
  }
}

// ── 1. 首页与 brotli 协商（v14 产物里 44 个 .br，若部署物没带 precompress 会静默退化） ──
{
  const home = await safeFetch(`${base}/`, { headers: headers({ 'Accept-Encoding': 'br' }) })
  if (home.err) {
    bad('服务不可达：--base 写错或服务没起来（先 systemctl status quyu）', home.err)
  } else {
  const html = home.text
  const r = home
  // 只认构建产物一定有的标记（入口 module script + /assets/index-…），
  // 不假设挂载点 id：#app/#root 这类细节改一次就让脚本假报警一次（我第一版就猜错了 #app）
  const looksLikeSpa = r.status === 200 && html.includes('<script type="module"') && html.includes('/assets/index-')
  if (!looksLikeSpa) bad('首页未返回构建后的 SPA 文档', `http=${r.status}`)
  else ok('首页 200 且是构建后的文档（含入口 module script）')
  if (r.headers.get('content-encoding') !== 'br') bad('首页未走 brotli（部署物可能缺 .br 或服务器没开协商）', `encoding=${r.headers.get('content-encoding')}`)
  else ok('首页 brotli 协商生效')
  // 入口 JS 必须能从 index.html 里解析出来，且真的可取——改名/打包错位是历史上线踩过 404 的那种
  const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)
  if (!m) bad('index.html 里找不到入口 JS 引用')
  else {
    const a = await safeFetch(`${base}${m[0]}`, { headers: headers({ 'Accept-Encoding': 'br' }) })
    if (!a.ok) bad('入口 JS 取不到（改名/漏传导致的 404 会在这里暴露）', `${m[0]} http=${a.status} ${a.err ?? ''}`)
    else ok('入口 JS 可达', `${m[0]} http=${a.status} enc=${a.headers.get('content-encoding') ?? 'identity'}`)
    // 字节级绑定：服务器给回的这份入口 JS 必须与本机交付包里同名的那份逐字节相同。
    // 为什么值得多做这一步：版本字符串根本不存在于产物里（package.json=0.0.0，无版本端点），
    // "线上是这份 8.12.0 吗"只能靠内容自证；端点存在只能说明"是 v14 那一类代码"，
    // 不能排除"传错包/传了一半/后来又被覆盖"。
    if (a.ok) {
      if (!tarPath) skip('没给 --tar，跳过"线上入口 JS == 本机交付包"的字节比对')
      else {
        try {
          // URL 里的 /assets/… 在包内是 dist/public/assets/…——直接拿 URL 当包内成员名会取不到，
          // 而"取不到"长得非常像"比对失败"，这条区分必须做对（第一版就踩了）。
          const member = 'dist/public' + m[0]
          const want = shasum(tarMemberBytes(tarPath, member))
          const remote = await fetch(`${base}${m[0]}`, { headers: headers({ 'Accept-Encoding': 'br' }) })
          const got = shasum(Buffer.from(await remote.arrayBuffer()))
          if (want === got) ok('线上入口 JS 与交付包逐字节一致', `${member} sha=${got.slice(0, 16)}…`)
          else bad('线上入口 JS 与交付包不一致：传错包、漏文件，或部署后又被改过', `tar=${want.slice(0, 16)}… 服务器=${got.slice(0, 16)}…`)
        } catch (e) {
          // 资源名是内容哈希，"包内找不到线上那份"几乎总意味着包不对（传错版本/只传了一半），
          // 这比"字节不同"更常见，所以把这条结论直接写出来，别让人去猜 tar 的错误。
          bad('字节比对没做成：交付包里找不到线上那份入口 JS（多半就是线上跑的不是这份交付包）',
            String(e.message ?? e).slice(0, 110))
        }
      }
    }
  }
  }
}

// ── 2. v14 新增/改动的读接口存在（procedure 不存在会返回特定错误，而不是 500） ──
const probes = [
  ['app.feed', { page: 1, pageSize: 5 }, '推荐流（卡片口径含 cover）'],
  ['app.posts.detail', { id: 1 }, '帖子详情（弹层与路由页共用）'],
  ['app.posts.comments', { postId: 1, limit: 5, sort: 'latest' }, '评论分页（游标 + 双排序）'],
  ['app.posts.myFavorites', {}, '帖子收藏列表（v14 新表 post_favorites）'],
]
for (const [path, input, label] of probes) {
  let r
  try {
    r = await fetch(trpcGet(path, input), { headers: headers() })
  } catch (e) {
    bad(`${label}：请求发不出去`, String(e).slice(0, 80))
    continue
  }
  const text = await r.text()
  // 404/NOT_FOUND 才是"端点不存在"；500 多为迁移未跑（见第 3 项的判读）
  if (r.status === 404 || /"path":"${path}[^"]*"[^}]*"status":404/.test(text)) {
    bad(`${label}：端点不存在（部署的代码不是 v14？）`, `http=${r.status}`)
  } else if (r.status >= 500) {
    // 只判"在不在"会放过一种真实故障：SQL 语法/函数在生产引擎上不被支持（v14 首次引入 JSON_EXTRACT 等）。
    // 那类错误到执行期才炸，端点照样"在位"，所以 5xx 必须算失败并把原文带出来。
    bad(`${label}：端点在位但服务端 5xx（SQL 层问题：迁移未跑 / 函数或语法不被支持 / 库不可达）`, text.slice(0, 160))
  } else {
    // 注：这里不加"401 记 SKIP"的分支。实测这组探针**不带 cookie 也会进 resolver 跑 SQL**
    // （服务器对访客走 demo 身份，user_id=1，库不可达时报的是 `Failed query: select … from user_profiles …`
    // 而不是 401），所以那个分支永远不会命中；而且我没法给它做变异测试（起桩服务被策略拦），
    // 未观测过的分支留在部署关键脚本里只是 speculative code——已回退。
    ok(`${label}：端点在位`, `http=${r.status}`)
  }
}

// ── 3. 迁移是否真的跑过（v14 新代码硬依赖这些列/表；缺任一项都是运行期 500） ──
// 判读方式：拿一个必然用到新列的接口，看错误信息里有没有 unknown column / doesn't exist。
for (const [path, input, label] of [['app.posts.comments', { postId: 1, limit: 5 }, '评论列表（依赖 author_avatar/images/like_count/deleted_at）']]) {
  try {
    const r = await fetch(trpcGet(path, input), { headers: headers() })
    const t = await r.text()
    if (/Unknown column|doesn't exist|no such table|ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR/i.test(t)) {
      bad(`${label}：迁移未跑或跑了一半`, t.slice(0, 160))
    } else if (r.status >= 500) {
      bad(`${label}：服务端 500（不是缺列，需看日志）`, t.slice(0, 120))
    } else {
      ok(`${label}：无缺列/缺表迹象`, `http=${r.status}`)
    }
  } catch (e) {
    bad(`${label}：请求失败`, String(e).slice(0, 80))
  }
}

// ── 4. 落盘目录可达（图片链路另一半：uploads 不在 dist 里，容器化/误删会让全部图片 404） ──
{
  const r = await safeFetch(`${base}/uploads/avatars/`, { headers: headers() })
  if (r.err) bad('/uploads/* 请求发不出去', r.err)
  else {
    // 目录列表通常 404/403，这里只要求"不是被 SPA fallback 吞掉"
    const t = r.text
    if (r.status === 200 && t.includes('<script type="module"')) bad('/uploads/* 被 SPA fallback 接管（静态路由顺序或部署布局变了）')
    else ok('/uploads/* 未被 SPA fallback 吞掉', `http=${r.status}`)
  }
}

console.log(
  failed === 0
    ? `\nDEPLOY VERIFY PASSED${skipped ? `（另有 ${skipped} 项因缺参数跳过，不算通过）` : ''}`
    : `\nDEPLOY VERIFY FAILED：${failed} 项${skipped ? `，另有 ${skipped} 项跳过` : ''}`
)
/**
 * 只设 process.exitCode，不调 process.exit()。
 * 上一版在这里强退：Windows 下 fetch 的 keep-alive socket 还在关闭流程中被打断，
 * 打印完 PASSED 之后崩出 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 并返回 127。
 * 于是脚本"通过了却退出码非零"——对门禁来说这比没有门禁更糟，因为 CI 只看退出码。
 * 实测：改前连跑三次都是 PASSED + exit=127；改后 PASSED + exit=0，失败路径仍为 1。
 */
process.exitCode = failed === 0 ? 0 : 1
