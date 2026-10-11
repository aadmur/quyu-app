# 变更日志（CHANGELOG）

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 规范。

## [v8.13.0] - 2026-10-11 **上线**（19:55 CST）「识鱼」（迭代计划 v15，K3 鱼种识别 + 预付费计费闭环）

> 状态：🟢 **已上线**——2026-10-11 19:55 CST 生产切到 v8.13.0。线上 `/opt/quyu/dist/boot.js` 现为
> `565c1f8adc42c738…`（= 交付包内那份，逐字节核对过；切之前是 8.12.0 的 `7775cba9e3e0acc8…`）。
> 0015 迁移生效、结构核对五项全中、上线后 `verify-deploy` 10/10 PASS；逐条实测见上「部署记录」。
> 代码已提交 4 条到分支 `v14-post-interaction`，**仍未 push**（清点用 `git log --oneline 134dcd3..HEAD`，
> 别抄这里的条数——它会随文档提交过期），所以仓库内那份 CI **至今没跑过第一次**（v14 遗留的同一件事）。
> ⚠️ **下面这条洞现在已经是事实，不再只是风险**：生产 `/opt/quyu/.env` 里**没有 `MOONSHOT_API_KEY` 这一行**
> （上线前后各测一次，只数变量名不打印值），而悬浮球菜单**无条件**列出「识鱼 · 识鱼种」
> （`src/components/FloatingBall.tsx`）→ **此刻每个用户都点得进去，而每次识别都会回**
> 「识别服务暂未开通，请稍后再试」（412：不崩、不扣钱、退回免费次数——降级是干净的，但功能就是不可用）。
> 先配 Key 还是先把入口收起来，是 PO 的决定（B-43 未关闭）。
> 同样没关闭的还有：**识鱼准确率至今没有可复核的证据**（评测集实测 315 张 / 17 目录，脚本只打印不落盘，B-37）。

### 部署记录（2026-10-11 19:52–19:57 CST，workbench CLI 全程实测）

- **切之前先量线上身份**：`/opt/quyu/dist/boot.js` = `7775cba9…`（= 8.12.0），服务 `active`，`/` 剩 33G。
- **三个远端目标事先查过是否被占用**：`/root/dist-v8.13.0.tar.gz`、`/root/v15-deploy.sh`、`/root/v15-sql` **都不存在**
  → 没有"覆盖唯一副本"的风险（v14 那次踩过，见上一版部署记录），`/root/v15-sql/` 是本次新建的目录。
- **上传后逐字节核对**（三条全中，`bash -n` 过、CR=0）：
  | 文件 | 远端 sha256 |
  |---|---|
  | `/root/dist-v8.13.0.tar.gz` | `f89ede3fbcca21f4f0cbed6a30e0e5bf1012eb390463c2d9cbb47c14a27d83d8` |
  | `/root/v15-deploy.sh` | `c71b3f05da310201786c7ff3219bc57b0bed4e172949a025cf7216c4b9134323` |
  | `/root/v15-sql/0015_fish_id_run.sql` | `00b429ddeec64a746467e2cf90b01fa045c4d547bb4cba515f2b2fbdcc255464` |
- `bash /root/v14-resync-sha.sh /root/dist-v8.13.0.tar.gz /root/v15-deploy.sh` 把第 31 行的期望 sha 写成 `f89ede3f…`
  （原脚本备份 `/root/v15-deploy.sh.bak-before-sha-resync`）。**这条复用了 v14 那个脚本**：它与版本无关，
  只是默认值写着 v14 路径，所以这里显式传两个参数，而不是再造一份 v15 版——"两条对同一件事的路径"正是 B-32 记的那类坑。
- **`gates` 模式在生产上先跑一次**（本轮新增这一步的价值就在这里）：`GATES OK`、183 条目、45 个 `.br`，
  并且打印出"现役 dist = `7775cba9…` / 新包 = `565c1f8a…`"——即**确认闸门会放行、同时确认此刻还没切**。
  跑完再量一次 `boot.js` 仍是 `7775cba9…`，证明 gates 分支真的什么都没动。
- `bash /root/v15-deploy.sh` **exit 0**，六步逐条：
  1. 全库备份 `backups/quyu-before-v8.13.0-20261011-195540.sql.gz` → **31 表** / 含 `Dump completed`；
     **旧 dist 也归档**成 `backups/dist-before-v8.13.0-20261011-195540.tar.gz`（v14 那一步是手做的，这次进脚本了）；
  2. `0015_fish_id_run.sql` 两遍无错（第二遍全 skip）→ **生产 DDL 落地**；
  3. 结构核对（数值版，无字符串等式）：`fish_id_free_used=1 / v15 新表=2 / v15 新索引=5 / v14 收藏表=1 / v14 评论点赞列=1`；
  4. sha 期望=实际、解包核对、`.br`=45 ≥30；
  5. `mv` 旧 dist 到 `/opt/quyu/dist-replaced-v8.13.0-20261011-195540` → 原子替换 → `restart` → `active`；
  6. 复核：首页 200（裸 1477 B / br 协商 **504 B**）、`app.feed` 200、`app.posts.comments` 200、
     `app.fishId.balance` **401**（query 走 GET，未登录属预期——这条正是 v14 坏仪表会误报成 405 的那类）、
     三个 mutation 各 **400**（空入参被 zod 拦下，**没有真的扣费/写样本**）。
- ⚠️ **一个我自己的判据写错了但没造成事故**：结构核对那行 `v15 新索引` 我期望 3、实际 **5**，
  因为 `information_schema.STATISTICS` 会把两张新表各自的 **PRIMARY 也算进去**。断言当时写的是 `≥3` 而不是 `=3`，
  所以它没有误杀部署。下一轮把这条查询改成只数命名索引，让数字直观可信；**这次不悄悄改文档，如实记着**。
- **上线后复核**：`node scripts/verify-deploy.mjs --base http://47.109.185.118:3000 --tar E:/tmp/dist-v8.13.0-r1.tar.gz`
  → **10/10 PASS、exit 0**；线上入口 JS `/assets/index-MZH_DVpL.js` 与交付包同名成员逐字节一致（`0b47a7b8…`）；
  线上 `/opt/quyu/dist/boot.js` 现为 `565c1f8adc42c738…` = r1 包内那份 → **"线上跑的就是这份包"有直接证据**。
  另测：懒加载分块 `FishId-a5iwSAvf.js` 线上 **200**（改名/漏传那类 404 已排除）；`/opt/quyu/uploads/` 未被触碰
  （仍是 `avatars`、`posts`、`quyu-v11.apk`；`spots/` 会在首个授权样本写入时由 root 进程自动创建）。
- **回滚路径此刻是现成的**：`bash /root/v15-deploy.sh --rollback /opt/quyu/backups/dist-before-v8.13.0-20261011-195540.tar.gz`
  或布局无关的 `bash /root/v14-rollback.sh 同一份包`（回滚脚本仍只有这一条被演练过的路径，且**必须显式传路径**）。
  回滚只回代码：0015 是加法且新列带默认值，旧代码不读它们。

### 上线后当天热修：B-45 悬浮球（交付物 r3，**已就位、尚未切换**）

> ⚠️ 截至本节写完，生产跑的仍是 **r1**（线上入口 `index-MZH_DVpL.js`；r3 会换成 `index-Dks682rz.js`）。
> r3 已上传、期望 sha 已对齐、`gates` 已过，**只差最后那条由人执行的部署命令**
> （自动化通道执行它被策略连续拦下两次，按规矩不再换写法绕）。
> 切完请补实测：`node scripts/verify-deploy.mjs --base http://47.109.185.118:3000 --tar E:/tmp/dist-v8.13.0-r3.tar.gz`
>
> **r2 为什么作废**：它内容没错，但之后我又改了 `FloatingBall.tsx` 的两处注释，重构建后 95 个分块改名
> （掩码比对：只有 FloatingBall 与入口两块真实变化，其余 41 块是命名级联），`verify:handoff` 因此判
> "包 ≠ 当前源码"。我不上线自己门禁判 FAIL 的包，所以重出 r3。构建本身是**确定的**（连跑两次逐文件哈希一致）。

上线约 25 分钟后用户报「哪钓打不开」。排查过程与已排除项记在 backlog **B-45**
（一句话：**不是** APK 版本低、**不是**分块丢失、**不是**深链 404；线上服务端零 5xx，
而那天全天没有一条 `app.fishSpot.*` → 那一下点击就没走通）。根因是 v15 把悬浮球的"点按"
从 `navigate('/fish-spot')` 改成了"弹功能菜单"，而菜单又被钉在**视口右下角**，不跟随可拖拽、可持久化的球位。

**这次改了什么（判据都在 `src/lib/fishballMenu.ts` + 12 条测试里，不在肉眼）**

| # | 改动 | 为什么 |
|---|---|---|
| 1 | 点按 = **直接进哪钓**（恢复 v14 手感）；长按 ≥450ms = 弹功能菜单；位移 >6px = 拖拽吸附 | 三分支判定抽成纯函数 `classifyGesture`，用 `src/lib/fishballMenu.test.ts` 钉住；含"差 1ms 仍是进哪钓"这条边界用例 |
| 2 | 菜单位置改由 `menuAnchor(球的 rect, 视口)` 推导：横向与球同侧、纵向优先球上方、放不下翻到下方，最后钳进视口 | 同一夹具下断言：旧公式离球 **>150px**（实测 278px），新公式 **<120px**（103.9px），且两者必须给出不同结果——这道测试因此**能变红** |
| 3 | 遮罩关闭从 `click` 改绑 `pointerdown` | **降级为防御性改动，不是修 bug**：我原先假设"同一次点击的 `click` 会被刚渲染的遮罩接走、菜单自己关掉"，用户手工在 `file://` 夹具上点出来的日志是 `ballOld click 落到球` → **假设被证伪**，`click` 没有落到遮罩。所以"哪钓打不开"的成因只有第 2 条那一个（菜单钉在屏幕另一头）。保留这处改动只因为它按压即关、手感更直接，不再声称它修掉了什么 |
| 4 | 菜单/遮罩的可见性不再依赖 CSS 动画（基态可见，动画只做入场过渡） | 旧写法是 `opacity: 0` + `animation forwards`——一旦系统抑制动画就是"点了屏幕暗一下、什么都没出现" |
| 5 | 长按计时器在卸载/取消/拖拽时清理；拖走球时顺手关掉开着的菜单 | 球被拖走后屏幕上会留下一个悬空菜单；v14 收尾修过两条同类残留，这次不留 |
| 6 | 球上加 `onContextMenu` 屏蔽系统长按气泡 | 长按现在是正式手势，不能让安卓的复制/选择气泡盖住我们自己的菜单 |

**验证到哪一步、没到哪一步**：`tsc -b` 0、`eslint` 0、`vitest` **49 条**（23 + 14 + 12）全绿；
整条构建链（①–⑪）跑通；产物里核过旧锚点 `bottom:calc(...76px...)` 已消失、450 阈值与新定位在位。
**仍未被证明的是真机手感本身**（点一下是否立刻进、按住是否在球旁出菜单）——那要有实体设备点一次，
本机没有这个通道，我不拿"测试全绿"冒充它（同 B-39 那类口径）。

| 7 | **门禁补盲**：`verify:handoff` 新增一条"包内 `boot.js` 必须以 `createRequire` banner 开头" | 重出 r3 时我把 esbuild 的 `--banner:js=...` 漏了 → `boot.js` 里 65 处 `require(` 在 ESM 下必 `ReferenceError`，**服务根本起不来**。而当时的 handoff 是 0 失败——因为整树比对是"包 vs 本机 dist"，**两边出自同一次错构建就一起绿**。这条新判据先在真实坏包上跑出了红（`FAIL ... 首行="var __create = Object.create;"`，紧接着一行仍是 `PASS 交付包与本机构建逐文件一致`，这两行同屏就是它存在的理由），重出后才转绿 |

**交付物更替（三次，每次都记为什么）**

- **当前要上线的**：`E:/tmp/dist-v8.13.0-r3.tar.gz`，sha256
  `f193d392411ff961b5e0e14b2e05298db85014a05a6b823e8e02c97ef70e4696`
  （2,659,537 B / 183 条目 / 45 个 `.br`），入口 `index-Dks682rz.js`，悬浮球分块 `FloatingBall-BYS2Qd1d.js`
- r2（`f71987f1832104ef5202f09f25eeb8bebbcbec7217eb1ee8904554de05f1de17`）：内容正确但已与后续源码不同步，**作废**，本机留副本
- r1（`f89ede3fbcca21f4f0cbed6a30e0e5bf1012eb390463c2d9cbb47c14a27d83d8`）：19:55 上线的那一份，就是当前生产；
  现役 dist 在服务器另有归档 `backups/dist-before-v8.13.0-20261011-195540.tar.gz`
- **判据还是源码 diff**：这轮 `src/` 真改了（悬浮球），所以必须重传；tar 的 sha 变化本身不算证据（mtime 也会改它）

### 交付物与身份

- **当前交付物**：`E:/tmp/dist-v8.13.0-r2.tar.gz`，sha256
  `f71987f1832104ef5202f09f25eeb8bebbcbec7217eb1ee8904554de05f1de17`（183 条目 / 45 个 `.br` /
  条目全在 `dist/` 之下 / 无 `data-dbg` / 包内只有 `dist/`）——它修的是 B-45 悬浮球，见上节
- 首次上线用的 r1：`E:/tmp/dist-v8.13.0-r1.tar.gz`，sha256
  `f89ede3fbcca21f4f0cbed6a30e0e5bf1012eb390463c2d9cbb47c14a27d83d8`
  （183 条目 / 45 个 `.br`），已于 19:55 上线后被 r2 取代，本机仍留副本
- 包内 `dist/boot.js` = `565c1f8adc42c738a129781ce356270958a16dfd69e0fa91366dd517dc4ea949`（r1；r2 的 boot.js 未变，
  只有前端分块变了——服务端代码这轮没动），与本机 `dist/boot.js` 逐字节相同
- 判据仍然是**源码 diff**而不是 tar 的 sha：本轮 `src/api/db` 相对 8.12.0 有真实改动，所以这一份**必须重传**，
  不像 v14 那次"sha 变了但源码没变"的情形。

### 这一版做了什么（按锚点，不按叙述）

| 面 | 内容 | 锚点 |
|---|---|---|
| 识别链路 | 单次 K3 视觉调用 → Top-3 候选 + 置信度 + 鉴别依据；低置信**诚实降级不硬猜**；返回非 JSON / 结构异常各自抛 `K3Error('parse')` | `api/kimi/fishId.ts` `identifyFish` / `parseFishResult` / `FISH_ID_SCHEMA` |
| 知识库 | 16 种首发淡水鱼标准名 + 形态/鉴别要点，注入系统提示词压幻觉（零 token 本地检索） | `api/knowledge/fishSpecies.ts` `SUPPORTED_FISH` / `speciesPromptBlock` |
| 计费 | 前 `FISH_ID_FREE_LIMIT`(默认 3) 次免费，用完按 `FISH_ID_PRICE_CENTS`(默认 30 分) 扣**共享余额**；免费次数 `fish_id_free_used` 与钓点各档**分列记账**；CAS 先占位、失败**全额退还** | `api/services/fishId.ts` `identifyFishCall` |
| 台账合规 | `fish_id_calls` 只存元数据（鱼名/置信度/token/费用），**不存图片与正文** | `db/schema.ts` `fishIdCalls` |
| 样本门控 | `fish_id_samples` 仅在**显式授权**下写入；`scope=features` 不碰磁盘、`scope=image` 才落盘到 `uploads/spots/`；未授权时**一个字节都不写** | `api/services/fishId.ts` `maybeSaveSample` / `saveSampleImage` |
| 接口 | 4 个新过程：`app.fishId.balance`(query) / `identify` / `correct` / `sampleConsent`(mutation)，全部要求登录 | `api/feature-router.ts` `fishId` |
| 入口与页面 | 悬浮球改为「哪钓 / 识鱼」二选一菜单；新路由 `/fish-id`（懒加载） | `src/components/FloatingBall.tsx`、`src/App.tsx`、`src/pages/FishId.tsx` |
| 顺带 | 规则检索加了同参数缓存（热更时失效） | `api/knowledge/index.ts` `RULE_CACHE` |

### 上线准备里我修掉的四个真问题（不修就上线会出事）

1. **`0015_fish_id_run.sql` 当时只有手写版、没进 drizzle journal**（journal 停在 `14:0014_v14_comment_report`）。
   后果不是"生产建不出表"，而是**CI 的空库路径永远建不出这两张表**——两条 schema 悄悄分叉。
   已生成配对 `db/migrations/0015_fish_id.sql` + `0015_snapshot.json`，journal 现为 16 条（末条 `15:0015_fish_id`）。
   并给 `npm run verify:handoff` 加了两道**版本无关**的判据：每份 `*_run.sql` 必须有同名 journal 条目、必须有生成版配对。
2. **`verify:handoff` 自己写死了 v14**：默认 `--tar` 指到 `dist-v8.12.0-r8.tar.gz`、脚本清单点名三个 v14 文件、
   迁移断言硬编码 0013/0014、还要求 `journal 最后一条 idx === 14`。
   照它跑 v15 会**对着上一版的包报全绿**——和 v14 上线当天"服务器包与期望 sha 自洽"是同一类假绿灯。
   现在：`--tar` **必须显式给**（不给就硬失败并列出候选包），脚本改为扫 `scripts/v1\d-*.sh`，迁移判据改成上面那条通用规则。
3. **新部署脚本的第⑥步探针差点重犯 v14 的错**：v14 用 POST 调 query 过程，tRPC 恒回 405
   `Unsupported POST-request to query procedure`，于是**每次成功部署都会显红**（见 v8.12.0「部署记录」）。
   `scripts/v15-deploy.sh` 里 query 走批量 GET、mutation 走 POST，并把「路由没注册(404/405)」与「运行期故障(5xx)」分成两种红。
4. **`.env.example` 缺三个新变量**，会让 `verify:handoff` 第 4 项直接红。补齐时顺手查出一个**口径冲突**并如实写进注释：
   `FISH_ID_MIN_CONFIDENCE_X100` 唯一读它的是 `api/kimi/fishId.ts` 的 `isHighConfidence()`，
   而该函数**当前没有任何调用点**；真正决定文案的是 `api/knowledge/fishSpecies.ts` 的 `FISH_ID_MIN_CONFIDENCE = 0.55`
   和 `src/pages/FishId.tsx` `confidenceTone` 里另一个硬编码 0.55。
   → **改这个环境变量今天不会改变线上表现**，别把它当开关用（收敛成单一来源登记为 B-38）。

### 本轮实测到的证据（都是现跑，不是抄上一版）

| 检查 | 结果 |
|---|---|
| `bash -n` + CR 字节数 | `v15-deploy.sh`、`v15-deploy-drill.sh` 均通过、**CR=0**（仓库已钉 `*.sh eol=lf`） |
| 部署闸门演练 `npm run verify:v15-deploy` | **PASS 12 / FAIL 0**：该放行的放行（含 `./dist/` 这种纯写法差异不得误杀）、该拒绝的逐条拒绝（sha 不符 / 期望 sha 仍是占位符 / 包不存在 / `.br`=0 / 条目不在 `dist/` 下），且六次拒绝后**现役 dist 的 sha 未变**、没写 `backups/`、没替换 dist。演练第一跑就把我自己的夹具打回炉过一次（我把 `basename` 当成员打包，条目成了 `good/dist/…`，闸门判红是**对的**） |
| 构建链（①–⑪ 逐段跑，顺序未乱） | 字体预算 ✓ 图片 ✓ 埋点接线 ✓ 知识库 ✓ vitest ✓ 计划锚点 31/31 ✓ 直跑版迁移 ✓ vite build ✓ 动画边界 ✓ precompress(45 br) ✓ esbuild ✓ |
| `vitest run` | **37 passed（4 文件）**——23 条 v14 存量 + 14 条本轮新增识鱼测试 |
| 首屏预算（`scripts/smoke-static.mjs`，自起服务） | 主 JS = `index-MZH_DVpL.js`，**br 52.0 KB**（v14 是 51.9 KB → **+0.1 KB**，预算 ≤70）、CSS 6.5 KB（≤12）；br/gzip/identity 三种协商、ETag→304、按需 chunk（SpotFieldForm 1.3 KB / SpotExpertReport 1.4 KB ≤12）、埋点上报 8 项断言**全部 PASS**，脚本打印「全部通过」 |
| ✅ 同一次 `verify:static` 的退出码缺陷（**已修并复验**） | 第一次跑：断言全过、打印「全部通过」，进程却以 **exit=127** 收场（libuv 在 Windows 上收尾时抛句柄断言）。根因与 v14 修 `verify-deploy.mjs` 那次同族——`process.exit()` 在 socket 未摘除时打断 libuv，而**门禁只看退出码，退出码说谎比没有门禁更糟**（这句话本来就在 CHANGELOG 十五节里）。同一处方改完复验：**56 项 PASS、exit=0、无 assertion**。**仍没复验的是"它还能不能变红"**：占用端口 / 起桩服务这类夹具在本机被策略拦过，我没换通道重试 → 留在 B-44，不当作已闭环 |
| `check:sql` / `check:docs` / `verify:handoff` | 见本节末「收尾复核」 |

