/**
 * @layer Application Layer —— CommunityService（帖子互动：点赞/评论/收藏/鱼讯 + 发布链路）
 * @file api/services/community.ts
 *
 * 数据主权：likes / comments / comment_likes / post_favorites 表唯一写方。
 * P0 修复：点赞由「SELECT-then-INSERT 竞态」改为 INSERT + affectedRows 分支
 *（uq_like 唯一索引去重，计数 UPDATE 原子累加，见 design/arch-v5.md §4.4）。
 *
 * v14「帖子交互优化」新增（评论双排序游标分页 / 楼中楼 / 评论点赞 / 评论软删 / 帖子收藏）：
 * - 图片一律走 imageStore 落盘，库里只存 URL（ADR-0003，拆掉「base64 挤进 JSON 列」这颗雷）。
 * - 评论删除是**软删 + 占位**：行保留、楼中楼不塌，content/images 不返回（见 deleteComment）。
 * - 评论点赞新建 comment_likes 表，不复用 likes（ADR-0004，理由见 db/schema.ts 注释）。
 * - 帖子卡片形状（PostCardRow + cover + liked/collected）在本文件定义，recommendService 复用同一份，
 *   避免 feed 与「我的收藏-帖子 Tab」两套字段漂移（v14 收尾把 searchPosts 也并进同一份列口径，
 *   否则首页搜索结果会同时缺封面、又把 images 全列拖进响应）。
 */
import { and, asc, desc, eq, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { toDataURL as qrToDataURL } from "qrcode";
import {
  commentLikes,
  comments,
  fishNews,
  likes,
  ponds,
  postFavorites,
  posts,
  users,
} from "@db/schema";
import { getCache, getDataSource, getQueue, isDupEntry, timedRead } from "../infra";
import { pushNotification } from "./notify";
import { assertContentAllowed, createSystemReport } from "./contentFilter";
import { flagPendingImageReview, ingestImages, type IngestedImages } from "./imageStore";

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

function insertIdOf(res: unknown): number {
  return ((res as unknown as [{ insertId?: number }])[0]?.insertId) ?? 0;
}

// ============ 帖子卡片形状（feed / 收藏列表 / 搜索共用一套瘦身口径） ============

/**
 * 出参列集合：**刻意不含 posts.images**。
 * 原因是链路级的，不是风格问题：召回池 200 条要进 60s 全用户共享缓存，
 * images 列历史上有过 9 图 base64（单行 2–4MB）的写法，全列 select 会把进程内存和首屏流量一起打爆。
 * 前端只需要首图，故在 SQL 层用 JSON_EXTRACT 直接取 `$[0]`（见 postCoverSql）。
 */
export const POST_CARD_COLUMNS = {
  id: posts.id,
  authorId: posts.authorId,
  authorName: posts.authorName,
  authorAvatar: posts.authorAvatar,
  content: posts.content,
  pondId: posts.pondId,
  pondSlug: posts.pondSlug,
  fishSpecies: posts.fishSpecies,
  weightJin: posts.weightJin,
  latitude: posts.latitude,
  longitude: posts.longitude,
  locationText: posts.locationText,
  likeCount: posts.likeCount,
  commentCount: posts.commentCount,
  impressionCount: posts.impressionCount,
  deletedAt: posts.deletedAt,
  createdAt: posts.createdAt,
};

/**
 * 帖子卡行类型：与 POST_CARD_COLUMNS 的列类型逐一对应（手写而非映射推导——
 * drizzle 的 `_` phantom 类型映射可读性差，显式 interface 出错时 tsc 的报错也更好定位）。
 * 改列时两处必须一起改。
 */
export interface PostCardRow {
  id: number;
  authorId: number | null;
  authorName: string;
  authorAvatar: string;
  content: string;
  pondId: number | null;
  pondSlug: string | null;
  fishSpecies: string | null;
  /** decimal(5,1) 原样字符串，避免 0.1 类浮点误差进前端 */
  weightJin: string | null;
  latitude: number | null;
  longitude: number | null;
  locationText: string | null;
  likeCount: number;
  commentCount: number;
  impressionCount: number;
  deletedAt: Date | null;
  createdAt: Date;
  /** images[0]（无图/历史 base64 超长行为 null）；feed 载荷不再含 images 数组 */
  cover: string | null;
}

/**
 * 首图表达式：取 images JSON 数组的第 0 个元素，超长的（历史遗留 base64 行）判为「无首图」。
 * 为什么宁可让老帖在 feed 里不显示图，也不把 base64 透出去：
 * feed 缓存是全用户共享的 200 行，一行 2MB 就是缓存 400MB；详情页仍能看到完整 images。
 * 治理路径是一次性回填脚本（把遗留 base64 解码进 uploads/posts 并改写该列），属后续项。
 *
 * 512 这个长度阈值**必须内联成字面量**：MySQL/TiDB 预处理下 `LIMIT ?` 之类的占位符曾让线上
 * feed 直接挂过（见 recommendService.recallCandidates 的历史坑注释），这里不做任何参数化冒险。
 */
export const postCoverSql = sql<string | null>`CASE
  WHEN JSON_LENGTH(${posts.images}) > 0
    AND CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(${posts.images}, '$[0]'))) <= 512
  THEN JSON_UNQUOTE(JSON_EXTRACT(${posts.images}, '$[0]'))
  ELSE NULL
END`;

/** 当前用户对一组帖子的互动命中（liked/collected），两条 IN 查询批量取，杜绝 N+1 */
export async function userPostInteraction(
  userId: number,
  postIds: readonly number[],
): Promise<{ liked: Set<number>; collected: Set<number> }> {
  if (postIds.length === 0) return { liked: new Set(), collected: new Set() }; // 空 IN() 是非法 SQL
  const ids = [...new Set(postIds)];
  const [likedRows, collectedRows] = await Promise.all([
    timedRead("interaction.liked_batch", (db) =>
      db
        .select({ postId: likes.postId })
        .from(likes)
        .where(and(eq(likes.userId, userId), inArray(likes.postId, ids))),
    ),
    timedRead("interaction.collected_batch", (db) =>
      db
        .select({ postId: postFavorites.postId })
        .from(postFavorites)
        .where(and(eq(postFavorites.userId, userId), inArray(postFavorites.postId, ids))),
    ),
  ]);
  return {
    liked: new Set(likedRows.map((r) => Number(r.postId))),
    collected: new Set(collectedRows.map((r) => Number(r.postId))),
  };
}

/**
 * 给任意带 id 的帖子行补上当前用户的 liked/collected。
 *
 * 缓存红线（很容易踩）：MemoryCache 命中时返回的是**同一个对象引用**，不是反序列化的副本；
 * 而 liked/collected 是每用户状态，绝不能就地写回缓存里的行——那会让用户 A 的点赞态
 * 串到用户 B 的 feed 上。所以这里一律 map 成新对象，且调用方保证「补齐发生在缓存命中之后」。
 */
export async function withUserInteraction<T extends { id: number }>(
  userId: number,
  rows: readonly T[],
): Promise<Array<T & { liked: boolean; collected: boolean }>> {
  const { liked, collected } = await userPostInteraction(userId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, liked: liked.has(r.id), collected: collected.has(r.id) }));
}


