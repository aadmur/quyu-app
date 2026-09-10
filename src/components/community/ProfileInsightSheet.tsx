import { m } from 'framer-motion'
import { X, Sparkles } from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { POND_NAME_BY_SLUG } from '@/lib/live'

interface ProfileInsightSheetProps {
  onClose: () => void
}

interface BarRowProps {
  label: string
  ratio: number
  index: number
}

/** 偏好横条：橄榄绿进度条，stagger 入场 */
function BarRow({ label, ratio, index }: BarRowProps) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-16 shrink-0 truncate text-[13px] leading-[18px] text-ink">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#2d1e1e0d]">
        <m.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: Math.max(ratio, 0.03) }}
          transition={{ delay: 0.15 + index * 0.07, duration: 0.5, ease: 'easeOut' }}
          style={{ transformOrigin: 'left' }}
          className="h-full rounded-full bg-olive"
        />
      </div>
      <span className="w-11 shrink-0 text-right font-num text-[13px] leading-4 text-ink-60">
        {Math.round(ratio * 100)}%
      </span>
    </div>
  )
}

/** 「我的兴趣画像」底部弹层：profileInsight() 的鱼种/钓场偏好横条占比（推荐算法可视化） */
export default function ProfileInsightSheet({ onClose }: ProfileInsightSheetProps) {
  const insightQuery = trpc.app.profileInsight.useQuery(undefined, { retry: 1 })
  const fishPrefs = Object.entries(insightQuery.data?.fishPrefs ?? {}).sort((a, b) => b[1] - a[1])
  const pondPrefs = Object.entries(insightQuery.data?.pondPrefs ?? {})
    .map(([slug, v]) => [POND_NAME_BY_SLUG[slug] ?? slug, v] as [string, number])
    .sort((a, b) => b[1] - a[1])
  const empty = insightQuery.data && fishPrefs.length === 0 && pondPrefs.length === 0

  return (
    <>
      <m.div
        className="fixed inset-0 z-40 bg-black"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <m.div
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[76dvh] max-w-[420px] flex-col rounded-t-[20px] bg-paper-white shadow-[0_8px_24px_rgba(45,30,30,0.12)]"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose()
        }}
      >
        <div className="flex h-12 shrink-0 items-center justify-center border-b border-line">
          <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-[22px] text-ink">
            <Sparkles size={16} strokeWidth={1.8} className="text-olive" />
            我的兴趣画像
          </span>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 text-ink-60">
            <X size={22} strokeWidth={1.8} />
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto px-4 py-4"
          style={{ paddingBottom: 'max(var(--safe-bottom), 20px)' }}
        >
          <p className="text-[13px] leading-[18px] text-ink-60">
            趣渔根据你的浏览与互动实时推荐
          </p>

          {insightQuery.isLoading && (
            <div className="mt-4 animate-pulse space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-3 w-16 rounded bg-paper" />
                  <div className="h-2.5 flex-1 rounded-full bg-paper" />
                </div>
              ))}
            </div>
          )}

          {insightQuery.error && (
            <p className="mt-4 text-[13px] leading-[18px] text-ink-60">
              画像服务暂时不可用，先去刷刷渔获吧
            </p>
          )}

          {empty && (
            <p className="mt-4 text-[13px] leading-[18px] text-ink-60">
              还没有画像数据，多逛逛社区、点点赞，趣渔就会越来越懂你
            </p>
          )}

          {fishPrefs.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-1.5 text-[15px] font-semibold leading-[22px] text-ink">鱼种偏好</h3>
              {fishPrefs.map(([name, v], i) => (
                <BarRow key={name} label={name} ratio={v} index={i} />
              ))}
            </section>
          )}

          {pondPrefs.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-1.5 text-[15px] font-semibold leading-[22px] text-ink">钓场偏好</h3>
              {pondPrefs.map(([name, v], i) => (
                <BarRow key={name} label={name} ratio={v} index={i} />
              ))}
            </section>
          )}

          {(fishPrefs.length > 0 || pondPrefs.length > 0) && (
            <p className="mt-5 text-center text-[12px] leading-4 text-ink-40">
              每次浏览、点赞、评论都会实时更新这份画像
            </p>
          )}
        </div>
      </m.div>
    </>
  )
}