### 新测试钉住了什么、**没**钉住什么

`api/services/fishId.test.ts`（14 条）用桩数据源钉钱路与合规门控：有免费次数时只碰 `fishIdFreeUsed` 不碰余额、
免费用完才预扣 `balanceCents` 且扣的就是 `FISH_ID_PRICE_CENTS`、余额不足时**不调模型也不写台账**、
入参不是 `data:image/` 时**一次 UPDATE 都不许有**（扣费必须发生在格式校验之后）、
识别失败时付费退余额/免费退次数且台账记 `error`+`costCents=0`、
没配 Key 时回 412「暂未开通」而不是伪装成 500、未授权时样本表零写入且**磁盘零新文件**、
`scope=features` 写入但 `imagePath` 必须为 null、`scope=image` 才真落盘并自清、
台账字段里出现 `image|content|base64` 即判越界、首查会补 0 余额行（`onDuplicateKeyUpdate`）、
纠正反馈只打最近一条且超 32 字截断、无样本行时不许凭空 UPDATE。

**它没钉住的两件事，我不写成已覆盖**：

1. **SQL 守卫文本**（`fish_id_free_used < limit`、`balance_cents >= price`、退还的 `GREATEST(... -1, 0)`）。
   桩里那些 where 片段是 drizzle 私有结构，对它做字符串断言会在升级后悄悄退化成"匹配不到也算通过"；
   真验要连库，而本机 DB 层不可用。→ B-40。
2. **每条断言各自变红的证据**。我按规矩尝试往 `api/services/fishId.ts` 注入 4 个变异（不退还 / 改错余额列 /
   去掉 no-key 分支 / 忽略授权门控），**该操作被本机策略拦下，我没有换第二条通道重试**。
   已拿到的红是真实但不同的那一类：把桩的 `read/write` 从方法写成属性时 **13/14 立刻全红**，
   证明这 14 条确实在执行被测代码、不是空跑。→ B-39。

### 部署面：这一版会动生产什么

- 迁移：只有 **0015**（`user_balance.fish_id_free_used` + `fish_id_calls` + `fish_id_samples` + 3 个索引），
  全加法、新列带 `NOT NULL DEFAULT 0`、新表 `IF NOT EXISTS` → **回滚代码不需要回滚库**。
- 结构核对用**逐条数值比较**而不是 v14 那种 grep 一整串 CONCAT 字面量：v14 的写法差一个空格就会"永远拒绝部署"，
  而它当时能钉是因为有隔离沙箱；本轮本机没有可用 DB 层，**我不生产自己无法当场验证的字符串等式**。
- 备份：全库 `mysqldump`（判据仍是 ≥29 表 + `Dump completed`）**并且新增一步把现役 dist 也归档**
  （v14 只归档到 `/root`，是靠人手做的；这一步进脚本才不会再漏）。
- 期望 sha 由 `bash /root/v14-resync-sha.sh <tar> <deploy 脚本>` 现算（脚本本身与版本无关，只是默认值写着 v14 路径）。
- 回滚仍只有 `app/scripts/v14-rollback.sh` 这一条**布局无关**的路径，且**必须显式传备份路径**（B-36 的硬要求）。
- 未纳管旧账：`/root/v14-deploy.sh` 仍只在服务器上（B-32）。

### 上线后仍然欠着的东西（**这一版已经切上去了，所以下面每一条现在都活在生产上**）

- **MOONSHOT_API_KEY 未配** → 识鱼入口点了必回 412。要么先配 Key，要么先把入口收起来。
- **识鱼准确率没有任何留存证据**：评测集实测是 **315 张**（17 个目录，含 30 张干扰图），
  **不是**先前说的 534 张；而且 `scripts/eval-fishid.ts` 只 `printReport`、**从不落盘**，
  所以 `eval-fishid/results.json` 根本不存在，本机也没有 `.env`（拿不到真 Key）→ 之前"已跑批量评测"这句话
  **不成立**，Top-1 准确率是未知的。→ B-37。
- 评测集 39 MB 未决定要不要进 git（我没动 `.gitignore`，也没 `git add` 它）。→ B-41。
- v14 那三条真机 UI 行为依旧没有运行时证据，且**这一版又加了新的真机面**（悬浮球菜单二选一、`/fish-id` 拍照链路）。
- 阿里云机审仍未开（`IMAGE_MODERATION_ENABLED=false`），与 v14 同。

### 上线四步（第 0 步在本机，第 3 步也在本机）——**已于 2026-10-11 19:52–19:57 全部执行，逐条结果见上「部署记录」**——**已于 2026-10-11 全部执行，逐条结果见上「部署记录」**

0. `node scripts/verify-handoff.mjs --tar E:/tmp/dist-v8.13.0-r1.tar.gz` → 0 失败才算交接物本身对得上
1. 上传：`E:/tmp/dist-v8.13.0-r1.tar.gz` → `/root/dist-v8.13.0.tar.gz`；
   `app/scripts/v15-deploy.sh` → `/root/v15-deploy.sh`；
   `app/db/migrations/0015_fish_id_run.sql` → `/root/v15-sql/0015_fish_id_run.sql`
2. 上机：`bash /root/v14-resync-sha.sh /root/dist-v8.13.0.tar.gz /root/v15-deploy.sh`
   → `bash /root/v15-deploy.sh gates`（先看闸门，不碰任何东西）→ `bash /root/v15-deploy.sh`
3. 回本机：`node scripts/verify-deploy.mjs --base http://47.109.185.118:3000 --tar E:/tmp/dist-v8.13.0-r1.tar.gz`
   全 PASS；再 `sha256sum /opt/quyu/dist/boot.js` 应当等于 `565c1f8a…`

（步骤 2 的"先 gates"是本轮新增的用法：它把不可逆的部分和可回退的部分分开，出问题时能先知道是包不对还是库不对。）


## [v8.12.0] - 2026-10-07 上线（编码与本地验收完成于 2026-10-06）「帖子交互专项」（迭代计划 v14，A+B+C 全量，一次性交付）

> 状态：🟢 **已上线**——2026-10-07 15:15 CST 生产切到 v8.12.0，迁移已生效、结构核对通过、上线后复核 10/10 PASS，
> 逐条实测数字见下「部署记录」。分支 `v14-post-interaction` 已提交但**仍未 push**（**不写具体 commit 数**，
> 它在每次文档提交后就会过期；要清点用 `git log --oneline 134dcd3..HEAD`），因此仓库内那份 CI **至今没跑过第一次**。
> ⚠️ 「迁移与代码替换的顺序是硬约束，不可拆」这条已按序满足：新代码硬依赖
> `comments.{author_avatar,images,like_count,deleted_at}`、`comment_likes`、`post_favorites`、
> `reports.comment_id`、`idx_comments_post_like`、`idx_comments_parent`，缺任一都会运行期报错，
> 评论列表与收藏首当其冲——脚本先跑迁移、再核对结构，**结构不符就拒绝切码**，实测核对行与期望字面量逐字节相符。
> 需求对齐见 `docs/产品/迭代计划-v14-草案.md`，术语裁定见 `CONTEXT.md`，
> 不可逆决策见 `docs/adr/0001~0005`，运维与验收证据见 `docs/NEXT-ITERATION.md` 第九节。
> 主线：把「打开帖子」从路由跳转改为**全屏弹层**，顺手拆掉**帖子图片 base64 入库**这颗雷，
> 并把评论区从"能看"做到"能用"。

### 部署记录（2026-10-07 15:13–15:16 CST，全程实测）

- **执行通道**：本机 workbench CLI（阿里云 ECS 助手）打到 `quyu0001` / `i-2vce1c7cs1wy1fyhtzrw`（成都）。
  上一节写的"这一步只能人工"在**这一次被用户明确授权替换**：用户自行选中该 CLI 技能并下达"把最新版本上线"，
  我在只读准备全部做完后停在那条不可逆命令前，用「动作 + 目标 + 影响面」要了一次显式确认，答复是"直接执行部署"。
  策略边界因此是"**不可逆那一条必须先问**"，不是"自动化通道永远不能碰"。
- **切之前先自证线上身份**：`/opt/quyu/dist/boot.js` = `6b5897df98d8568a…`（= 8.11.0），
  服务 `active`，`/` 剩 33G。产物里没有任何版本字符串，所以"线上是哪一版"只能这样量，不能读文档。
- ⚠️ **上一节那条 sha 记录已过期，且照它做会放行错包**：服务器上 `/root/dist-v8.12.0.tar.gz` 实际是
  `921d3f14872d9c4a…`（不是文档写的 `ca1c4a00…4532f`），而 `/root/v14-deploy.sh` 第 23 行的 `SHA_EXPECTED`
  **当时已经等于 `921d3f14…`**——也就是"产物已过期"这件事被一个自洽的旧 sha 对完全掩盖了，
  直接 `bash /root/v14-deploy.sh` 会**用一份错的产物通过 sha 闸门**。
  `921d3f14…` 与本机 `E:/tmp/old-builds/` 里 r2…r7 及那份 `dist-v8.12.0.tar.gz` 的 sha **一个都不对得上**
  （尺寸也各不相同），即服务器上那份是本地无副本的唯一一份 → 我没有覆盖它，而是改名留档
  `/root/dist-v8.12.0.tar.gz.stale-921d3f14`（这个文件名不匹配脚本用到的任何 glob），再上传新包。
  **教训**：看到"本地 sha ≠ 文档 sha"时，先量服务器实际值、再 diff 源码；文档里记的摘要只是历史快照。
- **交付物上传与逐字节核对**（上传前逐个查过远端目标是否存在并告知覆盖）：
  `E:/tmp/dist-v8.12.0-r8.tar.gz` → `/root/dist-v8.12.0.tar.gz`，服务器端 sha
  `bafa1fec8370f7525b43f9ebf98013e7a436be956dc16fe1dcde2b090b424ddd` 与本地**完全一致**；
  `scripts/v14-resync-sha.sh`（`33384bec…`）、`scripts/v14-rollback.sh`（`37c4e763…`）也逐字节一致。
  **这两个脚本此前根本不在服务器上**——即"要回滚了才发现机器上没有退路"那种情形真的存在过，现已就位；
  三个远端文件 `bash -n` 均通过，包内 180 条目、44 个 `.br`、条目全部在 `dist/` 之下。
  `/root/v14-sql/001{3,4}_*_run.sql` 与仓库版 sha 相同（`ec097f08…` / `f1748feb…`），无需重传。
- `bash /root/v14-resync-sha.sh` 把 `SHA_EXPECTED` 从 `921d3f14…` 改写为 `bafa1fec…`，
  原脚本备份在 `/root/v14-deploy.sh.bak-before-sha-resync`，改写后 `bash -n` 通过。
- `bash /root/v14-deploy.sh` **exit 0**，六步实测输出：
  1. 新备份 `backups/quyu-before-v8.12.0-20261007-151455.sql.gz` → 29 表 / 24 INSERT / 含 `Dump completed`；
  2. `0013`、`0014` 直跑版各两遍无错（第二遍全 skip）→ **生产 DDL 已落地**；
  3. 结构核对行 = `comments 新列=4 / 新表=2 / reports.comment_id=1 / uq_report 列数=3 / 评论新索引=2`，
     与脚本字面量逐字节相符 → 允许切码；
  4. sha 期望=实际 `bafa1fec…`；解包有 `dist/boot.js` + `dist/public/index.html` + 126 个 assets；`.br` = 41 ≥ 30；
  5. `mv` 旧 dist 到 `/root/dist-replaced-20261007-151455` → 原子替换 → `systemctl restart quyu` → `active`；
  6. 线上探针：首页 200（裸传 1477 B / br 协商 503 B）、`/api/perf` 204、三条 tRPC 探针 **405**（见下条，是仪表坏了）。
- **`v14-deploy.sh` 第⑥步是一个每次成功部署都会显红的坏仪表（尚未修）**：它用 **POST** 去调
  `app.posts.comments` / `app.posts.myFavorites`，而这两个是 **query** 过程，tRPC 按协议回
  `405 METHOD_NOT_SUPPORTED`（报文原文 `Unsupported POST-request to query procedure at path "app.posts.comments"`）
  ——**健康的服务器上也是这样**。脚本第⑥步不参与退出码，所以它只是误导人，不会拦下部署。
  该脚本**只存在于服务器上、不在仓库里**（`app/scripts/` 没有它），因此这段逻辑没有版本、没有测试、下次还会骗人；
  要修就得把批量 GET 形态（`?batch=1&input=<编码后的批>`）写进去并实际验一次。
  顺带一条我自己的假警报：第一次手探时我用 `?input=` 却没带 `batch=1`，得到 400 `expected object, received undefined`
  ——那是**我的探针写错**，不是服务故障；journal 里那段时间每个真实请求都是 `status:"ok"`。
- **上线后复核 `node scripts/verify-deploy.mjs --base http://47.109.185.118:3000 --tar E:/tmp/dist-v8.12.0-r8.tar.gz`
  → 10/10 PASS、exit 0**，其中两条是新信息：
  ① 线上入口 JS `/assets/index-HdRk0PXS.js` 与交付包同名成员 sha256 相同（`0df9389f4750801c…`），
  线上 `/opt/quyu/dist/boot.js` 现为 `7775cba9e3e0acc8…` = r8 包内那份 → **"线上跑的就是这份包"有直接证据**；
  ② v14 第一次在生产使用的 `JSON_*()` 查询函数（`postCoverSql`，被 feed/detail/comments 共用）**真的跑通了**，
  journal 显示 `app.feed` 7ms、`app.posts.detail` 7ms、`app.posts.comments` 10ms、`app.posts.myFavorites` 4ms 全 `ok`
  → 第「已用证据清掉的上线风险」里那条"生产引擎可能是 TiDB、未必支持 JSON 函数"的悬案**由观察收敛**，
  但仍然没有一次 `SELECT VERSION()` 实测，口径冲突本身还挂着（见 `docs/NEXT-ITERATION.md` 第九节）。
- **回滚这条路已实测可用（B-32 的未知布局疑问现在有答案）**：备份包 `/root/dist-before-v8.12.0-20261006-205956.tar.gz`
  的条目以 `dist/` 开头，解到 `/tmp/rb-probe-20261007` 后包内 `boot.js` 哈希
  `6b5897df98d8568a…`——与切换前线上那份**逐字节相同**，即它确实是正在被替换掉的那一版。
  因此脚本自带 `--rollback` 分支的 `--strip-components=1` 对这份包**是正确的**，布局无关的
  `bash /root/v14-rollback.sh /root/dist-before-v8.12.0-20261006-205956.tar.gz` 同样正确（**回滚必须显式传路径**，
  自动挑最新那份的改动已被 B-36 回退）。回滚只回代码，不回库。
- **仍未生效的东西别说它生效了**：`IMAGE_MODERATION_ENABLED` 依旧是 `false`，
  图片机审**在生产上没有开着**；`PUBLIC_MEDIA_BASE_URL` 也未配。

### 上线状态（2026-10-06 生产预检实测）

- **迁移面比预想小得多**：未删帖 13 条中**仅 1 条**的图片仍是 base64，`posts.images` 合计
  **0.93 MB**；`comments=4`、`likes=4`、`reports=3`。0013/0014 确认**尚未应用**。
  → 这颗雷**还没积累实际伤害**（真实 UGC 图帖量极小），ADR-0002 的存量迁移预案可大幅减重；
  回填只剩 1 条，成本极低，建议顺手做掉（能让该帖在信息流恢复封面）。
- 已完成：全库备份 `backups/quyu-before-v8.12.0-*.sql.gz`（29 表 / 24 INSERT / 含
  `Dump completed` 结束标记）；旧 dist 归档 2.5M；`uploads/` 确认存在（11M，含 avatars）且
  热更流程不触碰它；0013/0014 直跑版已上传 `/root/v14-sql/`；
  `dist-v8.12.0.tar.gz` 上传后**服务器端 sha256 与本地一致** `ca1c4a00…4532f`
  （⚠️ 这一份随后被机审返工判为过期，上线当天服务器上的实际值又既不是它、也不是本文档记的任何一份——
  以 `6b5897df…` 为切出点的那次部署实测见上「部署记录」第二条），
  tar 内 **44 个 `.br`**、**0 条反斜杠路径**（避开 v8.10.x 那类改名/打包致 404 的形态）。

    > 📌 **撤 B-24 之后我重建了一次产物，本地 sha 变成 `61dfeb7a883de1a2bb1916319716f0f3ac4269576f3184b28a98421c726df01c`，
    > 但服务器那份不必重传，脚本里的期望 sha 也不必改**——两者内容等价，证据是
    > `git diff 96526e7..HEAD -- src api db scripts package.json vite.config.ts` **输出为空**（上传点之后没有任何源码
    > 变化；B-24 的三次试验改动已回退、临时 `data-dbg` 诊断也只活在本机沙箱）。tar 字节之所以不同，只因为
    > `tar` 会把文件 mtime 写进头部。**为什么要把这条留在日志里**：sha 是部署的硬闸门，未来任何人看到
    > "本地 sha ≠ 服务器 sha"都会条件反射地以为产物过期、进而误改 `SHA_EXPECTED` 或误重传；
    > 判定依据应当是**源码 diff**，不是 tar 的 sha。部署前自证一次：
    > `sha256sum /root/dist-v8.12.0.tar.gz`（期望 `ca1c4a00…4532f`）→ 与 `/root/v14-deploy.sh` 里的 `SHA_EXPECTED` 对齐。
    > ⚠️ 上线当天这条自证**没能挡住错包**：服务器上那份已经是第三个值 `921d3f14…`，而脚本里的期望 sha **早已跟着它对齐**，
    > 所以"闸门通过"和"包是对的"是两件事。真正管用的顺序是：**先量服务器那份到底是谁**（和本机各包 sha 逐一比对 +
    > 源码 diff），把它改名留档，再上传要发的那一份，最后用 `v14-resync-sha.sh` 把闸门钉到新包上。

  ⚠️ **这里出过一次真实的部署物缺陷，留痕以免重犯**：我第一版打包的链子写成
  `vite build && esbuild && tar`，**漏了 `precompress.mjs`** → tar 内 `.br` 数为 **0**。
  照那份产物部署，`boot.ts` 没有 brotli 变体可做内容协商，所有 JS/CSS 按未压缩传输，
  首屏会从 **189.4 KB 退化到约 611 KB**，等于把 v12 性能专项当场清掉；而且它与其后的
  代码改动不同步，sha 校验也会失败。已按规范完整链重出，并在脚本里加了一道硬闸门：
  **解包后 `.br` 少于 30 个即中止部署**。该闸门用真实目录结构做过三例功能测试
  （41 个→放行 / 0 个→中止 / 边界 29 拦、30 过）。
  > 顺带一条自我纠正：我往脚本里插第一版守卫时，嵌套引号把 `$BRN` 吃成了 `[ "" -ge 30 ]`——
  > `bash -n` 完全通过，却会让**每次部署都中止**。再次印证语法检查不等于功能正确，
  > 闸门类逻辑必须真跑一遍它的两种结局。
- ~~待人工~~ **已执行（2026-10-07 15:14，逐条实测见上「部署记录」）**：
  `bash /root/v14-resync-sha.sh /root/dist-v8.12.0.tar.gz /root/v14-deploy.sh`
  把期望 sha 对齐到重传后的产物（机审返工动了 `api/`，旧那份确实过期），再 `bash /root/v14-deploy.sh`。
  脚本自带的六道闸门**全部真的触发过**：备份完整性校验（29 表 / `Dump completed`）、迁移跑两遍验幂等、
  **结构不符则拒绝切代码**（本次相符）、sha256 比对（改对齐后才通过——这条正是它该做的事）、解压结构核对、
  原子替换、`systemctl restart` 后 `active`；服务没起来时会打印一条命令回滚 dist，并有 `--rollback` 分支。
- **部署脚本本身已在沙箱逐项验证**（隔离 MySQL 26.7 + 真 tar 往返）。这一步不能省：脚本里
  任何一条判据写错，都会在**生产执行的那一刻**才暴露，那是最坏的发现时机。

  | 脚本假设 | 沙箱实测 |
  |---|---|
  | `tail -3` 找得到 mysqldump 的 `Dump completed` 标记 | 确有 `-- Dump completed on …` 为末行，判据成立（否则会**误杀一份好备份并拒绝部署**） |
  | 表数 `≥ 25` 的合理性 | 隔离库 dump 得 31 表 / 18 条 INSERT；生产实测 29 表 / 24 条 |
  | 结构核对要 grep 的字面量与 MySQL 实际输出相符 | `CONCAT(...)` 输出与脚本字面量**逐字节一致**（差一个空格就会"结构不符拒绝切码"，导致永远部署不上） |
  | 前向解包后存在 `dist/boot.js` + `dist/public/index.html` | 成立，126 个 assets 齐全 |
  | `--rollback` 的 `--strip-components=1` 能还原正确布局 | 成立。上线当天在服务器**那份真备份**上量到条目以 `dist/` 开头、包内 `boot.js` = 切换前线上的 `6b5897df…`——这是第十七节里"B-32 说本机读不到所以无法定论"的实测补齐 |
  | 幂等重跑的 `skip:` 输出**不会**被错误探测误判为失败 | 第二遍输出 16 行 `skip:`、命中 `ERROR` 正则 **0 行** |

  注：第一次跑 dump 判据时我的 `execSync` 用了 MSYS 风格路径，Windows 找不到 mysqldump，
  得到"0 个 CREATE TABLE、无 Dump completed"——那是**调用失败的假阴性**，不是结论。
  改用 bash 真跑才拿到上面的有效证据。

