import { useCallback, useEffect, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { X, ChevronUp, MapPin } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Story } from '@/data/home'
import BottomSheet from '@/components/home/BottomSheet'

interface StoryPlayerProps {
  story: Story
  onClose: () => void
}

/**
 * 全屏 Story 播放器：黑底图片填满，顶部 3 秒分段进度条，
 * 左右点按切换上/下一段，下滑关闭；官方塘 story 带「查看钓点 →」上滑入口。
 */
export default function StoryPlayer({ story, onClose }: StoryPlayerProps) {
  const navigate = useNavigate()
  const [frame, setFrame] = useState(0)
  const total = story.frames.length

  const next = useCallback(() => {
    if (frame < total - 1) setFrame((f) => f + 1)
    else onClose()
  }, [frame, total, onClose])

  const prev = useCallback(() => {
    if (frame > 0) setFrame((f) => f - 1)
  }, [frame])

  // 防止背景滚动
  useEffect(() => {
    const scroller = document.getElementById('app-scroll')
    if (scroller) scroller.style.overflow = 'hidden'
    return () => {
      if (scroller) scroller.style.overflow = ''
    }
  }, [])

  return (
    <m.div
      className="fixed inset-0 z-50 mx-auto max-w-[420px] bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <BottomSheet
        onClose={onClose}
        threshold={90}
        elastic={0.6}
        className="relative h-full w-full overflow-hidden"
      >
        <AnimatePresence mode="wait" initial={false}>
          <m.img
            key={frame}
            src={story.frames[frame]}
            alt={story.name}
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            draggable={false}
          />
        </AnimatePresence>

        {/* 左右点按切换 */}
        <button type="button" aria-label="上一段" className="absolute inset-y-0 left-0 w-1/3" onClick={prev} />
        <button type="button" aria-label="下一段" className="absolute inset-y-0 right-0 w-2/3" onClick={next} />

        {/* 顶部：进度条 + 作者 + 关闭（原生壳补 safe-top 让位状态栏） */}
        <div
          className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6"
          style={{ paddingTop: 'calc(var(--safe-top) + 0.75rem)' }}
        >
          <div className="flex gap-1">
            {story.frames.map((_, i) => (
              <div key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                {i < frame && <div className="h-full w-full bg-white" />}
                {i === frame && (
                  <m.div
                    key={`progress-${frame}`}
                    className="h-full w-full origin-left bg-white"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 3, ease: 'linear' }}
                    onAnimationComplete={next}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <img src={story.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
            <span className="text-[14px] font-semibold text-white">{story.name}</span>
            {story.live && (
              <span className="rounded-full bg-clay px-2 py-0.5 text-[11px] leading-4 text-white">直播</span>
            )}
            {story.official && (
              <span className="rounded-full bg-lake px-2 py-0.5 text-[11px] leading-4 text-white">鱼讯</span>
            )}
            <button type="button" aria-label="关闭" onClick={onClose} className="ml-auto text-white">
              <X size={24} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* 官方塘 story：底部「查看钓点 →」上滑入口 */}
        {story.official && story.spotId && (
          <m.button
            type="button"
            onClick={() => navigate(`/pond/${story.spotId}`)}
            className="absolute inset-x-4 flex items-center justify-center gap-1.5 rounded-xl bg-paper-white/95 py-3 text-[14px] font-semibold text-olive"
            style={{ bottom: 'max(var(--safe-bottom), 32px)' }}
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ChevronUp size={18} strokeWidth={2} />
            <MapPin size={16} strokeWidth={1.8} />
            查看钓点
          </m.button>
        )}
      </BottomSheet>
    </m.div>
  )
}
