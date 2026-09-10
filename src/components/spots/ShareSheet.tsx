import { AnimatePresence, m } from 'framer-motion'
import { Link2, Share2 } from 'lucide-react'

interface ShareSheetProps {
  open: boolean
  onClose: () => void
  onAction: (msg: string) => void
}

/** 复制当前页链接：优先 navigator.clipboard，降级 execCommand；失败返回 false */
async function copyCurrentUrl(): Promise<boolean> {
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/** 分享面板：底部弹起（系统分享 / 复制链接，均为真实能力） */
export default function ShareSheet({ open, onClose, onAction }: ShareSheetProps) {
  const canSystemShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const actions = [
    ...(canSystemShare
      ? [
          {
            key: 'system',
            label: '系统分享',
            icon: Share2,
            run: async () => {
              try {
                await navigator.share({ title: document.title, url: window.location.href })
                onClose()
              } catch {
                /* 用户取消或系统拒绝：静默关闭即可 */
              }
            },
          },
        ]
      : []),
    {
      key: 'copy',
      label: '复制链接',
      icon: Link2,
      run: async () => {
        const ok = await copyCurrentUrl()
        onAction(ok ? '链接已复制' : '复制失败，请长按地址栏手动复制')
        onClose()
      },
    },
  ]

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 bg-ink"
            onClick={onClose}
          />
          <m.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className="relative w-full max-w-[420px] rounded-t-[20px] bg-paper-white px-4 pt-5"
            style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 32px)' }}
          >
            <p className="text-center text-[15px] font-semibold leading-[22px] text-ink">分享钓点</p>
            <div className="mt-4 flex justify-around">
              {actions.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => void a.run()}
                  className="flex flex-col items-center gap-2"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-olive-tint text-olive">
                    <a.icon size={22} strokeWidth={1.8} />
                  </span>
                  <span className="text-[12px] leading-4 text-ink-60">{a.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 h-12 w-full rounded-xl border border-line text-[15px] font-semibold text-ink-60"
            >
              取消
            </button>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  )
}
