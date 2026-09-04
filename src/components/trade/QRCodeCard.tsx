import { motion, AnimatePresence } from 'framer-motion'
import type { Order } from '@/data/orders'

interface QRCodeCardProps {
  order: Order
  /** 是否已核销（控制印章与徽章） */
  used: boolean
  /** 演示入口：点击触发「模拟塘主核销」 */
  onSimulateUse?: () => void
}

/** 核销码卡：白底圆角 20，二维码 + 6 位核销码（Bebas 大字）+ 票种信息 + 已核销印章动画 */
export default function QRCodeCard({ order, used, onSimulateUse }: QRCodeCardProps) {
  const digits = order.verifyCode.split('')

  return (
    <div className="w-[320px] max-w-full rounded-[20px] bg-paper-white p-6 shadow-[0_8px_24px_rgba(45,30,30,0.12)]">
      {/* 顶行：塘名 + 状态徽章 */}
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold leading-[22px] text-ink">{order.pond.name}</span>
        <span
          className={`rounded-full px-2.5 py-1 text-[12px] leading-4 ${
            used ? 'bg-lake-tint text-lake' : 'bg-olive-tint text-olive'
          }`}
        >
          {used ? '已核销' : '待使用'}
        </span>
      </div>

      {/* 二维码 + 已核销印章 */}
      <div className="relative mx-auto mt-4 h-[216px] w-[216px]">
        <img
          src="/qr-demo.svg"
          alt="核销二维码"
          className={`h-full w-full transition-opacity duration-300 ${used ? 'opacity-60' : ''}`}
        />
        <AnimatePresence>
          {used && (
            <motion.div
              initial={{ scale: 2, opacity: 0 }}
              animate={{ scale: 1, opacity: 0.9 }}
              exit={{ scale: 2, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div
                className="flex h-[88px] w-[88px] items-center justify-center rounded-lg border-[2.5px] border-clay bg-paper-white/70"
                style={{ transform: 'rotate(-14deg)' }}
              >
                <span className="text-[20px] font-bold leading-6 text-clay">已核销</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 6 位核销码：Bebas 32px，字距 0.15em */}
      <p className="mt-3 text-center font-num text-[32px] leading-9 tracking-[0.15em] text-ink">
        {digits.join(' ')}
      </p>
      <p className="mt-1 text-center text-[12px] leading-4 text-ink-60">
        向塘主出示二维码或报核销码
      </p>

      {/* 票种信息行 */}
      <div className="mt-4 border-t border-line pt-3 text-center text-[13px] leading-[18px] text-ink-60">
        {order.ticketName} × {order.qty} · {order.dateShort}
        {order.seatNo ? ` · ${order.seatNo} 号钓位` : ''}
      </div>

      {/* 底部细节 */}
      <p className="mt-3 text-center text-[12px] leading-4 text-ink-40">亮度已自动调高</p>

      {/* 演示入口：模拟塘主核销 */}
      {!used && onSimulateUse && (
        <button
          type="button"
          onClick={onSimulateUse}
          className="mx-auto mt-2 block text-[12px] leading-4 text-ink-40 underline underline-offset-2"
        >
          模拟塘主核销（演示）
        </button>
      )}
    </div>
  )
}
