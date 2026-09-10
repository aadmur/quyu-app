import { motion } from 'framer-motion'

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
}

/** 发布选项开关：圆点 x 位移 spring + 底色 #2d1e1e26 → olive 0.2s */
export default function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors duration-200 disabled:opacity-50"
      style={{ backgroundColor: checked ? '#716a4b' : '#2d1e1e26' }}
    >
      <motion.span
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        className="block h-5 w-5 rounded-full bg-paper-white shadow-[0_1px_3px_rgba(45,30,30,0.2)]"
      />
    </button>
  )
}