### 一、架构改动（ADR-0001 / 0002 / 0004 / 0005）

- **列表内点击帖子 → PostSheet 全屏弹层 + URL 同步**：打开时 `pushState` 到 `/post/:id`、关闭时
  `history.back()`；`/post/:id` 路由保留只服务深链冷启动。两者共用 `PostContent`，
  **不存在两套渲染**（`PostDetail.tsx` 从 696 行降到 42 行）。根因：`/` 与 `/post/:id` 是
  `Layout` 下兄弟路由，走 `navigate` 会把 Home 整棵卸载，分页累积/滚动位置/tab/点赞态全丢。
- **图片 hero 共享元素转场技术上不可行**（不是没做）：它要求列表项与详情页两侧都挂 `layoutId`，
  而 `FeedPost` 在首屏静态闭包内，`check-motion-boundary.mjs` 禁止，违规即 build 失败。
  最终做 idle 预加载 + 纯 CSS `translateY` 上滑；`PostSheet` 独立 chunk 仅 **2.21 kB**（gzip）。
- **删除 `CommentSheet`（-150 行）**：它平铺展示、完全忽略 `parentId`，与详情页的两层楼中楼树是
  「同一份数据两种形态」，且乐观追加靠"作者+内容"字符串去重（同名同文会误删）。
  列表页评论按钮改为开弹层并聚焦输入框。
- **整卡可点 + 信息流取消双击点赞**（单击零延迟）；弹层/详情页内保留双击并修了时序 bug。
- **帖子图片改为磁盘落盘**，不再 base64 入库（详见下方「拆弹」）。
- **评论点赞新建 `comment_likes` 独立表**，不复用 `likes`（后者是 post 专用且 B-06 记有事务隐患）。

### 二、拆弹（QY-PERF-009/010）：帖子图片 base64 入库

`pickImages()` 返回 dataURL → `Publish.tsx` 原样传入 → `createPost` 直接写进 `posts.images`
JSON 列；项目**没有** `/api/upload`、无大小校验，`bodyLimit` 50MB 等于不设防。
至今没炸只是因为生产库里几乎都是 seed 的静态路径 `/feed-N.webp`。

- `recallCandidates()` 原为 `db.select()` **全列**含 images，一次拉 `RECALL_LIMIT` 条进
  **进程内存共享缓存**；`mapFeedPost` 又全量透传前端。真实用户发 9 图帖 ≈ 2-4MB 挤一行 JSON，
  首页传输会从 189KB 涨到 MB 级、v12 性能专项成果当场归零。
- 现在：`imageStore.ts` 落盘 `uploads/posts`/`uploads/comments`（沿用 `profileService` 已有链路），
  `recallCandidates` 改显式列排除 images，**feed/搜索/关注/收藏四类卡片统一只带 `cover`**。
- `postCoverSql` 对首图 **>512 字符判 null**（实测 300KB 与 623 字符的 base64 都被挡住），
  代价是遗留 base64 帖在信息流里**没有封面**，需靠 `scripts/migrate-post-images.mjs` 回填（B-14）。
- 搜索载荷实测体积 **5.5KB → 1.7KB（−69.2%）**；并补上 LIKE 通配符转义（此前搜 `%` 会捞出整表）。

### 三、评论区能力

游标分页 `(createdAt,id)`（原硬截断 50 条，第 51 条起永久不可见）；**热门/最新双排序**
（两套游标物理隔离，各走 `idx_comments_post_created` / `idx_comments_post_like`）；
楼中楼每楼预览 2 条 + 子回复分页；评论点赞；删自己评论=软删 + 「该评论已删除」占位且**不塌楼**；
真实头像（新增 `comments.author_avatar`，废除 `(userId+id)%7` 假算法）；评论图片；评论级举报。

### 四、术语裁定

**「渔获集」是幽灵术语，禁止使用** —— 它从未对应任何表/页面/功能，只存在于一句 toast 文案里，
而 `/favorites` 标题是「我的收藏」且只收钓场。收藏文案统一为「已收藏」，
帖子收藏归集到 `/favorites` 新增的「帖子」Tab（新表 `post_favorites`）。

### 五、合规（ADR-0003）

接入阿里云内容安全图片机审。**官方已核实**：按量付费通用版 $0.6/千次（高级 1.2 / 入华 0.7）。
⚠️ 本节上一版还写着「API 支持 URL 或二进制提交、**图片无需公网可访问**，所以审核能真正发生在落盘之前」——
**那句是错的**，第十节用官方文档推翻并返工了整条链路（实际只能按图片 URL 提交，故审核在落盘之后）。
⚠️ **`IMAGE_MODERATION_ENABLED` 默认 false**：ROA 签名规则已按文档校正（见第十节），但**仍未打真实网关**。
未配置时降级为「放行 + 写 `reports` 待人工复核」——
这是产品决策不是技术决策，代价是审核队列随带图发布增长。签名错的后果是 4xx→走降级，
不会误伤发布，但**也不等于机审已生效**。

### 六、本地验收证据（全部为实测，非纸面推断）

- **静态门禁全绿**：`tsc -b` 0 错、`eslint .` 0 problem、`check-fonts`/`check-images`/
  `check-perf-wiring`/`check-knowledge` 全 PASS、`vite build` 成功、
  `check-motion-boundary` 四项不变量 PASS（首屏闭包 62 → 67 文件，`PostDetail` 升入 `LazyMax`，
  domMax 未泄漏进首屏 chunk）。全仓 `as any` **0 处**。
- **首屏 189.5 KB br**（v13 基线 189.0 → **+0.5 KB / +0.3% 微回退**，未粉饰）；
  主 JS br 51.9（预算 ≤70）、CSS br 6.4（≤12）、字体 34.4（≤40）均在红线内。
- **`smoke-static.mjs` 全部通过**（含 QY-PERF-008 埋点六项断言、ETag/304、按需 chunk 校验）。
- **迁移**：隔离 MySQL 26.7 按「生产真实路径」（drizzle 0000-0010 + 直跑版 0011→0014）重放，
  与 drizzle 全量比对仅 2 处**刻意保留**差异（`comments.images` 默认值）；四个直跑版重跑两次幂等。
- **接口运行时**：隔离库起 `NODE_ENV=production` 服务打 tRPC，**39 项断言通过**
  （游标分页零重叠、`replyCount` 聚合、软删不塌楼、热门排序、`liked/collected` 回显、
  评论级举报与守卫、**图片落盘发帖+评论双链路实测端到端**：base64 进 → `/uploads/*` 出 → HTTP 200）。
- **回填工具四条路径实测**：dry-run / `--apply` / 幂等重跑 / `--rollback` 全部符合预期。

### 七、顺手修掉的非本轮问题

- `0011_fish_spot_run.sql` 三行裸 `CREATE INDEX` 使其**根本不可重跑**（第二次报
  `Duplicate key name`），与自身声明的"幂等"矛盾，恢复演练会在第 38 行中断 → 已补守卫。
- 修正了 `0013_run.sql` 头注释里一条**错误的理由**：无默认值的 `ADD images json NOT NULL`
  实测**不报错**，而是把历史行静默填成 `NULL`、违反自身 NOT NULL 声明（前端拿到 null 会崩且
  极难归因）；CI 跑空库永远发现不了这一点。
- 修正 `smoke-static.mjs` 的两个静默失效条件（缺 env 时服务起不来；3100 被占时会**测到别的服务**
  且体积/图片照样全绿）——已写入运维文档。
- `BottomSheet` 缺失的可用性补齐：PostSheet 加下拉把手（也是唯一可拖锚点）+ Escape 关闭；
  并用 ref 做关闭幂等守卫，避免连按 Escape 触发两次 `history.back()` 把用户甩出首页。
- **`pickImagesWeb` 遇到损坏文件会永久挂死**（B-20）。原先只有发布页走这条路，v14 把
  评论配图也接了上来，等于把一个静默挂死从一处扩到两处，因此本轮一并修掉：逐张 try/catch，
  坏图跳过、好图保留、Promise 必定结算。已在浏览器实证——喂「1 个损坏 + 1 个合法 PNG」，
  `createImageBitmap` 对损坏文件确实 reject（`InvalidStateError`），而新代码返回
  `settled=RESOLVED`、按钮恢复可用、缩略图 1 张、计数 `1/4`。
- **顶层「加载更多评论」失败后是死按钮**（B-21）：游标已等于「在请求里的那个」时再写同一个值
  不会改变 query key，react-query 根本不重发。改为此时走 `refetch()` 并把文案切成「重试加载评论」，
  与楼内 `CommentReplies` 的样板对齐（那处由同事本轮补，这两处口径现已一致）。

### 八、浏览器实测（隔离库 + 生产模式服务 + 真实会话）

内置浏览器视口不可见时指针动作会被拒，改用**派发原生 `click` 事件 + React 受控输入的原生
setter** 驱动（React 合成事件照常收到，属真实状态流，不是 mock）。以下均为浏览器里的实际返回值：

| 验的东西 | 实测结果 |
|---|---|
| 卡片点赞即时反馈（**本轮我自己引入又修掉的回归**） | `点赞 → 取消点赞`，计数 `+1`，`changed=true` |
| 点卡片打开 PostSheet | `[role=dialog]` 出现，`aria-label="帖子详情"` |
| URL 同步 | 打开后 `location.pathname === /post/3`；`history.back()` 后回到 `/` 且弹层消失 |
| ★ 返回列表后状态保持 | 点赞态与计数**都还在**（`已赞态保留`，33216 不变）—— 旧架构 Home 卸载必丢，这是本轮核心卖点的直接证据 |
| 弹层与列表共享互动态 | 列表里赞过后，弹层按钮直接显示 `取消点赞` |
| 评论排序切换 UI | 真实 DOM 中存在 `评论按最新排序` / `评论按热门排序` 两颗按钮 |
| 评论图片上传入口 | 真实 DOM 中存在 `拍照附图` / `从相册选择评论配图` |
| 发评论写路径 | 新评论出现在 DOM、输入框自动清空、区头计数 `0 → 1` |
| 搜索卡片有封面（缺口 #2 的 UI 端） | 搜「翘嘴」得 5 张卡，**5/5 均渲染出封面** |
| 幽灵术语 | 界面文案已无「渔获集」；卡片 aria-label 为 `查看评论，共 33 条（含回复）`（口径写进标签） |
| 评论按钮 → 开弹层且**输入框真的拿到焦点** | `document.activeElement.placeholder === "说两句…"`（QY-POST-006） |
| idle 预加载真实生效 | **点击之前** `PostSheet-*.js` 与 `PostContent-*.js` 已在 `performance` 资源条目里（4993ms 时由 load/4s 兜底触发）→ 点开零等待 |
| 热门/最新切换真的换序，且**两套游标不串页** | 最新序首五条 `冒烟管理员/作者1/作者2/已删除/作者4` → 热门序变 `作者5/4/3/2/1`（正对应 likeCount 24→20 降序）；**切回最新后与原始顺序逐字一致**（QY-COMM-011） |
| 楼中楼「展开更多回复」 | 按钮文案 `展开更多回复 (4)`，点击后按钮消失（已展平）、回复节点增多（QY-COMM-012） |
| 软删不塌楼（真实 DOM） | `该评论已删除` 之后紧跟着它楼下的「我还在这楼里」——不是只靠纯函数单测证明的 |
| 评论点赞 | 点击后 aria-label 从 `点赞评论` 翻成 `取消点赞评论` |
| 评论级举报入口 | 弹层里**每条非本人评论都有「举报评论」**；而「删除评论」**只出现在自己写的评论上** → 权限按 `authorId` 判定而非昵称 |
| 点赞防连点（网络层） | 包装 `fetch` 计数：**连点 3 次只发出 1 次** 点赞请求（QY-POST-015） |
| 正文折叠 | 造一条 191 字长帖，`.line-clamp-4` 存在、「全文」→点击变「收起」；短帖正确地不出按钮（QY-POST-012） |
| **深链冷启动仍走路由页**（ADR-0001 保留 `/post/:id` 的理由） | 直接访问 `/post/52` 能渲染作者与正文，不依赖先经过列表 |
| 冷启动 + 接口失败的降级体验（B-24 复核，结论为"正常"） | 断库实例下：7 张演示卡、toast「网络异常，展示本地内容」、点演示卡诚实提示且不误开弹层、无卡死骨架 |
| 健康路径不误报降级 | 正常实例下 5 张真实卡、无降级 toast（`mockFallback` 正确为 false） |
| 收藏闭环（QY-COMM-017） | `/favorites` 标题「我的收藏」+ 两 Tab `我的收藏·钓场` / `我的收藏·帖子`；切帖子 Tab 后渲染出已收藏的帖，非空态 |

**一处先「验不到」、后来真验到了的（过程值得留）**：QY-POST-017「离线演示数据下点击要有明确反馈」在第一批
探针里只有代码级依据。当时的手法是 SPA 内切走再切回强制 Home 重挂载，同时把 `app.feed` 的 fetch 改为永久
reject；`mockFallback` 之所以看起来"永不成立"，真实原因是 react-query 在 refetch 失败时保留上一次的数据，
且第二次重挂载连请求都没再发（`__feedCalls` 停在 1）。**那个手法确实造不出该状态**；第三批探针换成
「断库实例 + 无缓存冷启动」（请求真的以 `error` 结算）才验到，结论就是上方表格最后两行。

> ⚠️ **一次值得留下的自我纠错**：中间我一度基于"articles: 0"断言这是 v14 重构引入的**真回归**（立案 B-24，
> 结论"兜底永不触发"），并据此连改了三版 `mockFallback` 派生式。**全是错的**，而且错因很典型：
> 第一次取样发生在请求尚未结算的时刻（react-query 重试期间 `status` 仍是 `pending`），
> 于是三次都在修一个不存在的 bug。真相靠**临时把查询状态渲染进 DOM**、读一次就结束了：
> `{st:"error", err:true, eu>0}` → `mockFallback: true` → `articles: 7`。已提交代码从头到尾都是对的
> （`Home.tsx:280` 的 `feedQueries.some((q) => q.isError)` 无需改动）。
> 教训两条：① 断言"某状态永远不成立"之前，先确认观测时机覆盖了它的完整生命周期；
> ② 状态可疑时想办法**直接读出那个状态**，而不是替换判据碰运气——后者会把干净代码改脏。
> 三次试验改动已全部 `git checkout` 回退，`git diff src/pages/Home.tsx` 为空；B-24 在 backlog 里
> 改成了「误报，已撤回」并保留该条以记录方法论。

> 这批探针里我有**三次假阴性**值得记下，因为它们的形态很像"功能坏了"：
> ① 查排序变化时用了不存在的 `[data-cid]` 属性，取到空数组，于是"顺序没变"；
> ② 评论点赞的标签是 `点赞评论/取消点赞评论`，我写成 `取消评论点赞` 才误判"按钮不存在"
> （其实那次点击已经成功）；③ 正文折叠在短帖上本就不该出现，我拿短帖去验得到"没有按钮"。
> 三次都是**先 dump 真实 DOM 再重测**才拿到正确结论。写断言前先确认选择器，别拿猜测当证据。

**新发现（浏览器里才看得见，seed 数据造成的误导）**：同一张帖卡片标 `共 33 条（含回复）`、
弹层区头标 `共 0 条讨论`。根因不是 B-17（那是"回复算不算"的口径差），而是
**`db/seed.ts` 给种子帖凭空写了 `commentCount`/`likeCount`，却没有建对应的 comments 行**。
后果是：任何拿这两个计数做一致性对比的验证，在种子数据上都会得出错误结论。已登记 backlog。

**仍然只有真机能验（我没有做、也做不到）**

下拉关闭的**触摸拖拽手感**（`BottomSheet` 只接受非 mouse 指针，桌面浏览器无从触发）、
键盘弹起时评论吸底条是否被吃掉（`visualViewport` 在无硬件键盘的环境不触发）、
横滑与单击放大的误拦阈值（12px 量级的真实手指抖动）、iOS WebView 上排序 Tab 下划线的对齐、
安卓物理返回键。这些需要你在手机上过一遍。

### 九、明确未做 / 已知边界

- **`v14-deploy.sh` 第⑥步是一台每次成功部署都会显红的坏仪表**（用 POST 调 query 过程 → 恒 405），
  而这个脚本**只在服务器上、不在仓库里**——没有版本、没有测试、没人能审。下一轮该把它纳管，
  探针改成批量 GET 形态（`?batch=1&input=<编码后的批>`）后真跑一次再交付。详见「部署记录」。
- **已切上线但至今没有运行时证据的，仍是这四类**：三条真机 UI 行为（举报弹层重开是否干净 /
  关注乐观态会不会被 refetch 盖回 / 退出登录是否清掉前一个账号的高亮）、阿里云真实网关联调
  （QY-SAFE-003）、生产库 `SELECT VERSION()`（TiDB 与 MySQL 8 的口径冲突仍无实测，但 JSON 函数
  已在生产跑通这一事实由上线后复核给出）、直跑版迁移的 **ALTER 分支**（CI 那步只会走 skip，B-34）。
  前两类要用户的设备与 AK，后两类要一个能连生产库的通道。
- **图片机审在生产上并没有开**：`IMAGE_MODERATION_ENABLED` 仍为 `false`，`PUBLIC_MEDIA_BASE_URL` 未配。
  "v14 已上线" ≠ "违规图会被拦"。
- feed 本体 offset→游标 **B-10 仍在**（本轮只做了评论游标分页）。
- 存量 base64 回填**未执行**（工具就绪，取决于生产预检命中行数；见下）。
- 渔获墙 / 审核队列仍全列读 `posts.images`（**B-18/B-19**）：前者是真缺陷（2-4MB 白传给客户端，
  且四个统计查询都漏了 `isNull(posts.deletedAt)`）；后者刻意保留但出参只透出第 0 张，
  违规图若在九宫格后段则审核员看不到。
- ~~信息流接口失败兜底被本轮重构退化（B-24）~~ **B-24 是我误报，现已撤回**：兜底实测正常，无待修项。
  误报是怎么产生的、以及两条方法论教训，记在第八节末的自我纠错块里。
- 评论计数两套口径同屏（**B-17**）。
- **热门排序游标漂移已实测量化**：锚点期间某条被刷高赞会使其从下一页**漏 1 条、重复 0 条、
  不串页**，属有界退化（见 `docs/NEXT-ITERATION.md` 第五节）。
- 楼内「展开更多」在底部、拉出的是更老的回复、位置出现在按钮上方 —— 前端无法在不牺牲
  阅读顺序的前提下修掉，已在 `commentTree.ts` 注释里记为结构性取舍。

### 十、上线前必须由你完成

1. ~~生产库预检~~ **已完成**（只读查询被放行，我跑了）：未删帖 13 条中仅 1 条图片仍是
   base64，`images` 合计 0.93 MB，`comments` 仅 4 条 → 存量迁移面极小，回填建议顺手做掉。
2. ~~**执行迁移与切码**~~ **已完成（2026-10-07 15:15，生产即 v8.12.0）**：`bash /root/v14-deploy.sh` 六道闸门逐条触发、
   `verify-deploy --tar` 10/10 PASS（见上「部署记录」）。执行通道是本机 workbench CLI，**不是"只能人工上机敲"**——
   做法是把只读准备全部做完，然后在**唯一那条不可逆命令**前用「动作 + 目标 + 影响面」要一次显式授权，
   答复"直接执行部署"后代跑。所以上一版那句"这一步只能人工"应当修正为：
   **不可逆的那一条必须由人拍板，拍板之后可以由自动化执行**（见 `docs/NEXT-ITERATION.md` 第九节）。
3. **APK 无需重打包**（已核实而非推理）：v14 未引入新原生插件——评论图片复用既有
   `lib/native.ts` 的 `pickImages`/`capturePhoto`，本轮新增文件对 capacitor **零引用**，
   `package.json` 里 capacitor 依赖版本无变化。
   ⚠️ 但 `apk-shell/public` 的**内置兜底资源已落后两个版本**（仍是「路由跳详情 + 有
   CommentSheet + 无收藏」的旧形态）。联网版正常从服务器加载所以功能无碍；将来若重打
   APK，务必先 `rm -rf apk-shell/public && cp -r app/dist/public apk-shell/public`。
