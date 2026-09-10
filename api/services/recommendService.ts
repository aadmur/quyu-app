/**
 * @layer Application Layer —— RecommendService（信息流推荐：召回→粗排→精排→MMR 重排）
 * @file api/services/recommendService.ts
 *
 * 趣渔推荐引擎 —— 参考抖音信息流的三段式架构（原 api/recommend.ts 平移并升级）：
 * - N+1 消除：pond_slug / impression_count 走 posts 冗余列，不再用相关子查询（P0）
 * - 埋点队列化：曝光/行为事件走 EventQueue 批量异步落库，接口入队即返回（P0）
 * - 多级缓存：recall:hot 候选池（60s）、feed 结果页（30s）、profile（60s，见 profileService）
 * - tracking.user_event 消费者：批量 INSERT user_events + 累加 impression_count + 异步更新画像
 */
import { and, desc, gt, inArray, isNull, sql } from "drizzle-orm";
import { posts } from "@db/schema";
import { getAnalytics, getCache, getDataSource, getQueue, timedRead, type DomainEvent } from "../infra";
import { getProfile, updateProfileBatch, type Profile, type ProfileDelta } from "./profileService";
import { followeeIds } from "./social";

// ---- 权重（抖音式多目标融合，可调参） ----
const W = {
  likeRate: 3.0, // 点赞率
  commentRate: 2.0, // 评论率（互动深度）
  freshness: 4.0, // 时效性
  profile: 5.0, // 用户画像匹配（个性化权重最高，越刷越懂你）
  explore: 1.2, // 探索扰动（保证新内容曝光，避免信息茧房）
};

const RECALL_LIMIT = 200;
const RECALL_TTL = 60;
const FEED_TTL = 30;
const FOLLOWEES_TTL = 60;
/** QY-COMM-008：关注作者在打分阶段提权倍数 */
const FOLLOW_BOOST = 1.5;

/** 我关注的作者 id 集（60s 缓存；关注/取关最长 60s 反映到推荐加权，可接受） */
async function getFolloweeIds(userId: number): Promise<number[]> {
  return getCache().getOrSet(`followees:${userId}`, FOLLOWEES_TTL, () => followeeIds(userId));
}

/** 时效分：24h 半衰期指数衰减 */
function freshnessScore(createdAt: Date): number {
  const ageHours = (Date.now() - createdAt.getTime()) / 3_600_000;
  return Math.pow(0.5, ageHours / 24);
}

/** 互动率（点赞+评论相对曝光的强度）；封顶 1——率值超过 1 无业务意义，
 *  否则种子/刷量数据会以数千分淹没一切新帖 */
function engagementScores(post: { likeCount: number; commentCount: number; impressions: number }) {
  const imp = Math.max(post.impressions, 1);
  return {
    likeRate: Math.min(post.likeCount / imp, 1),
    commentRate: Math.min(post.commentCount / imp, 1),
  };
}

/** 画像匹配分：帖子的鱼种/钓场与用户偏好的加权和 */
function profileScore(post: { fishSpecies: string | null; pondSlug: string | null }, profile: Profile | null): number {
  if (!profile) return 0;
  let s = 0;
  if (post.fishSpecies && profile.fishPrefs[post.fishSpecies]) s += profile.fishPrefs[post.fishSpecies] * 0.6;
  if (post.pondSlug && profile.pondPrefs[post.pondSlug]) s += profile.pondPrefs[post.pondSlug] * 0.4;
  return s;
}

type PostRow = typeof posts.$inferSelect;

/** 召回：近 30 天活跃帖子（候选池全局共享缓存 60s；冗余列直读，零子查询） */
async function recallCandidates(): Promise<PostRow[]> {
  return getCache().getOrSet("recall:hot", RECALL_TTL, async () => {
    const since = new Date(Date.now() - 30 * 24 * 3_600_000);
    return timedRead("recall.hot", (db) =>
      db
        .select()
        .from(posts)
        // 原生写法：.limit() 内联数字、gt() 走列类型序列化，
        // 避免 sql`` 模板里 LIMIT ? 占位符在 MySQL 预处理下报错（线上 feed 挂掉的根因）
        .where(and(gt(posts.createdAt, since), isNull(posts.deletedAt))) // 过滤软删帖（v8.7.0）
        .orderBy(desc(posts.createdAt))
        .limit(RECALL_LIMIT),
    );
  });
}

interface Scored {
  post: PostRow;
  score: number;
}

/** feed 出参条目：帖子全字段 + 冗余 pondSlug + 打分（与原契约一致） */
export type FeedItem = PostRow & { pondSlug: string | null; score: number };
interface FeedPayload {
  items: FeedItem[];
  hasMore: boolean;
}

