import { motion } from 'framer-motion'
import { Keyboard } from 'lucide-react'

interface ScanVerifyCardProps {
  verifiedCount: number
  onScan: () => void
  onManual: () => void
}

/** 扫码核销大卡：核销门票标题 + 扫码核销 / 手动输码两枚大按钮 */
export default function ScanVerifyCard({ verifiedCount, onScan, onManual }: ScanVerifyCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
      className="mx-4 mb-4 rounded-2xl bg-paper-white p-4"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">核销门票</h2>
        <p className="text-[12px] leading-4 text-ink-60">今日已核销 {verifiedCount} 张</p>
      </div>
      <div className="flex gap-2.5">
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={onScan}
          className="flex h-[88px] flex-1 flex-col items-center justify-center gap-1.5 rounded-xl bg-olive text-paper-white"
        >
          <img src="/icon-scan.svg" alt="" className="h-8 w-8 invert" />
          <span className="text-[15px] font-semibold leading-[22px]">扫码核销</span>
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={onManual}
          className="flex h-[88px] flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-olive bg-paper-white text-olive"
        >
          <Keyboard size={30} strokeWidth={1.8} />
          <span className="text-[15px] font-semibold leading-[22px]">手动输码</span>
        </motion.button>
      </div>
    </motion.section>
  )
}
