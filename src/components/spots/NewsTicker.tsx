import { m } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import type { PondNewsFlash } from '@/data/spots'

interface NewsTickerProps {
  items: PondNewsFlash[]
}

/** 实时鱼讯快报条：横向滑动卡片（240×88），scroll-snap 吸附 */
export default function NewsTicker({ items }: NewsTickerProps) {
  const navigate = useNavigate()
  return (
    <section className="my-4">
      {/* 区块标题行：H2 + 呼吸圆点 +「直播中」 */}
      <div className="mb-2 flex items-center gap-1.5 px-4">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">实时鱼讯</h2>
        <m.span
          animate={{ scale: [1, 1.4, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="ml-1 h-1.5 w-1.5 rounded-full bg-lake"
        />
        <span className="text-[12px] leading-4 text-lake">直播中</span>
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4">
        {items.map((n, i) => (
          <m.button
            key={n.id}
            type="button"
            onClick={() => navigate(`/pond/${n.pondId}`)}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: 0.15 + i * 0.08 }}
            className="flex h-[88px] w-60 shrink-0 snap-start flex-col rounded-xl border border-line bg-paper-white p-3 text-left"
          >
            <p className="text-[13px] font-semibold leading-[18px] text-ink">{n.pondName}</p>
            <p className="mt-0.5 line-clamp-2 flex-1 text-[13px] leading-[18px] text-ink-60">{n.text}</p>
            <p className="text-[12px] leading-4 text-ink-40">{n.time}</p>
          </m.button>
        ))}
      </div>
    </section>
  )
}
