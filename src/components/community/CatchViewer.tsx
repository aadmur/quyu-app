import { useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { X, MessageCircle, Send, ChevronLeft, ChevronRight } from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import { PROFILE } from '@/data/community'
import type { CatchItem } from '@/data/community'

interface CatchViewerProps {
  items: CatchItem[]
  /** 当前索引；null 表示关闭 */
  index: number | null
  onChange: (index: number) => void
  onClose: () => void
}

/** 渔获墙全屏浏览：黑底，图居中，顶部 X，底部点赞评论栏，左右滑动切换 */
export default function CatchViewer({ items, index, onChange, onClose }: CatchViewerProps) {
  const [liked, setLiked] = useState(false)
  const item = index === null ? null : items[index]

  const prev = () => {
    if (index !== null && index > 0) {
      setLiked(false)
      onChange(index - 1)
    }
  }
  const next = () => {
    if (index !== null && index < items.length - 1) {
      setLiked(false)
      onChange(index + 1)
    }
  }

  return (
    <AnimatePresence>
      {item && index !== null && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-center justify-center"
        >
          <div className="absolute inset-0 bg-black" onClick={onClose} />
          <div className="relative flex h-full w-full max-w-[420px] flex-col">
            {/* 顶部：关闭（原生壳补 safe-top 让位状态栏，保持 48px 栏高） */}
            <div
              className="flex shrink-0 items-center justify-between px-2"
              style={{ height: 'calc(3rem + var(--safe-top))', paddingTop: 'var(--safe-top)' }}
            >
              <button
                type="button"
                aria-label="关闭"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center text-white"
              >
                <X size={24} strokeWidth={1.8} />
              </button>
              <span className="font-num text-[13px] leading-[18px] text-white/60">
                {index + 1} / {items.length}
              </span>
            </div>

            {/* 中部：图片，左右滑动切换 */}
            <div className="relative flex flex-1 items-center justify-center overflow-hidden">
              <m.img
                key={item.id}
                src={item.src}
                alt={item.caption}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.6}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -60) next()
                  else if (info.offset.x > 60) prev()
                }}
                className="max-h-full w-full object-contain"
              />
              {index > 0 && (
                <button
                  type="button"
                  aria-label="上一张"
                  onClick={prev}
                  className="absolute left-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"
                >
                  <ChevronLeft size={22} strokeWidth={2} />
                </button>
              )}
              {index < items.length - 1 && (
                <button
                  type="button"
                  aria-label="下一张"
                  onClick={next}
                  className="absolute right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white"
                >
                  <ChevronRight size={22} strokeWidth={2} />
                </button>
              )}
            </div>

            {/* 底部：作者 + 点赞评论栏 */}
            <div
              className="shrink-0 px-4 pt-3"
              style={{ paddingBottom: 'max(var(--safe-bottom), 32px)' }}
            >
              <div className="flex items-center gap-2">
                <img src={PROFILE.avatar} alt={PROFILE.name} className="h-8 w-8 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-[18px] text-white">{PROFILE.name}</p>
                  <p className="truncate text-[12px] leading-[16px] text-white/60">
                    {item.caption} · {item.time}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-6 border-t border-white/10 pt-3 text-white">
                <button
                  type="button"
                  onClick={() => setLiked((v) => !v)}
                  className="flex items-center gap-1.5"
                >
                  <m.span
                    key={String(liked)}
                    initial={{ scale: 0.6 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                    className={liked ? 'text-heart' : 'text-white'}
                  >
                    <FishIcon active={liked} size={22} />
                  </m.span>
                  <span className="font-num text-[15px] leading-none">
                    {(item.likes + (liked ? 1 : 0)).toLocaleString('en-US')}
                  </span>
                </button>
                <span className="flex items-center gap-1.5">
                  <MessageCircle size={22} strokeWidth={1.8} />
                  <span className="font-num text-[15px] leading-none">{item.commentCount}</span>
                </span>
                <Send size={22} strokeWidth={1.8} />
              </div>
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
