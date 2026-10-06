import { useMemo, useState } from 'react'
import { m } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Heart, Star } from 'lucide-react'
import PageHeader from '@/components/trade/PageHeader'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/hooks/useAuthGate'
import { mapFavoritePost } from '@/lib/live'
import type { FeedPost } from '@/data/home'

/** 后端 ponds.myFavorites 返回的收藏钓场项（契约：slug/name/region/priceFrom/rating + 封面字段）。
 *  封面字段名未最终确定，渲染时防御性取值：cover ?? coverImage ?? 按 slug 的本地封面约定 */
interface FavPondItem {
  slug: string
  name?: string | null
  region?: string | null
  priceFrom?: number | null
  rating?: number | string | null
  cover?: string | null
  coverImage?: string | null
}

function favCover(item: FavPondItem): string {
  return item.cover ?? item.coverImage ?? `/pond-${item.slug}-1.jpg`
}

/** 收藏行卡：封面 + 名称/地区 + 价格/评分，点击进钓场详情 */
function FavRow({ item, index }: { item: FavPondItem; index: number }) {
  const navigate = useNavigate()
  const rating = item.rating != null && !Number.isNaN(Number(item.rating)) ? Number(item.rating) : null
  return (
    <m.button
      type="button"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.06 * index, ease: 'easeOut' }}
      whileTap={{ scale: 0.98 }}
      onClick={() => navigate(`/pond/${item.slug}`)}
      className="mx-4 mb-3 flex w-[calc(100%-2rem)] gap-3 rounded-2xl border border-line bg-paper-white p-3 text-left"
    >
      <img
        src={favCover(item)}
        alt={item.name ?? item.slug}
        loading="lazy"
        className="h-20 w-28 shrink-0 rounded-xl bg-paper object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-[16px] font-semibold leading-[22px] text-ink">{item.name ?? item.slug}</p>
        <p className="mt-0.5 truncate text-[13px] leading-[18px] text-ink-60">{item.region ?? ''}</p>
        <div className="mt-auto flex items-center justify-between pt-1.5">
          <span className="flex items-baseline gap-1">
            <span className="font-num text-[20px] leading-6 text-clay">¥{item.priceFrom ?? '--'}</span>
            <span className="text-[12px] leading-4 text-ink-40">起</span>
          </span>
          {rating != null && (
            <span className="flex items-center gap-1">
              <Star size={14} strokeWidth={0} className="fill-olive text-olive" />
              <span className="font-num text-[16px] leading-5 text-ink">{rating}</span>
            </span>
          )}
        </div>
      </div>
    </m.button>
  )
}

/** 收藏的帖子行卡：封面（只有首图，与列表卡片同源）+ 作者 + 正文摘要 + 计数，点击进帖子详情页 */
function FavPostRow({ post, index }: { post: FeedPost; index: number }) {
  const navigate = useNavigate()
  return (
    <m.button
      type="button"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.06 * index, ease: 'easeOut' }}
      whileTap={{ scale: 0.98 }}
      onClick={() => navigate(`/post/${Number(post.id)}`)}
      className="mx-4 mb-3 flex w-[calc(100%-2rem)] gap-3 rounded-2xl border border-line bg-paper-white p-3 text-left"
    >
      {post.cover ? (
        <img
          src={post.cover}
          alt=""
          loading="lazy"
          className="h-20 w-20 shrink-0 rounded-xl bg-paper object-cover"
        />
      ) : (
        <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-paper text-[12px] leading-4 text-ink-40">
          无图
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-[15px] font-semibold leading-[22px] text-ink">{post.author}</p>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-ink-60">{post.caption}</p>
        <div className="mt-auto flex items-center gap-3 pt-1.5 text-[12px] leading-4 text-ink-40">
          <span>{post.time}</span>
          <span className="font-num">{post.likes}</span> 赞
          <span className="font-num">{post.commentCount}</span> 评论
        </div>
      </div>
    </m.button>
  )
}

