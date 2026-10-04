/**
 * 哪钓现场参数字段的选项与工具（数据层，与 UI 组件分离以满足 react-refresh 约定）
 */
import type { Clarity, Season, TimeOfDay } from '../../api/knowledge/fishingRules'
import type { FishSpotExpertResult, FishSpotResult } from '../../api/kimi/k3'

export interface SpotFieldValues {
  season: Season | ''
  waterTemp: string
  airTemp: string
  weather: string
  windLevel: number | null
  timeOfDay: TimeOfDay | ''
  clarity: Clarity | ''
  targetFish: string[]
}

export const EMPTY_FIELDS: SpotFieldValues = {
  season: '',
  waterTemp: '',
  airTemp: '',
  weather: '',
  windLevel: null,
  timeOfDay: '',
  clarity: '',
  targetFish: [],
}

export const SEASON_OPTIONS: Season[] = ['春', '夏', '秋', '冬']
export const TIME_OPTIONS: TimeOfDay[] = ['晨', '午', '昏', '夜']
/** 时段 → 代表小时（后端 timeOfDayFromHour 再归一，保证前后端口径一致） */
export const TIME_TO_HOUR: Record<TimeOfDay, number> = { 晨: 7, 午: 13, 昏: 18, 夜: 22 }
export const WEATHER_OPTIONS = ['晴', '多云', '阴', '小雨', '大雨', '雾'] as const
/** 风力档位：0=无风，1-3=常用，4+=大风（影响选位与溶氧） */
export const WIND_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '无风', value: 0 },
  { label: '2 级', value: 2 },
  { label: '3 级', value: 3 },
  { label: '4 级', value: 4 },
  { label: '5 级以上', value: 6 },
]
export const FISH_OPTIONS = [
  '鲫鱼', '鲤鱼', '草鱼', '鳊鱼', '翘嘴', '鲢鳙', '青鱼', '罗非鱼', '黄颡鱼', '鲶鱼',
]
export const CLARITY_OPTIONS: Clarity[] = ['清澈', '中等', '浑浊', '肥水']

/** 默认季节：按当前月份推断，允许覆盖（QY-SPOT-001） */
export function currentSeason(): Season {
  const mo = new Date().getMonth() + 1
  if (mo >= 3 && mo <= 5) return '春'
  if (mo >= 6 && mo <= 8) return '夏'
  if (mo >= 9 && mo <= 11) return '秋'
  return '冬'
}

export function currentTimeOfDay(): TimeOfDay {
  const h = new Date().getHours()
  if (h >= 5 && h < 10) return '晨'
  if (h >= 10 && h < 16) return '午'
  if (h >= 16 && h < 20) return '昏'
  return '夜'
}

/** 表单值 → identify 入参的可现场参数字段（未填的一律不传，保持全可选语义） */
export function fieldsToInput(v: SpotFieldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (v.season) out.season = v.season
  const wt = Number.parseFloat(v.waterTemp)
  if (Number.isFinite(wt)) out.waterTemp = wt
  const at = Number.parseFloat(v.airTemp)
  if (Number.isFinite(at)) out.airTemp = at
  if (v.weather) out.weather = v.weather
  if (v.windLevel != null) out.windLevel = v.windLevel
  if (v.timeOfDay) out.hour = TIME_TO_HOUR[v.timeOfDay]
  if (v.clarity) out.clarity = v.clarity
  if (v.targetFish.length) out.targetFish = v.targetFish.slice(0, 6)
  return out
}

/** 是否已填任一现场参数（用于「补充现场信息」按钮上的角标提示） */
export function fieldsTouched(v: SpotFieldValues): boolean {
  return Boolean(
    v.season || v.waterTemp || v.airTemp || v.weather || v.windLevel != null || v.timeOfDay || v.clarity || v.targetFish.length,
  )
}

/** 结果档位的运行时判别：专家档带 rigSetup（服务端保证专家档必为该形状） */
export function isExpertResult(r: FishSpotResult | FishSpotExpertResult): r is FishSpotExpertResult {
  return typeof r === 'object' && r !== null && 'rigSetup' in r
}
