import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import Lenis from 'lenis'
import { Bell, Search, X } from 'lucide-react'
import StoryBar from '@/components/home/StoryBar'
import FeedPost from '@/components/home/FeedPost'
import FishIcon from '@/components/FishIcon'
import { FEED_POSTS } from '@/data/home'
import type { FeedPost as FeedPostData } from '@/data/home'
import { PONDS as MOCK_PONDS } from '@/data/spots'
import { trpc } from '@/providers/trpc'
import { mapFeedPost } from '@/lib/live'
import type { FeedItem } from '@/lib/live'

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

/** 信息流加载骨架（推荐/关注两个 Tab 复用） */
function FeedSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
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
    </>
  )
}

/** 首页 · 社区信息流：TopBar + Story 圈 + 渔获大图信息流（双击点赞/评论弹层/无限滚动/下拉刷新）
 *  数据源：trpc.app.feed 推荐算法分页；接口异常时保留已加载真实帖在前、本地 mock 仅作补充填充 */
export default function Home() {
  const navigate = useNavigate()

  // 分享链接落地：/?post=<id> → 帖子详情页（旧格式分享链接兼容入口）
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get('post')
    if (pid && Number(pid) > 0) navigate(`/post/${Number(pid)}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  // 消息中心未读数：30s 轮询，驱动顶栏铃铛红点
  const unreadQuery = trpc.app.notify.unreadCount.useQuery(undefined, { refetchInterval: 30_000, retry: 1 })
  const unreadCount = unreadQuery.data?.count ?? 0
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

  // ---- 帖子搜索（QY-COMM-007）：顶栏放大镜展开输入框；清空关键词回到正常 feed ----
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [searchPage, setSearchPage] = useState(1)
  const [searchPosts, setSearchPosts] = useState<FeedPostWithId[]>([])
  const [searchHasMore, setSearchHasMore] = useState(false)

  const searchQuery = trpc.app.posts.search.useQuery(
    { keyword, page: searchPage, pageSize: 10 },
    { retry: 1, enabled: keyword.length > 0 },
  )

  // 搜索结果到达后累积分页（id 去重）；关键词变化时由提交处先清空列表
  useEffect(() => {
    const data = searchQuery.data as { items: FeedItem[]; hasMore: boolean } | undefined
    if (!data) return
    const mapped = data.items.map((p) => ({ ...mapFeedPost(p, pondMeta), postId: p.id }))
    setSearchPosts((prev) => {
      if (searchPage === 1) return mapped
      const seen = new Set(prev.map((p) => p.id))
      return [...prev, ...mapped.filter((p) => !seen.has(p.id))]
    })
    setSearchHasMore(data.hasMore)
  }, [searchQuery.data, searchPage, pondMeta])

  const submitSearch = () => {
    const kw = searchInput.trim()
    if (!kw) return
    setSearchPage(1)
    setSearchPosts([])
    setKeyword(kw)
  }

  const clearSearch = () => {
    setKeyword('')
    setSearchInput('')
    setSearchPosts([])
    setSearchPage(1)
    setSearchOpen(false)
  }

  const searching = keyword.length > 0

  // ---- 关注动态流（QY-COMM-008）：信息流顶部 Tab「推荐 / 关注」----
  // 「关注」只看我关注作者的新帖（时间倒序）；未登录或关注 0 人显示引导空态
  const [feedTab, setFeedTab] = useState<'recommend' | 'following'>('recommend')
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const me = meQuery.data ?? null
  const [followPage, setFollowPage] = useState(1)
  const [followPosts, setFollowPosts] = useState<FeedPostWithId[]>([])
  const [followHasMore, setFollowHasMore] = useState(true)

  const followingFeedQuery = trpc.app.posts.followingFeed.useQuery(
    { page: followPage, pageSize: PAGE_SIZE },
    { retry: 1, enabled: feedTab === 'following' && !!me },
  )

  // 关注流结果累积分页（id 去重）；第 1 页整表替换（tab 切换回来/下拉刷新）
  useEffect(() => {
    const data = followingFeedQuery.data as { items: FeedItem[]; hasMore: boolean } | undefined
    if (!data) return
    const mapped = data.items.map((p) => ({ ...mapFeedPost(p, pondMeta), postId: p.id }))
    setFollowPosts((prev) => {
      if (followPage === 1) return mapped
      const seen = new Set(prev.map((p) => p.id))
      return [...prev, ...mapped.filter((p) => !seen.has(p.id))]
    })
    setFollowHasMore(data.hasMore)
  }, [followingFeedQuery.data, followPage, pondMeta])

  const followLoading = !!me && followPosts.length === 0 && followingFeedQuery.isLoading

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

  // 无限滚动：哨兵进入视口时加载更多（推荐流翻页 / 关注流翻页 / mock 填充克隆新帖入场）
  useEffect(() => {
    const root = document.getElementById('app-scroll')
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return
    const ob = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        if (feedTab === 'following') {
          if (me && followHasMore && !followingFeedQuery.isFetching) setFollowPage((p) => p + 1)
          return
        }
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
  }, [round, mockFallback, hasMore, feedQuery.isFetching, mockPosts, feedTab, me, followHasMore, followingFeedQuery.isFetching])

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
      // 关注流同样整表重置（第 1 页响应覆盖 followPosts）
      setFollowPosts([])
      setFollowHasMore(true)
      window.setTimeout(() => {
        setRefreshing(false)
        setPull(0)
        if (page !== 1) setPage(1)
        else feedQuery.refetch()
        if (followPage !== 1) setFollowPage(1)
        else if (feedTab === 'following' && me) followingFeedQuery.refetch()
      }, 800)
    } else {
      setPull(0)
    }
  }

  const allPosts = mockFallback ? [...livePosts, ...mockPosts, ...extraPosts] : livePosts
  const feedEnded = mockFallback ? round >= MAX_ROUNDS : !hasMore && livePosts.length > 0
  // 关注流尽头（QY-COMM-008）
  const followEnded = !followHasMore && followPosts.length > 0

  return (
    <div ref={rootRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* 下拉刷新指示：鱼形 loading 旋转 */}
      <AnimatePresence>
        {pull > 8 && (
          <m.div
            className="flex justify-center overflow-hidden text-olive"
            animate={{ height: pull }}
            exit={{ height: 0 }}
            style={{ height: pull }}
          >
            <div className={`flex items-center py-2 ${refreshing ? 'animate-spin' : ''}`}>
              <FishIcon size={28} />
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* Section 1 — TopBar（48px 吸顶，融背景）：左 logo，右搜索 + 消息铃铛（未读红点角标） */}
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between bg-paper px-4">
        <m.img
          src="/logo.svg"
          alt="趣渔"
          className="h-6 w-auto"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
        <div className="flex items-center gap-1">
          <m.button
            type="button"
            aria-label="搜索帖子"
            onClick={() => (searching ? clearSearch() : setSearchOpen((v) => !v))}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={`flex h-9 w-9 items-center justify-center ${searchOpen || searching ? 'text-olive' : 'text-ink'}`}
          >
            <Search size={22} strokeWidth={1.8} />
          </m.button>
          <m.button
            type="button"
            aria-label="消息"
            onClick={() => navigate('/notifications')}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="relative flex h-9 w-9 items-center justify-center text-ink"
          >
            <Bell size={22} strokeWidth={1.8} />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-heart" aria-hidden="true" />
            )}
          </m.button>
        </div>
      </header>

      {/* 搜索输入条（QY-COMM-007）：放大镜展开，回车搜索，清空回到正常 feed */}
      <AnimatePresence>
        {(searchOpen || searching) && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="sticky top-12 z-20 overflow-hidden bg-paper px-4"
          >
            <div className="flex items-center gap-2 py-2">
              <div className="flex h-10 flex-1 items-center gap-2 rounded-full bg-paper-white px-4">
                <Search size={16} strokeWidth={1.8} className="shrink-0 text-ink-40" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
                  placeholder="搜渔获、鱼种…"
                  maxLength={64}
                  autoFocus={searchOpen && !searching}
                  className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-40"
                />
                {searchInput && (
                  <button type="button" aria-label="清空搜索" onClick={clearSearch} className="shrink-0 text-ink-40">
                    <X size={16} strokeWidth={2} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={submitSearch}
                disabled={!searchInput.trim()}
                className="h-10 shrink-0 rounded-full bg-olive px-4 text-[13px] font-semibold text-paper-white disabled:opacity-40"
              >
                搜索
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* Section 2 — Story 圈「钓友动态」（搜索态隐藏） */}
      {!searching && <StoryBar />}

      {/* 信息流 Tab（QY-COMM-008）：推荐 / 关注（搜索态隐藏，下划线指示随顶栏风格）
          下划线滑动原用 framer-motion layoutId（需 layout 能力，会把首屏动画
          预算抬高 13KB gzip）。改为 CSS 绝对定位 + transition 实现，
          视觉一致、零运行时布局测量开销（QY-PERF-005）。 */}
      {!searching && (
        <div className="sticky top-12 z-10 flex h-11 items-end gap-6 bg-paper px-4">
          <div className="relative flex h-11 items-end gap-6">
            {(
              [
                { key: 'recommend', label: '推荐' },
                { key: 'following', label: '关注' },
              ] as const
            ).map(({ key, label }) => {
              const active = feedTab === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`${label}信息流`}
                  onClick={() => setFeedTab(key)}
                  className="relative flex h-11 items-center justify-center"
                >
                  <span
                    className={`text-[15px] leading-[22px] ${active ? 'font-semibold text-ink' : 'text-ink-40'}`}
                  >
                    {label}
                  </span>
                </button>
              )
            })}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 h-0.5 w-6 rounded-full bg-ink transition-transform duration-300 ease-out motion-reduce:transition-none"
              style={{
                // 两个 Tab 等宽（w-6 指示器 + gap-6 间距），按索引平移
                transform: `translateX(${feedTab === 'following' ? 'calc(1.5rem + 1.5rem)' : '0'})`,
              }}
            />
          </div>
        </div>
      )}

      {/* 搜索结果（QY-COMM-007）：复用信息流卡片渲染，空结果显示空态 */}
      {searching ? (
        <div className="pb-2">
          {searchQuery.isLoading && searchPosts.length === 0 ? (
            <div className="flex justify-center py-10 text-olive">
              <FishIcon size={28} className="animate-spin" />
            </div>
          ) : searchPosts.length === 0 && !searchQuery.isFetching ? (
            <div className="flex flex-col items-center gap-3 px-8 py-12">
              <img src="/empty-creel.svg" alt="没有找到相关渔获" className="h-24 w-auto opacity-80" />
              <p className="text-[15px] leading-[22px] text-ink-60">没有找到相关渔获</p>
              <p className="text-[13px] leading-[18px] text-ink-40">换个关键词试试，比如鱼种或钓场名</p>
            </div>
          ) : (
            <>
              {searchPosts.map((post, i) => (
                <div key={post.id}>
                  {i > 0 && <div className="h-2 bg-paper" />}
                  <FeedPost post={post} index={i} onCollect={showToast} />
                </div>
              ))}
              {searchHasMore && (
                <button
                  type="button"
                  onClick={() => setSearchPage((p) => p + 1)}
                  disabled={searchQuery.isFetching}
                  className="mx-auto mt-3 flex h-10 w-full max-w-[280px] items-center justify-center rounded-xl border border-olive bg-paper-white text-[14px] font-semibold text-olive disabled:opacity-40"
                >
                  {searchQuery.isFetching ? '加载中…' : '加载更多'}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
      <>
      {feedTab === 'following' ? (
        /* 关注动态流（QY-COMM-008）：未登录或关注 0 人 → 引导空态；否则时间倒序卡片流 */
        <>
        <div className="pb-2">
          {followLoading ? (
            <FeedSkeleton />
          ) : !me || (followPosts.length === 0 && !followingFeedQuery.isFetching) ? (
            <div className="flex flex-col items-center gap-3 px-8 py-12">
              <img src="/empty-creel.svg" alt="还没有关注动态" className="h-24 w-auto opacity-80" />
              <p className="text-[15px] leading-[22px] text-ink-60">关注感兴趣的钓友，这里会出现他们的渔获</p>
              {!me && (
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="mt-1 rounded-full bg-olive px-5 py-2 text-[13px] font-semibold leading-[18px] text-paper-white active:brightness-95"
                >
                  去登录
                </button>
              )}
            </div>
          ) : (
            followPosts.map((post, i) => (
              <div key={post.id}>
                {i > 0 && <div className="h-2 bg-paper" />}
                <FeedPost post={post} index={i} onCollect={showToast} />
              </div>
            ))
          )}
        </div>

        {/* 关注流无限滚动哨兵 */}
        {!followEnded && !followLoading && me && followPosts.length > 0 && (
          <div ref={sentinelRef} className="h-px" aria-hidden="true" />
        )}

        {/* 关注流翻页加载中 */}
        {followingFeedQuery.isFetching && followPosts.length > 0 && (
          <div className="flex justify-center py-4 text-olive">
            <FishIcon size={24} className="animate-spin" />
          </div>
        )}

        {/* 关注流尽头 */}
        {followEnded && (
          <div className="flex flex-col items-center gap-3 border-t border-line px-8 py-10">
            <img src="/empty-creel.svg" alt="空鱼护" className="h-24 w-auto opacity-80" />
            <p className="text-[15px] leading-[22px] text-ink-60">关注动态都刷完啦</p>
          </div>
        )}
        </>
      ) : (
      <>
      {/* Section 3 — 信息流帖子（帖子间 8px paper 间隙 + 1px 细线） */}
      <div className="pb-2">
        {liveLoading && <FeedSkeleton />}
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
          <m.img
            src="/empty-creel.svg"
            alt="空鱼护"
            className="h-24 w-auto"
            animate={{ rotate: [-3, 3, -3] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <p className="text-[15px] leading-[22px] text-ink-60">看到的都是老渔获啦，去甩一竿吧</p>
          <m.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/spots')}
            className="mt-1 h-12 w-full max-w-[280px] rounded-xl border border-olive bg-paper-white text-[15px] font-semibold text-olive"
          >
            去钓点看看
          </m.button>
        </div>
      )}
      </>
      )}
      </>
      )}

      {/* 收藏 toast：底部升起，2 秒自动消失 */}
      <AnimatePresence>
        {toast && (
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[13px] leading-[18px] text-paper"
          >
            已收藏到渔获集
          </m.div>
        )}
      </AnimatePresence>

      {/* 网络异常 toast：接口降级为本地内容时提示 */}
      <AnimatePresence>
        {netToast && (
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[13px] leading-[18px] text-paper"
          >
            {netToast}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
