import { useState } from 'react'
import { motion } from 'framer-motion'

/** 可选钓位（数据来自 ponds.detail 的真实 seats） */
export interface SeatOption {
  no: number
  /** 该日已被订走，置灰不可选 */
  taken?: boolean
}

interface SeatSheetProps {
  /** 该钓场真实钓位列表 */
  seats: SeatOption[]
  /** 已选钓位号（多选） */
  selected: number[]
  /** 最多可选数量（与购票张数一致） */
  max: number
  onConfirm: (seatNos: number[]) => void
  onClose: () => void
}

/** seat-map.svg（viewBox 720×400，格 28×28）钓位中心坐标，index+1 即钓位号 —— 纯版式几何，非业务数据 */
const SEAT_RECTS: Array<[number, number]> = [
  [47.1, 392.1], [46.3, 353.5], [50.4, 315.0], [59.4, 277.4], [73.2, 241.3], [91.5, 207.2],
  [114.0, 175.8], [140.4, 147.5], [170.2, 122.9], [203.0, 102.3], [238.1, 86.1], [275.0, 74.5],
  [313.1, 67.8], [351.7, 66.1], [390.2, 69.3], [428.0, 77.4], [464.5, 90.4], [498.9, 107.9],
  [530.9, 129.7], [559.7, 155.5], [585.0, 184.7], [606.4, 217.0], [623.4, 251.7], [635.8, 288.4],
]

/** 钓位号 → 图上百分比定位；超出示意图范围的号沿底边均布兜底 */
function seatPos(no: number, total: number): { x: number; y: number } {
  const rect = SEAT_RECTS[no - 1]
  if (rect) return { x: ((rect[0] + 14) / 720) * 100, y: ((rect[1] + 14) / 400) * 100 }
  const extra = SEAT_RECTS.length
  const i = no - extra - 1
  return { x: 8 + (84 / Math.max(total - extra - 1, 1)) * i, y: 96 }
}

/** 选钓位底部弹层：seat-map.svg 大图 + 可点选钓位格（多选，与购票张数联动） */
export default function SeatSheet({ seats, selected, max, onConfirm, onClose }: SeatSheetProps) {
  const [picked, setPicked] = useState<number[]>(selected)

  const toggle = (s: SeatOption) => {
    if (s.taken) return
    setPicked((prev) => {
      if (prev.includes(s.no)) return prev.filter((n) => n !== s.no)
      if (prev.length >= max) return [...prev.slice(1), s.no] // 超出上限：踢掉最早选的
      return [...prev, s.no]
    })
  }

  const sorted = [...picked].sort((a, b) => a - b)

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-ink"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[420px] rounded-t-[20px] bg-paper-white shadow-[0_8px_24px_rgba(45,30,30,0.12)]"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
      >
        <div className="flex h-12 items-center justify-center border-b border-line">
          <span className="text-[18px] font-semibold leading-6 text-ink">选择钓位</span>
        </div>

        <div className="px-4 pt-3">
          {/* 图例 */}
          <div className="flex items-center gap-4 text-[12px] leading-4 text-ink-60">
            <span className="flex items-center gap-1.5">
              <i className="h-3 w-3 rounded-[4px] border border-olive bg-paper-white" /> 可选
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-3 w-3 rounded-[4px] bg-olive" /> 已选
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-3 w-3 rounded-[4px] bg-[#2d1e1e14]" /> 已订走
            </span>
          </div>

          {/* 钓位俯瞰图 + 可点热区 */}
          <div className="relative mt-3 w-full overflow-hidden rounded-xl border border-line">
            <img src="/seat-map.svg" alt="钓位俯瞰示意图" className="block w-full" />
            {seats.map((s, i) => {
              const active = picked.includes(s.no)
              const pos = seatPos(s.no, seats.length)
              return (
                <motion.button
                  key={s.no}
                  type="button"
                  aria-label={`${s.no} 号钓位`}
                  disabled={s.taken}
                  onClick={() => toggle(s)}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: active ? 1.15 : 1 }}
                  transition={{
                    opacity: { duration: 0.2, delay: 0.03 * i },
                    scale: { type: 'spring', stiffness: 500, damping: 24 },
                  }}
                  className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md font-num text-[11px] leading-none ${
                    s.taken
                      ? 'bg-[#2d1e1e14] text-ink-40'
                      : active
                        ? 'bg-olive text-paper-white'
                        : 'bg-paper-white/90 text-olive'
                  }`}
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    width: '5.5%',
                    aspectRatio: '1',
                    boxShadow: active ? '0 0 0 2px #716a4b33' : undefined,
                  }}
                >
                  {s.no}
                </motion.button>
              )
            })}
          </div>

          <p className="mt-3 text-[13px] leading-[18px] text-ink-60">
            {sorted.length > 0 ? (
              <>
                已选 <span className="font-num text-[15px] text-lake">{sorted.join('、')} 号位</span>
                ，共 {sorted.length} 个（最多 {max} 个）
              </>
            ) : (
              <>点选钓位，选几个就是几张票（最多 {max} 个）</>
            )}
          </p>
        </div>

        <div
          className="px-4 pt-4"
          style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 16px)' }}
        >
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => onConfirm(sorted)}
            disabled={sorted.length === 0}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-olive text-[15px] font-semibold leading-[22px] text-paper-white disabled:opacity-50"
          >
            确认钓位{sorted.length > 0 ? `（${sorted.length} 个）` : ''}
          </motion.button>
        </div>
      </motion.div>
    </>
  )
}