/**
 * 点赞/取消点赞（原子去重 + 计数，消除并发计数漂移）。
 * 插入撞 uq_like 唯一索引（ER_DUP_ENTRY）→ 已赞过 → DELETE 并 -1；成功则 +1。
 * 并发下两个相同 INSERT 只有一个成功，计数不漂移（design/arch-v5.md §4.4）。
 */
export async function toggleLike(userId: number, postId: number, actorName = "钓友"): Promise<{ liked: boolean }> {
  const db = getDataSource().write();
  try {
    await db.insert(likes).values({ userId, postId });
  } catch (err) {
    if (!isDupEntry(err)) throw err;
    // 取消点赞：DELETE 靠唯一索引定位，并发下只有一方能删除成功
    const del = await db.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId)));
    if (affectedRows(del) === 1) {
      await db
        .update(posts)
        .set({ likeCount: sql`GREATEST(${posts.likeCount} - 1, 0)` })
        .where(eq(posts.id, postId));
    }
    return { liked: false };
  }
  await db.update(posts).set({ likeCount: sql`${posts.likeCount} + 1` }).where(eq(posts.id, postId));
  await getQueue().publish("community.post.liked", { userId, postId });
  // 与原实现对齐：点赞同时记行为事件（异步画像更新）
  await getQueue().publish("tracking.user_event", { userId, postId, action: "like", durationMs: 0 });
  // 消息中心：通知帖子作者（失败不阻断点赞主流程）
  try {
    const [post] = await db
      .select({ authorId: posts.authorId, content: posts.content })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (post?.authorId) {
      await pushNotification(
        { userId: post.authorId, type: "like", actorName, actorId: userId, refId: postId, preview: post.content.slice(0, 50) },
        db,
      );
    }
  } catch {
    // 通知失败不阻断主流程
  }
  return { liked: true };
}

// ============ 评论体系（v14：游标分页 + 热门/最新双排序 + 楼中楼 + 评论点赞 + 软删占位） ============

/**
 * 分页口径：原实现一次 50 条封顶、无游标，长帖的评论列表首屏既要拉全量又要序列化全量。
 * 现在按 (created_at, id) 做 keyset 游标——评论表 id 单调递增，(created_at, id) 是稳定全序，
 * 不会出现 OFFSET 翻页时「新评论插进来导致重复/漏条」的经典错乱。
 */
const COMMENT_DEFAULT_LIMIT = 20;
const COMMENT_MAX_LIMIT = 50;
/** 楼中楼预览：每楼默认带前 2 条最新回复，其余走 posts.commentReplies 子分页 */
const REPLY_PREVIEW = 2;
/**
 * 回复扫描窗口系数（一次性取回本页所有楼的预览回复）。
 * 为什么不用 ROW_NUMBER() 开窗：本仓有一次「为了优雅把 LIMIT 写成占位符 → 线上 feed 直接挂」的
 * 前科（见 recommendService.recallCandidates），窗口函数 + 派生表在这里的收益（省下尾部几行）
 * 远不值「一段没法连库验证的裸 SQL」的风险。代价：极端长楼（整页回复总数超过窗口）时，
 * 排在窗口之外的楼预览为空，但 replyCount / repliesHasMore 仍由 GROUP BY 聚合给出、子分页也照常可用，
 * 属于「预览退化」而不是「数据错误」。
 */
const REPLY_SCAN_PER_THREAD = 20;

export type CommentSort = "latest" | "hot";

/** 游标在契约里是 ISO 字符串（前端可直接 JSON 化，且与 superjson 的 Date 序列化行为解耦） */
export interface CommentCursorInput {
  createdAt: string;
  id: number;
}

/** 评论树节点（前端 CommentNode 契约的字段名与此一一对应，不要改名） */
export interface CommentNode {
  id: number;
  postId: number;
  /**
   * 评论作者用户 id（契约之外的补充项）：前端要靠它决定「删除」入口只对本人出现
   *（昵称可以重复，不能拿昵称判本人）。不算新增泄露——升级前 listComments 直接返回 comments
   * 原始行，userId 本来就在出参里；这里换成语义明确的 authorId，并保留 nullable 以覆盖
   * 历史遗留的作者已注销/匿名行。
   */
  authorId: number | null;
  authorName: string;
  authorAvatar: string;
  /** 软删评论返回空串：行保留、结构不塌，前端渲染「该评论已删除」占位 */
  content: string;
  /** 软删评论返回空数组（库里仍保留，便于复核与回滚） */
  images: string[];
  parentId: number | null;
  likeCount: number;
  /** 当前用户是否赞过 */
  liked: boolean;
  deletedAt: string | null;
  createdAt: string;
  /** 该楼的全部回复数（含已软删的回复——口径与列表一致，删除只是占位不是消失） */
  replyCount: number;
  replies: CommentNode[];
  repliesHasMore: boolean;
}

export interface CommentPage {
  items: CommentNode[];
  nextCursor: CommentCursorInput | null;
  hasMore: boolean;
  /** 顶层评论总数（软删的仍计入，与列表可见口径一致） */
  total: number;
}

export interface ReplyPage {
  items: CommentNode[];
  nextCursor: CommentCursorInput | null;
  hasMore: boolean;
}

export interface CommentListOptions {
  sort: CommentSort;
  cursor?: CommentCursorInput | null;
  limit?: number;
}

type CommentRow = typeof comments.$inferSelect;

/**
 * ISO 游标 → Date。
 * 精度安全性：comments.created_at 是不带小数秒的 timestamp，读出的 Date 毫秒位恒为 0，
 * 所以 `date.toISOString()` → `new Date(iso)` 往返无损，keyset 的等值比较不会漂。
 * 若将来列改成 timestamp(6)，这里要连同 toISOString 的精度一起复核。
 * 非法游标（伪造/脏缓存）视为「无游标」从头开始，而不是抛错——列表页不该因游标炸掉。
 */
