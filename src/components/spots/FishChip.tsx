import FishIcon from '@/components/FishIcon'

interface FishChipProps {
  label: string
  /** 纯文字胶囊（非鱼种，如「可夜钓」）不显示鱼图标 */
  plain?: boolean
}

/** 鱼种/标签胶囊：olive-tint 底 + olive 字，鱼种带小鱼图标 */
export default function FishChip({ label, plain = false }: FishChipProps) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-olive-tint px-2.5 py-1 text-[12px] leading-4 text-olive">
      {!plain && <FishIcon size={13} />}
      {label}
    </span>
  )
}
