import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Heart, Star } from 'lucide-react'
import PageHeader from '@/components/trade/PageHeader'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/components/LoginSheet'

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
    <motion.button
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
    </motion.button>
  )
}

/** 空收藏：空鱼护插画 + 引导去钓点 */
function EmptyFavorites() {
  const navigate = useNavigate()
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center px-8 pb-16 pt-14"
    >
      <img src="/empty-creel.svg" alt="" className="h-40 w-[200px]" />
      <p className="mt-4 text-[15px] leading-[22px] text-ink-60">还没有收藏钓场</p>
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={() => navigate('/spots')}
        className="mt-5 flex h-12 w-40 items-center justify-center rounded-xl border border-olive bg-paper-white text-[15px] font-semibold leading-[22px] text-olive"
      >
        去钓点逛逛
      </motion.button>
    </motion.div>
  )
}

/** 我的收藏 /favorites（二级页）： ponds.myFavorites 列表；未登录空态引导登录 */
export default function Favorites() {
  const { user, requireAuth, loginSheet } = useAuthGate()
  const meLoading = user === undefined

  const favQuery = trpc.app.ponds.myFavorites.useQuery(undefined, {
    enabled: !!user,
    retry: 1,
  })
  const items = (favQuery.data ?? []) as FavPondItem[]

  return (
    <div className="min-h-full bg-paper pb-8">
      <PageHeader title="我的收藏" />

      {meLoading || (user && favQuery.isLoading) ? (
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
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="flex flex-col items-center px-8 pb-16 pt-14"
        >
          <span className="grid h-16 w-16 place-items-center rounded-full bg-olive-tint text-olive">
            <Heart size={28} strokeWidth={1.8} />
          </span>
          <p className="mt-4 text-[15px] leading-[22px] text-ink-60">登录后查看你收藏的钓场</p>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => requireAuth('查看我的收藏')}
            className="mt-5 flex h-12 w-40 items-center justify-center rounded-xl bg-olive text-[15px] font-semibold leading-[22px] text-paper-white"
          >
            立即登录
          </motion.button>
        </motion.div>
      ) : items.length === 0 ? (
        <EmptyFavorites />
      ) : (
        <div className="pt-3">
          {items.map((item, i) => (
            <FavRow key={item.slug} item={item} index={i} />
          ))}
        </div>
      )}

      {loginSheet}
    </div>
  )
}
