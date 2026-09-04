import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronRight, Star } from 'lucide-react'
import type { PondReview } from '@/data/spots'

interface ReviewListProps {
  reviews: PondReview[]
  total: number
}

const PREVIEW_COUNT = 2

/** 钓友评价：默认 2 条预览卡，「查看全部」本地展开显示全部已加载评价 */
export default function ReviewList({ reviews, total }: ReviewListProps) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? reviews : reviews.slice(0, PREVIEW_COUNT)
  const canExpand = reviews.length > PREVIEW_COUNT

  return (
    <section className="mx-4 mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">
          钓友评价 <span className="font-num text-[20px]">{total}</span>
        </h2>
        {canExpand && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center text-[15px] font-semibold leading-[22px] text-olive"
          >
            {showAll ? '收起' : '查看全部'}
            {showAll ? (
              <ChevronDown size={16} strokeWidth={1.8} />
            ) : (
              <ChevronRight size={16} strokeWidth={1.8} />
            )}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        {visible.map((r, i) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: i * 0.08 }}
            className="rounded-xl border border-line bg-paper-white p-3"
          >
            <div className="flex items-center gap-2">
              <img src={r.avatar} alt={r.author} className="h-8 w-8 rounded-full bg-paper object-cover" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[18px] text-ink">
                {r.author}
              </span>
              {/* 星级 */}
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
            <p className="mt-2 text-[15px] leading-[22px] text-ink">{r.text}</p>
            <div className="mt-2 flex items-end justify-between">
              {r.image ? (
                <img src={r.image} alt="评价晒图" className="h-20 w-20 rounded-lg bg-paper object-cover" />
              ) : (
                <span />
              )}
              <span className="text-[12px] leading-4 text-ink-40">{r.time}</span>
            </div>
          </motion.div>
        ))}
      </div>
      {reviews.length === 0 && (
        <p className="rounded-xl border border-line bg-paper-white p-4 text-center text-[13px] leading-[18px] text-ink-60">
          还没有评价，钓过之后来说两句吧
        </p>
      )}
    </section>
  )
}
