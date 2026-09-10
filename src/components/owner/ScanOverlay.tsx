import { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Keyboard } from 'lucide-react'

/** 扫描线（隔离的 perpetual 动画微组件） */
const ScanLine = memo(function ScanLine() {
  return (
    <motion.div
      className="absolute inset-x-3 h-0.5 rounded-full bg-lake"
      style={{ boxShadow: '0 0 12px #5e7a6e' }}
      animate={{ top: ['8%', '88%', '8%'] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
})

interface ScanOverlayProps {
  open: boolean
  /** 切到手动输码（真实核销入口） */
  onSwitchToManual: () => void
  onClose: () => void
}

/** 全屏扫码取景层：黑底 + 240×240 取景框 + 扫描线。
 *  诚实版：http 部署/无相机权限环境下不做假识别，引导到手动输码（真实核销链路）。 */
export default function ScanOverlay({ open, onSwitchToManual, onClose }: ScanOverlayProps) {
  const corners = [
    'left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-lg',
    'right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-lg',
    'left-0 bottom-0 border-l-[3px] border-b-[3px] rounded-bl-lg',
    'right-0 bottom-0 border-r-[3px] border-b-[3px] rounded-br-lg',
  ]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 mx-auto flex max-w-[420px] flex-col items-center bg-black"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex h-12 w-full items-center justify-between px-4 pt-2">
            <span className="text-[15px] font-semibold leading-[22px] text-paper-white">扫码核销</span>
            <button
              type="button"
              aria-label="关闭扫码"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-white/15 text-paper-white"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
          </div>

          {/* 取景框 */}
          <div className="mt-16">
            <div className="relative h-[240px] w-[240px]">
              {corners.map((c) => (
                <span key={c} className={`absolute h-7 w-7 border-lake ${c}`} />
              ))}
              <div className="absolute inset-0 overflow-hidden rounded-lg">
                <ScanLine />
              </div>
            </div>
          </div>

          <p className="mt-6 px-10 text-center text-[13px] leading-[18px] text-paper-white/60">
            当前部署环境未启用相机能力（HTTP 站点/Android WebView 限制）。请让钓友出示 6 位核销码，使用手动输码完成真实核销。
          </p>

          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={onSwitchToManual}
            className="mt-auto mb-16 flex h-12 items-center gap-2 rounded-full bg-lake px-6 text-[15px] font-semibold leading-none text-paper-white"
          >
            <Keyboard size={18} strokeWidth={1.8} /> 手动输入核销码
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
