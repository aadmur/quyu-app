import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Megaphone, Navigation, Star } from 'lucide-react'
import { getPond } from '@/data/spots'
import type { PondReview, Seat, TicketType } from '@/data/spots'
import PageHeader from '@/components/spots/PageHeader'
import Gallery from '@/components/spots/Gallery'
import SeatPicker from '@/components/spots/SeatPicker'
import TicketList from '@/components/spots/TicketList'
import ReviewList from '@/components/spots/ReviewList'
import ShareSheet from '@/components/spots/ShareSheet'
import DateSheet from '@/components/spots/DateSheet'
import FishChip from '@/components/spots/FishChip'
import { Toast } from '@/components/spots/Toast'
import { useToast } from '@/components/spots/useToast'
import { trpc } from '@/providers/trpc'
import { mapPondDetail, relativeTime } from '@/lib/live'
import { usePondMarks } from '@/hooks/usePondMarks'

const infoStagger = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: 'easeOut' as const, delay: 0.1 + i * 0.07 },
})

/** 本地时区格式化 yyyy-MM-dd（不用 toISOString，避免 UTC 导致日期前一天） */
function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 收藏 / 订阅鱼讯：走后端 ponds.myMarks / ponds.toggleMark（见 hooks/usePondMarks） */

/** 评分星：前 floor 颗实心 + 最后一颗按小数部分裁剪实心 */
function RatingStars({ rating }: { rating: number }) {
  const full = Math.floor(rating)
  const frac = rating - full
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: full }, (_, i) => (
        <Star key={i} size={16} strokeWidth={0} className="fill-olive text-olive" />
      ))}
      {frac > 0 && (
        <span className="relative inline-flex">
          <Star size={16} strokeWidth={0} className="fill-[#2d1e1e1f] text-[#2d1e1e1f]" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${frac * 100}%` }}>
            <Star size={16} strokeWidth={0} className="fill-olive text-olive" />
          </span>
        </span>
      )}
    </span>
  )
}

/** 后端评价行（reviews 表 $inferSelect 的展示子集） */
interface PondReviewItem {
  id: number
  authorName: string
  authorAvatar: string
  rating: number
  content: string | null
  tags: string[]
  images: string[]
  createdAt: string | Date
}

const REVIEW_PAGE_SIZE = 10

/**
 * 钓友评价区块（QY-B-002）：评分分布条（5~1 星占比）+ 分页评价卡片 + 加载更多。
 * 数据走 trpc.app.ponds.reviews（{ slug, page, pageSize }）；接口未接线/请求失败时
 * 回退详情接口自带的预览评价（ReviewList），保证页面始终可用。
 */
function PondReviewSection({
  slug,
  fallbackReviews,
  fallbackTotal,
}: {
  slug: string
  fallbackReviews: PondReview[]
  fallbackTotal: number
}) {
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<PondReviewItem[]>([])

  const reviewsQuery = trpc.app.ponds.reviews.useQuery(
    { slug, page, pageSize: REVIEW_PAGE_SIZE },
    { enabled: !!slug, retry: 1 },
  )
  const data = reviewsQuery.data
  // 分页累计：page 1 整体替换，后续页按 id 去重追加。
  // 采用 React 官方的「渲染期按数据变化调整 state」写法，替代 effect 内 setState（后者会级联渲染）。
  const [prevData, setPrevData] = useState(data)
  if (data !== prevData) {
    setPrevData(data)
    if (data) {
      setItems((prev) => {
        if (page === 1) return data.items as PondReviewItem[]
        const seen = new Set(prev.map((r) => r.id))
        const more = (data.items as PondReviewItem[]).filter((r) => !seen.has(r.id))
        return [...prev, ...more]
      })
    }
  }

  // 接口未就绪或失败：回退详情页预览评价
  if (reviewsQuery.isError) {
    return <ReviewList reviews={fallbackReviews} total={fallbackTotal} />
  }

  const stats = data?.stats

  return (
    <section className="mx-4 mb-6">
      <h2 className="mb-2 text-[18px] font-semibold leading-6 text-ink">
        钓友评价 {stats ? <span className="font-num text-[20px]">{stats.count}</span> : null}
      </h2>

      {/* 评分分布条（5~1 星横向占比） */}
      {stats && stats.count > 0 && (
        <div className="mb-3 flex items-center gap-4 rounded-xl border border-line bg-paper-white p-3.5">
          <div className="flex shrink-0 flex-col items-center">
            <span className="font-num text-[32px] leading-9 text-ink">{stats.avgRating.toFixed(1)}</span>
            <RatingStars rating={stats.avgRating} />
            <span className="mt-1 text-[12px] leading-4 text-ink-60">共 {stats.count} 条</span>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            {([5, 4, 3, 2, 1] as const).map((s, i) => {
              const n = stats.dist[s] ?? 0
              const pct = stats.count > 0 ? n / stats.count : 0
              return (
                <div key={s} className="flex items-center gap-2">
                  <span className="flex w-8 shrink-0 items-center gap-0.5 text-[12px] leading-4 text-ink-60">
                    {s}
                    <Star size={10} strokeWidth={0} className="fill-olive text-olive" />
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#2d1e1e0d]">
                    <m.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: pct }}
                      transition={{ delay: i * 0.06, duration: 0.5, ease: 'easeOut' }}
                      style={{ transformOrigin: 'left' }}
                      className="h-full rounded-full bg-olive"
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right font-num text-[12px] leading-4 text-ink-60">{n}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 首屏加载骨架 */}
      {reviewsQuery.isLoading && (
        <div className="flex flex-col gap-2.5">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-paper" />
          ))}
        </div>
      )}

      {/* 空态 */}
      {data && stats?.count === 0 && (
        <p className="rounded-xl border border-line bg-paper-white p-4 text-center text-[13px] leading-[18px] text-ink-60">
          还没有评价，核销门票后第一个来评
        </p>
      )}

      {/* 评价卡片列表 */}
      <div className="flex flex-col gap-2.5">
        {items.map((r) => (
          <m.div
            key={r.id}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="rounded-xl border border-line bg-paper-white p-3"
          >
            <div className="flex items-center gap-2">
              <img src={r.authorAvatar} alt={r.authorName} className="h-8 w-8 rounded-full bg-paper object-cover" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[18px] text-ink">
                {r.authorName}
              </span>
              <span className="flex shrink-0 gap-0.5">
                {Array.from({ length: 5 }, (_, s) => (
                  <Star
                    key={s}
                    size={13}
                    strokeWidth={0}
                    className={s < r.rating ? 'fill-olive text-olive' : 'fill-[#2d1e1e1f] text-[#2d1e1e1f]'}
                  />
                ))}
              </span>
            </div>
            {(r.tags ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(r.tags ?? []).map((t) => (
                  <span key={t} className="rounded-full bg-lake-tint px-2 py-0.5 text-[12px] leading-4 text-lake">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {r.content && <p className="mt-2 text-[15px] leading-[22px] text-ink">{r.content}</p>}
            {(r.images ?? []).length > 0 && (
              <div className={`mt-2 grid gap-1.5 ${(r.images ?? []).length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
                {(r.images ?? []).slice(0, 9).map((img, idx) => (
                  <img
                    key={idx}
                    src={img}
                    alt="评价晒图"
                    loading="lazy"
                    className={`rounded-lg bg-paper object-cover ${
                      (r.images ?? []).length === 1 ? 'max-h-48 w-full' : 'aspect-square w-full'
                    }`}
                  />
                ))}
              </div>
            )}
            <p className="mt-2 text-right text-[12px] leading-4 text-ink-40">{relativeTime(r.createdAt)}</p>
          </m.div>
        ))}
      </div>

      {/* 加载更多 */}
      {data?.hasMore && (
        <button
          type="button"
          disabled={reviewsQuery.isFetching}
          onClick={() => setPage((p) => p + 1)}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-xl border border-line bg-paper-white text-[14px] font-semibold leading-5 text-olive disabled:opacity-60"
        >
          {reviewsQuery.isFetching ? '加载中…' : '加载更多'}
        </button>
      )}
    </section>
  )
}

