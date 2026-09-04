import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

/** 轻量 toast：底部居中浮起，2s 自动消失（fixed 居中，与 420px 手机壳对齐） */
export function useToast() {
  const [message, setMessage] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback((msg: string) => {
    setMessage(msg)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(''), 2000)
  }, [])
  return { message, show }
}

export function Toast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center">
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="max-w-[320px] rounded-full bg-ink px-4 py-2 text-center text-[13px] leading-[18px] text-paper"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