/** 空态：空鱼护插画 + 引导按钮 */
function EmptyState({
  text,
  cta,
  onCta,
}: {
  text: string
  cta: string
  onCta: () => void
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center px-8 pb-16 pt-14"
    >
      <img src="/empty-creel.svg" alt="" className="h-40 w-[200px]" />
      <p className="mt-4 text-[15px] leading-[22px] text-ink-60">{text}</p>
      <m.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={onCta}
        className="mt-5 flex h-12 w-40 items-center justify-center rounded-xl border border-olive bg-paper-white text-[15px] font-semibold leading-[22px] text-olive"
      >
        {cta}
      </m.button>
    </m.div>
  )
}

/** 两个 Tab 等宽，下划线按下标平移 —— 与 Home 信息流 Tab 同一手法 */
const TABS = [
  { key: 'ponds', label: '钓场' },
  { key: 'posts', label: '帖子' },
] as const

type FavTab = (typeof TABS)[number]['key']

/** 帖子收藏每页条数 */
const POST_PAGE = 20

/**
 * 我的收藏 /favorites（二级页）：「钓场 / 帖子」两个 Tab。
 *
 * v14 新增「帖子」Tab：帖子收藏（posts.toggleFavorite）终于有了归集的地方。
 * 此前 FeedPost 上的收藏是纯前端 state + 一句「已收藏到渔获集」的 toast ——
 * 刷新即丢、也没任何页面能查到，「渔获集」这个说法从未对应过一张表或一个页面，
 * 属于幽灵术语，已全面停用（见 CHANGELOG 与本文件的 toast 文案）。
 *
 * Tab 下划线刻意用 CSS transform + transition 手写，**不用 layoutId**：
 * 本页在 App.tsx 里是 <Lazy>（domAnimation 级）而不是 <LazyMax>，引入 layout 投影
 * 就得为它单独升级 domMax，白白多背 11.9 KB brotli（check-motion-boundary.mjs 会拦）。
 */
