import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Megaphone, Navigation, Star } from 'lucide-react'
import { getPond } from '@/data/spots'
import type { Seat, TicketType } from '@/data/spots'
import PageHeader from '@/components/spots/PageHeader'
import Gallery from '@/components/spots/Gallery'
import SeatPicker from '@/components/spots/SeatPicker'
import TicketList from '@/components/spots/TicketList'
import ReviewList from '@/components/spots/ReviewList'
import ShareSheet from '@/components/spots/ShareSheet'
import DateSheet from '@/components/spots/DateSheet'
import FishChip from '@/components/spots/FishChip'
import { Toast, useToast } from '@/components/spots/Toast'
import { trpc } from '@/providers/trpc'
import { mapPondDetail } from '@/lib/live'

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

/** 收藏 / 订阅鱼讯：localStorage 持久化（按 pond slug 存取） */
const FAV_KEY = 'qy-fav-ponds'
const SUB_KEY = 'qy-news-subs'
function readSlugList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function toggleSlugInList(key: string, slug: string, on: boolean): void {
  try {
    const list = readSlugList(key)
    const next = on ? [...new Set([...list, slug])] : list.filter((x) => x !== slug)
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    /* 存储不可用时保持内存态 */
  }
}

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

  const [collected, setCollected] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [seatNo, setSeatNo] = useState(0)
  const [ticketId, setTicketId] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const { message, show } = useToast()

  // 数据就绪后初始化默认钓位与票种
  useEffect(() => {
    if (!pond) return
    setSeatNo((s) => (s ? s : pond.defaultSeat))
    setTicketId((t) => (t ? t : (pond.tickets[0]?.id ?? '')))
  }, [pond])

  // 挂载时从 localStorage 还原收藏 / 订阅状态（按 pond slug）
  useEffect(() => {
    if (!pond) return
    setCollected(readSlugList(FAV_KEY).includes(pond.id))
    setSubscribed(readSlugList(SUB_KEY).includes(pond.id))
  }, [pond?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
        onCollect={() => {
          setCollected((v) => {
            const next = !v
            toggleSlugInList(FAV_KEY, pond.id, next)
            if (next) show('已收藏该钓点')
            return next
          })
        }}
      />

      {/* Section 2 — 塘名信息区 */}
      <section className="px-4 pb-4">
        <motion.div {...infoStagger(0)} className="flex items-start justify-between gap-2">
          <h1 className="text-[28px] font-bold leading-[34px] text-ink">{pond.name}</h1>
          <span className="mt-1.5 flex shrink-0 items-center gap-1.5 rounded-full bg-lake-tint px-2.5 py-1 text-[12px] leading-4 text-lake">
            <motion.span
              animate={{ scale: [1, 1.4, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="h-1.5 w-1.5 rounded-full bg-lake"
            />
            营业中
          </span>
        </motion.div>

        <motion.div {...infoStagger(1)} className="mt-2 flex items-center gap-2">
          <RatingStars rating={pond.rating} />
          <span className="font-num text-[20px] leading-6 text-ink">{pond.rating}</span>
          <span className="text-[13px] leading-[18px] text-ink-60">· {pond.reviewCount} 条评价</span>
        </motion.div>

        <motion.div {...infoStagger(2)} className="mt-1.5 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[13px] leading-[18px] text-ink-60">{pond.address}</p>
          <button
            type="button"
            onClick={() => show('已打开模拟导航')}
            className="flex shrink-0 items-center gap-1 text-[15px] font-semibold leading-[22px] text-olive"
          >
            <Navigation size={15} strokeWidth={1.8} />
            导航
          </button>
        </motion.div>

        <motion.div {...infoStagger(3)} className="no-scrollbar -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4">
          {pond.tags.map((t) => (
            <FishChip key={t} label={t} plain={!/鱼|鲫|鲤|鳊|鲈|鳜|翘嘴|青鱼|草鱼/.test(t)} />
          ))}
          {pond.categories.includes('night') && <FishChip label="可夜钓" plain />}
          <FishChip label="免费停车" plain />
          <FishChip label="可租竿" plain />
        </motion.div>
      </section>

      {/* Section 3 — 实时鱼讯卡 */}
      <motion.section
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="mx-4 mb-4 rounded-2xl bg-lake-tint p-3.5"
      >
        <div className="flex items-start gap-2.5">
          <motion.span
            animate={{ rotate: [-8, 8, -8] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="mt-0.5 shrink-0 text-lake"
          >
            <Megaphone size={20} strokeWidth={1.8} />
          </motion.span>
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
            onClick={() => {
              setSubscribed((v) => {
                const next = !v
                toggleSlugInList(SUB_KEY, pond.id, next)
                if (next) show('已订阅该塘鱼讯')
                return next
              })
            }}
            className="shrink-0 text-[15px] font-semibold leading-[22px] text-lake"
          >
            {subscribed ? '已订阅 ✓' : '订阅鱼讯'}
          </button>
        </div>
      </motion.section>

      {/* Section 4 — 钓场介绍（3 行折叠） */}
      <section className="mx-4 mb-6">
        <h2 className="mb-2 text-[18px] font-semibold leading-6 text-ink">钓场介绍</h2>
        <motion.p
          animate={{ maxHeight: expanded ? 400 : 66 }}
          initial={false}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="max-w-[34em] overflow-hidden text-[15px] leading-[22px] text-ink"
        >
          {pond.intro}
        </motion.p>
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

      {/* Section 6 — 钓友评价 */}
      <ReviewList reviews={pond.reviews} total={pond.reviewCount} />

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
      <motion.div
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
                    <motion.span
                      key={ticket.price}
                      initial={{ y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -10, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="font-num text-[32px] leading-9 text-clay"
                    >
                      ¥{ticket.price}
                    </motion.span>
                  </AnimatePresence>
                  <span className="text-[12px] leading-4 text-ink-40">起</span>
                </p>
                <p className="text-[12px] leading-4 text-ink-60">已选：{ticket.name}</p>
              </>
            ) : (
              <p className="text-[15px] font-semibold leading-[22px] text-ink-60">暂无可售门票</p>
            )}
          </div>
          <motion.button
            type="button"
            whileTap={ticket ? { scale: 0.95 } : undefined}
            disabled={!ticket}
            onClick={() => ticket && goCheckout(localDateKey(new Date()))}
            className="h-12 w-[180px] rounded-xl bg-olive text-[15px] font-semibold text-paper-white disabled:bg-olive/40"
          >
            {ticket ? '立即购票' : '暂不可购'}
          </motion.button>
        </div>
      </motion.div>

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
    </div>
  )
}
