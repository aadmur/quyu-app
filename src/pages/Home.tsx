import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
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
import type { FeedItem, SearchFeedItem } from '@/lib/live'
import { usePostOverlayHistory } from '@/hooks/usePostOverlayHistory'

/**
 * 帖子弹层按需加载（v14 性能铁律 1）
 *
 * 这里**必须**用 import() 动态导入：PostSheet 静态依赖 PostContent → CatchViewer，
 * 而 CatchViewer 用了 framer-motion 的 drag="x"（domMax 能力）。Home 在首屏静态
 * 闭包里，一旦静态引入，scripts/check-motion-boundary.mjs 的不变量 1 直接 build
 * 失败；更重要的是首屏会白背 domMax 的 11.9 KB brotli。
 */
const PostSheet = lazy(() => import('@/components/home/PostSheet'))

/** 弹层 chunk 未就位时的兜底：整屏骨架而不是空白，避免「点了没反应」 */
function PostSheetFallback() {
  return (
    <div className="fixed inset-0 z-50 mx-auto max-w-[420px] animate-pulse bg-paper-white" aria-busy="true">
      <div className="h-12 border-b border-line" />
      <div className="flex items-center gap-2.5 p-3">
        <div className="h-10 w-10 rounded-full bg-paper" />
        <div className="h-4 w-24 rounded bg-paper" />
      </div>
      <div className="aspect-square w-full bg-paper" />
      <span className="sr-only">帖子加载中</span>
    </div>
  )
}

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

/** 只看分页结果里 data 的形态（useQueries 的结果里我们只用 data / hasMore） */
interface CardPage<T> {
  data?: { items: T[]; hasMore: boolean } | undefined
}

/**
 * 「还有下一页」= **最后一个已经返回数据的页**给出的答案。
 *
 * 为什么不能直接取数组最后一项的 data?.hasMore：正在请求中的那一页 data 还是
 * undefined，取到的是 false → 翻页途中会闪出「看到的都是老渔获啦」的尽头提示，
 * 更糟的是哨兵跟着被卸载，用户停在那里再也触发不了下一页（自己把自己锁死了）。
 */
function lastSettledHasMore(pages: Array<{ data?: { hasMore: boolean } | undefined }>): boolean {
  let acc = false
  for (const page of pages) if (page.data) acc = page.data.hasMore
  return acc
}

/**
 * 把「同一个 procedure 的多页缓存」摊平成卡片列表：按后端数值 id 去重、保持页序，
 * 并把 id 挂到 postId 上（卡片点赞/收藏/埋点与打开弹层都靠它）。
 *
 * 为什么没有 effect、没有 useState：这个函数**每次渲染都重跑**，产出的就是缓存的当前值。
 * 点赞乐观写缓存（lib/postCache.ts）→ react-query 通知订阅者 → Home 重渲染 →
 * 这里映射出 liked/likeCount 的新对象 → 卡片立刻变。
 * 迭代前的写法是 useEffect 把 data 拷进 useState，再「只追加没见过的 id」——
 * patch 之后所有 id 都已见过，合并返回原引用，React 直接 bail，UI 永远停在旧值。
 *
 * 去重是必要的：offset 分页在服务端数据变化（新帖插入 / 有人删帖）时，
 * 相邻两页可能返回同一条帖子，重复 key 会让 React 报 warning 且卡片闪烁。
 */
function toCards<T extends FeedItem>(pages: CardPage<T>[], meta: Record<string, { name: string; price: number }>): FeedPostWithId[] {
  const seen = new Set<number>()
  const out: FeedPostWithId[] = []
  for (const page of pages) {
    for (const item of page.data?.items ?? []) {
      const id = Number(item.id)
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ ...mapFeedPost(item, meta), postId: id })
    }
  }
  return out
}

/**
 * 网络异常降级提示（迭代前是 useState + 2.2s 定时清除 + 3.5s 节流，全靠 effect）。
 * 现在它由「查询是否出错」这个派生条件直接渲染，淡出交给 framer-motion 的关键帧动画：
 * 元素播完停在 opacity 0，不出场也不占交互（pointer-events-none）。
 * 目标对象提到模块级常量是因为 framer-motion 按引用比较 animate —— 内联字面量
 * 会在每次渲染（下拉刷新时 touchmove 每帧一次）被判成「新目标」而重播动画，
 * 那就变成 toast 闪个没完，正是迭代前那句「节流」要防的事。
 */