export default function Favorites() {
  const navigate = useNavigate()
  const { user, requireAuth, loginSheet } = useAuthGate()
  const meLoading = user === undefined
  const [tab, setTab] = useState<FavTab>('ponds')

  const favQuery = trpc.app.ponds.myFavorites.useQuery(undefined, {
    enabled: !!user && tab === 'ponds',
    retry: 1,
  })
  const items = (favQuery.data ?? []) as FavPondItem[]

  // 帖子收藏：游标分页。刻意用 useInfiniteQuery，而不是首页那套「手攒 page + useEffect 回填」——
  // 收藏列表是纯读取、无下拉刷新需求，用 effect 往 state 里累积会触发级联渲染
  // （react-hooks/set-state-in-effect 是本项目的 lint 红线，v12 专项已把存量清零）。
  // 注意 tRPC v11 的 `cursor` 是保留键：只传 limit，游标由 getNextPageParam 自动注入。
  const favPostsQuery = trpc.app.posts.myFavorites.useInfiniteQuery(
    { limit: POST_PAGE },
    {
      enabled: !!user && tab === 'posts',
      retry: 1,
      // 服务端游标是 {createdAt,id}，null 表示到底；react-query 要求"无下一页"返回 undefined
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    },
  )

  // 跨页按 id 去重：并发收藏/取消收藏时相邻页边界可能重叠一两条
  const favPosts = useMemo(() => {
    const seen = new Set<string>()
    const out: FeedPost[] = []
    for (const page of favPostsQuery.data?.pages ?? []) {
      for (const post of page.items.map(mapFavoritePost)) {
        if (seen.has(post.id)) continue
        seen.add(post.id)
        out.push(post)
      }
    }
    return out
  }, [favPostsQuery.data])

  const hasMore = favPostsQuery.data?.pages?.at(-1)?.hasMore === true

  const postsLoading = !!user && tab === 'posts' && favPostsQuery.isLoading

  return (
    <div className="min-h-full bg-paper pb-8">
      <PageHeader title="我的收藏" />

      {/* Tab 条：钓场 / 帖子 */}
      <div className="sticky top-0 z-10 flex h-11 items-end gap-6 bg-paper px-4">
        <div className="relative flex h-11 items-end gap-6">
          {TABS.map(({ key, label }) => {
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                aria-label={`我的收藏·${label}`}
                onClick={() => setTab(key)}
                className="relative flex h-11 items-center justify-center"
              >
                <span className={`text-[15px] leading-[22px] ${active ? 'font-semibold text-ink' : 'text-ink-40'}`}>
                  {label}
                </span>
              </button>
            )
          })}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 h-0.5 w-6 rounded-full bg-ink transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{
              // 两个 Tab 等宽（w-6 文字 + gap-6 间距），按索引平移，与 Home 信息流 Tab 一致
              transform: `translateX(${tab === 'posts' ? 'calc(1.5rem + 1.5rem)' : '0'})`,
            }}
          />
        </div>
      </div>

      {tab === 'ponds' ? (
        meLoading || (user && favQuery.isLoading) ? (
          /* 加载骨架 */
          <div className="space-y-3 pt-3">
            {[0, 1, 2].map((i) => (
              <div key={`sk-${i}`} className="mx-4 flex animate-pulse gap-3 rounded-2xl bg-paper-white p-3">
                <div className="h-20 w-28 shrink-0 rounded-xl bg-paper" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 w-36 rounded bg-paper" />
                  <div className="h-3 w-24 rounded bg-paper" />
                  <div className="h-3 w-20 rounded bg-paper" />
                </div>
              </div>
            ))}
          </div>
        ) : user === null ? (
          /* 未登录空态：引导登录 */
          <m.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex flex-col items-center px-8 pb-16 pt-14"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full bg-olive-tint text-olive">
              <Heart size={28} strokeWidth={1.8} />
            </span>
            <p className="mt-4 text-[15px] leading-[22px] text-ink-60">登录后查看你收藏的钓场与帖子</p>
            <m.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => requireAuth('查看我的收藏')}
              className="mt-5 flex h-12 w-40 items-center justify-center rounded-xl bg-olive text-[15px] font-semibold leading-[22px] text-paper-white"
            >
              立即登录
            </m.button>
          </m.div>
        ) : items.length === 0 ? (
          <EmptyState text="还没有收藏钓场" cta="去钓点逛逛" onCta={() => navigate('/spots')} />
        ) : (
          <div className="pt-3">
            {items.map((item, i) => (
              <FavRow key={item.slug} item={item} index={i} />
            ))}
          </div>
        )
      ) : meLoading || postsLoading ? (
        /* 帖子收藏加载骨架 */
        <div className="space-y-3 pt-3">
          {[0, 1, 2].map((i) => (
            <div key={`skp-${i}`} className="mx-4 flex animate-pulse gap-3 rounded-2xl bg-paper-white p-3">
              <div className="h-20 w-20 shrink-0 rounded-xl bg-paper" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-4 w-28 rounded bg-paper" />
                <div className="h-3 w-full rounded bg-paper" />
                <div className="h-3 w-1/2 rounded bg-paper" />
              </div>
            </div>
          ))}
        </div>
      ) : user === null ? (
        <EmptyState text="登录后才能看到你收藏的帖子" cta="立即登录" onCta={() => requireAuth('查看我的收藏')} />
      ) : favPosts.length === 0 ? (
        <EmptyState text="还没有收藏帖子" cta="去首页看看" onCta={() => navigate('/')} />
      ) : (
        <div className="pt-3">
          {favPosts.map((post, i) => (
            <FavPostRow key={post.id} post={post} index={i} />
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => favPostsQuery.fetchNextPage()}
              disabled={favPostsQuery.isFetchingNextPage}
              className="mx-auto mt-1 flex h-10 w-full max-w-[280px] items-center justify-center rounded-xl border border-olive bg-paper-white text-[14px] font-semibold text-olive disabled:opacity-40"
            >
              {favPostsQuery.isFetchingNextPage ? '加载中…' : '加载更多'}
            </button>
          )}
        </div>
      )}

      {loginSheet}
    </div>
  )
}
