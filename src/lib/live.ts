/**
 * 后端 tRPC 数据 → 前端展示模型的映射工具。
 * 约定：superjson 反序列化后 Date 为 Date 对象；decimal 字段为 string；JSON 字段已是数组。
 */
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../api/router'
import type { FeedPost } from '@/data/home'
import type { Pond, Seat, TicketType, PondReview } from '@/data/spots'
import { PONDS as TRADE_PONDS } from '@/data/orders'
import type { Order, OrderStatus } from '@/data/orders'

type RouterOutput = inferRouterOutputs<AppRouter>

export type FeedItem = RouterOutput['app']['feed']['items'][number]
/**
 * app.posts.search 的列表项（v14 载荷口径对齐后与 FeedItem **结构同形**：
 * 两者都是 PostCardRow + cover + score 占位 + liked/collected）。
 *
 * 为什么还单独留这个别名，而不是让 search 直接写 FeedItem：契约的归属方在后端 ——
 * community.ts 的 SearchPostCard 刻意不 import recommendService 的 FeedItem（反向 import
 * 会让 service 层循环依赖），所以是两个类型、一份形状。首页搜索结果的映射用它：
 * 后端哪天改回整行裸 select（没有 cover / 没有互动位），这里会直接 tsc 报错，
 * 而不是被 `as` 糊过去、上线成一堆无图且恒未互动的搜索卡。
 */
export type SearchFeedItem = RouterOutput['app']['posts']['search']['items'][number]
export type PondListItem = RouterOutput['app']['ponds']['list'][number]
export type PondDetailData = NonNullable<RouterOutput['app']['ponds']['detail']>
export type NewsItem = RouterOutput['app']['ponds']['news'][number]
export type MyOrder = RouterOutput['app']['orders']['mine'][number]
export type OwnerStats = RouterOutput['app']['orders']['ownerStats']
export type ProductItem = RouterOutput['app']['products']['list'][number]
/** v14：posts.comments 改为游标分页（{ items, nextCursor, hasMore, total }），评论节点从分页响应里取 */
export type CommentsPage = RouterOutput['app']['posts']['comments']
export type CommentNode = CommentsPage['items'][number]
/** 评论翻页游标：与后端契约同名同形，原样回传给下一次请求，不做任何加工 */
export type CommentsCursor = NonNullable<CommentsPage['nextCursor']>
export type PostDetailData = NonNullable<RouterOutput['app']['posts']['detail']>
export type FavoritePostItem = RouterOutput['app']['posts']['myFavorites']['items'][number]
/** 我的收藏（帖子）翻页游标 */
export type FavoritesCursor = NonNullable<RouterOutput['app']['posts']['myFavorites']['nextCursor']>

/** 后端未下发头像时的兜底占位（原先各处硬编码字面量，收敛到一个常量） */
const FALLBACK_AVATAR = '/avatar-1.png'


