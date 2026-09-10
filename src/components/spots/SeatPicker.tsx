import { m } from 'framer-motion'
import { Crown } from 'lucide-react'
import type { Seat } from '@/data/spots'

interface SeatPickerProps {
  seats: Seat[]
  selected: number
  onSelect: (seat: Seat) => void
}

/** 在线选钓位：24 个编号格（4×6），空闲/已售/VIP/选中四态，点击进入视口波次出现 */
export default function SeatPicker({ seats, selected, onSelect }: SeatPickerProps) {
  const current = seats.find((s) => s.no === selected)

  return (
    <section className="mx-4 mb-6">
      {/* 标题行 */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">钓位示意</h2>
        <span className="text-[12px] leading-4 text-ink-60">绿色为空闲</span>
      </div>

      {/* 俯瞰示意图 */}
      <img
        src="/seat-map.svg"
        alt="钓位俯瞰示意图"
        className="mb-3 w-full rounded-lg border border-line bg-paper"
        draggable={false}
      />

      {/* 24 格在线选位 */}
      <div className="grid grid-cols-6 gap-2">
        {seats.map((seat, i) => {
          const isSelected = seat.no === selected
          const sold = seat.status === 'sold'
          const vip = seat.status === 'vip'
          return (
            <m.button
              key={seat.no}
              type="button"
              disabled={sold}
              aria-label={`${seat.no} 号钓位${sold ? '（已售）' : ''}`}
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true, margin: '-10% 0px' }}
              transition={{ type: 'spring', stiffness: 380, damping: 22, delay: i * 0.02 }}
              onClick={() => onSelect(seat)}
              className={`relative flex aspect-square items-center justify-center rounded-lg border font-num text-[14px] leading-none ${
                isSelected
                  ? 'border-lake bg-lake text-paper-white'
                  : sold
                    ? 'border-transparent bg-[#2d1e1e1f] text-ink-40'
                    : vip
                      ? 'border-olive bg-olive-tint text-olive'
                      : 'border-lake bg-paper-white text-lake'
              }`}
            >
              {vip && !isSelected && (
                <Crown size={9} strokeWidth={2} className="absolute right-0.5 top-0.5 text-olive" />
              )}
              <m.span
                animate={isSelected ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                className="inline-block"
              >
                {seat.no}
              </m.span>
            </m.button>
          )
        })}
      </div>

      {/* 注释行 */}
      <p className="mt-2.5 text-[13px] leading-[18px] text-ink-60">
        {current ? `当前选中：${current.no} 号位 · ${current.note}${current.status === 'vip' ? '（VIP）' : ''}` : '点上方编号格选钓位'}
      </p>
    </section>
  )
}