4. 阿里云内容安全：开通 + 配 AK/Secret + **配 `PUBLIC_MEDIA_BASE_URL`（必须是阿里云能访问到的地址）**
   + **打一次真实网关**，并拍板「机审不可达时 fail-closed 还是 fail-open」。
   当前 `IMAGE_MODERATION_ENABLED=false`，别以为改成 true 就合规了。
   签名规则与请求体形状已按官方文档校正并由 13 条单测钉住（第十节），
   但**「阿里云是否接受我算出的签名」这一步只有配上 AK 才能确认**；
   联调时先用一张正常图 + 一张违规图各跑一次，确认第二张真的回到 `reject` 并删了文件。
5. **真机目检**——以下这些确实只有实体设备能验（第八节的浏览器实测覆盖不到它们，
   原因已注明）：弹层下拉关闭的**触摸拖拽**手感（`BottomSheet` 只接受非 mouse 指针，
   桌面浏览器无从触发）、键盘弹起时评论吸底条是否被吃掉（无硬件键盘的环境不触发
   `visualViewport`）、横滑与单击放大的误拦阈值（12px 量级的真实手指抖动）、
   iOS WebView 上排序 Tab 下划线的对齐、安卓物理返回键。

   > 注意这里**不再包含**「搜索结果卡片是否有图」「点赞点了没反应」「返回列表状态是否保留」
   > 「评论输入框是否存在」「排序 Tab 与配图入口是否存在」——这些我已在浏览器里实测通过
   > （第八节）。本节上一版曾把它们也列为"无法代验"，那是**过度保守的错误结论**：
   > 用隔离库 + 生产模式服务 + 真实会话 Cookie 就能把前端跑起来验证。



### 十、机审客户端返工：我用官方文档推翻了自己的设计

> 这一节是本轮迭代**最后一次真实返工**，起因不是别人指出的 bug，而是我在收尾时决定去核实
> 一句自己写下的「官方文档确认……」。

- **被证伪的前提**：`imageModeration.ts` 文件头原本写着「官方文档确认内容安全的图片检测支持
  URL 与二进制（base64）两种提交方式，图片无需公网可访问」，并据此把整条链路设计成
  **审核先于落盘 + base64 提交**。复核 help.aliyun.com 的 70292（图片同步检测 2018-05-09）、
  53413（公共参数）与增强版 2022-03-02 `ImageModeration` 后：**两个版本都只接受可被服务端拉取的
  图片 URL**（`tasks[].url` / `ServiceParameters.imageUrl`），都没有 base64 通道。
- **这个错的危害形态值得记一笔**：它不会崩、不会报错。照旧实现打开开关后，每次调用都 4xx →
  被本模块的降级口径折叠成 `unavailable` → 图片照常发布、全部刷进人工复核队列。
  后台看到的是「机审已接入」，实际**一张都没审成**，还额外烧掉人工复核的带宽。
  这类"失败被安全地吞掉"的模块，必须有断言钉住**请求长什么样**，而不能只靠注释。
- **另外两条由文档直接判定的缺陷**（旧实现都有）：
  ① `Content-MD5` 我做了 `.toUpperCase()` —— base64 大小写敏感，大写串与网关自己算出的 MD5 不同，
  官方示例是 `C+5Y0crpO4sYgC2DNjycug==` 这种混合格；
  ② **四个必发头一个都没发**：`x-acs-version: 2018-05-09`、`x-acs-signature-nonce`、
  `x-acs-signature-version: 1.0`、`x-acs-signature-method: HMAC-SHA1`，且它们要进
  CanonicalizedHeaders 参与签名。旧签名字符串里根本没有这一段。
- **改后的链路**：解码校验 → **全部落盘** → 用 `PUBLIC_MEDIA_BASE_URL + /uploads/...` 拼公网 URL
  提交 → 明确 `block` 则**删掉本次新写的所有文件**再抛 `BAD_REQUEST`。
  顺序不是偏好而是被外部约束定死的；代价是一段「违规图短暂公网可达」的窗口（单图 3s / 整批 8s），
  换来链路真能跑通。顺带把上一版注释里承认的遗留 (b)「reject 前几张已落盘留孤儿」**修掉了**。
- **新增 env**：`PUBLIC_MEDIA_BASE_URL`（审核服务端拉图用的公网前缀，如 `http://120.x.x.x:3000`，
  无尾斜杠）。**未配置 = 机审不可用**（降级为放行+待审），不再假装能用。
- **新增 `api/services/imageModeration.test.ts`：13 条用例全绿**（这是本项目第一份 api 层单测）。
  做法是把 `fetch` 整体替换掉，所以既不需要联网也不需要阿里云账号，但能钉住：
  请求体是 `{scenes, tasks:[{dataId,url}]}` 且 url 为绝对公网地址（并断言 `images`/顶层 `dataId` 不存在）、
  四个 `x-acs-*` 头取值正确、`Content-MD5` 等于对 body 重算的标准 base64 **且不等于它的大写形式**、
  `Authorization` 里的签名与「按文档规则独立重算 stringToSign（含 x-acs 头升序）」的结果一致、
  nonce 每张都换、`block/review/pass` 三档映射、非 200 code 与 HTTP 4xx 与网络异常一律折叠成
  `unavailable` 且**绝不外抛**、三种未配置状态下**零次外呼**。
  - 写这份测试时我自己先踩了一个坑：前 3 个用例连续失败，原因是 `env.ts` 与模块级 `cfg`
    都在**加载时**定死，我改了 `process.env` 却仍在用同一个已缓存的模块实例。
    加 `vi.resetModules()` 后 13/13 通过。**"测试失败"先怀疑测试自己的取样方式**，
    这和 B-24 是同一种错。
- **新增 `scripts/smoke-images.ts`（`npm run verify:images`）：连真实库跑通带图发布链路，可重复、自清理**。
  锁的是 createPost/addComment 的**接线**（单测只锁到 ingestImages）：库里只存 `/uploads` URL 且无
  base64 长串、文件真在磁盘、URL 与文件一一对应、评论头像取自 `users.avatar` 而非占位值、
  机审未配置时真的写了 `[系统]…待人工复核：2 张，原因：机审未启用（IMAGE_MODERATION_ENABLED!=true）`。
  连跑 3 次均 PASSED，`uploads/{posts,comments}` 残留 0、帖子/评论行残留 0
  （库里那 1 条 `[系统]` 行是更早一轮手工测试留下的，属既有数据，非本脚本泄漏——按 postId 精确清理）。
  - 为什么没并进 `scripts/smoke.ts`：先试过作为它的第 8 节。但 `smoke.ts` 第 2 节要先下单，
    在"按座位售票"的库（生产形状的数据）上会以「钓位数量必须与购票数量一致」失败退出，
    **后面的节永远跑不到**。未跑到的测试比没有测试更糟——它会让下一个人以为这条口径已被覆盖。
    这是 `smoke.ts` 的一个既有局限（与本轮改动无关），已在此登记，下一轮应把下单节改为
    先探测该帖是否要求座位、不满足就跳过，而不是让它把整条套件带崩。
  - 我自己的两个假阴性（都不是应用的错）：① drizzle 的 `select()` await 后**直接是行数组**，
    我还按 mysql2 的习惯解构 `[rows]`，于是拿到的是"第一行对象"，再取 `[0]` 成 undefined，
    报出"库里没有用户行"；② 探针最初放在项目外（`E:\tmp`），那里没有 `package.json`，
    tsx 按 CJS 转换 → 顶层 await 直接编译失败；且 `mysql2` 也解析不到（node_modules 在项目里）。
    **一次性验证脚本应放在项目内**，别把环境差异误读成被测代码的问题。
- **仍未做完的（不是我能在本机做的）**：真实网关联调。签名规则已按文档对齐，但
  「阿里云侧是否判定同一签名」只有配上 AK 才能确认；`bizType` 的确切位置文档示例未覆盖，
  因此默认留空不发送。`IMAGE_MODERATION_ENABLED` 保持 `false`。
- **⚠️ 这一节让已上传的部署物过期**：`api/` 变了，`/root/dist-v8.12.0.tar.gz`（`ca1c4a00…4532f`）
  必须替换为新产物 `bafa1fec8370f7525b43f9ebf98013e7a436be956dc16fe1dcde2b090b424ddd`
  （本地 `E:\tmp\dist-v8.12.0-r8.tar.gz`），并重出 `SHA_EXPECTED`。
  新产物已复核：180 条目 / **44 个 `.br`** / **0 条反斜杠路径** / **0 处 `data-dbg`**，
  且 bundle 内确认 `2018-05-09`、`HMAC-SHA1`、`/green/image/scan` 就位，
  `images:[…]` base64 通道与 MD5 大写两处缺陷已消失。
  构建门禁全绿：`tsc -b` 0 错、`eslint .` 0 错、字体/图片/埋点接线/知识库/动画边界五项校验通过、
  `vitest run` 13/13（下一小条又扩到 21/21，这里保留当时那次构建的读数）。**首屏体积未受影响**（本轮改动全在 `api/` 与文档，`src/` 零改动，
  前端产物与上一份全绿构建同源同尺寸）。
- **返工后又补了 8 条落盘顺序测试**（`imageStore.test.ts`），`vitest run` 当时为 **21/21**（13 + 8；
  收尾又加了 2 条跨账号缓存清理，现为 23/3 文件——这个数字以 `vitest run` 现算为准，别抄本行）。
  它们钉的是"四态判定落到磁盘上是什么结果"：`reject` 时**整批新文件都被删掉**（目录列表与调用前
  逐字相等），`pass` 时断言"送审的那一刻文件已经在磁盘上"（URL 提交方式的成立前提），
  `review/unavailable` 计入待审，服务返回条数少于图片数时缺位仍按待审，
  旧图 URL 透传位既不重新落盘也不送审，外链/协议相对/穿越/超张数在写盘前就被拒且不送审。
  - 写这组测试时我先踩了自己的坑两次：① `path.resolve(cwd, "/uploads/…")` 在 Windows 下会
    直接跳到盘根（`E:\uploads\…`），第一次跑出现**假失败**；断言文件存在必须 `join(dir, basename(url))`。
    ② 上一版文件里我留了一条 `// 占位，下一步断言真实值` 的断言和一段用 `require` 拼出来的
    `mkdirSync`——**半成品断言比没有断言更糟**（它会以"看起来通过了"的姿态留在仓库里），已重写。
- **新产物起得来服务（这一步不做，风险要等到生产切换那一刻才暴露）**：用 `dist/boot.js`
  以 `NODE_ENV=production` 起在 3105/3106 实测——
  首页 `200` 且 `content-encoding: br`，JS 分块同样走 brotli（3081 B 传输）；
  `POST /api/perf` 匿名埋点 `204`；
  把 `DATABASE_URL` 故意指向不存在的库时**进程不退**，`app.feed` 到达 resolver 后返回 500
  （报的是 `user_profiles` 查询失败，不是入参 400），后台的销号清扫/outbox 轮询只打 warn 并继续重试。
  - 顺带修了我自己的探针：`/api/trpc/app.feed` 少带 `batch=1` 会得到 400「expected object,
    received undefined」，那是**我的信封写错了**，不是应用回归。第一次跑我看到 400 时差点把它
    记成机审返工引入的问题——写探针前先确认协议口径（本项目是 superjson + httpBatchLink 信封）。

### 十一、交付前双轴审查（标准轴 + 规格轴）修掉 9 项，并把两条门禁补成可执行

> 这一节的全部结论都在**读源码之后**才落笔：审查子代理给出 4 条「严重」，我逐条打开它引用的行号核实
> （4/4 命中，但我仍然不打算把它的自述当成证据——上一轮就吃过子代理半成品的亏）。

**修掉的行为缺陷（都有真实用户后果，不是风格问题）**
1. `FeedPost.tsx` 整卡 `onKeyDown` 不判 `e.target` → 焦点在卡内**任何一个**按钮上按 Enter/Space，
   都会「打开弹层 + `preventDefault()` 取消按钮自身激活」，等于点赞/收藏/分享/更多全排键盘不可用。
   现在只在 `e.target === e.currentTarget` 时当作整卡激活。
2. `CommentSection.tsx` 的在途锁写成 `likeBusy != null` → **一条评论的点赞在飞时，其它评论的点赞被静默吞掉**
   （按钮看着能点、点了没反应），和同文件 118-119 行「只禁用被点的那一颗」的注释直接矛盾。改成 `likeBusy === c.id`。
3. `PostContent.tsx` 删帖成功后 `setTimeout(onBack, 600)` 没有句柄也没清理 → 用户在这 600ms 内手动关掉弹层，
   计时器仍会再 `onBack()` 一次，**多按一次 history.back() 会把 Home 也弹掉**。这与我在 PostSheet 里
   修过的「双 Escape → 两次 back」是同一个形状，只是这次的诱因是定时器。
4. `Home.tsx` 下拉刷新的 800ms 收尾计时器同样无主：连拉两次时第一发会把第二发的动画提前收掉，且卸载不清。
   两处都改为 ref 持有 + 排程前 clear + 卸载清理。
5. `PostContent.tsx` 的关注态是 `query.data` 拷进 `useState`（`useEffect` 同步）——**正是本轮在 Home.tsx 拆掉、
   并在 `postCache.ts` 开头点名的那个口径**。改为派生值 + 仅保留乐观覆盖位，成功后把服务端确认写回
   `followState` 缓存再清空覆盖，失败则清覆盖 + invalidate 让服务端真值回来。
   顺带暴露一个 TS 细节：`view.authorId` 的 null 收窄在 mutation 回调里会失效，必须先落到局部量。

**我自己审查里发现并修的一条**：`imageStore` 的清理原先只覆盖 reject 分支——`writeImage` 中途抛错
（磁盘满/IO）时前面几张已经落到公网目录却不会被删，留下「公网可访问、库里永不引用」的孤儿，
与 reject 分支同一形态、不同诱因。现在写循环也在 try 内，失败即 cleanup 再原样抛出。

**两条门禁从"叙述"变成"可执行"**（规格轴的主要发现）
- `npm run build` 现在包含 `vitest run`：单测不过就根本不产出可部署物。
- 新增 `npm run verify:static` —— **此前首屏体积/按需 chunk/ETag 的唯一执行处 `smoke-static.mjs`
  在 package.json 里没有任何入口**，只活在 CHANGELOG 的文字里；也就是说这些 ✅ 的验收项无法被复跑，
  一旦回退没有任何信号。本轮补上入口并**实跑一次：全部通过**（CSS 6.4KB / 主 JS 51.9KB / 字体 34.4KB，
  按需 chunk 1.3–1.4KB，ETag/304、埋点白名单与隔离目录九项全绿）。
- 记一条余量告警：`PostContent` 分块 **11.96 KB br**，顶在 12KB 线上（零余量）。它现在能过是因为
  门禁只约束被点名的按需 chunk；但只要再往里加一点东西就会变成真违规。要么拆，要么在下一轮明确提线。

**审查里我判定"暂不动"的（如实列出，不当已解决）**：`CommentSection` 顶层楼与楼内回复两份逐行重复的行卡 JSX
（+800 行里最大的结构泥团）；`Favorites` 两份骨架与 Tab 条魔法数 `calc(1.5rem + 1.5rem)` 复制自 Home；
`CatchViewer` 的 `Send` 图标是看着能点的死按钮；`ReportSheet` 关闭不清 `reason/note`（第二次举报带上次的补充说明）；
`check-motion-boundary.mjs` 的 `depsOf` 只解析 `@/` 不解析相对路径（本轮实测没有任何相对路径引入 domMax 组件，
门禁 4/4 仍成立，但盲区是真的）；react-query 缓存 key 不含用户 id 且登出不清缓存 → **换账号可能脏读自己的
liked/collected**，这属产品口径判断，我没有擅自改。

**产物随之重出**：`bafa1fec8370f7525b43f9ebf98013e7a436be956dc16fe1dcde2b090b424ddd`
（`E:\tmp\dist-v8.12.0-r8.tar.gz`，180 条目 / 44 个 `.br` / 0 反斜杠 / 0 测试文件），
因为本轮动了 `src/` 与 `package.json` —— 按我自己定下的判据（diff 非空才重发），这次就该重发。


**审查之后又补的两件事（同样是审出来的，不是猜出来的）**
- **会话切换必须整份清空查询缓存**（新增 `resetViewerCache`，接在 `PasswordAuthForm` 登录成功与
  `Profile` 退出登录两处）。这不是产品口径而是正确性缺陷：缓存键只有入参、**不含用户 id**，
  而出参带着 viewer 级的 `liked/collected`、收藏列表、评论点赞态、我的订单；登录与登出都发生在
  SPA 内（原先只 `invalidate` 了 `auth.me` / `users.overview`，页面不重载），于是**换账号后上一个账号的
  点赞收藏态会继续显示给下一个账号**，直到各自 staleTime/gcTime 过期。逐条列清单去 invalidate 迟早漏一个，
  所以按「会话变了 ⇒ 所有 viewer 级数据作废」这条不变量整体清空。代价是切换后当前页短暂回骨架屏——
  旧数据本就属于别人，这是正确表现。
  - 第一版写成 `utils.queryClient.clear()`，tsc 直接拒了：tRPC v11 的 utils 类型上没有 `queryClient`。
    改用标准的 `useQueryClient()`，而不是为了拿句柄去导出模块级单例（那会踩 react-refresh 的混合导出规则）。
- **`package.json` 里有一对重复键 `verify:images`，而我此前的校验看不见它。** 是 esbuild 在 vitest 启动时
  报 duplicate-object-key 才暴露的：`JSON.parse` 对重复键不报错，后值静默覆盖前值，所以我那句
  「JSON OK」对这个失败模式**根本不可能失败**——校验必须能对被防的那类错误报警，否则等于没有校验。
  现在改用 `object_pairs_hook` 检查键唯一性。教训与 B-24、CRLF 那两次同源：**先怀疑探针，再下结论**。
- 测试基线扩到 **23 条**：`vitest.config.ts` 的 include 加上 `src/lib/**/*.test.ts`（缓存层是纯逻辑，
  node 环境就能测，不必先引 jsdom）。新增的 `postCache.test.ts` 第一版也写错了 API——
  `getQueryCache()` 返回 QueryCache 对象而非数组，`toHaveLength` 无从落下，改为 `.getAll()`。
  这 2 条是真跑过才留下的：清空后两条 viewer 级缓存都取不到、缓存表为空、空缓存上不抛错。

**重出产物**：`bafa1fec8370f7525b43f9ebf98013e7a436be956dc16fe1dcde2b090b424ddd`
（`E:\tmp\dist-v8.12.0-r8.tar.gz`，180 条目 / 44 个 `.br` / 0 反斜杠 / 0 测试文件；
构建链现在自带 `vitest run`，23/23 通过才产出 dist）。首屏口径复核：eager JS 148.7 KB br、
CSS 6.44 KB br、按需 `PostContent` 11.96 KB br（仍顶在 12KB 线上、零余量，已登记）。


**审查里剩下两条我判定"暂不动"的，复核后其实都是该修的用户可见缺陷**
- `ReportSheet` 的理由/补充说明是**外层常驻组件的 state**：外层在父级里从不卸载（`open` 只控制
  AnimatePresence 的内容），所以关闭再打开时上一次的说明还在，甚至从「帖子」举报带到「评论」举报上。
  修法不是 useEffect 监听 `open` 复位（那是本项目 lint 红线 set-state-in-effect），也不是提交后复位
  （那会让"提交失败"把用户写好的说明一起清掉，得重打一遍）；而是把 state 移进**只在 open 期间挂载**的
  内层组件，靠卸载自然丢弃。我第一版正是写成"提交时复位"，是自己引入的新缺陷，复核时才看见。
- `CatchViewer` 底部第三条是一个**没有 onClick 的裸 `<Send>` 图标**：与左边的点赞钮同规格，
  用户会当成分享入口去点，点了毫无反应。v14 计划里没有"查看器内分享"这项，所以先摘掉死 affordance，
  并登记 B-26（真要做就补 `onShare`），而不是留一个假装能按的图标。

**顺带发现：`npm run format` 以前是不可用的**——仓库没有 prettier 配置，`prettier --write .` 会按
它自己的默认值（分号 + 双引号）把整个代码base 改写成与现有风格相反的形态。我实测踩到了一次：
裸跑 prettier 归一 `ReportSheet` 缩进，结果它给全文件加分号、把 JS 字符串改成双引号。
现在补了 `.prettierrc.json`，**只写我有直接证据的两条**（`semi:false` / `singleQuote:true`），
`printWidth` 之类没有把握的不写——凭空定一个宽度会让下一次全量格式化的改动面无法预料。


