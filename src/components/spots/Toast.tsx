import { AnimatePresence, m } from 'framer-motion'

/**
 * 轻量 toast：底部居中浮起，2s 自动消失（fixed 居中，与 420px 手机壳对齐）。
 * 状态钩子见同目录 useToast.ts（分文件以保住 Fast Refresh 边界）。
 */
export function Toast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center">
      <AnimatePresence>
        {message && (
          <m.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="max-w-[320px] rounded-full bg-ink px-4 py-2 text-center text-[13px] leading-[18px] text-paper"
          >
            {message}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