function parseCursor(cursor?: CommentCursorInput | null): { createdAt: Date; id: number } | null {
  if (!cursor || typeof cursor.createdAt !== "string" || !Number.isInteger(cursor.id)) return null;
  const d = new Date(cursor.createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return { createdAt: d, id: cursor.id };
}

/**
 * 倒序流的 keyset 谓词：取「严格排在该游标之后」的行，即 (created_at, id) < (c, i)。
 * drizzle 没有元组比较语法，用 OR 展开；`(a, b) < (c, i)` 的字典序语义逐条摊平。
 */
function keysetBefore(cursor: { createdAt: Date; id: number }) {
  return or(
    lt(comments.createdAt, cursor.createdAt),
    and(eq(comments.createdAt, cursor.createdAt), lt(comments.id, cursor.id)),
  )!;
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return COMMENT_DEFAULT_LIMIT;
  return Math.min(COMMENT_MAX_LIMIT, Math.max(1, Math.floor(limit as number)));
}

/** CommentRow → CommentNode（软删行就地脱敏：正文与图片不返回，库里保留） */
function toCommentNode(
  row: CommentRow,
  opts: { liked: boolean; replyCount?: number; replies?: CommentNode[]; repliesHasMore?: boolean },
): CommentNode {
  const deleted = row.deletedAt != null;
  return {
    id: Number(row.id),
    postId: Number(row.postId),
    authorId: row.userId != null ? Number(row.userId) : null,
    authorName: row.authorName,
    authorAvatar: row.authorAvatar ?? "/avatar-1.png",
    content: deleted ? "" : row.content,
    images: deleted ? [] : (Array.isArray(row.images) ? row.images : []),
    parentId: row.parentId != null ? Number(row.parentId) : null,
    likeCount: Number(row.likeCount ?? 0),
    liked: opts.liked,
    deletedAt: deleted ? new Date(row.deletedAt as Date).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    replyCount: opts.replyCount ?? 0,
    replies: opts.replies ?? [],
    repliesHasMore: opts.repliesHasMore ?? false,
  };
}

/** 当前用户在一组评论里的点赞命中（一条 IN 查询，绝不逐条查） */
async function likedCommentIds(userId: number, ids: readonly number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set(); // 空 IN() 是非法 SQL
  const rows = await timedRead("comments.liked_batch", (db) =>
    db
      .select({ commentId: commentLikes.commentId })
      .from(commentLikes)
      .where(and(eq(commentLikes.userId, userId), inArray(commentLikes.commentId, [...new Set(ids)]))),
  );
  return new Set(rows.map((r) => Number(r.commentId)));
}

/**
 * 评论列表（顶层楼 + 每楼前 2 条回复预览）。
 *
 * 双排序各走一套游标（ADR 决定支持 热门/最新 切换）：
 * - latest：(created_at DESC, id DESC)，命中 idx_comments_post_created(post_id, created_at)。
 * - hot：(like_count DESC, created_at DESC, id DESC)，命中 idx_comments_post_like(post_id, like_count, created_at)。
 * 游标契约只有 {createdAt, id}，hot 排序缺的 likeCount 阈值**从锚点行现读回来**：
 * 契约形状固定不动，代价是锚点行刚被点赞时会有轻微漂移（可能重复或跳过 1 条），
 * 这是「热门列表」可接受的最终一致，比把 likeCount 塞进私有游标字段更诚实。
 * 锚点查不到（伪造游标/跨帖游标）→ 当作首页，不抛错。
 *
 * 软删楼照常返回（content/images 置空），因为「删除」是占位而不是消失——
 * 硬删顶层楼会让楼下的回复孤儿化，整棵子树从列表里蒸发。
 */
export async function listComments(postId: number, opts: CommentListOptions, viewerId: number): Promise<CommentPage> {
  const db = getDataSource().read();
  const limit = clampLimit(opts.limit);
  const sort: CommentSort = opts.sort === "hot" ? "hot" : "latest";
  const cursor = parseCursor(opts.cursor);

  // hot 游标的 likeCount 锚点（latest 不需要，多一次主键单行查询只在翻页时发生）
  let hotThreshold: number | null = null;
  let effectiveCursor = cursor;
  if (sort === "hot" && cursor) {
    const [anchor] = await db
      .select({ likeCount: comments.likeCount })
      .from(comments)
      .where(and(eq(comments.id, cursor.id), eq(comments.postId, postId)))
      .limit(1);
    if (anchor) {
      hotThreshold = Number(anchor.likeCount);
    } else {
      // 锚点查不到（伪造游标 / 跨帖游标 / 行已消失）：整个游标作废、退回首页。
      // 不能只把阈值当 0 处理，也不能沿用 (created_at,id) 的 keyset——
      // 热门流的排序键是 like_count，拿时间游标去切它等于随机丢行。
      effectiveCursor = null;
    }
  }

  const keyset = effectiveCursor ? keysetBefore(effectiveCursor) : undefined;
  const where = and(
    eq(comments.postId, postId),
    isNull(comments.parentId),
    hotThreshold != null
      ? // 同分再按 (created_at, id) 定序，保证 ORDER BY 是全序、游标可续
        or(lt(comments.likeCount, hotThreshold), and(eq(comments.likeCount, hotThreshold), keyset))
      : keyset,
  );
  const order =
    sort === "hot"
      ? [desc(comments.likeCount), desc(comments.createdAt), desc(comments.id)]
      : [desc(comments.createdAt), desc(comments.id)];

  // 多取一条判 hasMore（项目内分页统一口径，见 searchPosts）
  const rows = await timedRead("comments.page", (rdb) =>
    rdb.select().from(comments).where(where).orderBy(...order).limit(limit + 1),
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const threadIds = page.map((r) => Number(r.id));

  const [countRows, countByThread, previewRows] = await Promise.all([
    timedRead("comments.total", (rdb) =>
      rdb
        .select({ cnt: sql<number>`COUNT(*)` })
        .from(comments)
        .where(and(eq(comments.postId, postId), isNull(comments.parentId))),
    ),
    threadIds.length === 0
      ? Promise.resolve([] as { parentId: number | null; cnt: number }[])
      : timedRead("comments.reply_counts", (rdb) =>
          rdb
            .select({ parentId: comments.parentId, cnt: sql<number>`COUNT(*)` })
            .from(comments)
            .where(inArray(comments.parentId, threadIds))
            .groupBy(comments.parentId),
        ),
    threadIds.length === 0
      ? Promise.resolve([] as CommentRow[])
      : timedRead("comments.reply_preview", (rdb) =>
          rdb
            .select()
            .from(comments)
            .where(inArray(comments.parentId, threadIds))
            // 按楼分组取楼内最新若干条；窗口上限见 REPLY_SCAN_PER_THREAD 的取舍说明
            .orderBy(asc(comments.parentId), desc(comments.createdAt), desc(comments.id))
            .limit(threadIds.length * REPLY_SCAN_PER_THREAD),
        ),
  ]);

  const total = Number(countRows[0]?.cnt ?? 0);
  const replyCount = new Map<number, number>();
  for (const r of countByThread) {
    if (r.parentId != null) replyCount.set(Number(r.parentId), Number(r.cnt));
  }
  // 分组保序：SQL 已按 (parent_id, created_at DESC, id DESC) 排好，JS 顺序入桶后每楼取前 REPLY_PREVIEW 条
  const repliesByThread = new Map<number, CommentRow[]>();
  for (const r of previewRows) {
    if (r.parentId == null) continue;
    const key = Number(r.parentId);
    const bucket = repliesByThread.get(key);
    if (bucket) bucket.push(r);
    else repliesByThread.set(key, [r]);
  }

  // 点赞命中一次性覆盖「顶层楼 + 预览回复」，避免两次串行查询
  const liked = await likedCommentIds(
    viewerId,
    [...threadIds, ...previewRows.map((r) => Number(r.id))],
  );

  const items = page.map((row) => {
    const kids = (repliesByThread.get(Number(row.id)) ?? []).slice(0, REPLY_PREVIEW);
    const count = replyCount.get(Number(row.id)) ?? 0;
    return toCommentNode(row, {
      liked: liked.has(Number(row.id)),
      replyCount: count,
      replies: kids.map((k) => toCommentNode(k, { liked: liked.has(Number(k.id)) })),
      // hasMore 以聚合计数为准（不受扫描窗口截断影响），前端据此决定要不要显示「查看全部 N 条回复」
      repliesHasMore: count > kids.length,
    });
  });

  const last = page[page.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: new Date(last.createdAt).toISOString(), id: Number(last.id) } : null,
    hasMore,
    total,
  };
}

/**
 * 子回复分页（「查看全部回复」）。
 * 只有「最新」一种口径：热门只作用于顶层楼，楼内回复按时间流更有意义（也省去再引一套锚点）。
 * 传入一个「回复」的 id 时，自动归并到其所属顶层楼——与 addComment 的两层模型保持一致，
 * 否则前端在回复上点「查看回复」会拿到空列表。
 */
export async function listCommentReplies(
  commentId: number,
  opts: { cursor?: CommentCursorInput | null; limit?: number },
  viewerId: number,
): Promise<ReplyPage> {
  const db = getDataSource().read();
  const [thread] = await db
    .select({ id: comments.id, parentId: comments.parentId })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!thread) throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在或已删除" });
  const rootId = thread.parentId != null ? Number(thread.parentId) : Number(thread.id);
  const limit = clampLimit(opts.limit);
  const cursor = parseCursor(opts.cursor);

  const rows = await timedRead("comments.replies_page", (rdb) =>
    rdb
      .select()
      .from(comments)
      .where(and(eq(comments.parentId, rootId), cursor ? keysetBefore(cursor) : undefined))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(limit + 1),
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const liked = await likedCommentIds(viewerId, page.map((r) => Number(r.id)));
  const items = page.map((row) => toCommentNode(row, { liked: liked.has(Number(row.id)) })); // 回复自身无子树（两层封顶）
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: new Date(last.createdAt).toISOString(), id: Number(last.id) } : null,
    hasMore,
  };
}

