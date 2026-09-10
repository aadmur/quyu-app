import { AnimatePresence, m } from 'framer-motion'
import { ImageDown, Link2, Share2 } from 'lucide-react'

interface PostShareSheetProps {
  open: boolean
  post: { id: number; authorName: string; content: string } | null
  onClose: () => void
  onAction: (msg: string) => void
  /** 「生成分享卡片」：关闭面板并打开卡片预览层 */
  onMakeCard: () => void
}

/** 复制文本：优先 navigator.clipboard，降级 execCommand；失败返回 false */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
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

/**
 * 帖子分享面板（QY-COMM-009）：底部弹起。
 * 「系统分享 / 复制链接」与原帖子详情页 sharePost 逻辑一致；新增「生成分享卡片」入口。
 * 对所有帖子可见（无需是作者）。
 */
export default function PostShareSheet({ open, post, onClose, onAction, onMakeCard }: PostShareSheetProps) {
  const canSystemShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const actions = [
    ...(canSystemShare
      ? [
          {
            key: 'system',
            label: '系统分享',
            icon: Share2,
            run: async () => {
              if (!post) return
              const url = `${window.location.origin}/post/${post.id}`
              try {
                await navigator.share({ title: `趣渔 · ${post.authorName} 的渔获`, text: post.content, url })
                onClose()
              } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') return
                // 系统分享被拒：与原逻辑一致降级为复制链接
                const ok = await copyText(url)
                onAction(ok ? '链接已复制' : '分享失败，请稍后再试')
                onClose()
              }
            },
          },
        ]
      : []),
    {
      key: 'card',
      label: '生成分享卡片',
      icon: ImageDown,
      run: async () => {
        onClose()
        onMakeCard()
      },
    },
    {
      key: 'copy',
      label: '复制链接',
      icon: Link2,
      run: async () => {
        if (!post) return
        const ok = await copyText(`${window.location.origin}/post/${post.id}`)
        onAction(ok ? '链接已复制' : '复制失败，请稍后手动复制')
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
            <p className="text-center text-[15px] font-semibold leading-[22px] text-ink">分享渔获</p>
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