const NET_TOAST_ANIMATE = { opacity: [0, 1, 1, 0], y: [20, 0, 0, 12] }
const NET_TOAST_TRANSITION = { duration: 2.4, times: [0, 0.08, 0.75, 1], ease: 'easeOut' as const }

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

/** 首页 · 社区信息流：TopBar + Story 圈 + 渔获大图信息流（整卡点开弹层/无限滚动/下拉刷新）
 *  数据源：trpc.app.feed 推荐算法分页；接口异常时保留已加载真实帖在前、本地 mock 仅作补充填充 */
const PAGE_SIZE = 5
const SEARCH_PAGE_SIZE = 10

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()

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
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchStartY = useRef<number | null>(null)

  // ---- 帖子弹层（v14）：整卡可点开 PostSheet，Home 不卸载所以分页/滚动/tab/点赞态都保住 ----
  const [sheet, setSheet] = useState<{ postId: number; seed?: FeedPostWithId; focusComment: boolean } | null>(
    null,
  )
  const { backFromPost, consumePop } = usePostOverlayHistory(sheet?.postId ?? null)

  const openSheet = useCallback((post: FeedPostWithId, focusComment = false) => {
    // 演示帖（接口降级时的本地 mock）没有后端数值 id，也就没有 posts.detail 可请，
    // 所以整卡对 mock 不响应。这里保持静默是**有意的**：唯一的调用方 FeedPost 已经在
    // 卡片层给了「当前为演示数据，这条帖子没有详情」的 toast，两处都提示会重复响两下。
    if (post.postId == null) return
    setSheet({ postId: post.postId, seed: post, focusComment })
  }, [])

  const closeSheet = useCallback(() => {
    backFromPost()
    setSheet(null)
  }, [backFromPost])

  // 浏览器/安卓物理返回：地址栏已经退回 '/'，这里只把「后退一格」翻译成「关弹层」
  useEffect(() => {
    const onPop = () => {
      if (consumePop()) setSheet(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [consumePop])

  // 路由真的变了（例如在弹层里点了钓场挂载条）就别把弹层留在屏幕上
  useEffect(() => {
    setSheet(null)
  }, [location.pathname])

  /**
   * 弹层 chunk 预热（v14）：首屏 LCP 之后趁浏览器空闲把 PostSheet 下载好，
   * 用户点开帖子时不必再等一次 chunk 往返。刻意排在 LCP 之后 —— 预加载不能和
   * 首屏关键资源抢带宽，否则省下的导航时间会从首屏传输预算里扣回去。
   */
  useEffect(() => {
    const warm = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => void import('@/components/home/PostSheet'), { timeout: 3000 })
      } else {
        window.setTimeout(() => void import('@/components/home/PostSheet'), 1200)
      }
    }
    let done = false
    const once = () => {
      if (done) return
      done = true
      warm()
    }
    let po: PerformanceObserver | undefined
    try {
      // largest-contentful-paint 未进 TS 标准 DOM 联合类型，按字符串订阅（同 lib/perf.ts）
      po = new PerformanceObserver((list) => {
        if (list.getEntries().length > 0) {
          po?.disconnect()
          once()
        }
      })
      po.observe({ type: 'largest-contentful-paint', buffered: true } as PerformanceObserverInit)
    } catch {
      // 老 Safari 不支持 LCP 条目：退到 load 事件
    }
    window.addEventListener('load', once, { once: true })
    // 兜底：LCP 与 load 都没触发（例如文档早已就绪）时也要预热
    const timer = window.setTimeout(once, 4000)
    return () => {
      po?.disconnect()
      window.clearTimeout(timer)
    }
  }, [])


  const pondsQuery = trpc.app.ponds.list.useQuery(undefined, { retry: 1 })
  /** 缓存操作入口：下拉刷新时用 invalidate 的 refetchType:'none' 把旧分页标脏而不立刻重取（见 onTouchEnd） */
  const utils = trpc.useUtils()
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

  // ---- 真实推荐信息流 ----
  /**
   * 分页方式：offset（app.feed 的入参是 {page, pageSize}，不是游标）。
   *
   * tRPC v11 的 useInfiniteQuery 要求入参里带保留键 `cursor` 才能自动翻页，
   * 这里后端契约没有 cursor（改它要动 api/，本轮不许），所以改成
   * 「把已加载的页码记在 state 里 + useQueries 一次性声明式读取多页」：
   *
   *   渲染时**每次都从 query.data 现取** → 卡片显示的就是缓存本身。
   *
   * 这正是 v14 回归的根因：迭代前这里用 useEffect 把 feedQuery.data 拷进 useState
   * (`livePosts`)，去重逻辑又是「只追加没见过的 id」，于是 lib/postCache.ts 把点赞数
   * patch 进缓存之后，effect 重跑却发现所有 id 都已见过 → 返回原引用 → React 直接 bail，
   * 请求发了、缓存改了、UI 不动。缓存端是对的，错在渲染端读了一份过期拷贝。
   * 现在没有拷贝了，patch 缓存 = 改 UI；同时也不碰 useEffect 里 setState
   * （react-hooks/set-state-in-effect 是本项目 lint 红线）。
   */
  const [loadedPages, setLoadedPages] = useState<number[]>([1])
  // tRPC v11 的 useQueries 只有根级形式（procedure 上没有 .useQueries），
  // 回调里给每条 query 传 input + 该条自己的 options。
  const feedQueries = trpc.useQueries((t) =>
    loadedPages.map((page) => t.app.feed({ page, pageSize: PAGE_SIZE }, { retry: 1 })),
  )
  /** 摊平成卡片列表（按 id 去重、保留页序）；每次渲染现取，缓存变更因此能到达 UI */
  const livePosts = useMemo(() => toCards(feedQueries, pondMeta), [feedQueries, pondMeta])
  const hasMore = lastSettledHasMore(feedQueries)
  /**
   * 接口异常 → mock 填充模式（真实帖保留在前；不阻断后续重试）。
   * 派生自查询状态而不是 setState 标记：这里没有任何 effect 参与的同步。
   */
  const mockFallback = feedQueries.some((q) => q.isError)
  const feedFetching = feedQueries.some((q) => q.isFetching)
  const liveLoading = !mockFallback && livePosts.length === 0 && feedQueries.some((q) => q.isPending)
  const [mockPosts, setMockPosts] = useState<FeedPostData[]>(FEED_POSTS)
  /** 下拉刷新收尾计时器：连拉两次时，第一发的计时器会把第二发的动画提前收掉，卸载也必须清 */
  const refreshTimer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    },
    [],
  )

  // ---- 帖子搜索（QY-COMM-007）：顶栏放大镜展开输入框；清空关键词回到正常 feed ----
  // 与推荐流同一套路：已加载页码记在 state，卡片渲染时从 useQueries 的结果现取，
  // 于是 patchSearchPost 写进缓存的点赞/收藏态会当场反映到搜索卡上。
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [searchPages, setSearchPages] = useState<number[]>([1])
  const searching = keyword.length > 0

  const searchQueries = trpc.useQueries((t) =>
    // 关键词为空时不打接口：enabled 是每条目各自的开关
    searchPages.map((page) =>
      t.app.posts.search({ keyword, page, pageSize: SEARCH_PAGE_SIZE }, { enabled: searching, retry: 1 }),
    ),
  )
  /**
   * 显式标注条目类型为 SearchFeedItem（而不是靠推断、更不再像迭代前那样 `as FeedItem` 强转）：
   * 后端 v14 已把 searchPosts 对齐到卡片口径（POST_CARD_COLUMNS + postCoverSql +
   * withUserInteraction），它与 FeedItem 结构同形，所以 mapFeedPost 直接可用。
   * 哪天后端改回裸 db.select()（没有 cover / 没有互动位），这一行会立刻 tsc 报错，
   * 而不是悄悄上线成一堆无图、恒未互动的搜索卡 —— 迭代前那个 `as` 就是把报错换成了坏功能。
   */
  const searchPosts = useMemo<FeedPostWithId[]>(
    () => toCards<SearchFeedItem>(searchQueries, pondMeta),
    [searchQueries, pondMeta],
  )
  const searchHasMore = lastSettledHasMore(searchQueries)
  const searchFetching = searchQueries.some((q) => q.isFetching)
  const searchLoading = searching && searchPosts.length === 0 && searchQueries.some((q) => q.isPending)

  const submitSearch = () => {
    const kw = searchInput.trim()
    if (!kw) return
    // 只回到第 1 页：列表是派生值，换个 keyword 就是另一组 queryKey，旧结果自然消失
    setSearchPages([1])
    setKeyword(kw)
  }

  const clearSearch = () => {
    setKeyword('')
    setSearchInput('')
    setSearchPages([1])
    setSearchOpen(false)
  }

  // ---- 关注动态流（QY-COMM-008）：信息流顶部 Tab「推荐 / 关注」----
  // 「关注」只看我关注作者的新帖（时间倒序）；未登录或关注 0 人显示引导空态
  const [feedTab, setFeedTab] = useState<'recommend' | 'following'>('recommend')
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const me = meQuery.data ?? null
  const [followPages, setFollowPages] = useState<number[]>([1])

  const followEnabled = feedTab === 'following' && !!me
  const followingFeedQueries = trpc.useQueries((t) =>
    followPages.map((page) =>
      t.app.posts.followingFeed({ page, pageSize: PAGE_SIZE }, { enabled: followEnabled, retry: 1 }),
    ),
  )
  const followPosts = useMemo(() => toCards(followingFeedQueries, pondMeta), [followingFeedQueries, pondMeta])
  const followHasMore = lastSettledHasMore(followingFeedQueries)
  const followFetching = followingFeedQueries.some((q) => q.isFetching)
  const followLoading = followEnabled && followPosts.length === 0 && followingFeedQueries.some((q) => q.isPending)

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

  /**
   * 无限滚动：哨兵进入视口时把下一页码 append 进「已加载页」。
   * IntersectionObserver 的回调是外部系统事件（和 onClick 同性质），在这里 setState
   * 不属于 react-hooks/set-state-in-effect 管的「effect 体内同步 setState」。
   * 页码数组始终是 [1..n] 连续的，所以下一页 = 当前长度 + 1。
   */
  useEffect(() => {
    const root = document.getElementById('app-scroll')
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return
    const ob = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        if (feedTab === 'following') {
          if (followEnabled && followHasMore && !followFetching) {
            setFollowPages((prev) => [...prev, prev.length + 1])
          }
          return
        }
        if (!mockFallback) {
          if (hasMore && !feedFetching) setLoadedPages((prev) => [...prev, prev.length + 1])
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
    // livePosts.length / followPosts.length 也要进依赖：哨兵是「有内容且不到底」时才挂载的，
    // 首屏数据到达那一刻如果这些长度不在依赖里，observer 可能还指着上一帧那个不存在的哨兵，
    // 结果就是滚动到底什么也不会发生（无限滚动死掉）。用 .length 而不是数组本身，
    // 因为派生数组每次渲染都是新引用，直接进依赖等于每帧重新订阅一次。
  }, [
    round,
    mockFallback,
    hasMore,
    feedFetching,
    mockPosts,
    feedTab,
    followEnabled,
    followHasMore,
    followFetching,
    livePosts.length,
    followPosts.length,
  ])

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
      // 先收起分页声明（列表回到第 1 页），mock 侧重排静态数据并清空克隆帖。
      // 关注流同样只留第 1 页；推荐流/搜索结果不再需要「整表替换标记」——
      // 数据是派生值，没有需要清空的本地拷贝。
      setLoadedPages([1])
      setFollowPages([1])
      setExtraPosts([])
      setRound(0)
      setMockPosts(shuffle(FEED_POSTS))
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(() => {
        setRefreshing(false)
        setPull(0)
        // 刷新语义要两步一起做：
        // 1) 把该 procedure 的所有分页标成 stale，但 refetchType:'none'（react-query v5 里
        //    这个开关在 filters 参数上，不在 options 上）让它们**现在都不重取**
        //    —— 第 2..N 页此刻刚被上面的 setLoadedPages([1]) 取消订阅，如果让它们跟着重取，
        //    下拉一次就是 N 个请求（正是 postCache.ts 开头嫌弃的那把大锤）。
        // 2) 只命令式重取第 1 页。refetch 不受 staleTime 30s 约束：用户主动下拉就是要最新数据。
        // 为什么第 1 步不可省：不标脏的话，用户往下滚回第 2 页时会命中**刷新前**那份缓存
        // （staleTime 30s 内根本不请求），刷新等于白刷。
        // 搜索结果不在这里重取（它有自己的翻页节奏，且换关键词天然换 key）。
        void utils.app.feed.invalidate({}, { refetchType: 'none' })
        void feedQueries[0]?.refetch()
        if (feedTab === 'following' && me) {
          void utils.app.posts.followingFeed.invalidate({}, { refetchType: 'none' })
          void followingFeedQueries[0]?.refetch()
        }
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
          {searchLoading ? (
            <div className="flex justify-center py-10 text-olive">
              <FishIcon size={28} className="animate-spin" />
            </div>
          ) : searchPosts.length === 0 && !searchFetching ? (
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
                  <FeedPost post={post} index={i} onOpen={(focus) => openSheet(post, focus)} />
                </div>
              ))}
              {searchHasMore && (
                <button
                  type="button"
                  onClick={() => setSearchPages((prev) => [...prev, prev.length + 1])}
                  disabled={searchFetching}
                  className="mx-auto mt-3 flex h-10 w-full max-w-[280px] items-center justify-center rounded-xl border border-olive bg-paper-white text-[14px] font-semibold text-olive disabled:opacity-40"
                >
                  {searchFetching ? '加载中…' : '加载更多'}
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
          ) : !me || (followPosts.length === 0 && !followFetching) ? (
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
                <FeedPost post={post} index={i} onOpen={(focus) => openSheet(post, focus)} />
              </div>
            ))
          )}
        </div>

        {/* 关注流无限滚动哨兵 */}
        {!followEnded && !followLoading && me && followPosts.length > 0 && (
          <div ref={sentinelRef} className="h-px" aria-hidden="true" />
        )}

        {/* 关注流翻页加载中 */}
        {followFetching && followPosts.length > 0 && (
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
            <FeedPost post={post} index={i} onOpen={(focus) => openSheet(post, focus)} />
          </div>
        ))}
      </div>

      {/* 无限滚动哨兵 */}
      {!feedEnded && !liveLoading && <div ref={sentinelRef} className="h-px" aria-hidden="true" />}

      {/* 翻页加载中 */}
      {!mockFallback && feedFetching && livePosts.length > 0 && (
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

      {/* 帖子弹层（v14）：整卡可点的目标。chunk 由上面的 requestIdleCallback 预热，
          真没到位时先显示整屏骨架，不给用户「点了没反应」的错觉。 */}
      {sheet && (
        <Suspense fallback={<PostSheetFallback />}>
          <PostSheet
            postId={sheet.postId}
            seed={sheet.seed}
            autoFocusInput={sheet.focusComment}
            onClose={closeSheet}
          />
        </Suspense>
      )}

      {/* 网络异常 toast：接口降级为本地内容时提示。
          渲染条件 = 「推荐流有分页请求失败」这个派生值，没有 setState、没有节流计时器
          （淡出由 NET_TOAST_ANIMATE 的关键帧播完停在 opacity 0 实现）。
          刻意不写 initial={false}：那个开关的含义是「跳过入场动画、直接落到 animate 的终值」,
          而这里的终值是 opacity 0 —— 加上它这条提示会一路隐身，等于没有。
          动画播完元素仍挂在 DOM 里（透明且不接收点击），错误状态持续期间不会再重复播报，
          这正是迭代前那句「节流」想要的效果。 */}
      {mockFallback && (
        <m.div
          role="status"
          aria-live="polite"
          animate={NET_TOAST_ANIMATE}
          transition={NET_TOAST_TRANSITION}
          className="pointer-events-none fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[13px] leading-[18px] text-paper"
        >
          网络异常，展示本地内容
        </m.div>
      )}
    </div>
  )
}
