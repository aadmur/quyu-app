import { useState } from 'react'
import { m } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'
import { formatMoney } from '@/data/orders'

interface CashierSheetProps {
  amount: number
  summary: string
  onPaid: () => void
  onClose: () => void
}

/** 收银台全屏弹层：金额巨字 + 订单摘要 + 确认下单。
 *  测试环境说明：无支付商户资质时不接真实扣款通道，本层只做下单确认——
 *  点击确认后真实创建订单落库（orders.create），文案如实告知，不伪装支付过程。 */
export default function CashierSheet({ amount, summary, onPaid, onClose }: CashierSheetProps) {
  const [paying, setPaying] = useState(false)

  const pay = () => {
    if (paying) return
    setPaying(true)
    onPaid()
  }

  return (
    <>
      <m.div
        className="fixed inset-0 z-40 bg-ink"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        exit={{ opacity: 0 }}
        onClick={() => !paying && onClose()}
      />
      <m.div
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
          <m.p
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.15, ease: 'easeOut' }}
            className="font-num text-[56px] leading-[56px] text-ink"
          >
            ¥{formatMoney(amount)}
          </m.p>
          <p className="text-[12px] leading-4 text-ink-60">{summary}</p>
        </div>

        {/* 订单摘要 + 测试环境说明 */}
        <div className="flex-1 overflow-y-auto border-t border-line px-4 py-4">
          <div className="rounded-xl bg-paper p-3.5 text-[13px] leading-[20px] text-ink-60">
            <p className="font-semibold text-ink">测试环境 · 不产生真实扣款</p>
            <p className="mt-1">
              本站为测试部署，未接入微信支付/支付宝商户通道。点击「确认下单」将真实创建订单并写入数据库，可在「我的票券」中查看与核销。
            </p>
          </div>
        </div>

        {/* 底部确认 */}
        <div
          className="shrink-0 border-t border-line px-4 pt-3"
          style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 16px)' }}
        >
          <m.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={pay}
            disabled={paying}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-olive text-[15px] font-semibold leading-[22px] text-paper-white disabled:bg-olive-deep"
          >
            {paying && <Loader2 size={18} strokeWidth={2} className="animate-spin" />}
            {paying ? '下单中…' : `确认下单 ¥${formatMoney(amount)}`}
          </m.button>
        </div>
      </m.div>
    </>
  )
}
