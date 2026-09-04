import { useState } from 'react'
import { motion } from 'framer-motion'
import { WEEK_STATS } from '@/data/owner'

type Metric = 'tickets' | 'income'

const BAR_AREA = 120

/** 近 7 日经营条形图：售票/收入切换，条顶 Bebas 数值，点按浮现数值气泡 */
export default function WeekChart() {
  const [metric, setMetric] = useState<Metric>('tickets')
  const [selected, setSelected] = useState<number | null>(null)

  const values = WEEK_STATS.map((d) => d[metric])
  const max = Math.max(...values)
  const format = (v: number) => (metric === 'income' ? `¥${v.toLocaleString('zh-CN')}` : String(v))

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mx-4 mb-10 rounded-2xl bg-paper-white p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">近 7 日{metric === 'tickets' ? '售票' : '收入'}</h2>
        {/* 指标切换胶囊 */}
        <div className="flex rounded-full bg-paper p-0.5">
          {(
            [
              { key: 'tickets', label: '售票' },
              { key: 'income', label: '收入' },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                setMetric(m.key)
                setSelected(null)
              }}
              className={`relative h-7 rounded-full px-3 text-[12px] leading-none ${
                metric === m.key ? 'font-semibold text-paper-white' : 'text-ink-60'
              }`}
            >
              {metric === m.key && (
                <motion.span
                  layoutId="week-metric-pill"
                  className="absolute inset-0 rounded-full bg-olive"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 条形图：条宽 24px 自适应间距，最高条（周六）olive-deep 强调；scaleY origin-bottom 入场 stagger */}
      <div className="mt-6 flex items-end justify-between px-1">
        {WEEK_STATS.map((d, i) => {
          const v = d[metric]
          const isMax = v === max
          const ratio = v / max
          const barTop = BAR_AREA * (1 - ratio)
          return (
            <div key={d.day} className="flex w-10 flex-col items-center gap-1">
              <div className="relative" style={{ height: BAR_AREA, width: 24 }}>
                {/* 条顶数值（transform 跟随条高，避免布局动画） */}
                <motion.span
                  className="pointer-events-none absolute left-1/2 whitespace-nowrap font-num text-[12px] leading-4 text-ink-60"
                  style={{ top: 0, x: '-50%' }}
                  initial={{ y: BAR_AREA - 18, opacity: 0 }}
                  animate={{ y: barTop - 18, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 220, damping: 24, delay: i * 0.06 }}
                >
                  {metric === 'income' ? `${(v / 1000).toFixed(1)}k` : v}
                </motion.span>
                {/* 点按数值气泡 */}
                {selected === i && (
                  <motion.span
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                    className="pointer-events-none absolute -top-7 left-1/2 z-10 whitespace-nowrap rounded-full bg-ink px-2 py-0.5 font-num text-[12px] leading-4 text-paper"
                    style={{ x: '-50%' }}
                  >
                    {format(v)}
                  </motion.span>
                )}
                <motion.button
                  type="button"
                  aria-label={`周${d.day} ${metric === 'tickets' ? '售票' : '收入'} ${format(v)}`}
                  onClick={() => setSelected(selected === i ? null : i)}
                  className={`absolute bottom-0 left-0 h-full w-6 rounded-t-md ${isMax ? 'bg-olive-deep' : 'bg-olive'} ${
                    selected === i ? 'ring-1 ring-ink/30' : ''
                  }`}
                  style={{ originY: 1 }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: ratio }}
                  transition={{ type: 'spring', stiffness: 220, damping: 24, delay: i * 0.06 }}
                />
              </div>
              <span className="text-[12px] leading-4 text-ink-60">{d.day}</span>
            </div>
          )
        })}
      </div>
    </motion.section>
  )
}
