import { m } from 'framer-motion'

interface SuccessCheckProps {
  size?: number
}

/** 成功对勾：圆形湖水绿描边 scale spring 落位 + 对勾 stroke-dashoffset 描边动画（0.6s） */
export default function SuccessCheck({ size = 96 }: SuccessCheckProps) {
  return (
    <m.svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 18 }}
      aria-hidden="true"
    >
      <m.circle
        cx="48"
        cy="48"
        r="43"
        fill="none"
        stroke="#5e7a6e"
        strokeWidth="4"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      <m.path
        d="M31 50 L43 62 L66 37"
        fill="none"
        stroke="#5e7a6e"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, delay: 0.3, ease: 'easeOut' }}
      />
    </m.svg>
  )
}
