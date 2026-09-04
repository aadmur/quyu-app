# 变更日志（CHANGELOG）

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 规范。

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
