import { useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { MapPin, Search, Check } from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import { FISH_SPECIES, PUBLISH_SPOTS } from '@/data/community'

/** 弹层通用壳：fixed 底部升起，宽度约束在手机壳 420px 内 */
function SheetShell({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-ink"
            onClick={onClose}
          />
          <m.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className="relative w-full max-w-[420px] rounded-t-[20px] bg-paper-white"
            style={{ paddingBottom: 'max(var(--safe-bottom), 32px)' }}
          >
            <div className="flex h-12 items-center justify-center border-b border-line">
              <h3 className="text-[15px] font-semibold leading-[22px] text-ink">{title}</h3>
            </div>
            {children}
          </m.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/** 鱼种选择层：4 列胶囊网格（v15 扩至 16 种 = 4 行 × 4 列），选中 olive 底白字，胶囊 stagger scale 0.8→1 */
export function SpeciesPicker({
  open,
  value,
  onSelect,
  onClose,
}: {
  open: boolean
  value: string | null
  onSelect: (species: string) => void
  onClose: () => void
}) {
  return (
    <SheetShell open={open} onClose={onClose} title="选择鱼种">
      <div className="grid grid-cols-4 gap-3 px-4 pt-5">
        {FISH_SPECIES.map((species, i) => {
          const active = value === species
          return (
            <m.button
              key={species}
              type="button"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.03, type: 'spring', stiffness: 400, damping: 24 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                onSelect(species)
                onClose()
              }}
              className={`flex h-10 items-center justify-center gap-1 rounded-full text-[13px] leading-[18px] ${
                active ? 'bg-olive font-semibold text-paper-white' : 'bg-olive-tint text-ink'
              }`}
            >
              <FishIcon size={16} className={active ? 'text-paper-white' : 'text-olive'} />
              {species}
            </m.button>
          )
        })}
      </div>
    </SheetShell>
  )
}

/** 钓点选择层：搜索框 + 钓点列表（塘名 + 距离，48px 行） */
export function SpotPicker({
  open,
  value,
  onSelect,
  onClose,
}: {
  open: boolean
  value: string | null
  onSelect: (spotId: string) => void
  onClose: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const spots = PUBLISH_SPOTS.filter((s) => s.name.includes(keyword.trim()))

  return (
    <SheetShell open={open} onClose={onClose} title="添加钓点">
      <div className="px-4 pt-4">
        <div className="flex h-10 items-center gap-2 rounded-xl bg-[#2d1e1e0d] px-3">
          <Search size={18} strokeWidth={1.8} className="text-ink-40" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索钓场名称"
            className="flex-1 bg-transparent text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-40"
          />
        </div>
      </div>
      <div className="mt-2">
        {spots.map((spot) => {
          const active = value === spot.id
          return (
            <button
              key={spot.id}
              type="button"
              onClick={() => {
                onSelect(spot.id)
                onClose()
              }}
              className="flex h-12 w-full items-center gap-3 px-4 text-left active:bg-olive-tint"
            >
              <MapPin size={20} strokeWidth={1.8} className={active ? 'text-olive' : 'text-ink-60'} />
              <span className="flex-1 text-[15px] leading-[22px] text-ink">{spot.name}</span>
              <span className="font-num text-[13px] leading-[18px] text-ink-60">{spot.distance}</span>
              {active && <Check size={18} strokeWidth={2.2} className="text-olive" />}
            </button>
          )
        })}
        {spots.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px] leading-[18px] text-ink-40">
            没有找到「{keyword}」相关钓场
          </p>
        )}
      </div>
    </SheetShell>
  )
}
