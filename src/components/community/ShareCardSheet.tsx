import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ImageDown, Link2, Loader2, X } from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { CARD_H, CARD_W, canvasToPngBlob, renderShareCard } from '@/lib/shareCard'

interface ShareCardSheetProps {
  open: boolean
  postId: number
  onClose: () => void
  onAction: (msg: string) => void
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
 * 渔获分享卡片预览层（QY-COMM-009）：
 * 拉取 posts.shareCard → canvas 2D 绘制 750×1100 PNG → <img> 预览。
 * 「保存图片」走 a[download]；原生 WebView 内可能无效，故同时渲染 PNG <img> 提示长按保存。
 */
export default function ShareCardSheet({ open, postId, onClose, onAction }: ShareCardSheetProps) {
  const cardQuery = trpc.app.posts.shareCard.useQuery(
    { id: postId },
    { enabled: open && postId > 0, retry: false, staleTime: 60_000, refetchOnWindowFocus: false },
  )

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [pngUrl, setPngUrl] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderFailed, setRenderFailed] = useState(false)

  // 数据到达后在离屏 canvas 上合成 PNG
  useEffect(() => {
    if (!open || !cardQuery.data) return
    let cancelled = false
    setRendering(true)
    setRenderFailed(false)
    setPngUrl(null)
    const canvas = canvasRef.current ?? document.createElement('canvas')
    canvasRef.current = canvas
    void (async () => {
      try {
        await renderShareCard(canvas, cardQuery.data)
        const url = canvas.toDataURL('image/png')
        if (!cancelled) setPngUrl(url)
      } catch {
        if (!cancelled) setRenderFailed(true)
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, cardQuery.data])

  // 接口 404 等错误：toast 提示并关闭
  useEffect(() => {
    if (open && cardQuery.error) {
      onAction(cardQuery.error.message || '卡片生成失败，请稍后再试')
      onClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cardQuery.error])

  const saveImage = async () => {
    const canvas = canvasRef.current
    if (!canvas || !pngUrl) return
    const blob = await canvasToPngBlob(canvas)
    if (!blob) {
      onAction('保存失败，请长按图片保存')
      return
    }
    try {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `quyu-catch-${postId}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      onAction('已开始下载；如未保存，请长按图片保存')
    } catch {
      onAction('保存失败，请长按图片保存')
    }
  }

  const copyLink = async () => {
    const url = cardQuery.data?.landingUrl ?? `${window.location.origin}/post/${postId}`
    const ok = await copyText(url)
    onAction(ok ? '链接已复制' : '复制失败，请稍后手动复制')
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 bg-ink"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="分享卡片"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className="relative flex max-h-[92dvh] w-full max-w-[420px] flex-col rounded-t-[20px] bg-paper px-4 pt-3"
            style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 20px)' }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold leading-[22px] text-ink">分享卡片</h2>
              <button
                type="button"
                aria-label="关闭"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center text-ink-60"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div className="no-scrollbar mt-3 min-h-[200px] flex-1 overflow-y-auto">
              {cardQuery.isLoading || rendering ? (
                <div className="flex flex-col items-center gap-3 py-16 text-ink-60">
                  <Loader2 size={26} className="animate-spin" />
                  <p className="text-[13px] leading-[18px]">正在生成卡片…</p>
                </div>
              ) : renderFailed ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <p className="text-[14px] font-semibold text-ink">卡片生成失败</p>
                  <p className="text-[12px] leading-[18px] text-ink-60">可以改用「复制链接」分享这条渔获</p>
                </div>
              ) : pngUrl ? (
                <>
                  <img
                    src={pngUrl}
                    alt="渔获分享卡片"
                    className="mx-auto w-full max-w-[320px] rounded-2xl shadow-sm"
                    style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}
                    draggable={false}
                  />
                  <p className="mt-2 text-center text-[12px] leading-4 text-ink-40">长按图片也可保存到相册</p>
                </>
              ) : null}
            </div>

            {/* 操作按钮 */}
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => void saveImage()}
                disabled={!pngUrl || rendering}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-olive text-[14px] font-semibold text-paper-white active:brightness-95 disabled:opacity-40"
              >
                <ImageDown size={17} strokeWidth={2} />
                保存图片
              </button>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-line bg-paper-white text-[14px] font-semibold text-ink active:brightness-95"
              >
                <Link2 size={17} strokeWidth={2} />
                复制链接
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
