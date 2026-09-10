import { useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'

interface DateSheetProps {
  open: boolean
  pondName: string
  onClose: () => void
  /** 确认时回传真实日期 key（yyyy-MM-dd，本地时区） */
  onConfirm: (dateKey: string) => void
}

/** 本地时区格式化 yyyy-MM-dd（不用 toISOString，避免 UTC 导致日期前一天） */
function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function next7Days() {
  const week = ['日', '一', '二', '三', '四', '五', '六']
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return {
      key: localDateKey(d),
      label: i === 0 ? '今天' : i === 1 ? '明天' : `周${week[d.getDay()]}`,
      date: `${d.getMonth() + 1}/${d.getDate()}`,
    }
  })
}

/** 选日期弹层：未来 7 天横排选择（「立即购票」直达详情页时自动弹出） */
export default function DateSheet({ open, pondName, onClose, onConfirm }: DateSheetProps) {
  const [days] = useState(next7Days)
  const [picked, setPicked] = useState(days[0].key)

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 bg-ink"
            onClick={onClose}
          />
          <m.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className="relative w-full max-w-[420px] rounded-t-[20px] bg-paper-white px-4 pt-5"
            style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 32px)' }}
          >
            <p className="text-center text-[15px] font-semibold leading-[22px] text-ink">选择日期</p>
            <p className="mt-0.5 text-center text-[12px] leading-4 text-ink-60">{pondName}</p>
            <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
              {days.map((d) => {
                const active = d.key === picked
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setPicked(d.key)}
                    className={`flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-xl border ${
                      active ? 'border-olive bg-olive text-paper-white' : 'border-line bg-paper-white text-ink'
                    }`}
                  >
                    <span className={`text-[12px] leading-4 ${active ? 'text-paper-white' : 'text-ink-60'}`}>
                      {d.label}
                    </span>
                    <span className="mt-0.5 font-num text-[15px] leading-none">{d.date}</span>
                  </button>
                )
              })}
            </div>
            <m.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => onConfirm(days.find((d) => d.key === picked)?.key ?? days[0].key)}
              className="mt-5 h-12 w-full rounded-xl bg-olive text-[15px] font-semibold text-paper-white"
            >
              选好了，去购票
            </m.button>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  )
}