/**
 * 评论点赞/取消（ADR-0004：走新建的 comment_likes 表，不复用 likes）。
 * 写法对齐 toggleLike：INSERT 撞 uq_comment_like → 已赞过 → DELETE 并原子 -1；成功则 +1。
 * 并发下两个相同 INSERT 只有一个成功，计数不漂移。
 * 与帖子点赞的两点差异（都是刻意的）：
 * 1. 返回值带 likeCount（评论列表徽标要与服务端一致，不靠前端 ±1 猜）；
 * 2. 不发 tracking.user_event——评论赞不是内容偏好信号，profileService 的 EVENT_W 里也没有这一档，
 *    凭空造一个 action 只会往画像里灌权重 0.1 的噪声。
 */
export async function toggleCommentLike(
  commentId: number,
  userId: number,
  actorName = "钓友",
): Promise<{ liked: boolean; likeCount: number }> {
  const db = getDataSource().write();
  const [target] = await db
    .select({
      id: comments.id,
      postId: comments.postId,
      userId: comments.userId,
      content: comments.content,
      deletedAt: comments.deletedAt,
    })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!target || target.deletedAt != null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在或已删除" });
  }
  try {
    await db.insert(commentLikes).values({ userId, commentId });
  } catch (err) {
    if (!isDupEntry(err)) throw err;
    const del = await db
      .delete(commentLikes)
      .where(and(eq(commentLikes.userId, userId), eq(commentLikes.commentId, commentId)));
    if (affectedRows(del) === 1) {
      await db
        .update(comments)
        .set({ likeCount: sql`GREATEST(${comments.likeCount} - 1, 0)` })
        .where(eq(comments.id, commentId));
    }
    return { liked: false, likeCount: await readCommentLikeCount(commentId) };
  }
  await db.update(comments).set({ likeCount: sql`${comments.likeCount} + 1` }).where(eq(comments.id, commentId));
  // 通知评论作者（失败不阻断点赞主流程）；refId 用所属帖子 id，消息中心靠它跳转定位
  try {
    if (target.userId != null) {
      await pushNotification(
        {
          userId: Number(target.userId),
          type: "like",
          actorName,
          actorId: userId,
          refId: Number(target.postId),
          preview: target.content.slice(0, 50),
        },
        db,
      );
    }
  } catch {
    // 通知失败不阻断主流程
  }
  return { liked: true, likeCount: await readCommentLikeCount(commentId) };
}

/** 计数以服务端为准：±1 之后回读一次，避免把并发下的漂移值返给前端徽标 */
async function readCommentLikeCount(commentId: number): Promise<number> {
  const [row] = await getDataSource()
    .read()
    .select({ likeCount: comments.likeCount })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  return Number(row?.likeCount ?? 0);
}

