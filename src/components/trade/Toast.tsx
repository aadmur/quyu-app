import { motion, AnimatePresence } from 'framer-motion'

interface ToastProps {
  message: string
  show: boolean
}

/** 轻提示：手机壳内顶部居中胶囊，淡入 + 微移 */
export default function Toast({ message, show }: ToastProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[70] mx-auto flex max-w-[420px] justify-center px-6">
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="rounded-full bg-ink px-4 py-2 text-[13px] leading-[18px] text-paper shadow-[0_8px_24px_rgba(45,30,30,0.12)]"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
