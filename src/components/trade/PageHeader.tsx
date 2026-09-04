import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  right?: ReactNode
}

/** 二级页头部：高 48px，左返回 + 中标题；内容区滚动超 24px 后由透明渐变为 paper 底 + 细线 */
export default function PageHeader({ title, right }: PageHeaderProps) {
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

  return (
    <header
      className={`sticky top-0 z-30 flex h-12 items-center justify-between px-2 transition-colors duration-200 ${
        scrolled ? 'border-b border-line bg-paper' : 'border-b border-transparent bg-transparent'
      }`}
    >
      <button
        type="button"
        aria-label="返回"
        onClick={() => navigate(-1)}
        className="flex h-10 w-10 items-center justify-center text-ink"
      >
        <ChevronLeft size={24} strokeWidth={1.8} />
      </button>
      <h1 className="text-[18px] font-semibold leading-6 text-ink">{title}</h1>
      <div className="flex h-10 w-10 items-center justify-center">{right}</div>
    </header>
  )
}
