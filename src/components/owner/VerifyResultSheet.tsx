import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { PendingOrder } from '@/data/owner'

/** 核销成功对勾描边动画（stroke-dashoffset 效果，0.6s） */
function CheckDraw() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <motion.circle
        cx="36"
        cy="36"
        r="32"
        stroke="#5e7a6e"
        strokeWidth="3"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      <motion.path
        d="M22 37 L32 47 L51 27"
        stroke="#5e7a6e"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut', delay: 0.35 }}
      />
    </svg>
  )
}

interface VerifyResultSheetProps {
  order: PendingOrder | null
  /** 点击「完成」：关闭并触发计数 +1 / 列表滑出 */
  onDone: (order: PendingOrder) => void
}

/** 核销结果弹层：对勾描边动画 + 票据信息卡（对应钓友端 QRCodeCard 信息） */
export default function VerifyResultSheet({ order, onDone }: VerifyResultSheetProps) {
  const [verifiedAt, setVerifiedAt] = useState('')
  useEffect(() => {
    if (order) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(30)
      // 核销时间取弹层展示时的真实本地时间
      setVerifiedAt(
        new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      )
    }
  }, [order])

  return (
    <AnimatePresence>
      {order && (
        <>
          <motion.div
            key="mask"
            className="fixed inset-0 z-[60] mx-auto max-w-[420px] bg-ink"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
          <motion.div
            key="sheet"
            className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex w-full max-w-[420px] flex-col items-center rounded-t-[20px] bg-paper-white px-6 pt-8"
            style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 32px)' }}
            initial={{ scale: 0.9, y: '40%', opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: '30%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <CheckDraw />
            <h2 className="mt-3 text-[28px] font-bold leading-[34px] text-ink">核销成功</h2>

            {/* 票据信息卡 */}
            <div className="mt-4 w-full rounded-xl bg-paper p-4">
              <div className="flex items-center gap-2.5">
                <img src={order.avatar} alt={order.name} className="h-9 w-9 rounded-full object-cover" />
                <div>
                  <p className="text-[15px] font-semibold leading-[22px] text-ink">{order.name}</p>
                  <p className="text-[12px] leading-4 text-ink-60">
                    {order.ticket} · {order.seat}
                  </p>
                </div>
                <span className="ml-auto rounded-full bg-lake-tint px-2.5 py-1 text-[12px] leading-3 text-lake">已核销</span>
              </div>
              <div className="mt-3 flex items-end justify-between border-t border-line pt-3">
                <div>
                  <p className="text-[12px] leading-4 text-ink-60">核销码</p>
                  <p className="font-num text-[32px] leading-9 tracking-[0.15em] text-ink">{order.code}</p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] leading-4 text-ink-60">核销时间</p>
                  <p className="font-num text-[20px] leading-6 text-ink">{verifiedAt || '--:--'}</p>
                </div>
              </div>
            </div>

            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => onDone(order)}
              className="mt-5 h-12 w-full rounded-xl bg-olive text-[15px] font-semibold text-paper-white"
            >
              完成
            </motion.button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
