import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'

const COLORS = ['#716a4b', '#5e7a6e', '#a8512f']

interface Piece {
  left: number
  size: number
  color: string
  delay: number
  duration: number
  drift: number
  rotate: number
  round: boolean
}

/** 支付成功顶部彩带：8 片橄榄绿/湖水绿/陶土色纸屑一次性飘落（2s 内落完）。隔离为 memo 微组件。 */
function ConfettiInner() {
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        left: 8 + ((i * 97) % 84),
        size: 6 + ((i * 5) % 5),
        color: COLORS[i % COLORS.length],
        delay: 0.2 + i * 0.12,
        duration: 1.4 + ((i * 3) % 4) * 0.15,
        drift: (i % 2 === 0 ? 1 : -1) * (18 + ((i * 7) % 26)),
        rotate: (i % 2 === 0 ? 1 : -1) * (160 + ((i * 53) % 200)),
        round: i % 3 === 0,
      })),
    [],
  )

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-64 overflow-hidden" aria-hidden="true">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute -top-3 block"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 1.8,
            backgroundColor: p.color,
            borderRadius: p.round ? '50%' : 2,
          }}
          initial={{ y: -12, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: 240, x: p.drift, rotate: p.rotate, opacity: [1, 1, 0.6] }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  )
}

const Confetti = memo(ConfettiInner)
export default Confetti
