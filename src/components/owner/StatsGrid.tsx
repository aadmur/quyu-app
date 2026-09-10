import { memo, useEffect } from 'react'
import { animate, m, useMotionValue, useTransform } from 'framer-motion'
import { TODAY_STATS } from '@/data/owner'
import type { TodayStat } from '@/data/owner'

/** 数字 counter：MotionValue 驱动，避免逐帧 re-render */
function StatNumber({ stat, index, override }: { stat: TodayStat; index: number; override?: number }) {
  const value = override ?? stat.value
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => stat.format(v))

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.9,
      delay: index * 0.1,
      ease: 'easeOut',
    })
    return () => controls.stop()
  }, [mv, value, index])

  return <m.span className="font-num text-[32px] leading-9 text-ink">{text}</m.span>
}

/** 「在钓人数」实时呼吸圆点（隔离的 perpetual 动画微组件） */
const LiveDot = memo(function LiveDot() {
  return (
    <m.span
      className="inline-block h-2 w-2 rounded-full bg-lake"
      animate={{ scale: [1, 1.4, 1] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
})

interface StatsGridProps {
  /** 「已核销」被扫码核销后 +1，触发 counter 重滚 */
  verifiedOverride?: number
  /** 真实看板数值覆盖（orders.ownerStats）：key 为 stat.id */
  overrides?: Partial<Record<string, number>>
}

/** 今日数据 4 宫格：白底圆角 12，大数字 + 环比/实时行 */
export default function StatsGrid({ verifiedOverride, overrides }: StatsGridProps) {
  return (
    <section className="mx-4 mb-4 grid grid-cols-2 gap-2.5">
      {TODAY_STATS.map((stat, i) => (
        <div key={stat.id} className="rounded-xl bg-paper-white p-3.5">
          <p className="text-[12px] leading-4 text-ink-60">{stat.label}</p>
          <div className="mt-1">
            <StatNumber
              stat={stat}
              index={i}
              override={stat.id === 'verified' ? verifiedOverride : overrides?.[stat.id]}
            />
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] leading-4">
            {stat.realtime ? (
              <span className="flex items-center gap-1.5 text-lake">
                <LiveDot />
                实时
              </span>
            ) : (
              <span className={stat.deltaUp ? 'text-lake' : 'text-clay'}>{stat.delta}</span>
            )}
          </p>
        </div>
      ))}
    </section>
  )
}