/** 信息流推荐主入口：召回 → 粗排 → 精排 → 多样性重排（对外契约与原 recommendFeed 一致） */
export async function recommendFeed(userId: number, page: number, pageSize = 5) {
  const cache = getCache();
  const seed = page * 31 + userId; // 每页确定性扰动，翻页不重样（与原实现一致）

  // feed 结果页缓存（bucket = page 粒度，TTL 30s，允许秒级旧数据）
  const feedKey = `feed:${userId}:${page}:${pageSize}`;
  const cached = await cache.get<FeedPayload>(feedKey);
  const profile = await getProfile(userId);
  if (cached) {
    await enqueueImpressions(userId, cached.items);
    return { ...cached, profile };
  }

  const rows = await recallCandidates();
  const followeeSet = new Set(await getFolloweeIds(userId)); // 关注作者提权（QY-COMM-008）

  // 粗排 + 精排打分
  const scored: Scored[] = rows.map((post, i) => {
    const eng = engagementScores({
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      impressions: post.impressionCount, // 冗余列直读（原实现为相关子查询，N+1 已消除）
    });
    const fresh = freshnessScore(post.createdAt);
    const prof = profileScore({ fishSpecies: post.fishSpecies, pondSlug: post.pondSlug }, profile);
    const explore = ((Math.sin(seed + i * 997) + 1) / 2) * 0.5; // 确定性伪随机
    let score =
      W.likeRate * eng.likeRate * 10 +
      W.commentRate * eng.commentRate * 10 +
      W.freshness * fresh +
      W.profile * prof +
      W.explore * explore;
    if (post.authorId != null && followeeSet.has(post.authorId)) score *= FOLLOW_BOOST; // 关注作者提权
    return { post, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // 多样性重排（MMR）：同作者连续出现时降权 40%
  const result: Scored[] = [];
  for (const item of scored) {
    const sameAuthor = result.slice(-2).filter((p) => p.post.authorName === item.post.authorName).length;
    const adjusted = { ...item, score: item.score * Math.pow(0.6, sameAuthor) };
    const idx = result.findIndex((p) => p.score < adjusted.score);
    if (idx === -1) result.push(adjusted);
    else result.splice(idx, 0, adjusted);
  }

  // 作者视角即时反馈：自己 48h 内发布的新帖置顶（按时间倒序），
  // 解决"刚发的帖子沉底看不到"的体验问题（对齐 ins 的作者优先曝光）
  const nowMs = Date.now();
  const ownFresh = result.filter(
    (r) => r.post.authorId === userId && nowMs - new Date(r.post.createdAt).getTime() < 48 * 3_600_000,
  );
  if (ownFresh.length > 0) {
    const ownIds = new Set(ownFresh.map((r) => r.post.id));
    const rest = result.filter((r) => !ownIds.has(r.post.id));
    ownFresh.sort((a, b) => +new Date(b.post.createdAt) - +new Date(a.post.createdAt));
    result.length = 0;
    result.push(...ownFresh, ...rest);
  }

  const start = (page - 1) * pageSize;
  const pageItems = result.slice(start, start + pageSize);

  const payload: FeedPayload = {
    items: pageItems.map((r) => ({
      ...r.post,
      pondSlug: r.post.pondSlug, // 冗余列（原实现为子查询）
      score: +r.score.toFixed(3),
    })),
    hasMore: start + pageSize < result.length,
  };
  await cache.set(feedKey, payload, FEED_TTL);

  // 曝光事件：异步入队（原实现逐行同步 insert，P0 已改批量队列）
  await enqueueImpressions(userId, payload.items);

  return { ...payload, profile };
}

/**
 * 关注动态流（QY-COMM-008）：只取我关注作者的非删除帖，created_at 倒序分页。
 * 返回结构与 recommendFeed 的 { items, hasMore } 兼容（items 为 posts 全字段行 + pondSlug/score，
 * 前端复用同一个 mapFeedPost）；未关注任何人 → 直接返回空，不打库。
 * limit pageSize+1 判定 hasMore。
 */
export async function followingFeed(userId: number, page: number, pageSize = 5): Promise<FeedPayload> {
  const ids = await getFolloweeIds(userId);
  if (ids.length === 0) return { items: [], hasMore: false };
  const rows = await timedRead("posts.following_feed", (db) =>
    db
      .select()
      .from(posts)
      .where(and(inArray(posts.authorId, ids), isNull(posts.deletedAt)))
      .orderBy(desc(posts.createdAt))
      .offset((page - 1) * pageSize)
      .limit(pageSize + 1),
  );
  const hasMore = rows.length > pageSize;
  const items: FeedItem[] = rows.slice(0, pageSize).map((post) => ({
    ...post,
    pondSlug: post.pondSlug,
    score: 0, // 时间流无打分，占位保持 FeedItem 契约
  }));
  // 曝光事件：与推荐流同口径异步入队（画像 impression 会略偏，可接受）
  await enqueueImpressions(userId, items);
  return { items, hasMore };
}

async function enqueueImpressions(userId: number, items: Array<{ id: number }>) {
  await getQueue().publishBatch(
    "tracking.user_event",
    items.map((it) => ({ userId, postId: it.id, action: "impression", durationMs: 0 })),
  );
}

/** 记录行为事件：入队即返回；落库与画像更新由消费者异步执行（P0：原同步 3 次 RT 已消除） */
export async function trackEvent(userId: number, postId: number, action: string, durationMs = 0): Promise<void> {
  await getQueue().publish("tracking.user_event", { userId, postId, action, durationMs });
}

// ============ tracking.user_event 消费者（模块加载即注册，进程内 dispatcher 批量派发） ============
let consumerRegistered = false;

type TrackingPayload = { userId: number; postId: number; action: string; durationMs?: number };

/**
 * 批量消费 tracking.user_event（消费端批处理，替代原逐条 5 次串行 RT 的实现）：
 * 1. user_events 明细：整批一条多值 INSERT（≤100 条/批，dispatcher 分片）
 * 2. impression_count：按 postId 聚合成**单条 CASE UPDATE**（同帖 N 次曝光合并为 +N，
 *    避免对热点行的多次并行 UPDATE 锁竞争）
 * 3. 画像：涉及帖子一条 IN 查询取回特征；同 userId 事件合并后一次读/归一化/写回
 * 三步在连接池上并行（1 次 RT 墙钟时间），整批（100 条）≈ 3 次 RT（原 500 次）。
 */
async function consumeTrackingBatch(events: DomainEvent[]): Promise<void> {
  if (events.length === 0) return;
  const payloads = events.map((e) => e.payload as TrackingPayload);
  const db = getDataSource().write();

  // 曝光计数按 postId 聚合
  const impressions = new Map<number, number>();
  for (const p of payloads) {
    if (p.action === "impression") impressions.set(p.postId, (impressions.get(p.postId) ?? 0) + 1);
  }
  const postIds = [...new Set(payloads.map((p) => p.postId))];

  // 1+2+帖子特征查询：三路并行（明细落库 / 计数聚合 UPDATE / 帖子特征 IN 查询）
  const [postRows] = await Promise.all([
    db
      .select({ id: posts.id, fishSpecies: posts.fishSpecies, pondSlug: posts.pondSlug })
      .from(posts)
      .where(inArray(posts.id, postIds)),
    getAnalytics().ingest(
      "user_events",
      payloads.map((p) => ({ userId: p.userId, postId: p.postId, action: p.action, durationMs: p.durationMs ?? 0 })),
    ),
    impressions.size > 0
      ? db.execute(sql`
          UPDATE posts SET impression_count = impression_count + CASE id
            ${sql.join([...impressions].map(([id, n]) => sql`WHEN ${id} THEN ${n}`), sql.raw(" "))}
            ELSE 0 END
          WHERE id IN (${sql.join([...impressions.keys()].map((id) => sql`${id}`), sql.raw(","))})
        `)
      : Promise.resolve(),
  ]);

  // 3. 画像批量更新：同 userId 合并增量后批量写回（一次读 / 一次 L1 归一化 / 一次 upsert）
  const postMap = new Map(postRows.map((r) => [r.id, r]));
  const byUser = new Map<number, ProfileDelta[]>();
  for (const p of payloads) {
    const post = postMap.get(p.postId);
    if (!post) continue; // 帖子已删：事件已落库，画像跳过
    const list = byUser.get(p.userId) ?? [];
    list.push({ fishSpecies: post.fishSpecies, pondSlug: post.pondSlug, action: p.action });
    byUser.set(p.userId, list);
  }
  await updateProfileBatch([...byUser].map(([userId, deltas]) => ({ userId, deltas })));
}

export function registerTrackingConsumer(): void {
  if (consumerRegistered) return;
  consumerRegistered = true;
  // chunkSize=500：大分片减少对 posts.impression_count 热点行的并发 CASE UPDATE 冲突
  // （7 个帖子的计数行是热点，分片越小 TiDB 乐观锁重试越多）
  getQueue().subscribeBatch("tracking.user_event", consumeTrackingBatch, { chunkSize: 500 });
}

registerTrackingConsumer();