/** 鱼塘详情页 /pond/:id：沉浸相册 + 鱼讯 + 介绍 + 在线选钓位 + 评价 + 票种 + 吸底购票栏 */
export default function PondDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // 真实数据：ponds.detail（路由 id 即 slug）；异常时回退 mock
  const detailQuery = trpc.app.ponds.detail.useQuery(
    { slug: id ?? '' },
    { enabled: !!id, retry: 1 },
  )
  const pond = useMemo(() => {
    if (detailQuery.data) return mapPondDetail(detailQuery.data)
    if (detailQuery.isLoading) return undefined
    return getPond(id)
  }, [detailQuery.data, detailQuery.isLoading, id])
  const loading = detailQuery.isLoading

  const [expanded, setExpanded] = useState(false)
  const [seatNo, setSeatNo] = useState(0)
  const [ticketId, setTicketId] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const { message, show } = useToast()
  // 收藏 / 订阅鱼讯：后端化标记（乐观更新 + 未登录弹登录层）
  const { isFav, isSubscribed, toggleFav, toggleNews, loginSheet } = usePondMarks({ onToast: show })
  const collected = pond ? isFav(pond.id) : false
  const subscribed = pond ? isSubscribed(pond.id) : false

  // 数据就绪后初始化默认钓位与票种
  useEffect(() => {
    if (!pond) return
    setSeatNo((s) => (s ? s : pond.defaultSeat))
    setTicketId((t) => (t ? t : (pond.tickets[0]?.id ?? '')))
  }, [pond])

  // 从钓点页「立即购票」进入时自动弹出选日期弹层
  useEffect(() => {
    if ((location.state as { openDateSheet?: boolean } | null)?.openDateSheet) {
      setDateOpen(true)
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="aspect-[4/3] w-full bg-paper" />
        <div className="space-y-3 px-4 pt-4">
          <div className="h-7 w-56 rounded bg-paper" />
          <div className="h-4 w-32 rounded bg-paper" />
          <div className="h-4 w-48 rounded bg-paper" />
          <div className="h-24 rounded-2xl bg-paper" />
          <div className="h-40 rounded-2xl bg-paper" />
        </div>
      </div>
    )
  }

  if (!pond) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-8 text-center">
        <img src="/empty-creel.svg" alt="空鱼护" className="h-32 w-40 opacity-80" />
        <p className="text-[15px] leading-[22px] text-ink-60">没有找到这个钓场，可能已下线</p>
        <button
          type="button"
          onClick={() => navigate('/spots')}
          className="mt-2 h-12 rounded-xl bg-olive px-6 text-[15px] font-semibold text-paper-white"
        >
          返回钓点列表
        </button>
      </div>
    )
  }

  const ticket = pond.tickets.find((t) => t.id === ticketId) ?? pond.tickets[0]

  const onSelectSeat = (s: Seat) => setSeatNo(s.no)
  const onSelectTicket = (t: TicketType) => setTicketId(t.id)
  // 购票跳转：携带真实票种 / 钓位 / 到访日期（yyyy-MM-dd）
  const goCheckout = (visitDate: string) =>
    navigate('/checkout', { state: { pondSlug: pond.id, ticketId, seatNo, visitDate } })

  return (
    <div className="relative">
      {/* Section 1 — 沉浸式相册 + 悬浮 PageHeader */}
      <Gallery images={pond.album} name={pond.name} />
      <PageHeader
        immersive
        title={pond.name}
        collected={collected}
        onShare={() => setShareOpen(true)}
        onCollect={() => toggleFav(pond.id)}
      />

      {/* Section 2 — 塘名信息区 */}
      <section className="px-4 pb-4">
        <m.div {...infoStagger(0)} className="flex items-start justify-between gap-2">
          <h1 className="text-[28px] font-bold leading-[34px] text-ink">{pond.name}</h1>
          <span className="mt-1.5 flex shrink-0 items-center gap-1.5 rounded-full bg-lake-tint px-2.5 py-1 text-[12px] leading-4 text-lake">
            <m.span
              animate={{ scale: [1, 1.4, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="h-1.5 w-1.5 rounded-full bg-lake"
            />
            营业中
          </span>
        </m.div>

        <m.div {...infoStagger(1)} className="mt-2 flex items-center gap-2">
          <RatingStars rating={pond.rating} />
          <span className="font-num text-[20px] leading-6 text-ink">{pond.rating}</span>
          <span className="text-[13px] leading-[18px] text-ink-60">· {pond.reviewCount} 条评价</span>
        </m.div>

        <m.div {...infoStagger(2)} className="mt-1.5 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[13px] leading-[18px] text-ink-60">{pond.address}</p>
          <button
            type="button"
            onClick={() => show('已打开模拟导航')}
            className="flex shrink-0 items-center gap-1 text-[15px] font-semibold leading-[22px] text-olive"
          >
            <Navigation size={15} strokeWidth={1.8} />
            导航
          </button>
        </m.div>

        <m.div {...infoStagger(3)} className="no-scrollbar -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4">
          {pond.tags.map((t) => (
            <FishChip key={t} label={t} plain={!/鱼|鲫|鲤|鳊|鲈|鳜|翘嘴|青鱼|草鱼/.test(t)} />
          ))}
          {pond.categories.includes('night') && <FishChip label="可夜钓" plain />}
          <FishChip label="免费停车" plain />
          <FishChip label="可租竿" plain />
        </m.div>
      </section>

      {/* Section 3 — 实时鱼讯卡 */}
      <m.section
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="mx-4 mb-4 rounded-2xl bg-lake-tint p-3.5"
      >
        <div className="flex items-start gap-2.5">
          <m.span
            animate={{ rotate: [-8, 8, -8] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="mt-0.5 shrink-0 text-lake"
          >
            <Megaphone size={20} strokeWidth={1.8} />
          </m.span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <img src={pond.news.ownerAvatar} alt={pond.news.owner} className="h-8 w-8 rounded-full bg-paper object-cover" />
              <p className="text-[13px] font-semibold leading-[18px] text-ink">塘主 · {pond.news.owner}</p>
            </div>
            <p className="mt-1.5 text-[15px] leading-[22px] text-ink">{pond.news.text}</p>
            <p className="mt-1 text-[12px] leading-4 text-ink-40">{pond.news.time}</p>
          </div>
          <button
            type="button"
            onClick={() => toggleNews(pond.id)}
            className="shrink-0 text-[15px] font-semibold leading-[22px] text-lake"
          >
            {subscribed ? '已订阅 ✓' : '订阅鱼讯'}
          </button>
        </div>
      </m.section>

      {/* Section 4 — 钓场介绍（3 行折叠） */}
      <section className="mx-4 mb-6">
        <h2 className="mb-2 text-[18px] font-semibold leading-6 text-ink">钓场介绍</h2>
        <m.p
          animate={{ maxHeight: expanded ? 400 : 66 }}
          initial={false}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="max-w-[34em] overflow-hidden text-[15px] leading-[22px] text-ink"
        >
          {pond.intro}
        </m.p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[15px] font-semibold leading-[22px] text-olive"
        >
          {expanded ? '收起' : '展开'}
        </button>
      </section>

      {/* Section 5 — 在线选钓位 */}
      <SeatPicker seats={pond.seats} selected={seatNo} onSelect={onSelectSeat} />

      {/* Section 6 — 钓友评价（QY-B-002：评分分布条 + 分页列表，失败回退预览）
          key=slug：切换钓场时整块重挂载，分页与累计列表自动重置（避免 effect 内 setState） */}
      <PondReviewSection
        key={pond.id}
        slug={pond.id}
        fallbackReviews={pond.reviews}
        fallbackTotal={pond.reviewCount}
      />

      {/* Section 7 — 票种列表 */}
      {ticket ? (
        <TicketList tickets={pond.tickets} selectedId={ticket.id} onSelect={onSelectTicket} />
      ) : (
        <section className="mx-4 mb-6">
          <h2 className="mb-2 text-[18px] font-semibold leading-6 text-ink">门票</h2>
          <p className="rounded-xl border border-line bg-paper-white p-4 text-center text-[13px] leading-[18px] text-ink-60">
            暂无可售门票，请稍后再来看看
          </p>
        </section>
      )}

      {/* Section 8 — 吸底购票栏 */}
      <m.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 300, delay: 0.4 }}
        className="sticky bottom-0 z-40 border-t border-line bg-paper-white shadow-[0_-8px_24px_rgba(45,30,30,0.12)]"
        style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 12px)' }}
      >
        <div className="flex h-[72px] items-center justify-between px-4">
          <div>
            {ticket ? (
              <>
                <p className="flex items-baseline gap-1">
                  <AnimatePresence mode="popLayout">
                    <m.span
                      key={ticket.price}
                      initial={{ y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -10, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="font-num text-[32px] leading-9 text-clay"
                    >
                      ¥{ticket.price}
                    </m.span>
                  </AnimatePresence>
                  <span className="text-[12px] leading-4 text-ink-40">起</span>
                </p>
                <p className="text-[12px] leading-4 text-ink-60">已选：{ticket.name}</p>
              </>
            ) : (
              <p className="text-[15px] font-semibold leading-[22px] text-ink-60">暂无可售门票</p>
            )}
          </div>
          <m.button
            type="button"
            whileTap={ticket ? { scale: 0.95 } : undefined}
            disabled={!ticket}
            onClick={() => ticket && goCheckout(localDateKey(new Date()))}
            className="h-12 w-[180px] rounded-xl bg-olive text-[15px] font-semibold text-paper-white disabled:bg-olive/40"
          >
            {ticket ? '立即购票' : '暂不可购'}
          </m.button>
        </div>
      </m.div>

      {/* 弹层与 toast */}
      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} onAction={show} />
      <DateSheet
        open={dateOpen}
        pondName={pond.name}
        onClose={() => setDateOpen(false)}
        onConfirm={(dateKey) => {
          setDateOpen(false)
          goCheckout(dateKey)
        }}
      />
      <Toast message={message} />
      {loginSheet}
    </div>
  )
}
