import { m } from 'framer-motion'

interface PondStatusCardProps {
  open: boolean
  onToggle: (next: boolean) => void
}

/**
 * 钓场卡：全站唯一深色卡（olive-deep），凸显工作台属性。
 * 右侧「营业中」胶囊 + 开关；关闭时整卡降饱和 50%。
 */
export default function PondStatusCard({ open, onToggle }: PondStatusCardProps) {
  return (
    <m.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut', delay: 0.05 }}
      className="mx-4 mb-4 mt-2 flex items-center gap-3 rounded-2xl bg-olive-deep p-3.5 transition-[filter] duration-300"
      style={{ filter: open ? 'saturate(1)' : 'saturate(0.5)' }}
    >
      <img src="/pond-qinglong-1.jpg" alt="青龙湾生态钓场" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-[22px] text-paper-white">青龙湾生态钓场</p>
        <p className="text-[12px] leading-4 text-paper-white/60">评分 4.8 · 326 条评价</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="rounded-full bg-paper-white/15 px-2.5 py-1 text-[12px] leading-3 text-paper-white">
          {open ? '营业中' : '已暂停'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="营业开关"
          onClick={() => onToggle(!open)}
          className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 ${
            open ? 'justify-end bg-lake' : 'justify-start bg-paper-white/25'
          }`}
        >
          <m.span layout className="h-5 w-5 rounded-full bg-paper-white" transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
        </button>
      </div>
    </m.section>
  )
}
