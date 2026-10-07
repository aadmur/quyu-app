# 产品待办列表（Product Backlog）

按优先级排序（MoSCoW 法则）。每条包含用户故事、优先级、验收标准。

## P0 — Must Have（下一冲刺候选）

| ID | 用户故事 | 优先级 | 验收标准 |
|---|---|---|---|
| B-14 | 作为开发，我希望把历史帖的 base64 图片一次性回填为磁盘 URL，彻底解除单行 MB 级与内存压力 | Must | 先跑迁移面预检 `SELECT COUNT(*) FROM posts WHERE JSON_SEARCH(images,'one','data:image%') IS NOT NULL` 确认行数；脚本幂等可重跑；回填前 mysqldump + 原值导出 JSON 备份；回滚可用备份写回（ADR-0002）。**注意 `postCoverSql` 对 >512 字符首图判 null，未回填的遗留图帖在 feed 里没有封面——回填完才恢复** |
| B-15 | 作为运营，我希望 UGC 图片机审真正生效，而不是停在「放行转人工」降级 | Must | **2026-10-06 进度**：请求侧已按官方文档返工并由 `api/services/imageModeration.test.ts`（13 条，mock fetch）锁住形状——base64 通道不存在（两版接口都只要图片 URL）、四个 `x-acs-*` 必发头、Content-MD5 不得大写、违规则删刚落盘文件并拒收。**剩下的全是线上动作**：开通内容安全 + RAM 子账号 AK/Secret、配 `PUBLIC_MEDIA_BASE_URL`（必须是阿里云侧真能访问到的公网前缀）、置 `IMAGE_MODERATION_ENABLED=true`，再拿一张正常图 + 一张违规图各发一次，确认第二张真回到 `reject` 且文件被删。顺带确认 `bizType` 在请求体里的确切位置（文档示例未覆盖，当前留空不发送）。最后敲定「机审不可达时 fail-closed 还是 fail-open」这一产品决策——当前默认沿用「放行 + 转人工队列」 |
| B-16 | 作为开发，我希望 uploads 目录在任何部署形态下都不丢 | Must | 当前 systemd + tar 解包是安全的（热更只 `rm -rf dist`）；**若切容器化必须给 `/app/uploads` 挂 volume**，否则每次重建镜像历史图片全 404（v8.10.1 有图片 404 前科）；补落盘孤儿文件清理任务 |
| B-01 | 作为塘主，我希望核销码更难被暴力破解，以保护我的收入 | Must | 核销码升级为 10 位字母数字混合；6 位旧码兼容期内仍可核销；爆破限流 5 次/min 生效 |
| B-02 | 作为钓友，我希望同一钓位可按日期预订，避免一次购买永久占座 | Must | seats 增加 visit_date 维度；同座位不同日期可分别售出；下单时校验当日库存 |
| B-03 | 作为运营者，我希望只有已核销的订单才能评价，保证评价真实性 | Must | reviewOrder 校验订单 status='used'；未核销提交返回明确错误 |
| B-04 | 作为系统，我希望生产环境默认关闭演示用户兜底，防止越权 | Must | 独立部署时 `ALLOW_DEMO_USER=false` 默认生效；未登录访问受保护接口返回 401 |

## P1 — Should Have

