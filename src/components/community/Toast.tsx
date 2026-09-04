import { motion, AnimatePresence } from 'framer-motion'

/** 社区通用 toast：底部升起的胶囊提示（fixed 定位，居中于手机壳宽度内） */
export default function Toast({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="pointer-events-none fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] leading-[18px] text-paper whitespace-nowrap"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