- **诚实交代验证边界（我这一轮改不了的那部分）**：本轮重构了三处只有真实浏览器/真机才能验行为的东西——`ReportSheet` 的挂载边界（跨次残留的修复）、关注态的 state 口径（派生 + 乐观覆盖位）、登录/登出时的 `resetViewerCache`。浏览器自动化在当前策略下不可用，仓库没有 jsdom 且本机无 npm 装不了，DOM 级测试落不了地，所以它们目前只有 tsc/eslint/23 条单测这层静态证据。具体点哪三下、期望结果是什么，写在 `docs/NEXT-ITERATION.md` 的「本轮改了、但我没能运行时验证的三条」表格里；不对就走部署脚本的 `--rollback`（迁移幂等，回滚码不动库）。
  顺带给条件子元素补了 `key` —— 让 AnimatePresence 的退场判定不要依赖「单个条件子元素恰好没 key 也能工作」这种巧合。

### 十二、把「只认别名的门禁」修成真正守得住的门禁（本轮最后一次门禁级改动）

- **缺陷**：`scripts/check-motion-boundary.mjs` 的不变量 2（用到 domMax 的页面必须被 `<LazyMax>` 包裹）
  里，`depsOf` **只跟随 `@/` 说明符**，`./X`、`../X` 一律忽略。于是「页面用相对路径引进一个 `drag` 组件」
  这种组合它完全看不见——而同文件的不变量 1 用的是另一套解析（别名 + 相对都认）。本项目约九成用 `@/`，
  但**比例不是保证**：门禁的强度取决于它最弱的那条路径。
- **修**：`depsOf` 增加相对路径解析，候选文件与 `resolveImports` 同口径（`.tsx` / `.ts` / `index.tsx` / `index.ts`）。
- **怎么证明它真的更严（差分对照，而不是「看着对了」）**：造一条探针链路——
  `pages/__ProbePage.tsx` 经 `../components/__probeDomMax` 引一个带 `drag` 的组件，分别跑 HEAD 版与修后版：
  旧版 `exit=0` 且通篇不提 `__ProbePage`（**盲区实锤**）；新版 `exit=1`，报
  `__ProbePage.tsx 需要 domMax，但 App.tsx 未用 <LazyMax> 包裹`。撤掉探针后新版仍通过，
  说明**当前代码库没有任何「相对路径拉 domMax」的违规**，所以这条修复不改变已交付的前端产物。
- **过程里我自己又踩了一次「对照实验不成立」**：第一版探针把组件放在 `components/`、页面里却写
  `./__probeDomMax`，路径根本解析不到，于是「门禁没报错」差点被我当成「修复无效」——
  真相是**阳性对照自己就是假的**。对照必须两头都能响：旧版漏检、新版捕获，差异才归因于修复。
- 顺带把交付前审查里只剩叙述的结构性债务登记成可追踪条目：**B-27**（评论行卡两份逐行重复）、
  **B-28**（Favorites 骨架 / Tab 条重复与 `calc(1.5rem + 1.5rem)` 魔法数复制）、
  **B-29**（`scripts/smoke.ts` 第 2 节在要求座位的库上必崩，导致其后各节永不执行）、
  **B-30**（`PostContent` 的 `view` 每轮新建，使下游 `useMemo` 形同虚设）。backlog 现为 B-01…B-30 连续无缺号。

### 十四、修好一套"从来没能跑完"的冒烟套件（B-29）

- 症状：`scripts/smoke.ts` 在第 2 节抛「钓位数量必须与购票数量一致」后 `main()` 退出，**§3–§7 一次都没执行过**。
- 诊断比原先登记的更硬：`createOrder` 是**无条件**要求 `seatNos.length === quantity`（1 票 1 位），
  而 §2 传的是 `seatNos: []` 配 `quantity: 2` → 在**任何**库上都必抛。也就是说这不是"生产形状的数据才会踩"，
  而是这条冒烟与交易 API 早就脱节了；而 **`smoke.ts` 没有挂在任何 npm 脚本上**，所以腐烂一直没人发现。
  推论值得记住：**没被任何入口引用的测试等于没有测试**，它会安静地烂掉。
- 修法：§2 从 `seats` 表取真实钓位、`visitDate` 用远期日期避开按 `(pondId, visitDate, seatNo)` 实时算出的占用；
  新增 `npm run verify:smoke` 给它一个入口。
- 我自己第一版把"清掉本次订单"放在了 §2 末尾，于是 §3 的核销读不到 `verify_code` ——
  清场必须挪到**核销之后**（座位占用由订单实时计算，不删下次会撞 CONFLICT）。
- 隔离库实跑：连续两次 `SMOKE PASSED`，7 节全部执行（recommendFeed / createOrder 幂等+金额重算 /
  verifyOrder CAS / toggleLike 去重 / 埋点异步入库 / ownerStats+shop+pondDetail / keyword 搜索）。

### 十三、把「计划完成」从自评变成可核验（B-31 交付）

- 新建 `docs/产品/v14-证据索引.md`：31 条计划项逐条绑到**真实存在的实现锚点**（文件 + 符号）与验证方式。
- `scripts/check-plan-coverage.mjs` 升级为**逐行核验索引**：文件必须存在、符号必须是该文件里真实的子串
  （候选长度 ≥ 4，防止用碎片糊过去）；只写文件路径、一个符号都不核的行**不给**算 strong。
- 现算结果：**strong=31、零证据=0、索引锚点核验失败=0**，`--strict` 退出 0。
  中途的数字变化全程以工具输出为准：先 `strong=5`（探针坏掉，见下①）、补索引后 `28`（三条没有表格行 + 一条只写了文件），
  补齐并改正失实锚点后才是 `31`。我一度把它写成「31 条全部拿到锚点」，也被自己的核验器打回过一次。
- 过程中被核验抓到**四处我自己的失实**，都留在这是因为它正是"为什么要核验"的答案：
  ① 第一版解析正则要求反引号内容以 `.ts/.tsx` 结尾，对我自己写的 `路径 :: 符号` 格式**一行都没匹配上**，
     屏幕上是「失败 0 / strong 5」——看着像"证据大多不合格"，实际是**探针坏了**。现在解析到 0 条引用按异常处理；
  ② 我把 `DEMO_OPEN_HINT` 记成在 `PostSheet.tsx`，实际它只在 `FeedPost.tsx`（36 行定义、151/160 行使用）；
  ③ 我把**通配符** `db/migrations/0013_*_run.sql` 当路径写进索引——核验器只认真实存在的文件，直接判失败；
  ④ 我把**已删除的** `CommentSheet.tsx` 当实现锚点写。那是负向断言（"不该存在的东西确实不存在"），
     不能充当"某条需求由这段代码兑现"的证据；已从锚位移到正文说明。
  另有一条规则收紧：**只写文件路径、一个符号都不核的行不算 strong**——文件存在不等于实现存在。
- **没有**把它接进 `build`：脚本要读计划与索引所在的 `../docs/…`，而那批文档不在本仓库（只有 `app/` 进 git）。
  设成硬门禁会让别人 clone 后构建直接失败——这是给构建链埋雷，不是加严。
  **后续（同日）已解决这个前提**：索引迁入 `app/docs/verification/`（验证代码的清单必须与代码同仓同版本），
  并让脚本在找不到计划文档时降级为「以索引声明的条目全集为准 + 警告」；两条路径都实测 exit 0（31/31），
  于是 `--strict` 已接进 `npm run build`。过程中我自己写坏过一次：把 `let ids: string[]` 这种 TS 标注写进 `.mjs`
  → SyntaxError；而当时我用 `| head` 后面的 `$?` 读退出码，读到的是 head 的状态，于是"崩了却显示 exit=0"。
  又一次印证同一件事：**测量方式错了，结论就毫无意义**（本轮第 5 次栽在这上面）。

### 十五、上线后一键复核（`npm run verify:deploy`）

- 动机：v14 还剩三条只有真机/浏览器能验的行为，而"部署完打开首页看一眼"既覆盖不到它们，
  也覆盖不到最容易出事的一种失败——**迁移没跑就切了代码**（表现是特定接口 500，不是白屏）。
  于是把服务端能验的部分压成一条只读命令：`node scripts/verify-deploy.mjs --base http://<ip>:3000`。
- 检查项（当时本地 production 服务实测全 PASS、exit 0；项数会随修复增长，以脚本自身输出为准）：
  首页是构建后的文档、brotli 协商生效、
  入口 JS 真的可取（改名/漏传这类历史 404）、v14 四个读端点在位（feed / detail / comments / myFavorites）、
  评论接口无缺列缺表迹象（即迁移确实跑过）、`/uploads/*` 没被 SPA fallback 吞掉。
- 收尾时又给它加了两条牙齿（详见第十七、十九节）：**探针返回 5xx 一律判 FAIL**——只区分"404 / 其他"会放过
  "SQL 函数不被支持"这类执行期故障，而 v14 恰恰第一次在生产引入 `JSON_EXTRACT` 等函数；
  以及 `--tar <交付包>` 把**线上入口 JS 与交付包同名成员做 sha256 逐字节绑定**——产物里没有任何版本字符串
  （`package.json` 是 `0.0.0`、没有版本端点、`index.html` 里也搜不到 8.1x），这条是"线上跑的就是这份包"的直接证据；
  不传 `--tar` 则显式记 SKIP，不算通过。
- 反向也测了：基址不可达时输出 7 行可读 FAIL、exit 1，第一行直接告诉你"先 systemctl status quyu"。
- 写这个脚本过程中被自己抓到三个错，都留在这里，因为都是"看起来能用其实会误导运维"的形态：
  ① 断言首页含 `<div id="app">`——挂载点其实是 `#root`，**我猜的**；改成只认构建产物必有的标记
    （`<script type="module">` + `/assets/index-…`），不再依赖实现细节。
  ② 探针里用了 `app.posts.commentList`，真实 procedure 名是 `app.posts.comments`——
    照它跑上线当天会报"部署的代码不是 v14"，是个纯假警报。名字是查 `feature-router.ts` 得到的。
  ③ 结尾 `process.exit()` 在 Windows 上会在 socket 未摘除时打断 libuv：
    **打印完 PASSED 却 exit=127**，连跑三次稳定复现。改成只设 `process.exitCode`；
    对门禁来说，退出码说谎比没有门禁更糟，因为 CI 与脚本判断只看退出码。

### 十六、把散落的九项校验收进一个总入口（防止再次"没人跑就等于没有"）

- 起因就是本轮那个 bug：`scripts/smoke.ts` 的 §3–§7 从来没执行过，因为它没挂在任何 npm 脚本上。
  现在校验项已经散成 tsc / eslint / vitest / 5 个 `check-*` / `verify:smoke` / `verify:images` /
  `verify:static` / `verify:deploy`，**记不住就等于不会跑**。所以加了 `npm run verify`（`scripts/verify-all.mjs`）。
- 关键约束是它自己的诚实性：**跳过必须显式说明理由，绝不能把"没跑"报成"通过"**——
  我这轮在覆盖率脚本上正是栽在"匹配到 0 条却报告 0 失败"。因此三种模式都实测过：
  - 默认（只跑不依赖外部服务的 9 项）：`9 PASS / 0 FAIL / 3 SKIP`，exit 0；
  - `--strict`（给 CI 用）：`exit 1`，且原因是"`3 项被跳过，视为未覆盖`"而不是崩溃；
  - `--db`（数据库不可达时）：`exit 1`，两条 FAIL 带上子进程退出码与输出尾部。
- 一个值得记的细节：`--strict` 第一次"看起来通过了验证"（exit=1），实际原因是我删掉了一个还在被两处
  引用的辅助函数导致脚本崩了。**退出码对，但理由是错的**——所以每次验证都要去看它给出的原因，
  不能只看颜色。这类"绿/红都得解释"的要求，和上面那条是同一件事。

### 十七、把回滚这条路真的走了一遍（并修掉一条自证不了的判据）

一次性切版本的最大风险不是"上不去"，是**上去了还得退回来**，而这条恢复路径此前只被读过、没被执行过。

- **先撞出一个文档冲突**：`v14-deploy.sh` 的 `--rollback` 分支用 `tar --strip-components=1`，
  而交接文档里手写的回滚是 `rm -rf dist && tar xzf backups/…`（不带 strip）。同一个备份包不可能两种写法都对，
  实测 `tar` 行为就清楚了（最小样例，条目布局 × 解压写法）：

  | 备份包条目 | 不带 strip 解到 `/opt/quyu` | 带 `--strip-components=1` 解到 `/opt/quyu` |
  |---|---|---|
  | `dist/boot.js …` | ✅ 得到 `dist/boot.js` | ❌ 得到 `./boot.js`，没有 `dist/` |
  | `./boot.js …` | ❌ 得到 `./boot.js` | ❌ 同样得到 `./boot.js` |

  谁能落对，取决于备份包自己的顶层布局——而服务器上那份 `/root/dist-before-v8.12.0-*.tar.gz` 我在本机读不到。
  **所以不猜**：新增 `scripts/v14-rollback.sh`，先解到暂存区，再按 `boot.js` 的实际位置反推货根，
  两种布局都落位；落位前必须过 `public/index.html` + `.br ≥ 30` 两道与部署同口径的闸门，
  不合格就 ABORT 且**一个字节都不碰现有 dist**；被替换的旧 dist 用 `mv` 留痕而不是删掉（回滚失败还能再退一次）。
- **演练**：`npm run verify:rollback`（`scripts/v14-rollback-drill.sh`）是**真跑被测脚本**，不是照抄它的判据。
  6 组 13 条全绿，端到端用两份真实产物（r8 上线态 → 回滚 → 服务再起、首页 200 且仍走 brotli）。
- **我第一版的判据是死的，被自己的 FAIL 行纠正**：原本用文本标记 `toUpperCase` 判断"是否换成了旧版"，
  结果它在 r2 和 r8 里各出现 **19 次**（换成 `2018-05-09` 也一样，两边各 1 次）——也就是说屏幕上那条
  `PASS dist 真的被换成旧版` 什么都没证明。现在的判据是 **boot.js 的 sha256**
  （旧 `33ebcc768c1df675…` / 新 `7775cba9e3e0acc8…`，先断言两者不等，演练才有意义），
  回滚后必须**等于旧值且不等于新值**。文本标记不能当版本判据，内容哈希才能——这和第十一节
  "tar 的 sha 不能当源码判据"是同一类错误的两面。
- **闸门能不能变红，用变异测过**（不改仓库，临时改副本）：`find -name boot.js` → `BOOT.js` 得 3 FAIL；
  `BR_MIN=30` → `0` 得 1 FAIL（"缺 .br 的包回了滚"）；把留痕的 `mv` 换成 `rm -rf` 得 1 FAIL。
  三个变异各自只打中它该打中的那条，说明断言不是摆设。产物 r8 **不必重出**：整条 `build` 链重跑后
  `dist/boot.js` 的 sha256 前缀仍是 `7775cba9e3e0acc8…`，与 r8 包内那份逐字节相同
  （包里只有 `dist/`，`package.json` / `scripts/` 计数为 0），本轮新增的两个脚本不随包上线。
- **"回滚码不动库"——今天被自己的新门禁改窄了。** 原话是"v14 加的全是
  `ADD COLUMN … NOT NULL DEFAULT …`（只有 `deleted_at` 可空）与 `CREATE TABLE IF NOT EXISTS`，
  没有任何 DROP / 改类型 / 填不变的语句"。**这句超出我当时探针的覆盖面**：我 grep 的是
  `ADD COLUMN|CREATE TABLE|NOT NULL|DEFAULT`，**从没查过 DROP 本身**，就下了"没有任何 DROP"。
  新加的 `scripts/check-run-sql.mjs` 第一版就把它报红：`0014_v14_comment_report_run.sql` 里有
  `ALTER TABLE reports DROP INDEX uq_report`，随后用同名重建三列唯一索引
  （`reporter_id, post_id, comment_id`）。仍然成立的部分：加列全带默认值、新表都是 IF NOT EXISTS、
  没有删表/删列/改类型——所以老代码不写新列的 INSERT 照样落默认值，回滚**不会崩**。
  但索引语义变宽了：回滚后"同一用户对同一帖只能举报一次"变成"每个评论位各能举报一次"，
  这是产品可见的差别，已登记 **B-35** 等 PO 拍板。教训写在这：**结论的边界必须等于探针的边界**。
  唯一按位置取数据的风险点是 `api/infra/search.ts:126` 的 `SELECT *`（ponds/posts/products），
  该文件与 8.11.0 基线逐字一致，且 v14 没给这三张表加列。
- **顺手查出一个更值得记的事实**：核对"生产库到底是什么引擎"时发现各处口径互相打架（本仓环境表说的是**开发机**
  MySQL 8，`api/infra/datasource.ts` 注释与早期路线图说生产是单实例 TiDB）。我没有凭记忆断言 TiDB 兼容性，
  而是改用可测的事实：**0012 已在生产成功跑过两遍，其中就有 `json` 列与 `DEFAULT (now())`**，所以"加列语法"这一类
  有先例。但顺着查下去发现一条**没有先例**的新面：`git grep -c JSON_EXTRACT 134dcd3^ -- api` = **0**，
  当前 = 4（`JSON_UNQUOTE` 2、`JSON_LENGTH` 1），全部集中在 `api/services/community.ts:110-112` 的 `postCoverSql`，
  被信息流与详情/评论共用——**v14 是第一次让生产执行 JSON 查询函数**，DDL 的先例覆盖不到它。
- 于是补了 `verify:deploy` 的一个洞（上一条的直接后果）：第 2 组探针原先只区分"404 = 端点不存在 / 其他 = 在位"，
  而"函数不被支持"要到执行期才炸，端点照样在位 → **500 会被报成 PASS**。现在 `>=500` 一律 FAIL 并带出
  `Failed query` 原文。用 r8 产物 + 指向死库的 boot 实测：五条探针全部给出可读 FAIL，整体判 FAILED；
  服务器不可达时退出码 1（7 条 FAIL）。同时把"5xx 也算失败"这条写进交接表，
  上线后那一步**不需要**先搞登录态——这句我上一版写反了，实测推翻：
  不带 `--cookie` 时这四条探针**照样进 resolver 跑 SQL**（失败原文里的 params 显示解析出了
  `user_id=1` 并去查 `user_profiles`，报的是 500 而不是 401），所以 `--cookie` 是可选增强、
  不是前置条件。当时那句"必须带 cookie 否则只拿 401"是从"收藏类过程要登录"推出来的，
  没看中间件实际怎么给访客兜底——又是一次"按名字猜行为"。
- **仍未覆盖的一段**：演练的回滚目标是 r2（同为 v14 构建），生产真正要退的是 **8.11.0** 那份备份；
  它的完整性只能由部署脚本的备份校验在生产那一刻确认（`tail -3` 找 `Dump completed` 那条判据已在沙箱实测过）。
  `verify:rollback` **没有**接进 `npm run verify`——它会起真实服务、耗时约 25 秒，属于 `--db/--server` 那一层，
  塞进静态门禁会让人更不愿意跑全套。

### 十八、查证"迁移 CI 化"这句话时，发现那条 CI 从来跑不起来

起因很朴素：交接文档说"CI 会在 MySQL 8 测试库全量跑 db/migrations 全部迁移"，我想确认 v14 的 0013/0014 是否真被 CI 覆盖。结果：

- 仓库根是 `app/`（`git rev-parse --show-toplevel`），而 workflow 文件在**上一级**的
  `E:\趣渔项目APP开发\.github\workflows\ci.yml`——那目录不在 git 里（`git ls-files ../.github` 直接报
  `outside repository`）。GitHub 只认**被推送那棵树根下**的 `.github/workflows`，所以照现在的位置它永远不会触发。
  旁证：`git branch -r` 为空（没有任何远程跟踪引用），且那份 workflow 里写着 `working-directory: app`
  与 `cache-dependency-path: app/package-lock.json`——它是按"仓库根 = 项目根目录"的假设写的，
  与本机实际的 git 根不一致。**结论：v8.6.1 起文档里的"迁移 CI 化"是一句从未生效的保证**，
  和这个会话里反复出现的"没被任何入口引用的测试等于没有测试"是同一件事，只是这次规模更大。
  （远程 `quyu-app` 的真实布局无法证实：`git ls-remote` 连不上 github.com。所以两种修法都写进文件头注释了。）
- 修法：新增**仓库内**的 `.github/workflows/ci.yml`（`working-directory: .`、锁文件路径 `package-lock.json`），
  并补上原来缺的两块覆盖：① 结构核对加了 v14 的 `post_favorites` / `comments.like_count` / `reports.comment_id`
  （原先只核对 v13 的列）；② 新加一步**跑生产直跑版 `db/migrations/*_run.sql` 两遍**——那才是上线那一刻
  真正执行的 SQL，旧 CI 完全没碰过它。
- 说清这一步**不能**发现什么（否则就是又一次自我刷绿）：测试库是先用 drizzle 迁移建好的，
  所以每条 ALTER 的 `information_schema` 守卫都会走 **skip 分支**；该步能验的是守卫查询、字面量、
  回填 UPDATE 的语法与幂等，**验不到 ALTER 分支本身**。要覆盖那条得另建一个"只迁到 0012 的库"，
  需要跨版本 checkout，本轮没做，也没有假装做了。
