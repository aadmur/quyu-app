import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import Lenis from 'lenis'
import StoryBar from '@/components/home/StoryBar'
import FeedPost from '@/components/home/FeedPost'
import FishIcon from '@/components/FishIcon'
import { FEED_POSTS } from '@/data/home'
import type { FeedPost as FeedPostData } from '@/data/home'
import { PONDS as MOCK_PONDS } from '@/data/spots'
import { trpc } from '@/providers/trpc'
import { mapFeedPost } from '@/lib/live'

/** 真实帖子附带后端数值 id（用于点赞/评论/曝光埋点） */
type FeedPostWithId = FeedPostData & { postId?: number }

/** 洗牌拷贝（mock 填充刷新时重排静态数据） */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

/** 首页 · 社区信息流：TopBar + Story 圈 + 渔获大图信息流（双击点赞/评论弹层/无限滚动/下拉刷新）
 *  数据源：trpc.app.feed 推荐算法分页；接口异常时保留已加载真实帖在前、本地 mock 仅作补充填充 */
export default function Home() {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const [extraPosts, setExtraPosts] = useState<FeedPostData[]>([])
  const [round, setRound] = useState(0)
  const [toast, setToast] = useState(false)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchStartY = useRef<number | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  // ---- 真实推荐信息流：useQuery + page state 累积分页 ----
  const PAGE_SIZE = 5
  const [page, setPage] = useState(1)
  const [livePosts, setLivePosts] = useState<FeedPostWithId[]>([])
  const [hasMore, setHasMore] = useState(true)
  // 接口异常 → mock 填充模式（真实帖保留在前；不阻断后续重试，下拉刷新成功后回到纯 live）
  const [mockFallback, setMockFallback] = useState(false)
  const [mockPosts, setMockPosts] = useState<FeedPostData[]>(FEED_POSTS)
  // 下拉刷新标记：下一次成功响应整表替换（等价清空已加载列表与 seen 去重集合）
  const resetRef = useRef(false)
  // 网络异常提示（节流，避免自动重试连发）
  const [netToast, setNetToast] = useState('')
  const netToastTimer = useRef<number | undefined>(undefined)
  const netToastAt = useRef(0)

  const showNetToast = useCallback((text: string) => {
    setNetToast(text)
    window.clearTimeout(netToastTimer.current)
    netToastTimer.current = window.setTimeout(() => setNetToast(''), 2200)
  }, [])

  const pondsQuery = trpc.app.ponds.list.useQuery(undefined, { retry: 1 })
  const pondMeta = useMemo(() => {
    const meta: Record<string, { name: string; price: number }> = {}
    for (const p of pondsQuery.data ?? MOCK_PONDS) {
      const slug = 'slug' in p ? p.slug : p.id
      meta[slug] = { name: p.name, price: 'priceFrom' in p ? p.priceFrom : 68 }
    }
    return meta
  }, [pondsQuery.data])

  const feedQuery = trpc.app.feed.useQuery(
    { page, pageSize: PAGE_SIZE },
    { retry: 1 },
  )

  useEffect(() => {
    const data = feedQuery.data
    if (!data) return
    const mapped = data.items.map((p) => ({ ...mapFeedPost(p, pondMeta), postId: p.id }))
    if (resetRef.current) {
      // 下拉刷新后的首个成功响应：整表替换，回到纯 live
      resetRef.current = false
      setMockFallback(false)
      setLivePosts(mapped)
    } else {
      setLivePosts((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        const fresh = mapped.filter((p) => !seen.has(p.id))
        return fresh.length > 0 ? [...prev, ...fresh] : prev
      })
    }
    setHasMore(data.hasMore)
  }, [feedQuery.data, feedQuery.dataUpdatedAt, pondMeta])

  useEffect(() => {
    if (!feedQuery.error) return
    // 失败：toast 提示并保留已加载真实帖，mock 仅作补充填充；useQuery 保持 enabled，不阻断重试
    resetRef.current = false
    setMockFallback(true)
    const now = Date.now()
    if (now - netToastAt.current > 3500) {
      netToastAt.current = now
      showNetToast('网络异常，展示本地内容')
    }
  }, [feedQuery.error, showNetToast])

  const liveLoading = !mockFallback && livePosts.length === 0 && feedQuery.isLoading

  const MAX_ROUNDS = 2

  // Lenis 丝滑滚动（仅首页信息流启用，作用于手机壳内容区）
  useEffect(() => {
    const wrapper = document.getElementById('app-scroll')
    if (!wrapper || !rootRef.current) return
    const lenis = new Lenis({ wrapper, content: rootRef.current, lerp: 0.12 })
    let raf = 0
    const loop = (time: number) => {
      lenis.raf(time)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      lenis.destroy()
    }
  }, [])

  // 无限滚动：哨兵进入视口时加载更多（真实流翻页 / mock 填充克隆新帖入场）
  useEffect(() => {
    const root = document.getElementById('app-scroll')
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return
    const ob = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        if (!mockFallback) {
          if (hasMore && !feedQuery.isFetching) setPage((p) => p + 1)
          return
        }
        if (round >= MAX_ROUNDS) return
        const next = round + 1
        const cloned = mockPosts.slice(0, 3).map((p, i) => ({
          ...p,
          id: `${p.id}-r${next}-${i}`,
        }))
        setExtraPosts((prev) => [...prev, ...cloned])
        setRound(next)
      },
      { root, rootMargin: '300px' },
    )
    ob.observe(sentinel)
    return () => ob.disconnect()
  }, [round, mockFallback, hasMore, feedQuery.isFetching, mockPosts])

  const showToast = useCallback(() => {
    setToast(true)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(false), 2000)
  }, [])

  // 下拉刷新：顶部出现鱼形 loading，松手后重置分页与列表、重新拉取第 1 页
  const onTouchStart = (e: React.TouchEvent) => {
    const scroller = document.getElementById('app-scroll')
    if (scroller && scroller.scrollTop <= 0 && !refreshing) {
      touchStartY.current = e.touches[0].clientY
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) setPull(Math.min(dy * 0.45, 96))
  }
  const onTouchEnd = () => {
    if (touchStartY.current === null) return
    touchStartY.current = null
    if (pull > 64) {
      setRefreshing(true)
      setPull(64)
      // 真刷新：重置分页/整表替换（seen 随之清空）；mock 侧重排静态数据并清空克隆帖
      resetRef.current = true
      setHasMore(true)
      setExtraPosts([])
      setRound(0)
      setMockPosts(shuffle(FEED_POSTS))
      window.setTimeout(() => {
        setRefreshing(false)
        setPull(0)
        if (page !== 1) setPage(1)
        else feedQuery.refetch()
      }, 800)
    } else {
      setPull(0)
    }
  }

  const allPosts = mockFallback ? [...livePosts, ...mockPosts, ...extraPosts] : livePosts
  const feedEnded = mockFallback ? round >= MAX_ROUNDS : !hasMore && livePosts.length > 0

  return (
    <div ref={rootRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* 下拉刷新指示：鱼形 loading 旋转 */}
      <AnimatePresence>
        {pull > 8 && (
          <motion.div
            className="flex justify-center overflow-hidden text-olive"
            animate={{ height: pull }}
            exit={{ height: 0 }}
            style={{ height: pull }}
          >
            <div className={`flex items-center py-2 ${refreshing ? 'animate-spin' : ''}`}>
              <FishIcon size={28} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Section 1 — TopBar（48px 吸顶，融背景） */}
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between bg-paper px-4">
        <motion.img
          src="/logo.svg"
          alt="趣渔"
          className="h-6 w-auto"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </header>

      {/* Section 2 — Story 圈「钓友动态」 */}
      <StoryBar />

      {/* Section 3 — 信息流帖子（帖子间 8px paper 间隙 + 1px 细线） */}
      <div className="pb-2">
        {liveLoading &&
          [0, 1].map((i) => (
            <div key={`skeleton-${i}`} className="animate-pulse border-b border-line bg-paper-white">
              <div className="flex h-12 items-center gap-2.5 px-3">
                <div className="h-10 w-10 rounded-full bg-paper" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 rounded bg-paper" />
                  <div className="h-2.5 w-32 rounded bg-paper" />
                </div>
              </div>
              <div className="aspect-square w-full bg-paper" />
              <div className="space-y-2 px-3 py-3">
                <div className="h-3 w-40 rounded bg-paper" />
                <div className="h-3 w-full rounded bg-paper" />
              </div>
            </div>
          ))}
        {allPosts.map((post, i) => (
          <div key={post.id}>
            {i > 0 && <div className="h-2 bg-paper" />}
            <FeedPost post={post} index={i} onCollect={showToast} />
          </div>
        ))}
      </div>

      {/* 无限滚动哨兵 */}
      {!feedEnded && !liveLoading && <div ref={sentinelRef} className="h-px" aria-hidden="true" />}

      {/* 翻页加载中 */}
      {!mockFallback && feedQuery.isFetching && livePosts.length > 0 && (
        <div className="flex justify-center py-4 text-olive">
          <FishIcon size={24} className="animate-spin" />
        </div>
      )}

      {/* Section 4 — 信息流尽头 */}
      {feedEnded && (
        <div className="flex flex-col items-center gap-3 border-t border-line px-8 py-10">
          <motion.img
            src="/empty-creel.svg"
            alt="空鱼护"
            className="h-24 w-auto"
            animate={{ rotate: [-3, 3, -3] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <p className="text-[15px] leading-[22px] text-ink-60">看到的都是老渔获啦，去甩一竿吧</p>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/spots')}
            className="mt-1 h-12 w-full max-w-[280px] rounded-xl border border-olive bg-paper-white text-[15px] font-semibold text-olive"
          >
            去钓点看看
          </motion.button>
        </div>
      )}

      {/* 收藏 toast：底部升起，2 秒自动消失 */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[13px] leading-[18px] text-paper"
          >
            已收藏到渔获集
          </motion.div>
        )}
      </AnimatePresence>

      {/* 网络异常 toast：接口降级为本地内容时提示 */}
      <AnimatePresence>
        {netToast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[13px] leading-[18px] text-paper"
          >
            {netToast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