/**
 * 删除评论（v14 全软删 + 占位）。
 * 权限（已拍板）：评论作者本人 OR 所属帖子作者——楼主对自己帖下的评论有清理责任。
 * 置 deleted_at 后行保留：楼中楼结构不塌（硬删顶层楼会让子回复孤儿化），
 * 正文/图片仍留在库里但不返回，前端渲染「该评论已删除」。
 * posts.comment_count 不递减：软删评论照常出现在列表里（作为占位），计数口径必须与可见口径一致。
 */
export async function deleteComment(commentId: number, userId: number): Promise<{ ok: true }> {
  const db = getDataSource().write();
  const [target] = await db
    .select({ id: comments.id, postId: comments.postId, userId: comments.userId, deletedAt: comments.deletedAt })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在或已删除" });
  }
  const [post] = await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, target.postId)).limit(1);
  const isCommentAuthor = target.userId != null && Number(target.userId) === userId;
  const isPostAuthor = post?.authorId != null && Number(post.authorId) === userId;
  if (!isCommentAuthor && !isPostAuthor) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无权删除该评论" });
  }
  // CAS（WHERE deleted_at IS NULL）：与 deletePost 同口径，并发重复删按「已不存在」处理
  const res = await db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)));
  if (affectedRows(res) !== 1) {
    throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在或已删除" });
  }
  return { ok: true };
}

/** 发表评论的入参（v14 起改为对象：新增 images / 需要返回 CommentNode，位置参数已经排不下了） */
export interface AddCommentInput {
  userId: number;
  postId: number;
  content: string;
  authorName: string;
  /** 楼中楼目标评论 id；回复「回复」时归并到其顶层楼（两层封顶） */
  parentId?: number | null;
  /** 评论配图：dataURL（走机审 + 落盘）或既有 /uploads 相对路径（原样透传） */
  images?: string[];
  /** 通知展示用的发起者昵称（缺省用 authorName） */
  actorName?: string;
}

/**
 * 发表评论（楼中楼归并 + comment_count 原子累加 + 事件入队 + 通知；v14 起返回 CommentNode）。
 * 接线顺序是刻意的：文本过滤 → 楼中楼父行校验 → 图片机审与落盘 → 落库。
 * 前两步没过就直接抛错，不浪费一次机审调用、也不在磁盘上留孤儿文件
 *（回复目标不存在是必然失败，没必要先把 3MB 图片写进 uploads/）。
 * authorAvatar 由服务端从 users 表取，不再让前端按 (userId+id)%7 算假头像。
 */
export async function addComment(input: AddCommentInput): Promise<CommentNode> {
  const { userId, postId, content } = input;
  const db = getDataSource().write();
  // 内容前置过滤（QY-SAFE-002）：违禁词 reject 直接抛错不落库；广告词 flag 照常发表、事后写系统举报
  const filter = assertContentAllowed(content, "comment", userId);
  // 楼中楼（QY-COMM-006）：回复须指向同帖评论；回复「回复」时挂到其顶层评论（最多两层）
  let effectiveParentId: number | null = null;
  let replyToUserId: number | null = null;
  if (input.parentId != null) {
    const [parent] = await db
      .select({ id: comments.id, postId: comments.postId, userId: comments.userId, parentId: comments.parentId })
      .from(comments)
      .where(eq(comments.id, input.parentId))
      .limit(1);
    if (!parent || Number(parent.postId) !== postId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "评论不存在或已删除" });
    }
    effectiveParentId = parent.parentId != null ? Number(parent.parentId) : Number(parent.id);
    replyToUserId = parent.userId != null ? Number(parent.userId) : null;
  }
  // 图片：机审（落盘前）→ 写 uploads/comments → 只把 URL 数组落库
  const ingested: IngestedImages = await ingestImages(input.images, {
    slot: "comments",
    userId,
    kind: "comment",
  });
  // 真实头像：冗余进 comments.author_avatar（v14 与 posts/reviews 同模式），取不到用默认值
  const [author] = await db.select({ avatar: users.avatar }).from(users).where(eq(users.id, userId)).limit(1);
  const authorAvatar = author?.avatar || "/avatar-1.png";
  const res = await db
    .insert(comments)
    .values({ postId, userId, authorName: input.authorName, authorAvatar, content, images: ingested.urls, parentId: effectiveParentId });
  const commentId = insertIdOf(res);
  await db.update(posts).set({ commentCount: sql`${posts.commentCount} + 1` }).where(eq(posts.id, postId));
  await getQueue().publish("community.post.commented", { userId, postId });
  // 与原实现对齐：评论同时记行为事件（异步画像更新）
  await getQueue().publish("tracking.user_event", { userId, postId, action: "comment", durationMs: 0 });
  // 消息中心：回复通知被回复者（reply），顶层评论通知帖子作者（comment）；失败不阻断评论主流程
  try {
    if (replyToUserId != null) {
      await pushNotification(
        { userId: replyToUserId, type: "reply", actorName: input.actorName ?? input.authorName, actorId: userId, refId: postId, preview: content.slice(0, 50) },
        db,
      );
    } else {
      const [post] = await db
        .select({ authorId: posts.authorId })
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);
      if (post?.authorId) {
        await pushNotification(
          { userId: post.authorId, type: "comment", actorName: input.actorName ?? input.authorName, actorId: userId, refId: postId, preview: content.slice(0, 50) },
          db,
        );
      }
    }
  } catch {
    // 通知失败不阻断主流程
  }
  // 广告词命中（QY-SAFE-002）：评论已落库，对被举报帖写一条系统举报进审核队列（best-effort，内部容错）
  if (filter.action === "flag" && filter.hit) {
    await createSystemReport({ postId, authorId: userId, hit: filter.hit, kind: "comment", excerpt: content.slice(0, 20) });
  }
  // 图片机审「放行但标记待审」的落点（未配置 Key 时也是这条路径），同样挂在所属帖子名下
  await flagPendingImageReview(ingested, { postId, authorId: userId, kind: "comment" });

  const [row] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!row) {
    // 理论上不该发生（刚插入就读不到），出现即为主从延迟/连接指向异常
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "评论发表失败，请重试" });
  }
  return toCommentNode(row, { liked: false });
}

/** 单帖详情（帖子详情页）；软删帖返回 null，由路由层抛 404 */
export async function getPost(postId: number) {
  const rows = await timedRead("posts.detail", (db) =>
    db.select().from(posts).where(and(eq(posts.id, postId), isNull(posts.deletedAt))).limit(1),
  );
  return rows[0] ?? null;
}

