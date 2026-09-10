import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Heart, Star } from 'lucide-react'
import type { Pond } from '@/data/spots'
import FishChip from './FishChip'
import { Toast, useToast } from './Toast'
import { usePondMarks } from '@/hooks/usePondMarks'

interface PondCardProps {
  pond: Pond
  index: number
}

/** 钓场大卡：封面 3:2 + 距离胶囊 + 收藏（后端化：ponds.myMarks / toggleMark）+ 今日鱼讯横幅 + 信息区 + 立即购票 */
export default function PondCard({ pond, index }: PondCardProps) {
  const navigate = useNavigate()
  const { message, show } = useToast()
  const { isFav, toggleFav, loginSheet } = usePondMarks({ onToast: show })
  const fav = isFav(pond.id)

  return (
    <>
    <motion.article
      layout
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-15% 0px' }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: Math.min(index, 2) * 0.1 }}
      className="mx-4 mb-5 cursor-pointer overflow-hidden rounded-2xl border border-line bg-paper-white"
      onClick={() => navigate(`/pond/${pond.id}`)}
    >
      {/* 封面图 3:2 */}
      <div className="relative">
        <motion.img
          src={pond.cover}
          alt={pond.name}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 1.02 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="aspect-[3/2] w-full bg-paper object-cover"
          draggable={false}
        />
        {/* 左上：距离胶囊 */}
        <span className="absolute left-3 top-3 rounded-full bg-ink/40 px-2.5 py-1 font-num text-[12px] leading-4 text-paper-white">
          {pond.distanceKm}km
        </span>
        {/* 右上：收藏心形 */}
        <motion.button
          type="button"
          aria-label="收藏"
          whileTap={{ scale: 0.85 }}
          onClick={(e) => {
            e.stopPropagation()
            toggleFav(pond.id)
          }}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-ink/40 text-paper-white"
        >
          <Heart size={18} strokeWidth={1.8} fill={fav ? '#b3502e' : 'none'} className={fav ? 'text-heart' : ''} />
        </motion.button>
      </div>

      {/* 今日鱼讯横幅（封面下缘） */}
      {pond.todayNews && (
        <p className="bg-lake-tint px-3.5 py-1.5 text-[12px] leading-4 text-lake">{pond.todayNews}</p>
      )}

      {/* 信息区 */}
      <div className="px-3.5 py-3">
        {/* 行 1：塘名 + 评分 */}
        <div className="flex items-center justify-between gap-2">
          <h3 className="min-w-0 truncate text-[18px] font-semibold leading-6 text-ink">{pond.name}</h3>
          <span className="flex shrink-0 items-center gap-1">
            <Star size={16} strokeWidth={0} className="fill-olive text-olive" />
            <span className="font-num text-[20px] leading-6 text-ink">{pond.rating}</span>
          </span>
        </div>
        {/* 行 2：标签胶囊组 */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pond.tags.map((t) => (
            <FishChip key={t} label={t} plain={!/鱼|鲫|鲤|鳊|鲈|鳜|翘嘴|青鱼|草鱼/.test(t)} />
          ))}
        </div>
        {/* 行 3：地址 */}
        <p className="mt-2 truncate text-[13px] leading-[18px] text-ink-60">
          {pond.address}
          {pond.addressExtra ? ` · ${pond.addressExtra}` : ''}
        </p>
        {/* 行 4：价格 + 立即购票 */}
        <div className="mt-2.5 flex items-center justify-between">
          <p className="flex items-baseline gap-1">
            <span className="font-num text-[20px] leading-6 text-clay">¥{pond.priceFrom}</span>
            <span className="text-[12px] leading-4 text-ink-40">起</span>
          </p>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/pond/${pond.id}`, { state: { openDateSheet: true } })
            }}
            className="h-9 rounded-[10px] bg-olive px-4 text-[14px] font-semibold leading-none text-paper-white"
          >
            立即购票
          </motion.button>
        </div>
      </div>
    </motion.article>
    {/* 收藏反馈 toast + 未登录引导层（fixed 定位，不影响卡片布局） */}
    <Toast message={message} />
    {loginSheet}
    </>
  )
}
