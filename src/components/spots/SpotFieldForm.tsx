import { m } from 'framer-motion'
import {
  CLARITY_OPTIONS,
  FISH_OPTIONS,
  SEASON_OPTIONS,
  TIME_OPTIONS,
  WEATHER_OPTIONS,
  WIND_OPTIONS,
  type SpotFieldValues,
} from '@/lib/spotFields'
import type { Clarity, Season, TimeOfDay } from '../../../api/knowledge/fishingRules'

interface Props {
  value: SpotFieldValues
  onChange: (next: SpotFieldValues) => void
  disabled?: boolean
}

const chipBase = 'rounded-full px-3 py-1.5 text-[13px] leading-4 transition-colors'
const chipOn = 'bg-lake text-paper-white'
const chipOff = 'bg-paper text-ink-60 border border-line'

function Chip({
  label, active, onSelect, multi,
}: {
  label: string
  active: boolean
  onSelect: () => void
  multi?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`${chipBase} ${active ? chipOn : chipOff} ${multi ? 'mr-2 mb-2' : 'mr-2 mb-2'}`}
    >
      {label}
    </button>
  )
}

function NumberField({
  label, value, onValue, placeholder,
}: {
  label: string
  value: string
  onValue: (v: string) => void
  placeholder: string
}) {
  return (
    <label className="mr-2 mb-2 inline-flex flex-col gap-1">
      <span className="text-[11px] leading-3 text-ink-40">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onValue(e.target.value)}
        className="h-8 w-[76px] rounded-lg border border-line bg-paper px-2 text-[13px] leading-4 text-ink outline-none focus:border-lake"
      />
    </label>
  )
}

/**
 * 「补充现场信息」表单（QY-SPOT-001）：7 项全部可选，缺省不阻断识别。
 * 由 FishSpot 页按展开状态动态 import，不进首屏闭包。
 */
export default function SpotFieldForm({ value, onChange, disabled }: Props) {
  const set = <K extends keyof SpotFieldValues>(key: K, v: SpotFieldValues[K]) =>
    onChange({ ...value, [key]: v })

  const toggleFish = (name: string) => {
    const has = value.targetFish.includes(name)
    const next = has ? value.targetFish.filter((f) => f !== name) : [...value.targetFish, name].slice(0, 6)
    onChange({ ...value, targetFish: next })
  }

  return (
    <m.section
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="mt-3 space-y-3 rounded-xl bg-paper-white px-4 py-3 shadow-[0_4px_16px_rgba(45,30,30,0.05)]"
    >
      <div>
        <p className="mb-2 text-[12px] font-medium leading-4 text-ink-40">季节</p>
        <div className="flex flex-wrap">
          {SEASON_OPTIONS.map((s) => (
            <Chip key={s} label={s} active={value.season === s} onSelect={() => set('season', (value.season === s ? '' : s) as Season | '')} />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium leading-4 text-ink-40">水温 / 气温（℃，选填）</p>
        <div className="flex flex-wrap">
          <NumberField label="水温" value={value.waterTemp} onValue={(v) => set('waterTemp', v)} placeholder="如 8" />
          <NumberField label="气温" value={value.airTemp} onValue={(v) => set('airTemp', v)} placeholder="如 15" />
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium leading-4 text-ink-40">天气</p>
        <div className="flex flex-wrap">
          {WEATHER_OPTIONS.map((w) => (
            <Chip key={w} label={w} active={value.weather === w} onSelect={() => set('weather', value.weather === w ? '' : w)} />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium leading-4 text-ink-40">风力</p>
        <div className="flex flex-wrap">
          {WIND_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label} active={value.windLevel === o.value} onSelect={() => set('windLevel', value.windLevel === o.value ? null : o.value)} />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium leading-4 text-ink-40">作钓时段</p>
        <div className="flex flex-wrap">
          {TIME_OPTIONS.map((t) => (
            <Chip key={t} label={t} active={value.timeOfDay === t} onSelect={() => set('timeOfDay', (value.timeOfDay === t ? '' : t) as TimeOfDay | '')} />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium leading-4 text-ink-40">
          目标鱼（最多 6 项，不选则由 AI 推荐）
        </p>
        <div className="flex flex-wrap">
          {FISH_OPTIONS.map((f) => (
            <Chip key={f} label={f} active={value.targetFish.includes(f)} onSelect={() => toggleFish(f)} multi />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium leading-4 text-ink-40">水色（辅助判断，选填）</p>
        <div className="flex flex-wrap">
          {CLARITY_OPTIONS.map((c) => (
            <Chip key={c} label={c} active={value.clarity === c} onSelect={() => set('clarity', (value.clarity === c ? '' : c) as Clarity | '')} />
          ))}
        </div>
      </div>

      {disabled && <p className="text-[12px] leading-4 text-ink-40">识别中不可修改现场参数</p>}
    </m.section>
  )
}