/**
 * 详情页出参 = 完整行 + 当前用户互动态。
 * 与 feed 不同，详情页**保留 images 全量数组**：这里只有一次单行查询、且用户要看的就是九宫格，
 * 瘦身只需要发生在「200 行进共享缓存」那条批量链路上（见 POST_CARD_COLUMNS）。
 */
export async function getPostDetail(postId: number, viewerId: number) {
  const post = await getPost(postId);
  if (!post) return null;
  const { liked, collected } = await userPostInteraction(viewerId, [postId]);
  return { ...post, liked: liked.has(postId), collected: collected.has(postId) };
}

/** 最新鱼讯（全站 10 条，联查钓场名） */
export async function listNews() {
  return timedRead("news.list", (db) =>
    db
      .select({ id: fishNews.id, content: fishNews.content, createdAt: fishNews.createdAt, pondName: ponds.name, pondSlug: ponds.slug })
      .from(fishNews)
      .innerJoin(ponds, eq(fishNews.pondId, ponds.id))
      .orderBy(desc(fishNews.createdAt))
      .limit(10),
  );
}

/** 发帖（发渔获）：写入真实信息流，进入推荐召回池 */
export interface CreatePostInput {
  content: string;
  /**
   * v14 语义变更：入参是客户端压缩后的 **dataURL 数组**（可混排既有 /uploads 相对路径，
   * 供编辑重试时原样带回旧图），服务端机审 + 落盘后，库里只写 URL 数组。
   * 字段名不变，前端调用点零改动。
   */
  images: string[];
  pondSlug?: string;
  fishSpecies?: string;
  weightJin?: number;
  latitude?: number;
  longitude?: number;
  locationText?: string;
}
export async function createPost(
  user: { id: number; name: string; avatar: string },
  input: CreatePostInput,
) {
  const db = getDataSource().write();
  // 内容前置过滤（QY-SAFE-002）：正文 + 鱼种标签合并检查；
  // 违禁词 reject 直接抛错不落库；广告词 flag 照常发帖、事后写系统举报进审核队列
  const filter = assertContentAllowed(`${input.content} ${input.fishSpecies ?? ""}`, "post", user.id);
  // 图片链路（ADR-0003）：解码校验 → 机审（落盘前，图片无需公网可访问）→ 写 uploads/posts →
  // 只有 URL 数组进数据库。放在 pondId 反查之前，是为了让「超限/违规」这种必然失败的请求
  // 尽早返回；文本过滤在最前，是为了不为一篇注定被拦下的帖子烧机审额度、留孤儿文件。
  const ingested: IngestedImages = await ingestImages(input.images, { slot: "posts", userId: user.id, kind: "post" });
  // 由 pondSlug 反查 pondId（冗余列 pondSlug 直填，消除推荐召回 N+1）
  let pondId: number | null = null;
  if (input.pondSlug) {
    const [p] = await db.select({ id: ponds.id }).from(ponds).where(eq(ponds.slug, input.pondSlug));
    pondId = p?.id ?? null;
  }
  const res = await db.insert(posts).values({
    authorId: user.id,
    authorName: user.name,
    authorAvatar: user.avatar,
    content: input.content,
    images: ingested.urls,
    pondId,
    pondSlug: input.pondSlug ?? null,
    fishSpecies: input.fishSpecies ?? null,
    weightJin: input.weightJin != null ? String(input.weightJin) : null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    locationText: input.locationText ?? null,
  });
  const insertId = insertIdOf(res);
  const [post] = await db.select().from(posts).where(eq(posts.id, insertId));
  // 发帖后让作者立即在信息流看到：失效共享召回池 + 作者 feed 首页缓存
  await getCache().del("recall:hot", `feed:${user.id}:1:5`);
  // 广告词命中（QY-SAFE-002）：帖子已落库，写系统举报进审核队列（best-effort，内部容错）
  if (filter.action === "flag" && filter.hit) {
    await createSystemReport({ postId: insertId, authorId: user.id, hit: filter.hit, kind: "post" });
  }
  // 图片待人工复核（机审未启用/超时/判 review 时都是这条路径）：需要 postId，故必须在 INSERT 之后
  await flagPendingImageReview(ingested, { postId: insertId, authorId: user.id, kind: "post" });
  return post;
}

/** 读取本人未删除帖子：他人资源/已软删一律 NOT_FOUND，不泄露存在性 */
async function requireOwnPost(userId: number, postId: number) {
  const db = getDataSource().write();
  const [post] = await db
    .select({ id: posts.id, authorId: posts.authorId })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  if (!post || post.authorId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在或已删除" });
  }
  return post;
}

/** 删帖（QY-COMM-004）：仅作者本人；软删 CAS（WHERE deleted_at IS NULL），点赞/评论保留 */
export async function deletePost(userId: number, postId: number): Promise<{ ok: true }> {
  await requireOwnPost(userId, postId);
  const db = getDataSource().write();
  const res = await db
    .update(posts)
    .set({ deletedAt: new Date() })
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)));
  if (affectedRows(res) !== 1) {
    // 并发下已被另一请求删除
    throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在或已删除" });
  }
  // 与 createPost 同口径：失效共享召回池 + 作者 feed 首页缓存
  await getCache().del("recall:hot", `feed:${userId}:1:5`);
  return { ok: true };
}

