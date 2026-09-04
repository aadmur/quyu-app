import { memo, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

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
  /** 模拟识别成功（按钮点击 1s 后触发） */
  onDetected: () => void
  onClose: () => void
}

/** 全屏模拟扫码：黑底 + 240×240 取景框 + lake 扫描线往复 + 模拟识别按钮 */
export default function ScanOverlay({ open, onDetected, onClose }: ScanOverlayProps) {
  const [recognizing, setRecognizing] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!open) {
      setRecognizing(false)
      window.clearTimeout(timer.current)
    }
  }, [open])

  const simulate = () => {
    if (recognizing) return
    setRecognizing(true)
    timer.current = window.setTimeout(onDetected, 1000)
  }

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
              {/* 模拟识别中：显示钓友票二维码 */}
              <AnimatePresence>
                {recognizing && (
                  <motion.img
                    src="/qr-demo.svg"
                    alt="识别到钓友票券二维码"
                    className="absolute inset-6 rounded-md"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>

          <p className="mt-6 text-[13px] leading-[18px] text-paper-white/60">
            {recognizing ? '识别中…' : '对准钓友票券上的二维码'}
          </p>

          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={simulate}
            disabled={recognizing}
            className="mt-auto mb-16 h-12 rounded-full border border-paper-white/40 px-6 text-[15px] leading-none text-paper-white disabled:opacity-50"
          >
            {recognizing ? '识别中…' : '模拟：扫到钓友的票'}
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