- 新 CI 步骤本身做了差分测试（把步骤文本里的 `sudo mysql` 换成可控桩，循环与判据一字不改）：
  正常输出 → 退出 0；命令失败（`ERROR 1064` + exit 1）→ 退出 1 并打印是哪一遍哪个文件；
  **退出 0 但输出含 `ERROR`**（真实 mysql 客户端在某些错误下就是这种形状）→ 也退出 1。
  三种结局都能变红，YAML 也用 js-yaml 解析过、结构核对断言里三个 v14 新字段都在。
- ⚠️ 但**现在仍然没有 CI**：文件只是躺在分支里，要等用户授权 push 才会第一次执行。
  所以我没有把任何文档措辞改成"CI 已覆盖"，只写"已就位、待首次推送验证"。

### 十九、上线前把"交接物"本身变成一条命令能核对的东西（`npm run verify:handoff`）

这次上线依赖一组散落在仓库内外的事实：一个 tar、三个脚本、四条迁移 SQL、文档里那个 sha。
本项目已经踩过一次"文档写的 sha 与磁盘产物不再一致"（服务器上的 `ca1c4a00…` 因机审返工而失效），
所以不该留给人眼核对。新增 `scripts/verify-handoff.mjs`，六组断言，**失败项数即退出码**：

- **产物**：tar 存在；它的 sha **确实写在 CHANGELOG 与 NEXT-ITERATION 里**（文档与物对不上就红）；
  含 `dist/boot.js` + `dist/public/index.html`；`.br ≥ 30`；无反斜杠路径；无 `data-dbg`；
  不含 `package.json`/`scripts/`（这条把"改仓库侧脚本不必重出产物"从口头推断变成断言）。
- **包内 `dist/boot.js` == 本机 `dist/boot.js`**：这才真正回答"产物跟得上最近一次构建吗"
  （现算两边都是 `7775cba9e3e0acc8…`）。
  > 这条后来被我自己加强了：入口一致只证明后端壳子对得上，前端是内容哈希分块，少传/多传某一块
  > 照样可能让线上跑到旧 chunk 而首页看着正常。改成**整棵 `dist/` 逐文件 sha 比对**，
  > 实测本机现构建与 r8 交付包 **176 个文件全部一致**；把 `--tar` 指到 r2 立刻报
  > "182 处不同（仅本机 89、仅包内 89、同名不同内容 4）"。又一次先怀疑探针：第一版把 Windows 路径
  > 直接传给 `tar -C`，MSYS 把它拆成 `E\:\趣渔…`，报的是"解包失败"而不是"包不一样"——
  > 同一个坑（给孩子进程的路径形式）今天踩了第二次，于是把"靠记忆转换"改成**开局探测**：
  > 用 `tar -tf` 各试 `/e/tmp/…` 与 `E:/tmp/…` 两种形式，命中哪种用哪种；都读不通就明确 FAIL，
  > 不会让"探针没跑起来"冒充通过。实测矩阵：MSYS tar 只认前者（给 `E:/tmp` 报 `Cannot connect to E:`），
  > bsdtar 两种都认；把 PATH 削成只剩 System32（没有 Git 的 usr/bin）再跑，
  > `verify:handoff` 的整树比对与 `verify:deploy --tar` 的绑定检查**都仍然 PASS**，
  > 换错包照样红——也就是说换台机器跑这段校验不会因为 tar 版本不同而给出假 FAIL。
- **三个交接脚本**：在仓库里、CR 字节数 = 0、`bash -n` 通过。
- **迁移链**：journal 每条都有对应 `.sql`，且 `idx` 与文件名前缀一致；0013/0014 的 drizzle 版与
  直跑版四份齐全；最后一条是 0014。
- **env 口径**：`api/lib/env.ts` 读到的每个变量都得在 `.env.example` 里出现，
  并且**解析到的名字少于 5 个就判探针不可信**（覆盖率脚本栽过的跟头，不再犯第二次）。
- **OPEN 区**：真机三条 UI、阿里云真实网关、生产库引擎版本、直跑版 ALTER 分支——
  这四条命令验不了，就明写成 OPEN，不参与"通过"计数。

一次跑出自家四个问题（前三个是我的探针，最后一个是真缺陷），都值得留：
① `execFileSync` 默认 `maxBuffer` 1 MB，取包内 2.85 MB 的 `boot.js` 直接 ENOBUFS，
   我第一版把它报成"取不到 boot.js"——**判据失败和判据没跑是两回事**，现在分开报并带上真实 stderr 首行；
② journal 的 `tag` 本身就带 `0013_` 前缀，我又 `padStart` 拼了一次，于是报"15 条迁移文件全缺"，
   看着像迁移链炸了，其实是我把文件名拼重；
③ 正则 `/(^|/)package\.json$/` 里的 `/` 会**提前结束字面量**（组内的 `/` 不例外），`node --check` 当场抓住；
④ 顺手查实的真缺陷：`.env.example` 里**没有 `NODE_ENV`**，而 `env.ts` 会读它——已补一行而不是在探针里开特例
   （探针里的特例就是假绿藏身的地方）。
另：Git Bash 的 `tar` 会把 `E:\tmp\x.tar` 当成"远程主机 E:"，必须先转 `/e/tmp/x.tar`——
这条只在传给孩子进程的路径上需要，node 自己的 `fs` 不受影响。

**它没接进 `npm run verify`**：换一台没有产物的机器跑会 FAIL 而不是 SKIP，那是假警报；
作为"上线前跑一次"的独立入口更诚实。

- 顺着"版本号到底存在哪儿"查下去发现一个运营层面的真空：**产物里没有任何版本字符串**
  （`package.json` 的 version 一直是 `0.0.0`，服务端没有版本端点，`index.html` 里也搜不到 8.1x，
  全仓库除了文件名和 CHANGELOG 标题之外没有一处写着 `8.12.0`）。也就是说"线上现在跑的是不是这份包"
  原本只能靠端点存在性间接推断。给 `verify:deploy` 加了 `--tar`：把**线上返回的入口 JS**
  与**交付包里同名那份**做 sha256 逐字节比对（对包 PASS `0df9389f4750801c…`；
  换成 r2 立刻 FAIL，且因为资源名是内容哈希，"包内找不到这个名字"本身就是"线上不是这份包"的信号）。
  不传 `--tar` 明确记为 SKIP 并在总结里写"不算通过"。三条踩坑记在此：URL 的 `/assets/…`
  在包内是 `dist/public/assets/…`（拿 URL 当成员名会"取不到"，长得极像"比对不一致"）；
  `execFileSync` 默认 1 MB `maxBuffer` 会截断 2.8 MB 的取包；Git Bash 的 tar 连 `/e//tmp` 这种双斜杠
  都容忍，但错误信息会误导人，所以驱动路径统一归一。

- 上传前又加了一道**包内内容安全**检查（在 `verify:handoff` 第 1 组里）：条目必须全在 `dist/` 之下
  （服务器以 root 解包，绝对路径或 `..` 会写到目录外）；包内不得有 `.map`（构建产物带上源码映射等于把
  源码传上公网）；对**全部非二进制正文**扫 4 条凭据特征（`LTAI…` AccessKeyId 形态、私钥块、带口令的
  `mysql://` 连接串、写死的 `APP_SECRET` 值），命中只报文件名与规则名，绝不回显命中内容。
  现算结果：r8 的 176 个文件里 55 个文本类正文**零命中**、无 `.map`、条目全在 `dist/` 下。
  三条都用毒包反向证明能变红：塞进一个含假 AK/假连接串的 `public/.env` 加一个 `poison.map`
  → 四条 FAIL 全中；把顶层目录改名成 `payload/` → 报"180 个条目会解到 dist/ 之外"。
  > 这一条里又是**我的探针出错**（本会话反复出现的同一类）：① 报错信息写成 `B.keys().filter(...)`，
  > Map 的键迭代器没有 `filter`，断言还没跑就崩，屏幕上留下"整树比对没做成"这种误导结论；
  > ② 第一版按**扩展名白名单**挑文本文件（js/css/html/json/txt/map），于是最可能藏凭据的无扩展名
  > `.env` 压根没进扫描——毒包测试里它安静地"通过"了。改成"排除已知二进制"的黑名单，并把这条留成规则：
  > **扫描类判据用白名单，默认失败方式是漏检**，而漏检不会报红。

### 二十、给"CI 验不到的那条 ALTER 分支"补一道静态门禁（并让它推翻我一轮的结论）

B-34 说清了动态覆盖做不到（本机起不了 mysqld，策略拦截，我没绕行）。但 ALTER 出错的两类主要原因
其实是**静态可判**的，所以加了 `scripts/check-run-sql.mjs`（已接进 `build`，也进了 `npm run verify`，
单独跑是 `npm run check:sql`）：

- ① 守卫/ALTER 指向的表必须在 0012 之前就已存在（同一文件里新建的表除外）；
- ② `CREATE TABLE` 必须 `IF NOT EXISTS` 且不与既有表重名（幂等的前提）；
- ③ 每条 `ADD COLUMN` 里 `NOT NULL` 必须带 `DEFAULT`——否则回滚到 8.11.0 后，老代码不写这列的 INSERT 会直接失败；
- ④ 不许出现 `DROP TABLE/COLUMN`、`MODIFY/CHANGE COLUMN`、`TRUNCATE`、`DELETE FROM`；
  `DROP INDEX` 允许，但**必须同名重建**，否则算真删除；同名重建也照样打 WARN，因为唯一性语义已经变了。
- 判据自身的牙齿：解析到的 `ADD COLUMN` 条数必须等于字面量出现次数，**少解析=少检查一律判 FAIL**
  （第一版就少解析了 1 条：`DEFAULT ''/avatar-1.png''` 这种**双写引号**的声明被 `[^']+` 截断，
  那条列安静地没被看过——正好是本项目反复出现的"白名单式漏检"）。

**它第一跑就推翻了我上一轮写下的结论**：我曾在 CHANGELOG 与交接文档里写"v14 的 DDL 没有任何 DROP、
回滚代码语义完全不变"，而我 grep 的关键字里**根本没有 DROP**。实际 `0014_v14_comment_report_run.sql`
会 `DROP INDEX uq_report` 再重建为 `(reporter_id, post_id, comment_id)`：不是删库级危险，但
举报去重从"每人每帖一次"放宽成"每人每帖每评论一次"，回滚代码不会崩、行为却回不到 8.11.0。
已改窄那条结论并把这一项挂成 **B-35** 等拍板。

四条变异都实测能变红（用 `--dir` 指向改坏的副本目录）：守卫表名拼错 → 报"指向不存在的表"；
去掉某列的 `DEFAULT` → 报"NOT NULL 却没有默认值"；把重建索引改名成 `uq_report_new` → 报
"DROP INDEX 之后没有同名重建"；去掉 `IF NOT EXISTS` → 报幂等会被破。
第三条最初**没报错**：`uq_report` 被当成 `uq_report_new` 的前缀匹配上了，补上标识符边界负向预查才红——
又一次"变异测试比绿灯有用"。

> 补一条实抓：接完门禁后我按老习惯单独跑了一次 `vite build` 验证链条，`verify:handoff` 立刻报
> "整树比对有 88 处不同：仅包内 88"。不是包错了，是 **`vite build` 的 `emptyOutDir` 会把
> `dist/public` 清掉，连带删了 `precompress.mjs` 产的 `.br/.gz`**——只跑 vite 不跑 precompress
> 得到的就是"首屏会退化成未压缩"的残缺产物。这道门禁在我这次误操作上当场变红，
> 说明它守的是真事；正确链条是 `vite build → check-motion-boundary → precompress → esbuild`。

### 二十一、更正第二十节里我自己写错的后果判断（B-35 降级）

上一节我根据 DDL 就断言"回滚代码后举报去重比 8.11.0 弱、行为回不到 8.11.0"。**读了写入路径后这句不成立**：
`api/services/moderation.ts` 与 8.11.0 的同函数都**只靠 `uq_report` 唯一索引去重**（没有代码级预查），
而 8.11.0 的 `reportContent` 压根不传 `commentId` → 插入时该列取默认值 0；
三列索引 `(reporter_id, post_id, comment_id)` 在 comment_id 恒为 0 的子集上与两列版**等价**，
所以回滚到老代码后"每人每帖一次"的幂等仍然成立，**不需要为了回滚安全去改 0014**。

真正剩下的只是前向语义：新代码允许同一用户按不同评论位各举报一次（这正是"评论举报"的本意），
于是审核队列里同一帖可能出现同一举报人的多条记录。B-35 相应从 Must 降为 Should，
内容改为"审核后台要不要把同帖多举报合并展示"。

方法论上的这条比结论本身更值得留：**我连着两次在同一段 DDL 上得出过头结论**——
第一次 grep 里没有 DROP 就断言"没有 DROP"（第二十节），第二次只看了索引列集就断言"回滚后行为变了"。
两次都是**只看数据结构不看读写路径**，而索引的语义只在"哪些语句会往里写什么值"里才完整。
以后凡是"某条约束/索引的变化会改变行为"这类判断，必须先 grep 出该表的所有 INSERT/UPDATE 调用点，
把新老两边实际传入的列值摆出来再说话；`check-run-sql` 的 WARN 文案也已改成提醒"去读写入路径，别只看 DDL"。

### 二十二、老客户端兼容：把"不需要重打包"从推断改成追出来的结论

v14 有两处**改了服务端返回形状**的地方，而线上还装着一批老 APK。我原先那句"APK 无需重打包"的依据是
"没有新增原生插件 + capacitor 依赖未变"——那只能说明**壳**不用换，说明不了**载荷**变了会不会让老 UI 崩。
这次按调用链逐条追：

- **输入侧（老客户端发来的请求会不会被新 schema 拒）**：对 8.11.0 与当前版本的三个
  *既有*过程的 input 做 diff——`comment` 加了 `images: ….default([])`（其余列与边界不变），
  `posts.comments` 加了 `sort: ….default("latest")`、`cursor/limit` 本就是 optional，
  `report` 加了 `commentId: z.number().optional()` 且处理器用 `?? 0`。
  **全部是"加默认值/可选项"，没有任何字段变必填**；zod 的对象默认剥离未知键，所以老客户端
  多发/少发都过得去。v14 新增的过程（评论点赞/删除/楼中楼/收藏）在老 APK 里根本没有调用点，
  它们的必填字段不构成兼容问题。
- **输出侧（老 UI 读的字段会不会消失）**：这条是真风险——`git grep post\.images 134dcd3^` 显示
  老 `FeedPost.tsx` 在 209/242/244 行直接 `post.images.map(...)`、`post.images.length`，
  **没有可选链**；而 v14 的信息流把 `images` 从列里排除、改带 `cover`。
  如果老载荷能撞上老 UI，这里会是 `Cannot read properties of undefined` 级的整卡崩。
  决定性的事实在 `apk-shell/capacitor.config.json`：`server.url = http://…:3000`（且 `cleartext: true`），
  即装好的 APK **加载的是服务器上的前端包**，不是内置那份——上线后所有客户端跑的都是新 UI，
  那条 `post.images` 代码路径根本不会被执行。内置兜底那份只在服务器不可达时用，而那种情况下
  信息流本来就没有数据回来，也撞不到。（顺带记一句：`apk-shell/` 不在 git 里，和根 `docs/` 一样未纳管。）
- **反过来这件事提高了上线的风险权重**：`server.url` 直连意味着**部署那一刻就切换了全部在线用户的 UI**，
  没有灰度、没有"等用户更新"这层缓冲。所以本次把回滚演练、`verify:deploy -- --tar` 的逐字节绑定
  和 5xx 判 FAIL 这三样补上，不是锦上添花——它们是这份包唯一的刹车。

结论：`APK 无需重打包` 成立，但现在它有一条**追出来的**依据链，而不是"没动原生插件"的旁证。

## [v8.11.0] - 2026-10-04 「哪钓专业化」（迭代计划 v13，C1~C7 全量）

> 状态：**已于 2026-10-04 17:31 (CST) 上线生产**（本地/库级验收 48+56 项全通过后热更新；见下方「部署记录」）。
> 主线：把「哪钓」从通用视觉问答升级为垂类专业决策器——**专业结论由知识库规则保证，模型只负责看图与叙述**。
> ⚠️ 生产 `/opt/quyu/.env` **尚未配置 `MOONSHOT_API_KEY`**：识别链路会返回「服务未开通」并**自动全额退还**（不扣钱），
> 配 Key 后无需重新发版即可生效。

### 部署记录（2026-10-04 17:31 CST）
- 迁移：`0012_v13_spot_expert_run.sql` 经生产 mysql CLI 执行两次（第二次全 skip，幂等实测）→
  5 个新列 + 3 张新表到位；历史台账 0 行，默认档位 `basic`
- 产物：`dist-v8.11.0.tar.gz`（2.5 MB）上传 → **sha256 双向一致** `0569b376…` → 解压暂存并核对结构
  （boot.js / public/index.html / 37 个 `.br` 变体 / 两个按需 chunk 齐全）→ 原子替换 → `systemctl restart quyu`（active）
- ⚠️ 踩坑记录：**不能用 PowerShell `Compress-Archive`**——它把条目写成 `public\avatar-1.png` 反斜杠，
  Linux `unzip` 会解成带反斜杠的扁平文件名导致资源全 404。已在替换脚本里改为 tar.gz + 结构核对 + 暂存后原子移动
- 线上复核：首屏传输 **189.0 KB**（v8.10.2 同法实测 189.6 KB，−0.6 KB）；入口 chunk 不含 v13 新 UI 字符串；
  `SpotFieldForm`（1.3 KB）/`SpotExpertReport`（1.4 KB）/`FloatingBall`（2.3 KB）三个按需 chunk 均 200 且含组件代码；
  图片 `.webp` 与两个保留名 200；`/api/perf` 204；`fish-spot` 路由 SPA 壳 200（需带 `Accept: text/html`，
  静态中间件只对导航请求做 fallback，这是设计不是 bug）
- 新过程上线确认：`identify / sampleConsent / feedback / knowledgeStatus / balance` 未登录均返回
  `UNAUTHORIZED`（而非 `NOT_FOUND`），说明分层与样本接口已注册生效
- 顺手补 v12 遗留：`/etc/cron.d/quyu` 加 `0 4 * * * root find /opt/quyu/logs -name 'perf-*.jsonl' -mtime +30 -delete`
  （原文件已备份为 `/etc/cron.d/quyu.bak-before-v13`）
- **回滚**：`cd /opt/quyu && rm -rf dist && tar xzf backups/dist-before-v8.11.0-20261004-172810.tar.gz && systemctl restart quyu`；
  库回滚 `gunzip -c backups/quyu-before-v8.11.0-20261004-172810.sql.gz | mysql -uquyu -p<密码> quyu`。
  新表/新列可留（老代码不读，`tier` 默认 `basic` 不影响对账）

### 输入侧（QY-SPOT-001 / 002，提交 C1）
- `identify` 入参扩展 8 个**全部可选**字段：`season / waterTemp / airTemp / weather / windLevel / hour / targetFish[] / waterType / clarity`，缺省不阻断（实测：不填任何现场参数可完成专家档识别）。季节缺省按当月推断、时段缺省按当前小时、水温缺省按季节+气温估算（`api/knowledge/fishingRules.ts`）。
- 前端 `/fish-spot` 拍照区下方新增「补充现场信息」**默认收起**表单（7 组选项 + 水色辅助）；`capturePhoto` 后自动调 `getCurrentPosition()` 补传经纬度（复用 v11 的 12s 硬超时，失败不阻断并提示）。
- **按需加载**：表单与专业报告各自独立 chunk（br 1.3 / 1.4 KB），实测入口 chunk 内不含任何 v13 新增字符串。

### 知识库与链路（QY-SPOT-003 / 004 / 005 / 011，提交 C2 + C3 + C7）
- 新增 `api/knowledge/fishingRules.ts`：**34 条**垂类规则（鱼种×季节×水型×流态×水色×结构×水温×时段 → 钓法/线号/钩型/调漂/铅坠/饵料/打窝/策略），含 13 组鱼种别名归一（黄辣丁→黄颡鱼、非洲鲫→罗非鱼等）与 `*` 通用结构规则。**全部标 `reviewStatus:"draft"`，待钓手/你审定**。
- 新增 `api/knowledge/index.ts`：本地零 token 规则检索（硬过滤 季节/水型/鱼种 + 软加分 流态/水色/结构/水温/时段，`MIN_HIT_SCORE=25`）、Top-N 鱼种多样化、`hasRuleFor` 覆盖率口径。
- **RAG 三段式**（`api/kimi/k3.ts`）：Step1 视觉特征提取（只观察、禁建议，`FEATURE_SCHEMA`）→ Step2 规则检索 → Step3 结论生成（`EXPERT_SCHEMA`，**不重传图片**，图像 token 只付一次）。Step1 失败/超时降级为空特征，链路不断。
- **反幻觉兜底是链路级的，不靠提示词**：命中规则时线号/钩型/调漂/铅坠以规则值为准（模型漏写由规则填充）；**未命中时四项具体数值强制清空**并标 `specificsSource:"none"`，前端明示「不提供线号/钩型/调目」。
- 输出结构化（QY-SPOT-005）：新增 `waterAnalysis / rigSetup / baitPlan / spotPick / suitableFishDetail / bestTimeDetail / knowledgeBasis`；`knowledgeBasis`（规则 id + 命中维度 + 审定状态）**由服务端注入，不经模型**，杜绝编造依据。
- **兼容取舍**：为满足「老 APK 行为完全不变」，基础档 Schema 与提示词**逐字保持 v12**（实测输出仅 7 字段、`suitableFish` 仍为 `string[]`）；结构化升级只出现在专家档，旧扁平字段同时保留。
- 热更（QY-SPOT-011）：`FISH_KNOWLEDGE_FILE` 指向 JSON 数组，每次识别 stat 比 mtime，变化重读；解析/校验/字段缺失**整批拒绝并保留旧表**（同 `SENSITIVE_WORDS_FILE` 模式）。

