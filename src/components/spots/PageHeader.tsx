import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Heart, Share2 } from 'lucide-react'

interface PageHeaderProps {
  title?: string
  /** 沉浸模式：悬浮于相册之上，图标白底 40% 圆形衬底；滚动后转为 paper 底 */
  immersive?: boolean
  collected?: boolean
  onCollect?: () => void
  onShare?: () => void
}

/** 二级页头部：左返回、中标题、右分享/收藏；滚动超 24px 后由透明渐变为 paper + 细线 */
export default function PageHeader({ title, immersive = false, collected, onCollect, onShare }: PageHeaderProps) {
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const scroller = document.getElementById('app-scroll')
    if (!scroller) return
    const onScroll = () => setScrolled(scroller.scrollTop > 24)
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  const solid = !immersive || scrolled

  const iconBtn = (label: string, onClick: (() => void) | undefined, node: ReactNode) => (
    <motion.button
      type="button"
      aria-label={label}
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-full ${
        solid ? 'text-ink' : 'bg-paper-white/40 text-ink backdrop-blur-sm'
      }`}
    >
      {node}
    </motion.button>
  )

  return (
    <header
      className={`absolute inset-x-0 top-0 z-40 flex h-12 items-center justify-between px-3 transition-colors duration-300 ${
        solid ? 'border-b border-line bg-paper' : 'border-b border-transparent bg-transparent'
      }`}
    >
      {iconBtn('返回', () => navigate(-1), <ChevronLeft size={24} strokeWidth={1.8} />)}
      <h2
        className={`absolute left-1/2 -translate-x-1/2 text-[18px] font-semibold leading-6 text-ink transition-opacity duration-300 ${
          solid && title ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {title}
      </h2>
      <div className="flex items-center gap-2">
        {onShare && iconBtn('分享', onShare, <Share2 size={20} strokeWidth={1.8} />)}
        {onCollect &&
          iconBtn(
            '收藏',
            onCollect,
            <Heart
              size={20}
              strokeWidth={1.8}
              fill={collected ? '#b3502e' : 'none'}
              className={collected ? 'text-heart' : ''}
            />,
          )}
      </div>
    </header>
  )
}
