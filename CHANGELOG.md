# 变更日志（CHANGELOG）

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 规范。

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
