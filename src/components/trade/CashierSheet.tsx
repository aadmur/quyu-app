import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, MessageCircle, Wallet, Loader2 } from 'lucide-react'
import { formatMoney } from '@/data/orders'

/** 支付宝线性图标（lucide 无品牌图标，自绘「支」字圆章） */
function AlipayIcon() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-md border-[1.8px] border-olive text-[13px] font-bold leading-none text-olive">
      支
    </span>
  )
}

const METHODS = [
  { id: 'wechat', name: '微信支付', note: '', render: () => <MessageCircle size={24} strokeWidth={1.8} className="text-lake" /> },
  { id: 'alipay', name: '支付宝', note: '', render: () => <AlipayIcon /> },
  { id: 'balance', name: '余额支付', note: '余额 ¥128.50', render: () => <Wallet size={24} strokeWidth={1.8} className="text-ink" /> },
] as const

interface CashierSheetProps {
  amount: number
  summary: string
  onPaid: () => void
  onClose: () => void
}

/** 收银台全屏弹层：金额巨字 + 支付方式单选 + 确认支付（loading 1.2s） */
export default function CashierSheet({ amount, summary, onPaid, onClose }: CashierSheetProps) {
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('wechat')
  const [paying, setPaying] = useState(false)

  const pay = () => {
    if (paying) return
    setPaying(true)
    window.setTimeout(onPaid, 1200)
  }

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-ink"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        exit={{ opacity: 0 }}
        onClick={() => !paying && onClose()}
      />
      <motion.div
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[420px] flex-col bg-paper-white"
        style={{ top: 'max(var(--safe-top, 0px), 44px)' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
      >
        {/* 顶部 */}
        <div className="flex h-12 shrink-0 items-center justify-center border-b border-line">
          <button
            type="button"
            aria-label="关闭收银台"
            onClick={onClose}
            disabled={paying}
            className="absolute left-3 flex h-10 w-10 items-center justify-center text-ink-60"
          >
            <X size={22} strokeWidth={1.8} />
          </button>
          <span className="text-[18px] font-semibold leading-6 text-ink">收银台</span>
        </div>

        {/* 金额巨字 */}
        <div className="flex shrink-0 flex-col items-center gap-1 px-6 pb-6 pt-8">
          <motion.p
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.15, ease: 'easeOut' }}
            className="font-num text-[56px] leading-[56px] text-ink"
          >
            ¥{formatMoney(amount)}
          </motion.p>
          <p className="text-[12px] leading-4 text-ink-60">{summary}</p>
        </div>

        {/* 支付方式 */}
        <div className="flex-1 overflow-y-auto border-t border-line px-4">
          {METHODS.map((m) => {
            const active = method === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                className="flex h-14 w-full items-center gap-3 border-b border-line text-left"
              >
                {m.render()}
                <span className="flex-1">
                  <span className="block text-[15px] leading-[22px] text-ink">{m.name}</span>
                  {m.note && <span className="block text-[12px] leading-4 text-ink-60">{m.note}</span>}
                </span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-[1.8px] ${
                    active ? 'border-olive' : 'border-line'
                  }`}
                >
                  {active && <motion.span layoutId="pay-radio" className="h-2.5 w-2.5 rounded-full bg-olive" />}
                </span>
              </button>
            )
          })}
        </div>

        {/* 底部确认 */}
        <div
          className="shrink-0 border-t border-line px-4 pt-3"
          style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 16px)' }}
        >
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={pay}
            disabled={paying}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-olive text-[15px] font-semibold leading-[22px] text-paper-white disabled:bg-olive-deep"
          >
            {paying && <Loader2 size={18} strokeWidth={2} className="animate-spin" />}
            {paying ? '支付中…' : `确认支付 ¥${formatMoney(amount)}`}
          </motion.button>
        </div>
      </motion.div>
    </>
  )
}