| ID | 用户故事 | 优先级 | 验收标准 |
|---|---|---|---|
| B-17 | 作为钓友，我希望帖子上的评论数与评论区里的数量一致，不要出现两个不同的数 | Should | v14 遗留：服务端对每条含回复的评论都 +1，而评论区分页的 `total` 只数顶层（`COUNT(*) WHERE parent_id IS NULL`）；且前端发回复时刻意不 bump 本地计数、服务端却 +1，刷新后数字会跳。需二选一：`comment_count` 只统计顶层，或区头改用总数口径 |
| B-20 | ~~作为钓友，我希望选图时遇到损坏文件不会让页面卡在"正在选择"~~ **已在 v14 内修掉** | Should | 根因确认：`compressImage` 里的 `createImageBitmap` 遇到损坏/非图片文件会 reject（浏览器实测 `InvalidStateError: The source image could not be decoded`），而旧 `pickImagesWeb` 无 try/catch，异常从 async `onchange` 冒出后 `resolve()` 永不执行 → 外层 Promise 永久 pending → 按钮卡死无法重试。现改为逐张 try/catch：坏图跳过、好图保留、Promise 必结算。已实证：喂「1 损坏 + 1 合法 PNG」得到 `settled=RESOLVED`、按钮恢复可用、缩略图 1 张、计数 `1/4` |
| B-21 | ~~作为钓友，我希望"加载更多评论"失败后还能重试，而不是一颗死按钮~~ **已在 v14 内修掉** | Should | 顶层评论此前只写 `setCursor(nextCursor)`；失败后再写同一个值不改变 query key，react-query 不重发。现改为「游标已等于在请求里的那个」时走 `refetch()`，并把文案切成「重试加载评论」，与楼内 `CommentReplies` 样板对齐（那处由同事本轮补），两条链路口径现已一致 |
| B-24 | ~~接口挂掉时信息流永久空白~~ **误报，已撤回：兜底实测正常，无待修项** | Should | 我曾据此立案并连改三版 `mockFallback` 派生式，**全部是错的**。错因：首次在请求尚未结算时取样（react-query 重试期 `status` 仍为 `pending`），看到 0 张卡就断言"条件永不成立"。真相用"临时把 `feedQueries` 状态渲染进 DOM 读一次"终结：`{st:"error",err:true,eu>0}` → `mockFallback:true` → 7 张演示卡，且 toast 与"当前为演示数据"诚实提示、健康路径无误报均实测通过。试验改动已 `git checkout` 回退（`git diff src/pages/Home.tsx` 为空）。保留此条只为记录方法论教训：**断言某状态永不成立前，先确认取样覆盖了它的完整生命周期；状态可疑时直接读那个状态，而不是换判据碰运气。** |
| B-25 | 作为维护者，我希望按需 chunk 的体积余量被显式管理，别让 12KB 线变成"迟早会撞"的隐性债 | Should | 交付前审查实测：`PostContent` 分块 **11.96 KB br**，而预算线是 12 KB——**只剩 0.04 KB 余量**。它现在能过是因为门禁只校验被点名的按需 chunk（SpotFieldForm 1.3KB、SpotExpertReport 1.4KB 等），而不是"每个动态 chunk 都不得超线"；也就是说往里再加一点东西就会成真违规，而且**当前 CI 里加进去的 `vitest run` 并不会拦住它**（体积断言在 `verify:static`，需要起服务）。两个方向选一个：把 PostContent 里的重块（评论区的行卡 JSX 与楼中楼重复实现）抽成独立动态 chunk，或者把 12KB 这条线按实际架构重新定义并让 `smoke-static.mjs` 逐个动态 chunk 断言。现状首屏口径 healthy：eager JS 148.7 KB br + CSS 6.44 KB br，总量仍在 189KB 预算内 |
| B-26 | 作为钓友，我希望在渔获大图浏览界面里能把这张图分享出去 | Could | 原先这里摆着一个没有 onClick 的裸 `<Send>` 图标，外形与左边的点赞钮同规格，用户会当成分享入口去点、点了毫无反应——交付前审查发现后已先把这个死 affordance 摘掉（不是留个假装能按的图标）。真要做需要：给 `CatchViewer` 补 `onShare` 回调、由 `PostContent`/`Profile` 传入与卡片同一条 `navigator.share`/复制链接链路，并决定分享的是"整帖"还是"这一张图"（九图帖里用户指的是哪一张，得跟随当前页 index） |
| B-27 | 作为维护者，我希望评论行的渲染只有一份实现，改一处不会漏另一处 | Should | 交付前审查实测：`CommentSection.tsx` 的顶层楼（约 440-505 行）与楼内回复（约 720-773 行）是两份逐行重复的行卡 JSX（头像 / 正文 / 配图 / 回复入口 / 赞 / 举报 / 删除），是本轮 +800 行里最大的结构泥团。已经造成过一次真实分歧风险：软删占位、举报入口、配图渲染这三处逻辑必须在两处同步改。修法：抽 `CommentRow` 组件，差异用 props（`depth`/`isReply`）表达；不要靠复制粘贴加 if |
| B-28 | 作为维护者，我希望 Tab 下划线与骨架屏有单一定义，别在不同页面各摆一份魔法数 | Could | `Favorites.tsx` 里有两份骨架、`FavRow` 与 `FavPostRow` 同款动效与 className，Tab 条连同 `calc(1.5rem + 1.5rem)` 这个魔法数是**从 `Home.tsx` 复制过来的**。两处下划线宽度算法一旦不同步，iOS WebView 上的对齐问题（已列真机目检项）会更难定位。修法：抽 `TabsBar` + `Skeleton` 到共用位置，宽度表达式收成一个常量或 CSS 变量 |
| B-29 | ~~smoke.ts 第 2 节必崩导致其后各节永不执行~~ **已修** | Must | 诊断比原先登记的更硬：`createOrder` 是**无条件**要求 `seatNos.length === quantity`，而 §2 传的是 `seatNos: []` 配 qty=2 → 在任何库上都必抛，`main()` 当场退出，**§3–§7 一次都没跑过**；而 `smoke.ts` 没有挂在任何 npm 脚本上，所以这份腐烂持续存在没人发现。修法：§2 改为从 `seats` 取真实钓位、visitDate 用远期避开实时计算的占用，并把"清掉本次订单"挪到**核销那节之后**（§3 要读这单的 verify_code，提前删会让核销失败——我自己第一版就删早了）；新增 `npm run verify:smoke` 让它有入口。隔离库实跑：7 节全过、SMOKE PASSED。教训：**没被任何入口引用的测试等于没有测试**，它会安静地腐烂 |
| B-30 | 作为维护者，我希望弹层里传给子组件的对象保持稳定引用，别一边用 useMemo 一边每轮新建 | Could | `PostContent.tsx` 的 `view` 每次渲染都新建对象，导致下游 `useMemo([view])`（约 203 行）实际每轮都重算。目前数据量小、看不出问题，但这是一处"写了 memo 却不生效"的假安心；要么把 `view` 也 memo 化（依赖它真正的来源 query 数据），要么删掉下游那条无效的 memo |
| B-31 | ~~计划里的 ✅ 只能靠自评~~ **已交付并接进 build** | Must | 证据索引迁入仓库（`app/docs/verification/v14-证据索引.md`，与它所指向的代码同仓同版本），`scripts/check-plan-coverage.mjs` 逐行核验「文件存在 + 符号确实出现在该文件」，只写文件不写符号、通配符路径、已删除文件都判不合格。`npm run build` 现在含 `check-plan-coverage.mjs --strict`：锚点缺位或失实就出不了可部署物。根 docs 不在 git 里，所以计划文档缺失时脚本降级为「以索引声明的条目全集为准 + 警告」，两条路径都实测 exit 0（31/31）。索引之所以要在仓库里，是因为验证代码的清单必须和代码一起版本化——放外面等于又做一个没人更新的附表 |
| B-32 | 作为维护者，我希望回滚只有一条路径，而不是两条对备份包布局的假设互相冲突 | Should | 本轮实测：`tar --strip-components=1` 对条目以 `dist/` 开头的包会把文件落到 `./boot.js`（**没有 dist/**），而对以 `./` 开头的包两种写法都得不到 `dist/boot.js`——谁能落对完全取决于备份包的顶层布局。服务器上的 `/root/v14-deploy.sh` 仍带着它自己的 `--rollback` 分支（依赖 strip 层数），而我新加的 `app/scripts/v14-rollback.sh` 走"解到暂存区再按 boot.js 实际位置反推货根"，与布局无关。两条路并存就是未来的坑：**下次上机先 `tar tzf /root/dist-before-v8.12.0-*.tar.gz \| head -2` 记下真实布局**（这条我在本机做不到，只能交给上机的人），然后把部署脚本里的 `--rollback` 分支删掉或改成直接调用 `v14-rollback.sh`，只留一条被演练过的路径（`npm run verify:rollback`，三个变异都验证过它能变红） |
| B-23 | 作为开发者，我希望种子数据的计数与真实评论/点赞行一致，否则任何计数校验都会得出错误结论 | Could | 浏览器实测发现：同一张帖卡片显示 `共 33 条（含回复）`、弹层区头显示 `共 0 条讨论`。根因不是 B-17 的口径差，而是 `db/seed.ts` 给种子帖**凭空写了 commentCount/likeCount 却没有建对应的 comments/likes 行**。后果：凡拿这两个数做一致性对比的验证，在种子数据上必然失败，容易被误判成实现有 bug。修法：seed 时按声明的数量真造出对应行，或把声明值改成与实际行数一致 |
| B-22 | 作为钓友，我希望能只发图片不写文字做评论 | Could | 现状被服务端 `content: z.string().min(1)` 挡住，纯图评论发不出去。前端刻意未绕（不拿空串占位充数）。属产品口径问题：要么放开 `min(1)` 并让 `content` 可空，要么明确"评论必须带文字"并在 UI 上说清楚 |
| B-18 | 作为钓友，我希望自己的主页渔获墙不再传全量 base64，且软删帖不混进我的统计 | Should | v14 核查发现两处：① `profileService.getProfileOverview`（约 137-142 行）`select` 了 `posts.images` **整列**并在 167-169 行把**整个数组**写进出参，而前端 `Profile.tsx:112-118` 只用了首图和 `images.length>1` 这个角标——即 2-4MB base64 白传给客户端。修法同 feed：`cover: postCoverSql` + `JSON_LENGTH(images) AS imageCount`。**但有个真实取舍**：套 512 阈值后历史 base64 帖在**用户自己主页**里会整张消失，而"看自己当年发的图"正是渔获墙的职责——所以必须等 B-14 回填完成后才能干净瘦身。② 同函数的 wall/postCount/totalLikes/speciesStats **四个查询都没有 `isNull(posts.deletedAt)`**，软删帖仍计入个人主页统计与渔获墙。这是独立于瘦身的口径缺陷，需确认是"作者自己该看到"还是 bug |
| B-19 | 作为审核员，我希望举报队列能看到被举报的那张图，而不是永远只有第 0 张 | Should | v14 核查发现：`moderation.listReports` 全列读 `posts.images`（刻意如此，为了让审核员看到 base64 原图而非 null），**但出参只透出 `cover: r.images[0]`，前端 `Moderation.tsx` 也只渲染这一个**。结果九宫格里第 3 张若是违规图，审核员看不到。真解法是透出"被举报的那张/完整九宫格"并在审核台渲染（可能要能跳详情），而不是继续多读 8 张没人看的 base64。与「评论图片举报」同属审核可见性问题 |
| B-05 | 作为开发，我希望埋点消费者支持批量聚合，降低 DB 压力 | Should | 同 postId 事件合并 incr；消费速率 >2000 条/s |
| B-06 | 作为开发，我希望点赞计数与写操作同事务，避免崩溃漂移 | Should | likes 表写与 posts.like_count 更新在同一事务；崩溃恢复后计数可对账。**v14 评论点赞刻意沿用同一非事务口径（见 ADR-0004）；B-06 修好之前不要把 `likes` 与 `comment_likes` 合并** |
| B-07 | 作为运营，我希望限流器在多实例下仍准确，支撑水平扩展 | Should | 限流状态切 Redis 后多实例共享；读-改-写竞态消除（Lua 脚本或 INCR 原子） |
| B-08 | 作为钓友，我希望能搜索钓场和帖子，快速找到目标 | Should | 搜索接口接入 SearchIndex；切 ES 后召回率 >95%；响应 P99 < 300ms |
| B-09 | 作为塘主，我希望看到经营趋势图（近 7 日/30 日），辅助决策 | Should | owner_stats_daily 驱动图表；数据与订单实时一致（增量+每日重算对账） |

## P2 — Could Have

| ID | 用户故事 | 优先级 | 验收标准 |
|---|---|---|---|
| B-10 | 作为钓友，我希望信息流用游标分页，下拉加载更流畅 | Could | feed 支持 cursor 参数；重复内容率 <1% |
| B-11 | 作为开发，我希望有 /api/metrics 端点，接入 Prometheus | Could | 暴露 QPS/延迟/缓存命中率；Grafana 可看板 |
| B-12 | 作为开发，我希望有熔断器，DB 故障时快速失败 | Could | DB 连续 5 次超时触发熔断；30s 半开探测恢复 |
| B-13 | 作为钓友，我希望能微信支付购票 | Could | 接入微信支付（平台当前不支持，需独立部署后实施） |

## Won't Have（本阶段明确不做）

- 直播功能（带宽成本与内容审核复杂度高，验证期不投入）
- 多语言国际化（目标用户为国内钓友）
- 短视频信息流（与图文社区定位冲突，待 DAU 验证后再评估）

## 待办梳理规则

1. PO 每周梳理一次 Backlog，保证顶部 2 个 Sprint 的故事处于 Ready 状态
2. 故事粒度：单个故事工作量不超过 Sprint 容量的 1/3（约 10 点）
3. 所有 P0 故事必须附带验收标准（可测试、可演示）