/** 编辑帖子（QY-COMM-004）：仅作者本人；仅更新传入字段 */
export interface EditPostInput {
  content?: string;
  /**
   * 同 createPost：dataURL（新图，机审 + 落盘）与既有 /uploads 相对路径（透传）可混排。
   * 传 undefined 表示不动图片；传 [] 表示清空图片。
   */
  images?: string[];
  fishSpecies?: string;
  weightJin?: number;
}
export async function editPost(userId: number, postId: number, input: EditPostInput) {
  await requireOwnPost(userId, postId);
  const db = getDataSource().write();
  // 内容前置过滤（QY-SAFE-002 补齐编辑入口）：正文/鱼种任一变更时，
  // 新文本与 createPost 同口径合并检查，堵住「先正常发帖、再编辑绕过发布过滤」的口子。
  // 违禁 reject 直接抛错（编辑不落库）；广告 flag 照常保存、事后幂等写系统举报。
  const filter =
    input.content !== undefined || input.fishSpecies !== undefined
      ? assertContentAllowed(`${input.content ?? ""} ${input.fishSpecies ?? ""}`, "post", userId)
      : null;
  // 图片变更走与 createPost 完全相同的链路（机审 → 落盘 → 存 URL），
  // 否则「先发帖、再编辑塞 base64」就是绕过 ADR-0003 的后门。
  // 换图后不回收旧文件：与 imageStore 的孤儿文件口径一致（低频、单实例磁盘余量足够），
  // 在写路径上 rm 只会新增失败模式，治理应交给离线对账。
  const ingested: IngestedImages | null =
    input.images !== undefined
      ? await ingestImages(input.images, { slot: "posts", userId, kind: "post" })
      : null;
  const patch: Partial<typeof posts.$inferInsert> = {};
  if (input.content !== undefined) patch.content = input.content;
  if (ingested !== null) patch.images = ingested.urls;
  if (input.fishSpecies !== undefined) patch.fishSpecies = input.fishSpecies;
  if (input.weightJin !== undefined) patch.weightJin = String(input.weightJin);
  if (Object.keys(patch).length > 0) {
    // CAS：仅当帖子未被软删时才允许编辑，避免与并发删除交错复活内容
    const res = await db
      .update(posts)
      .set(patch)
      .where(and(eq(posts.id, postId), isNull(posts.deletedAt)));
    if (affectedRows(res) !== 1) {
      throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在或已删除" });
    }
  }
  const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  // 与 createPost 同口径：失效共享召回池 + 作者 feed 首页缓存
  await getCache().del("recall:hot", `feed:${userId}:1:5`);
  // 广告词命中（QY-SAFE-002）：编辑已落库，写系统举报进审核队列。
  // 幂等由 uq_report（reporterId=作者本人, postId）保证：发帖时已系统举报过
  // 或前次编辑已举报过的帖子，重复命中不会重复写（createSystemReport 内部容错）。
  if (filter?.action === "flag" && filter.hit) {
    await createSystemReport({ postId, authorId: userId, hit: filter.hit, kind: "post" });
  }
  // 图片待人工复核（与 createPost 同口径；uq_report 幂等，重复待审只会保留第一条记录）
  if (ingested) {
    await flagPendingImageReview(ingested, { postId, authorId: userId, kind: "post" });
  }
  return post;
}

/**
 * 搜索结果卡片：与 feed 的 FeedItem 同形（PostCardRow + cover + score 占位 + liked/collected）。
 * 刻意在本文件定义而不是 import recommendService 的 FeedItem——卡片契约的归属方是 community
 *（见文件头「recommendService 复用同一份」），反向 import 会让 service 层依赖倒置成循环。
 * 结构类型一致即可互换：前端因此能把 search 结果直接当 FeedItem 用，不需要 as 强转。
 */
export type SearchPostCard = PostCardRow & { score: number; liked: boolean; collected: boolean };

/**
 * 帖子搜索（QY-COMM-007）：正文/鱼种 LIKE 模糊匹配，按发布时间倒序，多取一条判 hasMore。
 *
 * v14 载荷口径对齐（本轮修的正是这里）：搜索从前是裸 `db.select()` 全列，与 feed 的瘦身卡片脱节——
 * 1) 没有 cover → 前端 mapFeedPost 读不到封面，搜索结果整块图不渲染；
 * 2) 没过 withUserInteraction → liked/collected 恒缺失，已赞已藏的帖在搜索结果里显示成未互动；
 * 3) 全列 select 把 posts.images 的历史 base64（单行 2–4MB）整块拖进响应，正是 v14 拆掉的那颗雷。
 * 现在与 feed 同一份列口径（POST_CARD_COLUMNS + postCoverSql），超长遗留行由 512 字符守卫判 null，
 * 详情页仍能看到完整 images。
 *
 * 搜索算法没动：WHERE（isNull(deletedAt) + content/fishSpecies 的 LIKE 模糊匹配，关键词先转义
 * % 与 _）、orderBy created_at 倒序、limit pageSize+1 判 hasMore、offset 翻页——这几段与改造前逐字相同，
 * 只换载荷。ES 召回是阶段二（见 api/infra/index.ts 的 getSearch 注释与 backlog B-08），本轮不顺手改。
 *
 * viewerId 是必填第 2 参而不是尾部默认值：匿名调用必须显式传 0（viewerId(ctx) 的口径），
 * 默认值会让「忘了传 viewer」静默退化成全员未赞未藏——那种 bug 在页面上看不出来，只会慢慢烂。
 *
 * 缓存口径：本函数**不接**共享缓存（关键词长尾、命中率低，缓存收益不抵一致性成本）。
 * 因此这里没有「就地写回共享行」的风险；若将来要接缓存，必须照 recommendFeed 的做法——
 * 缓存读写之后再 withUserInteraction，绝不能把每用户的 liked/collected 写进 MemoryCache 的行对象里。
 */
