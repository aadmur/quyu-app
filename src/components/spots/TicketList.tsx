import { m } from 'framer-motion'
import { Check } from 'lucide-react'
import type { TicketType } from '@/data/spots'

interface TicketListProps {
  tickets: TicketType[]
  selectedId: string
  onSelect: (t: TicketType) => void
}

/** 票种列表：选中态 2px olive 描边 + olive-tint 底 + 单选圆圈 */
export default function TicketList({ tickets, selectedId, onSelect }: TicketListProps) {
  return (
    <section className="mx-4 mb-[100px]">
      <h2 className="mb-2 text-[18px] font-semibold leading-6 text-ink">选择票种</h2>
      <div className="flex flex-col gap-2.5">
        {tickets.map((t, i) => {
          const active = t.id === selectedId
          return (
            <m.button
              key={t.id}
              type="button"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10% 0px' }}
              transition={{ duration: 0.4, ease: 'easeOut', delay: i * 0.07 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelect(t)}
              className={`relative flex items-center rounded-2xl bg-paper-white p-4 text-left transition-colors duration-200 ${
                active ? 'bg-olive-tint shadow-[inset_0_0_0_2px_#716a4b]' : 'shadow-[inset_0_0_0_1px_#2d1e1e14]'
              }`}
            >
              {t.badge && (
                <span className="absolute right-3 top-0 -translate-y-1/2 rounded-full bg-lake px-2.5 py-0.5 text-[12px] leading-4 text-paper-white">
                  {t.badge}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-[22px] text-ink">{t.name}</span>
                <span className="mt-0.5 block text-[12px] leading-4 text-ink-60">{t.desc}</span>
              </span>
              <span className="mx-3 font-num text-[20px] leading-6 text-clay">¥{t.price}</span>
              {/* 单选圆圈 */}
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  active ? 'border-olive bg-olive' : 'border-ink-40 bg-paper-white'
                }`}
              >
                {active && <Check size={13} strokeWidth={2.6} className="text-paper-white" />}
              </span>
            </m.button>
          )
        })}
      </div>
    </section>
  )
}
