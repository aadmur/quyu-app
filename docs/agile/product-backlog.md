# 产品待办列表（Product Backlog）

按优先级排序（MoSCoW 法则）。每条包含用户故事、优先级、验收标准。

## P0 — Must Have（下一冲刺候选）

| ID | 用户故事 | 优先级 | 验收标准 |
|---|---|---|---|
| B-14 | 作为开发，我希望把历史帖的 base64 图片一次性回填为磁盘 URL，彻底解除单行 MB 级与内存压力 | Must | 先跑迁移面预检 `SELECT COUNT(*) FROM posts WHERE JSON_SEARCH(images,'one','data:image%') IS NOT NULL` 确认行数；脚本幂等可重跑；回填前 mysqldump + 原值导出 JSON 备份；回滚可用备份写回（ADR-0002）。**注意 `postCoverSql` 对 >512 字符首图判 null，未回填的遗留图帖在 feed 里没有封面——回填完才恢复** |
| B-15 | 作为运营，我希望 UGC 图片机审真正生效，而不是停在「放行转人工」降级 | Must | 开通阿里云内容安全并配 AK/Secret；**校正 `imageModeration.ts` 的 ROA 签名与请求体字段**（当前 `TODO(签名校正)`，未联调，`IMAGE_MODERATION_ENABLED` 默认 false）；用已知违规样本站实测命中并拒收；敲定「机审不可达时 fail-closed 还是 fail-open」这一产品决策 |
| B-16 | 作为开发，我希望 uploads 目录在任何部署形态下都不丢 | Must | 当前 systemd + tar 解包是安全的（热更只 `rm -rf dist`）；**若切容器化必须给 `/app/uploads` 挂 volume**，否则每次重建镜像历史图片全 404（v8.10.1 有图片 404 前科）；补落盘孤儿文件清理任务 |
| B-01 | 作为塘主，我希望核销码更难被暴力破解，以保护我的收入 | Must | 核销码升级为 10 位字母数字混合；6 位旧码兼容期内仍可核销；爆破限流 5 次/min 生效 |
| B-02 | 作为钓友，我希望同一钓位可按日期预订，避免一次购买永久占座 | Must | seats 增加 visit_date 维度；同座位不同日期可分别售出；下单时校验当日库存 |
| B-03 | 作为运营者，我希望只有已核销的订单才能评价，保证评价真实性 | Must | reviewOrder 校验订单 status='used'；未核销提交返回明确错误 |
| B-04 | 作为系统，我希望生产环境默认关闭演示用户兜底，防止越权 | Must | 独立部署时 `ALLOW_DEMO_USER=false` 默认生效；未登录访问受保护接口返回 401 |

## P1 — Should Have

| ID | 用户故事 | 优先级 | 验收标准 |
|---|---|---|---|
| B-17 | 作为钓友，我希望帖子上的评论数与评论区里的数量一致，不要出现两个不同的数 | Should | v14 遗留：服务端对每条含回复的评论都 +1，而评论区分页的 `total` 只数顶层（`COUNT(*) WHERE parent_id IS NULL`）；且前端发回复时刻意不 bump 本地计数、服务端却 +1，刷新后数字会跳。需二选一：`comment_count` 只统计顶层，或区头改用总数口径 |
| B-20 | 作为钓友，我希望选图时遇到损坏文件不会让页面卡在"正在选择" | Should | **先前就存在、v14 扩大了暴露面**。`src/lib/native.ts:68-80` 的 Web 回退里，`compressImage` 对损坏/非图片文件抛错时 `resolve` 永不触发 → Promise 永久 pending。原先只影响发布页 `Publish.tsx`，v14 评论图片也走同一条链路，等于两处都会卡。修法：`pickImagesWeb` 的循环里逐张 try/catch，失败项跳过并提示，且无论如何都要 resolve |
| B-21 | 作为钓友，我希望"加载更多评论"失败后还能重试，而不是一颗死按钮 | Should | 顶层评论用的是 `cursor`/`nextCursor` 双状态样板写法，副作用是：请求失败后再点 `setCursor(同一个值)` 不改变 query key → **react-query 根本不会重发**，按钮看着能点但毫无反应。v14 只在 `CommentReplies`（楼内展开）上补了 `refetch()` 兜底并加了"展开失败，点这里重试"文案，**顶层那条链路刻意没扩大改动面**，做法可直接照搬 `CommentSection` 的失败分支 |
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