export async function searchPosts(
  keyword: string,
  viewerId: number,
  page = 1,
  pageSize = 10,
): Promise<{ items: SearchPostCard[]; hasMore: boolean }> {
  const kw = `%${keyword.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const where = and(
    isNull(posts.deletedAt),
    or(like(posts.content, kw), like(posts.fishSpecies, kw)),
  );
  const rows = await timedRead("posts.search", (db) =>
    db
      .select({ ...POST_CARD_COLUMNS, cover: postCoverSql })
      .from(posts)
      .where(where)
      .orderBy(desc(posts.createdAt))
      .limit(pageSize + 1) // 多取一条判定 hasMore
      .offset((page - 1) * pageSize),
  );
  const hasMore = rows.length > pageSize;
  // score 占位 0：搜索按时间倒序、没有打分流，但前端卡片组件与 FeedItem 共用一套类型，
  // 补 0 保持同形（与 followingFeed 的处理一致）
  const cards: Array<PostCardRow & { score: number }> = rows
    .slice(0, pageSize)
    .map((row) => ({ ...row, score: 0 }));
  // 两条 IN 查询批量补互动态（无 N+1）；返回的是新对象，不与任何共享行同引用
  const items = await withUserInteraction(viewerId, cards);
  return { items, hasMore };
}

// ============ 帖子收藏（v14：归集到 /favorites 的「帖子」Tab） ============

/**
 * 收藏/取消收藏（幂等，靠 uq_post_favorite 唯一索引；写法对照 toggleLike）。
 * 为什么单独建表而不复用 likes：收藏与点赞的用户心智不同（「以后再看」vs「已阅 + 认可」），
 * 混在一张表里就把两种信号 permanently 搅在一起了（且 likes 有 B-06 记录的历史隐患）。
 * 代价是系统里多一张互动表，换来的是 feed 的 likeRate 打分不会被「私下囤图」行为污染。
 */
export async function togglePostFavorite(userId: number, postId: number): Promise<{ collected: boolean }> {
  const db = getDataSource().write();
  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  if (!post) {
    throw new TRPCError({ code: "NOT_FOUND", message: "帖子不存在或已删除" });
  }
  try {
    await db.insert(postFavorites).values({ userId, postId });
  } catch (err) {
    if (!isDupEntry(err)) throw err;
    // 重复点：靠唯一索引定位删除，并发下只有一方 affectedRows=1
    await db
      .delete(postFavorites)
      .where(and(eq(postFavorites.userId, userId), eq(postFavorites.postId, postId)));
    return { collected: false };
  }
  // 行为事件入队（action=favorite 本就是 user_events 允许值，前端 track 接口也在发这个值）；
  // 画像权重表 EVENT_W 未收录 favorite → 落到 0.1 兜底，不改动既有打分口径。
  await getQueue().publish("tracking.user_event", { userId, postId, action: "favorite", durationMs: 0 });
  return { collected: true };
}

/** 我的收藏-帖子 Tab 每页条数（卡片含 cover，比纯文字列表重，默认比评论列表小一档） */
const FAVORITES_DEFAULT_LIMIT = 10;
const FAVORITES_MAX_LIMIT = 20;

/**
 * 我的收藏帖子列表（游标分页，按「收藏时间」倒序，返回 feed 帖子卡形状）。
 * 只 JOIN 出 POST_CARD_COLUMNS + cover（与 feed 同一份列口径，绝不再把 images 整列捞出来），
 * 并过滤掉已被软删的帖子：收藏是个人的书签，不因为原帖下架而报错，直接不展示。
 *
 * 游标里的 id 是 **post_favorites.id**（它是本列表排序键的一部分），不是 postId；
 * 前端只需原样回显 nextCursor，不必理解其含义。
 * liked/collected 由 withUserInteraction 补齐——这里是每用户自己的数据、没进共享缓存，
 * 但仍走同一个补齐函数，避免两处逻辑漂移（collected 对本列表恒为 true，值得为一致性付一次 IN 查询）。
 */
export async function myPostFavorites(
  userId: number,
  opts: { cursor?: CommentCursorInput | null; limit?: number },
): Promise<{ items: Array<PostCardRow & { liked: boolean; collected: boolean }>; nextCursor: CommentCursorInput | null; hasMore: boolean }> {
  const limit = Math.min(FAVORITES_MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? FAVORITES_DEFAULT_LIMIT)));
  const cursor = parseCursor(opts.cursor);
  const rows = await timedRead("favorites.page", (db) =>
    db
      .select({
        ...POST_CARD_COLUMNS,
        cover: postCoverSql,
        favoritedAt: postFavorites.createdAt,
        favoriteId: postFavorites.id,
      })
      .from(postFavorites)
      .innerJoin(posts, eq(postFavorites.postId, posts.id))
      .where(
        and(
          eq(postFavorites.userId, userId),
          isNull(posts.deletedAt),
          cursor
            ? or(
                lt(postFavorites.createdAt, cursor.createdAt),
                and(eq(postFavorites.createdAt, cursor.createdAt), lt(postFavorites.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(postFavorites.createdAt), desc(postFavorites.id))
      .limit(limit + 1),
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  // 游标要的是收藏行（favoritedAt/favoriteId），出参不需要——剥掉，保持与 feed 卡片严格同形
  const last = page[page.length - 1];
  const items = await withUserInteraction(userId, page.map(toCardRow));
  return {
    items,
    nextCursor: hasMore && last ? { createdAt: new Date(last.favoritedAt).toISOString(), id: Number(last.favoriteId) } : null,
    hasMore,
  };
}

/** 卡片行 → 干净卡片对象：去掉「仅为拼游标而多带」的收藏辅助列 */
function toCardRow(row: PostCardRow & { favoritedAt: Date; favoriteId: number }): PostCardRow {
  const out = { ...row } as Partial<PostCardRow & { favoritedAt: Date; favoriteId: number }>;
  delete out.favoritedAt;
  delete out.favoriteId;
  return out as PostCardRow;
}


// ============ 渔获分享卡片（QY-COMM-009） ============

/** 分享落地页 base：默认线上地址，可用环境变量覆盖 */
const SHARE_BASE_URL = (process.env.SHARE_BASE_URL ?? "http://47.109.185.118:3000").replace(/\/$/, "");

/** 分享卡片渲染契约：前端 canvas 绘制的全部输入 */
export interface ShareCardData {
  /** 正文摘要（≤60 字，超出截断加省略号） */
  title: string;
  authorName: string;
  species: string | null;
  /** 重量（斤，decimal 原样字符串） */
  weight: string | null;
  pondName: string | null;
  /** 首图 URL（同源 /feed-x.jpg 或 /uploads/...，可能为空） */
  coverUrl: string | null;
  landingUrl: string;
  /** 落地页二维码 PNG DataURL；生成失败降级为 null，前端绘制占位框不阻断 */
  qrDataUrl: string | null;
}

/**
 * 分享卡片数据：单帖查询（不含软删），联查钓场名；二维码由纯 JS 库 qrcode 生成
 *（esbuild 打包进 bundle，生产无原生图像库也可用；纠错级 M、小 margin）。
 */
export async function getShareCard(postId: number): Promise<ShareCardData | null> {
  const post = await getPost(postId);
  if (!post) return null;

  let pondName: string | null = null;
  if (post.pondSlug) {
    const rows = await timedRead("posts.shareCardPond", (db) =>
      db
        .select({ name: ponds.name })
        .from(ponds)
        .where(eq(ponds.slug, post.pondSlug!))
        .limit(1),
    );
    pondName = rows[0]?.name ?? null;
  }

  const landingUrl = `${SHARE_BASE_URL}/post/${post.id}`;
  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await qrToDataURL(landingUrl, { margin: 1, errorCorrectionLevel: "M", width: 360 });
  } catch {
    qrDataUrl = null; // 降级路径：前端在二维码位置绘制占位框 + 链接文本
  }

  const excerpt = post.content.replace(/\s+/g, " ").trim();
  return {
    title: excerpt.length > 60 ? `${excerpt.slice(0, 60)}…` : excerpt,
    authorName: post.authorName,
    species: post.fishSpecies ?? null,
    weight: post.weightJin != null ? String(post.weightJin) : null,
    pondName,
    coverUrl: post.images?.[0] ?? null,
    landingUrl,
    qrDataUrl,
  };
}