### 分层定价（QY-SPOT-007，提交 C5）
- `FISH_SPOT_EXPERT_PRICE_CENTS`（默认 200＝¥2.00，方案建议区间下限）+ `FISH_SPOT_EXPERT_FREE_LIMIT`（默认 1 次免费体验）；基础档价与免费额度不变。
- **两档免费额度分列记账**（`user_balance.expert_free_used`），互不挪用；台账 `fish_spot_calls` 加 `tier / rule_hit / rule_ids / k3_steps` 列（仍不存正文与图片，合规最小化不变）。
- 失败退还**按所选档位全额**退（付费退该档金额、免费退该档次数）。

### 样本沉淀（QY-SPOT-008，提交 C6）
- 新增 `fish_spot_samples`（图 + 现场参数 + 特征 + 命中规则 + 报告）与 `fish_spot_feedback`（有用/饵料不符/不准）与 `fish_spot_sample_consents`（授权与撤回）三表，与计费台账**物理分离**。
- **默认不存图**：仅存在未撤回授权记录时才写样本表（scope=image 落盘 `uploads/spots/`，单张上限 1 MB；scope=features 只存结构化数据）；撤回授权**立即删除本人全部样本与落盘文件**，计费台账与未挂样本 id 的反馈行不受影响。
- 结果卡新增反馈按钮与授权开关（说明文案含「随时可撤回」「不影响计费记录」）。

### 验证（本机实测，未上线）
- `tsc -b` → 0 error；`eslint .` → **0 问题**（顺手修掉工作区里 `FloatingBall.tsx` 的 `set-state-in-effect` 违规，改为 `useState` 惰性初始化，恢复 v12 清零基线）
- 构建门禁：`check-fonts` / `check-images` / `check-perf-wiring` / **`check-knowledge`（新增）** / `check-motion-boundary` / `precompress` 全 PASS
- **新增知识库门禁** `scripts/check-knowledge.ts`（已接入 build）：规则条数 34、字段完整性、**主流组合覆盖率 100%（48/48，四个水型各 100%）**、**典型场景命中率 100%**、未命中场景正确降级、Top-N 多样化、热更三项（外部文件生效 / 坏文件保留旧表 / 缺字段整批拒绝）
- **新增哪钓验收脚本** `scripts/verify-fishspot.ts`（`npm run verify:fishspot`）：真实 MySQL 直调服务层，**48 项断言全通过**——含老 APK 形状不变、免费额度分列、按专家价扣费、失败按档全额退还（余额分文不动 + 免费次数退回）、专家档两步链路、专业数值来自规则、未命中清空数值、未授权 0 样本、授权后样本+落盘图、撤回删净且台账不动、**并发 12 次 CAS：成功 5 次＝免费 3＋可付 2，余额不为负**
- 数据库迁移：`0012_v13_spot_expert.sql`（drizzle 生成）+ `0012_v13_spot_expert_run.sql`（生产直跑幂等版，含 information_schema 守卫）；本机 MySQL 26.7 实测：0000→0012 全量重放 OK，直跑版**重复执行两次不报错**，与 drizzle 版逐列逐索引一致，历史台账行默认回填 `tier='basic'/k3_steps=1`
- `smoke-static.mjs` 全项通过（56 项，含新增 7 项按需加载断言）
- 首屏体积：**189.0 KB br**（线上 v8.10.2 实测 189.6 KB，**低于 v12 基线**）。中途曾量到 190.7 KB，
  根因是工作区里尚未上线的悬浮球被 `Layout.tsx` 静态引用进了首屏闭包——已改为 `lazy` + `Suspense`
  （独立 chunk br 2.3 KB，代价是球比首帧晚一个 chunk 才出现）。v13 新增代码全部在懒加载 chunk
  （入口 chunk 内 grep「补充现场信息/专业报告/SpotFieldForm/fishSpot.identify」命中均为 0）
- 成本口径（⚠️ 估算，非账单实测）：专家档 2 次调用但 Step3 不传图，单次成本仍高于基础档；真实价须以 Moonshot 账单核算后再定专家档最终价

### 待你确认（不影响已实现，改 env 即可）
1. 专家档最终定价（现为 ¥2.00）与免费体验次数（现为 1）
2. 知识库 34 条规则的钓手审定（现为 `draft`，前端已显示「待审定初稿」提示）
3. 存图合规口径：当前实现为「默认不存 + 显式授权 + 可撤回删除」，需你确认是否即为可接受口径
4. `FISH_KNOWLEDGE_FILE` 热更（服务器文件）还是入库管理（现为文件方式）



## [v8.10.2] - 2026-09-12 「图片路径统一到 .webp」

> 状态：**已于 2026-09-12 00:19 (CST) 上线**（数据库迁移 + 代码对齐 + 下线兼容副本）。

### 变更
- **数据库图片路径迁移到 .webp**：把 v8.10.1 事故后临时补的「旧文件名兼容副本」下线，改为一劳永逸地消除「代码层 + 数据层」双重固化。22 个固定旧路径精确改为 `.webp`（`posts.images`/`author_avatar`、`products.image`、`ponds.cover`、`reviews.images`），明确排除 `/uploads/` 与保留名 `avatar-1.png` / `pond-yunxi-1.jpg`。迁移前全库备份 `quyu-before-webp-migrate-20260912-000830.sql.gz`，迁移后逐列校验 0 错迁/漏迁。
- **代码对齐**：`db/seed.ts` 25 处旧路径 → `.webp`；`public/` 删除 29 个兼容副本（`public/` 997 → 891 KB）；`check-images.mjs` 去掉兼容副本清单逻辑、保留 `db/` 扫描；`smoke-static.mjs` 改为校验「迁移后 `.webp` 路径 200」。
- 迁移 SQL 留档 `_archive/migrate-images-to-webp.sql`；`restore-legacy-images.py` 标注为「仅回滚用」。

## [v8.10.1] - 2026-09-11 「图片 404 事故修复」

> 状态：**已于 2026-09-11 23:43 (CST) 热修复上线**。

### 修复
- **线上图片全部 404**：v8.10.0 的 QY-PERF-004 把 `public/` 下 29 个位图改名为 `.webp`，但文件名同时被**代码层**与**数据层（数据库已落库的历史路径）**双重固化，改名前只同步了代码层，漏了数据层。前端从接口拿到的图片地址（`/feed-1.jpg`、`/prod-rod.jpg`、`/avatar-2.png`、`/pond-qinglong-1.jpg`、`/review-1.jpg` 等，生产库逐条核对 25 处）全部指向已不存在的文件 → 404。
- **修复方式**：不回滚、不改库、不动应用代码。新增 `scripts/restore-legacy-images.py`，从基线 `3e59500` 取原图、按同名 `.webp` 的实际像素尺寸重编码成**原文件名/原格式**（内容仍为优化后小图），与 `.webp` 并存——旧路径（数据层）与新路径（代码层）同时可达。共 29 个兼容副本，约 985 KB。
- **门禁补强**：`check-images.mjs` 扫描范围加入 `db/`；新增「兼容副本清单完整性」校验（`scripts/image-legacy-compat.json`，全量幂等生成，29 项），并校验每个兼容副本都有同名 `.webp` 孪生。已注入违规验证（移走 `feed-1.jpg` / 删 `avatar-3.webp` 均正确失败）。
- **冒烟补强**：`smoke-static.mjs` 新增「兼容副本全量可达」断言，逐个真实请求 29 个旧路径。

> 后续可选清理：待生产库路径迁移到 `.webp` 后，可整体下线这 29 个兼容副本（需用户确认后另做数据迁移）。

## [v8.10.0] - 2026-09-11 「性能专项 + 工程卫生」（迭代计划 v12）

> 状态：**已于 2026-09-11 21:38 (CST) 部署至生产**并完成线上验收（见下方「生产验收」）。

### 性能（QY-PERF-001 ~ 008）
首屏上线传输量（基线未压缩裸传 → 优化后 brotli 直出）：**1047.9 KB → 188.5 KB（−82%）**；首屏图片集合 2086 → 430 KB。

- **静态资源预压缩直出 + 分级缓存头**（QY-PERF-001）：`scripts/precompress.mjs` 构建期产出 `.br`(q11)/`.gz`(l9) 变体，运行时零 CPU 直出；`api/lib/vite.ts` 重写静态中间件——按 `Accept-Encoding` q 值协商、`/assets/*` immutable 一年 / `index.html` no-cache / `/uploads/*` 一天、补 ETag + Vary + 304、目录穿越防护。修掉「缺 Cache-Control 导致发版后旧 index.html + 已删 hash 资源白屏」。实测主 JS 943,532 B → 214,587 B（br，−77.3%），CSS 101,903 → 14,015 B（br，−86.2%）
- **路由级代码分割 + vendor 分组**（QY-PERF-002）：21 个静态 import → 首页/Login 静态 + 18 个二级页 `React.lazy`（统一 `<Lazy>` 包裹 + 骨架占位）；`manualChunks` 按 react/data/router/icons/utils/capacitor 分组。首屏 1021 → 216.1 KB，入口 chunk 943 → 134 KB，1 → 34 chunk
- **数字字体本地化**（QY-PERF-003）：删除 `fonts.googleapis.com` 渲染阻塞外链，自托管 Oswald（可变字体，单文件覆盖 400/500/600）+ Bebas Neue latin 子集，合计 34.4 KB（预算 ≤40 KB），`font-display: swap`；`scripts/check-fonts.mjs` 接入 build 门禁。首屏第三方域名依赖 → 0
- **图片转 WebP + 按显示尺寸降采样**（QY-PERF-004）：`scripts/optimize-images.py` 按「显示尺寸 × 1.5」（头像 ×2）重采样，逐类上限 avatar 128 / feed 640 / pond 720 / prod 560 / banner 720 / review 560 / cover 720。29 张转 WebP；`public/` 3489 → 891 KB（−74%），首屏图片 2086 → 430 KB（−79%），头像 7 张 760 → 15 KB。`/avatar-1.png` 与 `/pond-yunxi-1.jpg` 因被 DB 列默认值与服务端兜底引用**保留原名原格式**，仅原地重编码
- **framer-motion 按需能力包**（QY-PERF-005）：首屏静态闭包剥离 domMax（layout/drag/useMotionValue），需要者经 `LazyMax` 包裹延迟加载；`scripts/check-motion-boundary.mjs` 作为 build 前置门禁（三条动画能力不变量）。首屏 216.1 → 203.2 KB
- **QueryClient 默认值收敛**（QY-PERF-006）：`staleTime` 30s / `gcTime` 5min / `refetchOnWindowFocus` false / `refetchOnReconnect` true / `retry` 1（`retryDelay` 上限 3s）/ mutations `retry` 0。消除 38 处无 staleTime 调用点的重复请求、切前台重取风暴、以及 5xx 静默重试约 7 秒。正确性依据：37 处 `invalidate` 主动失效不受 staleTime 影响
- **清理 shadcn 组件层与死依赖**（QY-PERF-007）：删除 59 个零引用文件 + 45 个零引用包（dependencies 68→25、dev 25→23）；Login/NotFound 两页改用产品 token 重写并中文化。CSS br 14.0 → 6.2 KB、gzip 17.31 → 7.46 KB，首屏 203.2 → 187.7 KB。**两处必须显式保留**：`borderColor.DEFAULT = #2d1e1e14`（裸 `border` 上色来源）与 `borderRadius` 刻度（rounded-xl 101 处 / rounded-lg 21 处）
- **冷启动埋点与验收工具**（QY-PERF-008）：`/api/perf` 匿名采样接口（白名单字段校验、服务端补写 UA、落 `logs/perf-YYYY-MM-DD.jsonl`、超限不落盘、非法 JSON 仍 204）；前端 `src/lib/perf.ts` 用 `PerformanceObserver`(buffered) 采集 FCP/LCP/TTI + 资源字节数，`sendBeacon` 上报；配套 `scripts/measure-coldstart.mjs`（网络+CPU 降速实测）、`scripts/perf-log-stats.mjs`（真机采样分档聚合）、`scripts/bench-order-p99.ts`（下单 P99 基准工具）、`smoke-static.mjs` 新增 8 项埋点断言、`docs/perf/真机冷启动测量SOP.md`

### 工程卫生
- **lint 存量清零**：18 项（17 error + 1 warning，11 个文件）→ **0 项**。根因是 `eslint-plugin-react-hooks` 7.0.1 的 React Compiler 派生规则（`set-state-in-effect` / `use-memo` / `static-components` 等）对 v5 时代代码的存量违约
  - 9 处 `set-state-in-effect` → 改为渲染期推导 / 官方「按变化调整 state」写法；切 key 即重置的场景改用 `key={slug}` 重挂载
  - 5 处 `react-refresh/only-export-components` → 按已有约定拆分模块：`providers/trpc.tsx` → `trpc.ts`（单例，**对外路径不变**）+ `TRPCProvider.tsx`；`spots/Toast.tsx` → 加 `spots/useToast.ts`；`LoginSheet.tsx` → 加 `lib/kimiAuth.ts` + `hooks/useAuthGate.tsx`
  - 4 处类型/未用变量：`api/lib/http.ts` 引入 `JsonValue` 替代 `any`、`scripts/smoke.ts` 清理未用导入、`Checkout.tsx` 的 `useMemo(next7Days, [])` 改内联箭头
  - 注意：`use-memo` 错误会让编译器分析在该组件处 bail out，**遮挡后续错误**（Checkout 修掉 1 处后另 2 处才浮现）——lint 必须修到 0 才算数

### 验证（本地实测）
- `tsc -b` → 0 error；`eslint .` → 0 problem；`vite build` + `esbuild boot.ts` 通过
- 构建门禁：`check-fonts` / `check-images` / `check-perf-wiring` / `check-motion-boundary` / `precompress` 全 PASS
- `smoke-static.mjs` 全项 PASS（压缩协商 / 缓存头 / SPA fallback / 404 / 目录穿越 / 304 / 字体 / 图片 / 体积预算 / 埋点上报）
- 体积预算实测：CSS br 6.3 KB（≤12）、主 JS br 50.8 KB（≤70）、字体 34.4 KB（≤40）
- 冷启动实测（CDP 驱动真实 Chromium，每次全新 profile = 真冷缓存；基线 `3e59500` 注入同源埋点后重新构建，同一把尺子；叠加 4× CPU 降速，p50；**目标为 localhost 服务**）：
  - **Slow 4G**（1.5 Mbps/300 ms，10 次）：传输 1026 → 287 KB（−72%）、FCP 7064 → 2464 ms（−65%）、LCP 7560 → 2984 ms（−61%）、可交互 7343 → 2708 ms（−63%）
  - **Fast 4G**（4 Mbps/20 ms，5 次）：传输 1149 → 290 KB（−75%）、FCP 3212 → 1264 ms（−61%）、LCP 3568 → 1772 ms（−50%）、可交互 3436 → 1551 ms（−55%，达成 <2 s 设计指标）

### 生产验收（2026-09-11 21:38 CST 上线，实测于 http://47.109.185.118:3000）
- **上线动作**：`dist` 打包经 Workbench CLI 上传 → SHA256 双向核对一致（`175f1c43…`）→ `rm -rf dist && unzip` 覆盖 → `systemctl restart quyu`（PID 42802，active）。**无数据库迁移**（v12 未改 `db/`）。回滚包 `backups/dist-before-v8.10.0-20260911-213733.tar.gz`
- **压缩与缓存头（上线前 → 上线后）**：`index.html` 由无 `content-encoding`、无 `Cache-Control` → `content-encoding: br` + `cache-control: no-cache` + `etag` + `vary: Accept-Encoding`；`/assets/*` → `public, max-age=31536000, immutable`；`Accept-Encoding: identity` 时正确回退裸传
- **首屏传输量**：单页 HTTP 实测 **1021 KB（裸传）→ 189.5 KB（br，−81.4%）**；同环境 identity 对照 609.4 KB，压缩收益 68.9%。其中入口 `index-DbzxmEpT.js` 52.5 KB、`vendor-react` 52.0 KB、`index--T3A94us.css` 6.4 KB
- **生产冷启动实测**（CDP + 真实 Chromium，目标为**线上地址**，4× CPU 降速，5 次 p50；含本机→成都真实 RTT）：
  - **Fast 4G**：TTFB 37 ms、FCP 836 ms、LCP 1684 ms、可交互 **940 ms**、load 631 ms
  - **Slow 4G**：TTFB 36 ms、FCP 2116 ms、LCP 2416 ms、可交互 2170 ms、load 1904 ms（对比实验室基线 7343 ms，−70%）
- **埋点闭环打通**：真实浏览器加载线上站点后 `sendBeacon` 上报成功，服务端落盘 `/opt/quyu/logs/perf-2026-09-11.jsonl`（含 ttfb/fcp/lcp/interactive/decodedBytes/dpr/cores/effectiveType 等字段）——**真机采样路径已可正式启用**
- **回归项**：`/api/perf`（有效样本 204 / 非法 JSON 204 / 无效样本不落盘）、`/api/oauth/nonce` 200、SPA fallback（`/spots`、`/post/123`、`/shop`、`/me` 带 `Accept: text/html` 均回入口 HTML）、未知资源 404、目录穿越 404、`/uploads/*` 206（APK 更新链路完好）、ETag→304 协商命中、`avatar-1.png` 保留名 200。tRPC 全部 `status: ok`（1–2 ms），服务 RSS 92 MB，无 error 日志

### 说明
- 提交记录（分支 `v12-app-tuning`，每项一件）：`ab1d23c`(001) `f0b8f3f`(003) `55334be`(002) `689f0f7`(005) `9a19703`(006) `b30489d`(007) `265ec41`(004) `f7f5dbe`(008)；lint 清零另计一件
- 冷启动数字均为**实验室实测**（真实 Chromium + 网络/CPU 节流，基线注入同源埋点保证同一把尺子）。**真机 WebView 采样**受 APK 限制（Capacitor `webContentsDebuggingEnabled` 在 release 构建默认关闭，无法直连 DevTools），已改为**服务端采样路径**，并在本次部署后验证打通（真实浏览器上报 → `/opt/quyu/logs/perf-*.jsonl` 落盘）；正式真机数据待按 `docs/perf/真机冷启动测量SOP.md` 采集。**下单 P99** 仍未产出可信数字（本机 MySQL 非测试实例；`scripts/bench-order-p99.ts` 已就绪，建议直接在服务器本地执行以排除网络干扰）
- 无单测覆盖（`vitest` 配置的 `api/**/*.test.ts` 为空），回归依赖类型检查 + 构建 + 静态门禁 + 冒烟脚本

## [v8.9.0] - 2026-09-06 「合规三件套补齐 + 版本触达」（迭代计划 v11 全量）

### 新增
- **账号注销**（QY-E-005）：`users.deletion_requested_at`（迁移 0009）；7 天冷静期 + hourly 定时匿名化（unionId 改 `deleted:` 前缀、昵称改「已注销用户」、头像/简介/封面/邮箱/密码哈希清空，冗余作者名同步改写）；帖子/评论保留匿名展示，订单流水保留对账；冷静期内密码登录自动撤销；admin 账号禁止自助注销；「我的→设置」红色入口 + 输入「注销」二字确认 + 状态条可撤销
- **内容前置过滤**（QY-SAFE-002）：`contentFilter` 服务两档词表（违禁 20 词拒发 / 广告 20 词落库+系统举报进审核队列），覆盖发帖/评论/鱼讯/编辑帖子/入驻申请；词表支持 `SENSITIVE_WORDS_FILE` 服务器文件 mtime 热更，缺失回退内置；命中写审计日志（不含全文）；fail-open 保可用性
- **APP 版本检查**（QY-G-003）：`app.versionInfo` 公共查询（`/opt/quyu/app-version.json` mtime 热更 → env 兜底 → null 静默）；UpdateSheet 弹层仅原生壳内展示（`@capacitor/app` getInfo 比对 versionName），force 模式不可跳过
- **塘主入驻申请**（QY-D-002）：`pond_applications` 表（迁移 0010）；`/pond-apply` 表单页（照片≤4 复用上传管线、3 次/天限流、pending 幂等 409）；/moderation 新增「入驻申请」Tab（仅 admin），通过自动建塘 + 生成认领码 + 通知申请人，拒绝必填备注；审批幂等
- **渔获分享卡片**（QY-COMM-009）：`posts.shareCard` 返回卡片数据 + 服务端 QR（纯 JS qrcode 库打进 bundle）；前端 canvas 2D 合成 750×1100 PNG（封面/chips/摘要/QR），保存下载 + 长按降级

