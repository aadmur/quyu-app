# 变更日志（CHANGELOG）

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 规范。

## [v8.12.0] - 2026-10-06 「帖子交互专项」（迭代计划 v14，A+B+C 全量，一次性交付）

> 状态：🟡 **编码与本地验收完成，尚未上线生产**。需求对齐见 `docs/产品/迭代计划-v14-草案.md`，
> 术语裁定见 `CONTEXT.md`，不可逆决策见 `docs/adr/0001~0005`，运维与验收证据见
> `docs/NEXT-ITERATION.md` 第九节。
> ⚠️ **上线顺序硬约束**：必须先执行 `0013` + `0014` 迁移，再切 dist。新代码硬依赖
> `comments.{author_avatar,images,like_count,deleted_at}`、`comment_likes`、`post_favorites`、
> `reports.comment_id`，缺任一会在运行期报错。
> 主线：把「打开帖子」从路由跳转改为**全屏弹层**，顺手拆掉**帖子图片 base64 入库**这颗雷，
> 并把评论区从"能看"做到"能用"。

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

接入阿里云内容安全图片机审。**官方已核实**：按量付费通用版 $0.6/千次（高级 1.2 / 入华 0.7），
API 支持 URL 或二进制提交、**图片无需公网可访问**，所以审核能真正发生在落盘之前。
⚠️ **`IMAGE_MODERATION_ENABLED` 默认 false**：ROA 签名与请求体字段名**尚未联调验证**，
函数上留有 `TODO(签名校正)`。未配置时降级为「放行 + 写 `reports` 待人工复核」——
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

### 八、明确未做 / 已知边界

- feed 本体 offset→游标 **B-10 仍在**（本轮只做了评论游标分页）。
- 存量 base64 回填**未执行**（工具就绪，取决于生产预检命中行数；见下）。
- 渔获墙 / 审核队列仍全列读 `posts.images`（**B-18/B-19**）：前者是真缺陷（2-4MB 白传给客户端，
  且四个统计查询都漏了 `isNull(posts.deletedAt)`）；后者刻意保留但出参只透出第 0 张，
  违规图若在九宫格后段则审核员看不到。
- 评论计数两套口径同屏（**B-17**）；`pickImages` Web 回退对损坏文件会永久 pending（**B-20**，
  先前就存在、本轮扩大暴露面）；顶层「加载更多」失败后是死按钮（**B-21**）。
- **热门排序游标漂移已实测量化**：锚点期间某条被刷高赞会使其从下一页**漏 1 条、重复 0 条、
  不串页**，属有界退化（见 `docs/NEXT-ITERATION.md` 第五节）。
- 楼内「展开更多」在底部、拉出的是更老的回复、位置出现在按钮上方 —— 前端无法在不牺牲
  阅读顺序的前提下修掉，已在 `commentTree.ts` 注释里记为结构性取舍。

### 九、上线前必须由你完成

1. 生产库跑迁移面预检（两条已实测可用的 SQL 见 `docs/NEXT-ITERATION.md` 第九节），
   据此决定是否需要执行 `db:image-backfill`。
2. 阿里云内容安全：开通 + 配 AK/Secret + **联调校正签名**，并拍板"机审不可达时
   fail-closed 还是 fail-open"。
3. **真机目检**（本地无库、起不了有效前端会话，以下我无法代验）：弹层下拉关闭手感、
   键盘弹起时评论输入框是否完整可见、安卓返回键、图片横滑与单击放大是否误拦、
   排序 Tab 下划线对齐、搜索结果卡片是否有图。



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
