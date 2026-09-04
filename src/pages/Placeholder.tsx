interface PlaceholderProps {
  title: string
  subtitle?: string
}

/** 占位页：展示页面标题，等待页面代理实现 */
export default function Placeholder({ title, subtitle }: PlaceholderProps) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-2 px-8 text-center">
      <h1 className="text-[22px] font-bold leading-7 text-ink">{title}</h1>
      {subtitle && <p className="text-[13px] leading-[18px] text-ink-60">{subtitle}</p>}
    </div>
  )
}