### 变更
- `auth.me` 增量返回 `deletionRequestedAt`；编辑帖子接入敏感词过滤（补绕过漏洞）
- APK v11：versionCode/versionName=11，新增 `@capacitor/app` 插件；下载地址 http://47.109.185.118:3000/uploads/quyu-v11.apk
- 备份脚本预置 OSS 上传段（注释态，待 RAM 授权后启用，见 NEXT-ITERATION）

### 验证（线上实测）
- 注销申请幂等/撤销/冷静期登录自动撤销 ✅；违禁词发帖 400 拒发 ✅；广告词落库+系统举报进队列 ✅；入驻提交/重复 409/admin 拒绝/通知申请人 ✅；版本接口+APK 下载 ✅；`posts.shareCard` QR ✅

## [v8.8.0] - 2026-09-06 「合规与安全三件套之二 + 关注价值」（迭代计划 v10 全量）

### 新增
- **内容举报与审核**（QY-SAFE-001）：`reports` 表（迁移 0008）；帖子/评论「举报」入口；`/moderation` 审核队列（全局 admin 审全站，塘主审自己钓场）；审核删除后帖子全站 404，被删作者收通知；重复举报幂等
- **用户协议与隐私政策**（QY-E-002）：`/terms`、`/privacy` 静态内容页 + 注册勾选「已阅读并同意」+ 登录页入口
- **关注动态流**（QY-COMM-008）：feed 新增「关注」Tab（仅关注作者帖子，时间倒序）；推荐召回关注作者 1.5× 提权
- **粉丝/关注列表**（QY-E-003）：`/me/follows`，头像+昵称+关注状态+回关
- **钓场评价区块**（QY-B-002）：钓场详情评价列表 + 评分分布 + 分页，`ponds.reviewCount` 与真实评价数对账
- **主页封面自定义**（QY-E-004）：内置 3 张 + 相册上传（`users.cover`）

### 安全（QY-G-002）
- APP_SECRET 轮换为真随机值（全员会话失效一次，重新登录即可）
- 发帖/评论/点赞/关注/下单全部要求真实登录，匿名只读

### 验证
- 双账号实测：举报落库 → 审核队列可见 → 删除后 404；匿名互动全部 401

## [v8.7.0] - 2026-09-06 「商城闭环 + 社区关系」（迭代计划 v9.0 全量）

### 新增
- **商城订单闭环**（QY-SHOP-001）：「我的」页商品订单入口 + 订单列表（状态筛选）+ 状态机流转（付款确认→发货→收货）+ 商品退款（复用门票 CAS 模式）
- **帖子删除/编辑**（QY-COMM-004）：软删（feed/主页/详情全站不可见），他人删除返回 404 不泄露存在性；编辑限内容/图片
- **数据备份与存活自检**（QY-OPS-001）：cron 每日 03:17 mysqldump → `/opt/quyu/backups/`，保留 7 天；每 5 分钟健康检查，连续 2 次失败自动重启并记 health.log
- **关注/粉丝体系**（QY-COMM-005）：`follows` 表（迁移 0007）+ 关注/取关 + 主页真实计数
- **评论楼中楼**（QY-COMM-006）：`comments.parent_id` + 两层缩进 + reply 通知
- **帖子搜索**（QY-COMM-007）：关键词 LIKE + 首页搜索入口

## [v8.6.1] - 2026-09-06 「退款 + 塘主多钓场 + 迁移 CI」

### 新增
- **门票退款**：pending→refunded CAS 状态机 + 幂等 + 越权 404，票券页「申请退款」
- **塘主多钓场绑定 + 自助认领**：`pond_admins` 表 + `ponds.claim_code`（迁移 0006），塘主看板页输入认领码自助绑定，核销/发鱼讯/看板按钓场作用域隔离
- **经营周报**：`owner_stats_daily` 近 7 天日聚合 + 环比上周 + 迷你柱状图
- **迁移 CI 化**：drizzle 迁移补齐至 0006；`.github/workflows/ci.yml` 每次提交在 MySQL 8 测试库全量跑迁移 + tsc + build

## [v8.6.0] - 2026-09-05 「定位可读地址 + 个人简介」

### 新增
- **GPS + OSM 逆地理**：发帖坐标经逆地理编码为可读地址（`posts.location`），详情页展示，为空回退坐标（国内精度受限，高德方案待 Key）
- **个人简介**：`users.bio`，个人主页展示与编辑

## [v8.5.0] - 2026-09-05 「发帖交互完备」（Sprint 迭代 4）

### 新增
- **真实相册选图**：原生端走 Capacitor Camera 插件（多选 ≤9 张），Web 回退文件选择器；统一压缩 1600px/JPEG；预览网格可删、首图为封面
- **真实 GPS 定位**：「显示定位」开关实时取坐标（原生 Capacitor Geolocation 运行时申请权限；Web 走 navigator.geolocation），成功显示坐标 chip，失败如实提示并回退；坐标随帖落库（`posts.latitude/longitude`，迁移 0005），详情页展示定位 chip

### 修复（发布页去假）
- 删除预置假照片/假文案/假鱼种/假钓点/假重量（全部从空白开始）
- 删除「同步到钓点攻略区」装饰开关（无对应功能实体）
- 重量改选填并强化小数输入过滤；必填收敛为「照片+鱼种」

### 验证
- 线上实测：带坐标发帖入库（30.3751°N,114.3210°E）→ 详情页定位 chip 显示；发布页空初始态 + 发布按钮 gating 正确

## [v8.4.0] - 2026-09-05 「收藏订阅 + 消息中心」（Sprint 迭代 3）

### 新增
- **收藏/订阅后端化**：新表 `pond_marks`（user×pond×kind 唯一）；`ponds.toggleMark`（fav 收藏 / news 订阅鱼讯，开关式）、`myMarks`、`myFavorites`；钓场详情/钓场卡片收藏订阅全部走真实接口（乐观更新+失败回滚），未登录弹登录层
- **「我的收藏」页** `/favorites`：收藏钓场列表（封面/地区/价格/评分），Profile 服务宫格入口恢复
- **消息中心**：新表 `notifications`；点赞/评论→通知帖子作者，核销→通知购票用户（自赞自评不通知）；`notify.list/unreadCount/markAllRead`；`/notifications` 页（未读圆点、2s 自动已读、点击跳详情）；首页顶栏真实铃铛 + 未读红点（30s 轮询）

### 验证
- 双账号实测：收藏 toggle/myMarks/myFavorites、点赞→作者未读 +1→全部已读清零、下单→核销→购票者收到 verify 通知，全过

## [v8.3.0] - 2026-09-05 「帖子详情页」（Sprint 迭代 2）

### 新增
- **帖子详情页 `/post/:id`**：大图横滑（双击点赞+爆鱼动效）、作者行、完整正文、鱼种/重量 chips、钓场挂载条（跳钓场详情）、点赞/评论数/分享操作栏、内联评论区（骨架/空态/列表）、底部评论输入条（登录门槛 + 安全区适配）
- 后端 `posts.detail` 接口（不存在返回 404「帖子不存在或已删除」）
- 分享链接升级为 `/post/<id>` 永久链接；旧格式 `/?post=<id>` 自动 301 兼容跳转详情页

### 变更
- 信息流「查看全部评论」从弹层改为进详情页（真实帖子）；评论图标仍开快捷评论弹层

### 验证
- 线上实测：详情页渲染/点赞/发评论（计数+列表即时刷新）/分享链接落地/旧链接兼容跳转，全链路通过

## [v8.2.0] - 2026-09-04 「账号密码登录」

### 新增
- **自包含账号密码登录/注册**（零外部依赖，供 Kimi OAuth 不可用的部署环境）：`auth.register` / `auth.loginPassword`（scrypt 加盐哈希，无需第三方库），注册/登录限流 5 次/12 秒/IP；用户名支持中文（2-20 位）；会话复用既有 JWT+Cookie 机制（unionId 命名空间 `pwd:` 与 OAuth 隔离）
- 前端：`PasswordAuthForm` 共享组件接入登录引导弹层与登录页（登录/注册切换 Tab），「我的」页登录按钮、商城「我的订单」空态全部改为弹层登录；Kimi 登录入口保留
- `users.passwordHash` 列（迁移 `0003_password_auth`）

### 去演示化（真实链路收口）
- 收银台：删除假的微信/支付宝/余额支付方式与 1.2s 假 loading，改为「测试环境·不产生真实扣款」的真实下单确认（订单真实落库，票券可查可核销）
- 分享面板：删除假的微信/朋友圈入口（保留系统分享+复制链接，均真实）
- 扫码核销：删除「模拟扫到票」假按钮（http/WebView 无相机权限时诚实引导手动输码，真实核销链路）
- 票券卡「模拟塘主核销（演示）」→「塘主核销此票」（真实调 orders.verify）
- 页脚「MVP 演示版 v0.1.0」→ 真实版本号

### 修复（推荐反馈）
- **刚发的帖子沉底**：互动率封顶 1（率值>1 无意义，种子数据曾以数千分淹没新帖）；作者 48h 内新帖在自己信息流置顶；发帖后失效召回池与 feed 缓存——发帖即刻可见

## [v8.1.1] - 2026-09-04 「HTTP 部署登录修复」

### 修复
- **state nonce mismatch**：生产模式无差别给会话/ nonce Cookie 打 `Secure` 标记，纯 HTTP 部署（裸 IP 测试站）下浏览器拒存 Cookie，OAuth 回调必现 `state nonce mismatch` → Cookie 属性改为按请求上下文判定（`x-forwarded-proto` 优先，localhost/纯 IP 主机按非安全上下文发 `SameSite=Lax` 无 Secure；HTTPS 域名保持 `None+Secure`）
- 部署包：`package.json` 补 `"type":"module"`（ESM 启动崩溃）、迁移 SQL 导入前剔除 drizzle `--> statement-breakpoint` 标记、种子数据改相对时间（feed 30 天召回窗恒有内容、演示订单恒可核销）

## [v8.1.0] - 2026-09-03 「虚拟按键与全站修复」（Sprint 9）

### 修复（安卓虚拟按键 / 安全区）
- **系统虚拟导航栏遮挡**：新增 `--safe-top/--safe-bottom` CSS 变量体系 + `src/lib/safeArea.ts` 探测兜底——安卓 WebView 且 `env(safe-area-inset-*)` 为 0 时自动注入 48px/24px 兜底（竖屏），横屏/桌面/iOS 不误伤
- 全站 9 处已有 `env()` 统一换变量，14 处漏处理贴底 UI（商品详情购买栏、选日期、核销结果、购物车结算、登录引导、编辑资料、通用弹层壳、分享层、渔获浏览、Story、成功页等）全部补齐
- **双状态栏**：仿 iOS 假状态栏在原生壳内自动隐藏并让位真实状态栏；全屏覆盖层顶部补安全区

### 修复（P0 交易链路）
- **Checkout 金额错配**：删除硬编码青龙湾数据，以 `ponds.detail` 为唯一数据源（真实钓场/票种/价格/钓位），用户所见金额=实际订单金额
- **选日期丢失**：DateSheet 回传真实日期（本地时区 yyyy-MM-dd），Checkout 动态生成 7 天日期，告别写死 2025 年
- **钓位永久锁死**：占用判定改为 (钓场, 到访日, 座位) 维度，事务内行锁 + 订单交集校验，座位按日释放；`ponds.detail` 新增 `visitDate` 入参返回当日真实占用
- **事件队列丢事件**：handler 成功后才登记 `processed_events`，失败留缓冲下轮重试，恢复 at-least-once 语义

### 修复（P1 功能）
- useAuthGate 竞态：auth.me 查询中不再误弹登录层
- 商城 mock 回退 productId=NaN 导致加购重复行/下单必败：回退模式禁用下单并明确提示
- 评价：失败不再假成功；仅限本人已核销订单（IDOR 修复）；重复评价返回 409；作者名用真实昵称
- 塘主看板「今日」口径改为真实当日（DB 时区），used 不再计入退款单；`ownerStats` 由公开改为需塘主权限（原泄露核销码与营收）
- 核销失败分级：限流/5xx 不再伪装成功，仅网络不可达才演示兜底（文案明示）
- 钓场关键词搜索 snake_case 原始行导致前端崩溃：改为取 id 回表映射
- 下单幂等键前端生成复用；数量与选座数强一致（前后端双校验）
- 资料修改需真实登录 + 限流；头像上传目录移出 dist（构建不再清空），新增 /uploads 静态路由

### 修复（P2 体验，摘要）
- 死按钮全清：帖子分享/更多、发动态、查看全部、再来一单、复制链接等全部接真实行为或移除；顶栏假图标红点移除
- 点赞失败回滚；评论失败提示并刷新计数；自定义头像保存后即时生效；下拉刷新真刷新；mock 回退不再不可逆；收藏/订阅 localStorage 持久化；空票种钓场不再白屏；重量输入防 NaN；双 `*` 路由修复 404 可达
- OAuth state 增加服务端 nonce 校验（防登录 CSRF，旧格式兼容放行）；auth.me 不再下发 unionId；商品下单事务化；迁移 SQL 补齐（0000-0002）
- **本地启动崩溃**：未配置 `KIMI_AUTH_URL` 时 JWKS 在模块加载期 `new URL(空)` 抛 Invalid URL 拖垮整个 dev 服务器 → 改惰性创建，未配置时仅在真正校验 token 时报明确错误

### 验证
- `tsc -b` 零错；`vite build` 通过；模拟安卓 WebView（Pixel 8 UA）实测 `--safe-bottom:48px` 注入、TabBar 与详情页吸底栏 padding 48px、假状态栏隐藏；桌面端 0px 不误伤；首页/钓点/商城/我的/钓场详情渲染正常

## [v7.1.0] - 2026-09-03 「评审修复」（Sprint 8）

### 修复（按 5 处用户标注）
- **登录数据未初始化**：「我的」页 auth.me 加载中加骨架屏，杜绝未初始化闪烁
- **头像自定义导入**：编辑资料支持从相册/文件选择头像，前端压缩至 256px，经 `avatarData`(dataURL) 上传后端落盘 `dist/public/uploads/avatars/` 存 URL（上限 2MB）
- **分享实际有效内容**：分享主页改为真实名片——用户名 + 等级 + 累计渔获数 + 最新战报 + 直达链接
- **塘主审核员认证**：`orders.verify` 与 `ponds.publishNews` 强制 `role=admin`（unionId 命中 `OWNER_UNION_ID` 时建档即授权），普通登录用户核销/发鱼讯返回 403；塘主工作台未认证时显示认证引导横幅，扫码/手动核销按钮加门槛
- **虚假按键**：发布鱼讯接真实 `ponds.publishNews` 落 `fish_news` 表并失效钓场缓存，详情页鱼讯即时可见

### 验证
- 匿名核销/发鱼讯 → 401；非 admin → 403；头像 dataURL 落盘验证通过；tsc 零错

## [v7.0.0] - 2026-09-03 「温和登录」（Sprint 7）

### 新增
- 登录引导弹层 `LoginSheet` + `useAuthGate` 钩子：未登录执行关键操作时弹出 Kimi 登录引导（「先逛逛」可关闭，不强制）
- 「我的」页真实登录状态：已登录显示 Kimi 头像昵称 + 退出登录；未登录显示登录按钮；编辑资料需登录

### 变更
- `auth.me` 由 authedQuery 宽松化为公共查询：匿名返回 `null`（前端据此引导登录），不再 401
- 登录门槛接入：发布渔获、商城下单/立即购买、钓场购票支付、信息流点赞、发表评论
- 演示兜底保留（`ALLOW_DEMO_USER=true`）：游客浏览、看 feed、逛商城不受影响

## [v6.0.0] - 2026-09-03 「全真按钮」（Sprint 6）

### 新增（后端）
- `product_orders` 表：商品订单，含幂等键唯一约束
- `products.search`（关键词 LIKE 检索）/ `products.order`（服务端重算金额 + 销量原子自增 + 幂等）/ `products.mine`
- `posts.create`：真实发帖（pondSlug 反查关联，图片/鱼种/重量落库），限流 5 次/分
- `users.update`：昵称/头像真实保存

### 修复（前端虚设按钮 → 真实链路）
- 商城：搜索框真实检索；加入购物车/立即购买/去结算全部接下单接口，购物车抽屉支持改数量、实时合计、下单中 loading；下单成功返回真实订单号
- 发渔获：发布按钮调 `posts.create`，成功后信息流即时刷新可见
- 我的：设置 → 真实编辑资料弹层（昵称+头像，保存到 users 表）；分享主页 → 系统分享/复制链接；数据行、服务宫格全部接通真实页面；帮助中心改为真实内容弹层
- 全站不再存在「演示版功能」占位提示

### 验证
- 冒烟测试：下单幂等重放返回同一订单；发帖后 feed 首条即为新帖；搜索命中真实商品
- 版本快照：`5eb6cd2`（dynamic），APK 包 `趣渔-v6-联网版.apk`（SHA-256 `6cf5d895…cdfa7`）

## [v5.0.0] - 2026-09-03 「企业级架构」

### 新增
- **多模态数据访问层**（`api/infra/`）：CacheStore / SearchIndex / EventQueue / AnalyticsStore / RWDataSource 五类抽象端口，当前内存+SQL 实现，预留 Redis / Elasticsearch / Kafka / ClickHouse 切换，业务代码零改动
- **领域服务模块**（`api/services/`）：community / trade / pond / shop / recommendService / profileService / ownerService，tRPC router 降为薄壳
- **横切中间件**：TokenBucket 限流（CacheStore 实现）、结构化 JSON 日志、慢查询告警（>200ms）、RequestID 链路追踪
- 新表：`outbox_events`（事务性发件箱）、`processed_events`（消费幂等）、`owner_stats_daily`（经营汇总）；新列：`orders.idempotency_key`、`posts.pond_slug`、`posts.impression_count`
- 13 项复合索引（消除 filesort、支撑游标分页）
- 性能压测报告 `perf-report-v5.md`、架构审查报告 `review-arch-v5.md`、独立部署路线 `deployment-roadmap.md`

### 修复（P0 并发安全）
- 点赞 SELECT-then-INSERT 竞态 → 唯一索引 + 1062 冲突捕获
- 下单无幂等/无事务/钓位超卖 → 幂等键 + withTx 事务 + 钓位 CAS
- 核销两步并发双写 → 单条 CAS UPDATE
- 推荐召回 400 次相关子查询 N+1 → 冗余计数列直读
- 钓场关键词搜索 500 → ORDER BY 前缀拼接修复
- orders.verify 匿名可撞码 → 强制登录 + IP/用户双维度限流（限流 key 改用 socket IP，防 XFF 伪造）

### 性能（实测，同机 2vCPU + 远程 TiDB RTT≈74ms）
| 指标 | 升级前 | 升级后 |
|---|---|---|
| feed P99 / QPS | 220ms / 89 | 58ms / 1148 |
| 事件消费速率 | 1.2 条/s | 714 条/s |
| 缓存命中率 | — | 99.8% |
| track P99 | 959ms | 10ms（低压档） |

## [v4.0.0] - 2026-09-02 「联网版」

### 新增
- Capacitor `server.url` 指向已发布站点，APK 实时加载线上内容
- 动态全栈部署（版本 ID 3175be3），后端 + 数据库随版本上路

## [v3.0.0] - 2026-09-02 「品牌版」

### 变更
- 应用图标与启动页替换为用户上传的鱼竿 LOGO（lets fishing）
- 全密度 mipmap 图标（mdpi~xxxhdpi）+ Android 12 SplashScreen API 适配
- APK：趣渔-v3.apk（8.5 MB，com.quyu.app，minSdk 23 / targetSdk 35）

## [v2.0.0] - 2026-09-02 「全栈版」

### 新增
- 真实后端：tRPC 11 + Hono + Drizzle ORM + MySQL(TiDB)，13 张表
- 业务闭环：推荐流 / 下单 / 6 位核销码 / 塘主核销 / 评价 / 商城
- 抖音式推荐算法：行为采集 + 用户画像 + 24h 新鲜度衰减 + MMR 多样性重排
- 「我的兴趣画像」实时可视化
- Kimi OAuth 登录（auth 特性嫁接）

## [v1.0.0] - 2026-09-02 「MVP 原型」

### 新增
- 10 页全链路静态原型：社区流 / 找钓场 / 钓场详情 / 下单支付 / 票券核销 / 塘主端 / 评价晒图 / 发渔获 / 商城 / 我的
- Instagram 式设计语言：暖中性自然色系（橄榄绿 #716a4b / 米白 #f2f0e6）、420px 手机壳层
- Capacitor 7 打包 APK（HashRouter 适配 WebView）
