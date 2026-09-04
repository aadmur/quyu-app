import { memo } from 'react'

interface FishIconProps {
  /** 激活态：赭红实心鱼 */
  active?: boolean
  size?: number
  className?: string
}

/**
 * 趣渔定制「鱼形点赞」图标（与 public/icon-fish-like.svg 同源）。
 * 默认线性侧视鱼轮廓（stroke currentColor），激活后填充 #b3502e 实心鱼。
 */
const FishIcon = memo(function FishIcon({ active = false, size = 24, className }: FishIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g
        stroke="currentColor"
        strokeWidth={active ? 0 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
      >
        <path d="M3 12 C6 7.5, 11 6, 15.5 8.5 C17.5 7, 19.8 5.6, 21.5 5 C21 7.5, 21 9.8, 21.6 12 C21 14.2, 21 16.5, 21.5 19 C19.8 18.4, 17.5 17, 15.5 15.5 C11 18, 6 16.5, 3 12 Z" />
        {!active && <path d="M11 8.2 C12 9.6, 12 14.4, 11 15.8" strokeWidth={1.8} />}
      </g>
      <circle cx="7.2" cy="11" r="0.9" fill={active ? '#f2f0e6' : 'currentColor'} stroke="none" />
    </svg>
  )
})

export default FishIcon
