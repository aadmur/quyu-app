import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search } from 'lucide-react'
import { NEWS_FLASH, PONDS } from '@/data/spots'
import NewsTicker from '@/components/spots/NewsTicker'
import PondCard from '@/components/spots/PondCard'
import { trpc } from '@/providers/trpc'
import { mapPondListItem, relativeTime } from '@/lib/live'

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'near', label: '距离最近' },
  { key: 'top', label: '评分最高' },
  { key: 'night', label: '可夜钓' },
  { key: 'jintang', label: '斤塘' },
  { key: 'lure', label: '路亚' },
  { key: 'stocking', label: '有放鱼' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

const stagger = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: 'easeOut' as const, delay: i * 0.06 },
})

/** 钓点页 /spots：搜索 + 筛选胶囊 + 鱼讯快报 + 钓场大卡列表（购票链路入口） */
export default function Spots() {
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [focused, setFocused] = useState(false)

  // 真实数据：钓场列表 + 鱼讯快报；接口异常回退 mock
  const pondsQuery = trpc.app.ponds.list.useQuery(undefined, { retry: 1 })
  const newsQuery = trpc.app.ponds.news.useQuery(undefined, { retry: 1 })

  const newsItems = useMemo(() => {
    if (!newsQuery.data) return NEWS_FLASH
    return newsQuery.data.map((n) => ({
      id: String(n.id),
      pondId: n.pondSlug,
      pondName: n.pondName,
      text: n.content,
      time: relativeTime(n.createdAt),
    }))
  }, [newsQuery.data])

  const latestNewsBySlug = useMemo(() => {
    const m = new Map<string, string>()
    for (const n of newsQuery.data ?? []) {
      if (!m.has(n.pondSlug)) m.set(n.pondSlug, n.content)
    }
    return m
  }, [newsQuery.data])

  const loading = pondsQuery.isLoading && !pondsQuery.error

  const sourcePonds = useMemo(() => {
    if (loading) return []
    if (!pondsQuery.data) return PONDS
    return pondsQuery.data.map((p) => mapPondListItem(p, latestNewsBySlug.get(p.slug)))
  }, [loading, pondsQuery.data, latestNewsBySlug])

  const ponds = useMemo(() => {
    const kw = keyword.trim()
    let list = sourcePonds.filter(
      (p) => !kw || p.name.includes(kw) || p.tags.some((t) => t.includes(kw)) || p.region.includes(kw),
    )
    switch (filter) {
      case 'near':
        list = [...list].sort((a, b) => a.distanceKm - b.distanceKm)
        break
      case 'top':
        list = [...list].sort((a, b) => b.rating - a.rating)
        break
      case 'night':
      case 'jintang':
      case 'lure':
      case 'stocking':
        list = list.filter((p) => p.categories.includes(filter))
        break
    }
    return list
  }, [keyword, filter, sourcePonds])

  return (
    <div className="pb-2">
      {/* Section 1 — 头部区 */}
      <header className="px-4 pt-2">
        <motion.div {...stagger(0)}>
          <h1 className="text-[22px] font-bold leading-7 text-ink">找钓点</h1>
          <p className="mt-0.5 text-[13px] leading-[18px] text-ink-60">武汉 · 周边 50km 内 27 家钓场</p>
        </motion.div>

        {/* 搜索框 */}
        <motion.label
          {...stagger(1)}
          className="mt-3 flex h-11 items-center gap-2 rounded-xl border bg-paper-white px-3 transition-colors duration-200"
          style={{ borderColor: focused ? '#716a4b' : '#2d1e1e14' }}
        >
          <Search size={20} strokeWidth={1.8} className="shrink-0 text-ink-40" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="搜钓场、鱼种、钓法"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-40"
          />
        </motion.label>

        {/* 筛选胶囊横滑 */}
        <motion.div {...stagger(2)} className="no-scrollbar -mx-4 mt-3 flex h-10 gap-2 overflow-x-auto px-4">
          {FILTERS.map((f) => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`relative h-9 shrink-0 rounded-full px-4 text-[13px] leading-none ${
                  active ? 'text-paper-white' : 'border border-line bg-paper-white text-ink-60'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="spots-filter-pill"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="absolute inset-0 rounded-full bg-olive"
                  />
                )}
                <span className="relative z-10">{f.label}</span>
              </button>
            )
          })}
        </motion.div>
      </header>

      {/* Section 2 — 鱼讯快报条 */}
      <NewsTicker items={newsItems} />

      {/* Section 3 — 钓场大卡列表 */}
      <div>
        {loading && (
          <div className="mx-4 mb-5 animate-pulse overflow-hidden rounded-2xl border border-line bg-paper-white">
            <div className="aspect-[3/2] w-full bg-paper" />
            <div className="space-y-2 px-3.5 py-3">
              <div className="h-4 w-40 rounded bg-paper" />
              <div className="h-3 w-56 rounded bg-paper" />
            </div>
          </div>
        )}
        <AnimatePresence mode="popLayout">
          {ponds.map((p, i) => (
            <PondCard key={p.id} pond={p} index={i} />
          ))}
        </AnimatePresence>

        {!loading && ponds.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="flex flex-col items-center px-8 py-10 text-center"
          >
            <img src="/empty-creel.svg" alt="空鱼护" className="h-32 w-40 opacity-80" />
            <p className="mt-4 text-[15px] leading-[22px] text-ink-60">
              附近还没有这个钓场，换个关键词试试
            </p>
            <button
              type="button"
              onClick={() => {
                setKeyword('')
                setFilter('all')
              }}
              className="mt-4 h-12 rounded-xl bg-olive px-6 text-[15px] font-semibold text-paper-white"
            >
              看看全部钓场
            </button>
          </motion.div>
        )}
      </div>

      {/* Section 4 — 列表尽头 */}
      {ponds.length > 0 && (
        <p className="pb-12 pt-1 text-center text-[12px] leading-4 text-ink-40">
          已展示周边全部 {ponds.length} 家钓场 · 更多城市即将开通
        </p>
      )}
    </div>
  )
}
