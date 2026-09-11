/**
 * 后端 tRPC 数据 → 前端展示模型的映射工具。
 * 约定：superjson 反序列化后 Date 为 Date 对象；decimal 字段为 string；JSON 字段已是数组。
 */
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../api/router'
import type { FeedPost, FeedComment } from '@/data/home'
import type { Pond, Seat, TicketType, PondReview } from '@/data/spots'
import { PONDS as TRADE_PONDS } from '@/data/orders'
import type { Order, OrderStatus } from '@/data/orders'

type RouterOutput = inferRouterOutputs<AppRouter>

export type FeedItem = RouterOutput['app']['feed']['items'][number]
export type PondListItem = RouterOutput['app']['ponds']['list'][number]
export type PondDetailData = NonNullable<RouterOutput['app']['ponds']['detail']>
export type NewsItem = RouterOutput['app']['ponds']['news'][number]
export type MyOrder = RouterOutput['app']['orders']['mine'][number]
export type OwnerStats = RouterOutput['app']['orders']['ownerStats']
export type ProductItem = RouterOutput['app']['products']['list'][number]
export type CommentItem = RouterOutput['app']['posts']['comments'][number]

/** 相对时间（与 mock 文案风格一致：「2 小时前」） */
export function relativeTime(d: Date | string): string {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  if (Number.isNaN(t)) return '刚刚'
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

/** 信息流帖子 → FeedPost 展示模型 */
export function mapFeedPost(
  p: FeedItem,
  meta: Record<string, { name: string; price: number }>,
): FeedPost {
  const spot = p.pondSlug
    ? {
        id: p.pondSlug,
        name: meta[p.pondSlug]?.name ?? pondName(p.pondSlug) ?? p.pondSlug,
        price: meta[p.pondSlug]?.price ?? 68,
      }
    : undefined
  return {
    id: String(p.id),
    author: p.authorName,
    avatar: p.authorAvatar,
    time: relativeTime(p.createdAt),
    location: spot?.name,
    images: p.images,
    caption: p.content,
    likes: p.likeCount,
    commentCount: p.commentCount,
    comments: [],
    spot,
  }
}

/** 评论 → 展示模型（评论表无头像字段，按 userId 取预置头像） */
export function mapComment(c: CommentItem): FeedComment {
  const avatarIdx = ((Number(c.userId ?? 1) + Number(c.id)) % 7) + 1
  return {
    id: String(c.id),
    name: c.authorName,
    avatar: `/avatar-${avatarIdx}.png`,
    text: c.content,
    likes: 0,
    time: relativeTime(c.createdAt),
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