/** 时间字段归一为毫秒时间戳（superjson 反序列化后是 Date，游标回传后是 string，两种都要吃得下） */
export function toMillis(d: Date | string): number {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** 相对时间（与 mock 文案风格一致：「2 小时前」） */
export function relativeTime(d: Date | string): string {
  const t = toMillis(d)
  if (t === 0) return '刚刚'
  const diff = Math.max(0, Date.now() - t)
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  const dt = new Date(t)
  return `${dt.getMonth() + 1} 月 ${dt.getDate()} 日`
}

/** slug → 中文名（用于画像/挂载条兜底展示） */
export const POND_NAME_BY_SLUG: Record<string, string> = {
  qinglong: '青龙湾生态钓场',
  ludao: '鹭岛湖路亚基地',
  laozhou: '老周家斤塘',
  yunxi: '云溪谷休闲钓园',
}

export function pondName(slug: string | null | undefined): string | undefined {
  return slug ? (POND_NAME_BY_SLUG[slug] ?? slug) : undefined
}

/** 钓场标签 → 前端筛选分类 */
export function deriveCategories(tags: string[]): Pond['categories'] {
  const cats: Pond['categories'] = []
  if (tags.some((t) => t.includes('夜钓'))) cats.push('night')
  if (tags.some((t) => t.includes('斤塘'))) cats.push('jintang')
  if (tags.some((t) => t.includes('路亚'))) cats.push('lure')
  if (tags.some((t) => t.includes('放鱼'))) cats.push('stocking')
  return cats
}

const SEAT_NOTES = [
  '临水草区，出鲫鱼',
  '近进水口，鱼口稳',
  '深水区，常出大物',
  '向阳位，晨钓首选',
  '树荫下，午后不晒',
  '塘角洄湾，藏鲤鱼',
]

/** 钓场列表项 → 列表大卡所需模型（详情字段以占位填充，列表卡不使用） */
export function mapPondListItem(p: PondListItem, todayNews?: string): Pond {
  return {
    id: p.slug,
    name: p.name,
    region: p.region,
    address: p.region,
    addressExtra: p.openHours ? `营业 ${p.openHours}` : undefined,
    rating: Number(p.rating),
    reviewCount: p.reviewCount,
    priceFrom: p.priceFrom,
    distanceKm: Number(p.distanceKm),
    tags: [...p.fishSpecies, ...p.tags],
    categories: deriveCategories(p.tags),
    cover: p.cover,
    album: p.album,
    todayNews,
    news: { owner: '塘主', ownerAvatar: '/avatar-5.webp', text: todayNews ?? '', time: '' },
    intro: p.intro ?? '',
    seats: [],
    defaultSeat: 0,
    tickets: [],
    reviews: [],
  }
}

/** 钓场详情 → 详情页完整模型 */
export function mapPondDetail(d: PondDetailData): Pond {
  const latestNews = d.news[0]
  const seats: Seat[] = d.seats
    .slice()
    .sort((a, b) => a.seatNo - b.seatNo)
    .map((s, i) => ({
      no: s.seatNo,
      status: s.isVip ? 'vip' : s.isSold ? 'sold' : 'free',
      note: SEAT_NOTES[i % SEAT_NOTES.length],
    }))
  const firstFree = seats.find((s) => s.status === 'free')
  const tickets: TicketType[] = d.tickets.map((t) => ({
    id: String(t.id),
    name: t.name,
    desc: t.durationDesc ?? '',
    price: t.price,
    badge: t.isHot ? '热门' : undefined,
  }))
  const reviews: PondReview[] = d.reviews.map((r) => ({
    id: String(r.id),
    author: r.authorName,
    avatar: r.authorAvatar,
    rating: r.rating,
    text: r.content ?? '',
    image: r.images[0],
    time: relativeTime(r.createdAt),
  }))
  return {
    id: d.slug,
    name: d.name,
    region: d.region,
    address: d.region,
    addressExtra: d.openHours ? `营业 ${d.openHours}` : undefined,
    rating: Number(d.rating),
    reviewCount: d.reviewCount,
    priceFrom: d.priceFrom,
    distanceKm: Number(d.distanceKm),
    tags: [...d.fishSpecies, ...d.tags],
    categories: deriveCategories(d.tags),
    cover: d.cover,
    album: d.album.length > 0 ? d.album : [d.cover],
    todayNews: latestNews?.content,
    news: {
      owner: '塘主',
      ownerAvatar: '/avatar-5.webp',
      text: latestNews?.content ?? '暂无鱼讯，欢迎来电咨询',
      time: latestNews ? relativeTime(latestNews.createdAt) : '',
    },
    intro: d.intro ?? '',
    seats,
    defaultSeat: firstFree?.no ?? 1,
    tickets,
    reviews,
  }
}

/**
 * 钓点挂载条：pondSlug + 钓场元数据 → 卡片底部那条「钓场名 · ¥价格 起」。
 * 推荐流 / 关注流 / 搜索结果三条列表都经 mapFeedPost 走这里，元数据没命中时
 * 价格兜底 68、名称兜底 slug 中文表（与迭代前一致）。
 */
function cardSpot(
  pondSlug: string | null,
  meta: Record<string, { name: string; price: number }>,
): FeedPost['spot'] | undefined {
  if (!pondSlug) return undefined
  return {
    id: pondSlug,
    name: meta[pondSlug]?.name ?? pondName(pondSlug) ?? pondSlug,
    price: meta[pondSlug]?.price ?? 68,
  }
}

/**
 * 信息流帖子 → 列表卡片展示模型。
 * app.feed、app.posts.followingFeed、app.posts.search 三条列表的条目都吃这个函数：
 * 后端把三者的载荷口径统一成了同一份卡片列（PostCardRow + cover + liked/collected），
 * 结构同形因此不需要三个映射器 —— 一旦哪天不同形，tsc 会在这里报错而不是悄悄掉图。
 * v14 两处关键变化（都来自后端 feed 瘦身）：
 * - images 数组没了，只有首图 cover：9 图帖的全量 base64 不再进首页传输；
 * - liked / collected 由服务端下发：已赞/已藏帖刷新后不再显示为未赞未藏
 *   （迭代前 FeedPost 的 liked 恒从 false 起步，就是这里没映射导致的）。
 */
export function mapFeedPost(
  p: FeedItem,
  meta: Record<string, { name: string; price: number }>,
): FeedPost {
  const spot = cardSpot(p.pondSlug, meta)
  return {
    id: String(p.id),
    author: p.authorName,
    avatar: p.authorAvatar || FALLBACK_AVATAR,
    time: relativeTime(p.createdAt),
    location: spot?.name,
    cover: p.cover ?? null,
    caption: p.content,
    likes: p.likeCount,
    commentCount: p.commentCount,
    // 真实帖的评论预览不在这里：feed 已不透传评论，每张卡各发一次
    // posts.comments 换一行预览的成本不可接受。改走 commentPreview 本地旁路，
    // 见 lib/commentPreview.ts 顶部注释。
    comments: [],
    liked: p.liked,
    collected: p.collected,
    spot,
  }
}

/**
 * 帖子展示模型：posts.detail 的返回、以及列表卡片已知字段（seed）都归一到这个形状。
 * PostSheet 与 /post/:id 路由页因此能共用 PostContent 一套渲染逻辑，
 * 不必为「弹层数据来自列表、路由数据来自详情」写两棵树。
 */
export interface PostView {
  id: number
  authorId: number | null
  authorName: string
  authorAvatar: string
  /** 已格式化的相对时间文案 */
  time: string
  content: string
  /** 全量图片；seed 态下只有封面那一张 */
  images: string[]
  likeCount: number
  commentCount: number
  liked: boolean
  collected: boolean
  fishSpecies: string | null
  weightJin: number | null
  pondSlug: string | null
  locationText: string | null
  latitude: number | null
  longitude: number | null
  /**
   * true = 这份视图来自列表卡片字段（详情尚未到达），只有封面、没有鱼种/重量/定位 chips。
   * 渲染层用它决定顶部是否挂一条细进度条，避免用户在白屏前干等。
   */
  partial: boolean
}

/** posts.detail → 帖子展示模型 */
export function mapPostDetail(d: PostDetailData): PostView {
  return {
    id: Number(d.id),
    authorId: d.authorId != null ? Number(d.authorId) : null,
    authorName: d.authorName,
    authorAvatar: d.authorAvatar || FALLBACK_AVATAR,
    time: relativeTime(d.createdAt),
    content: d.content,
    images: d.images ?? [],
    likeCount: Number(d.likeCount ?? 0),
    commentCount: Number(d.commentCount ?? 0),
    liked: !!d.liked,
    collected: !!d.collected,
    fishSpecies: d.fishSpecies ?? null,
    weightJin: d.weightJin != null ? Number(d.weightJin) : null,
    pondSlug: d.pondSlug ?? null,
    locationText: d.locationText ?? null,
    latitude: d.latitude != null ? Number(d.latitude) : null,
    longitude: d.longitude != null ? Number(d.longitude) : null,
    partial: false,
  }
}

/** 列表卡片已知字段 → 帖子展示模型（弹层打开瞬间先乐观渲染作者/时间/点赞数，减少白屏感） */
export function mapCardToPostView(p: FeedPost, postId: number): PostView {
  return {
    id: postId,
    authorId: null,
    authorName: p.author,
    authorAvatar: p.avatar || FALLBACK_AVATAR,
    time: p.time,
    content: p.caption,
    images: p.cover ? [p.cover] : [],
    likeCount: p.likes,
    commentCount: p.commentCount,
    liked: !!p.liked,
    collected: !!p.collected,
    fishSpecies: null,
    weightJin: null,
    pondSlug: p.spot?.id ?? null,
    locationText: null,
    latitude: null,
    longitude: null,
    partial: true,
  }
}

/**
 * 评论节点 → 评论展示模型（递归带上服务端已嵌套的一层回复）。
 * v14 修掉两个假数据：头像不再按 (userId+id)%7 造（同一个人会长出不同的脸），
 * likes 不再硬编码 0（评论点赞数/点赞态改为读后端 likeCount/liked）。
 */
export interface CommentView {
  id: number
  postId: number
  name: string
  avatar: string
  text: string
  /**
   * 评论配图：服务端落盘后的 /uploads/comments/* URL 数组（软删行服务端不下发，恒为空）。
   * 上传侧走 posts.comment 的 images 入参（dataURL 数组，最多 4 张，见 CommentSection 的
   * COMMENT_IMAGE_MAX），机审 + 写盘后返回的就是这里的 URL。
   */
  images: string[]
  likes: number
  liked: boolean
  time: string
  /** 原始时间戳（ms）：楼内回复按它正序排；同秒回复靠 id 兜底，见 commentTree.ts */
  createdAtMs: number
  /** 顶层评论为 null；回复指向所属顶层评论 id */
  parentId: number | null
  /** 评论作者的用户 id：决定「删除」入口只对本人出现（昵称可以重复，不能拿昵称判本人） */
  authorId: number | null
  replyCount: number
  replies: CommentView[]
  repliesHasMore: boolean
  /** 软删标记：非空渲染成「该评论已删除」灰占位，但它楼下的回复不能跟着塌 */
  deleted: boolean
}

export function mapComment(c: CommentNode): CommentView {
  return {
    id: Number(c.id),
    postId: Number(c.postId),
    name: c.authorName,
    avatar: c.authorAvatar || FALLBACK_AVATAR,
    text: c.content,
    images: c.images ?? [],
    likes: Number(c.likeCount ?? 0),
    liked: !!c.liked,
    time: relativeTime(c.createdAt),
    createdAtMs: toMillis(c.createdAt),
    parentId: c.parentId != null ? Number(c.parentId) : null,
    authorId: c.authorId != null ? Number(c.authorId) : null,
    replyCount: Number(c.replyCount ?? 0),
    replies: (c.replies ?? []).map(mapComment),
    repliesHasMore: !!c.repliesHasMore,
    deleted: c.deletedAt != null,
  }
}

/** 收藏帖子列表项 → 列表卡片展示模型（/favorites「帖子」Tab 复用信息流卡的数据形状） */
export function mapFavoritePost(p: FavoritePostItem): FeedPost {
  return {
    id: String(p.id),
    author: p.authorName,
    avatar: p.authorAvatar || FALLBACK_AVATAR,
    time: relativeTime(p.createdAt),
    location: p.pondSlug ? pondName(p.pondSlug) : undefined,
    cover: p.cover ?? null,
    caption: p.content,
    likes: Number(p.likeCount ?? 0),
    commentCount: Number(p.commentCount ?? 0),
    comments: [],
    // 出现在「我的收藏」里的帖子必然已收藏
    liked: !!p.liked,
    collected: true,
  }
}


/** 后端订单 → 票券卡/评价页展示模型（status：pending 待使用 / used 已使用 / completed 已完成） */
export function mapMyOrder(o: MyOrder): Order {
  const pond =
    TRADE_PONDS.find((p) => p.id === o.pondSlug) ?? {
      id: o.pondSlug,
      name: o.pondName,
      cover: `/pond-${o.pondSlug}-1.jpg`,
      location: '',
      rating: 0,
    }
  const created = o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt)
  const ymd = Number.isNaN(created.getTime())
    ? '20250101'
    : created.toISOString().slice(0, 10).replaceAll('-', '')
  const status: OrderStatus = o.status === 'pending' ? 'pending' : o.status === 'used' ? 'used' : 'done'
  return {
    id: String(o.id),
    orderNo: `QY${ymd}${String(o.id).padStart(4, '0')}`,
    pond,
    ticketName: o.ticketName,
    qty: o.quantity,
    seatNo: o.seatNos[0] ?? null,
    dateLabel: `${o.visitDate.replaceAll('-', '.')} · ${o.ticketName}`,
    dateShort: o.visitDate.slice(5).replace('-', '.'),
    amount: o.totalAmount,
    status,
    verifyCode: o.verifyCode,
  }
}
