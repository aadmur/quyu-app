/** 塘主端模拟数据：今日看板、待核销订单、鱼讯模板、近 7 日经营 */

export interface TodayStat {
  id: string
  label: string
  value: number
  /** 展示用格式化（如 ¥3,208） */
  format: (v: number) => string
  /** 环比文案，如「▲ 12%」；无则显示实时圆点 */
  delta?: string
  deltaUp?: boolean
  realtime?: boolean
}

const fmtNum = (v: number) => String(Math.round(v))
const fmtYuan = (v: number) => `¥${Math.round(v).toLocaleString('zh-CN')}`

export const TODAY_STATS: TodayStat[] = [
  { id: 'tickets', label: '今日售票', value: 46, format: fmtNum, delta: '▲ 12%', deltaUp: true },
  { id: 'income', label: '今日收入', value: 3208, format: fmtYuan, delta: '▲ 8%', deltaUp: true },
  { id: 'verified', label: '已核销', value: 31, format: fmtNum, delta: '▲ 15%', deltaUp: true },
  { id: 'fishing', label: '在钓人数', value: 18, format: fmtNum, realtime: true },
]

export interface PendingOrder {
  id: string
  name: string
  avatar: string
  ticket: string
  seat: string
  note: string
  code: string
}

export const PENDING_ORDERS: PendingOrder[] = [
  { id: 'o1', name: '浮漂小王子', avatar: '/avatar-2.png', ticket: '全天票', seat: '8 号位', note: '已到场 20 分钟', code: '552138' },
  { id: 'o2', name: '阿杰爱钓鱼', avatar: '/avatar-6.png', ticket: '夜钓票', seat: '17 号位', note: '预约 18:00 到场', code: '908172' },
  { id: 'o3', name: '周大爷', avatar: '/avatar-4.png', ticket: '半天票', seat: '3 号位', note: '已到场 5 分钟', code: '310245' },
]

/** 扫码/手动输码演示命中的订单（对应钓友端 /tickets 的 QRCodeCard） */
export const SCAN_DEMO_ORDER: PendingOrder = {
  id: 'o-scan',
  name: '江边老陈',
  avatar: '/avatar-1.png',
  ticket: '半天票',
  seat: '12 号位',
  note: '已到场 35 分钟',
  code: '836219',
}

/** 手动输码正确码 */
export const VALID_CODE = '836219'

export interface NewsTemplate {
  label: string
  text: string
}

export const NEWS_TEMPLATES: NewsTemplate[] = [
  { label: '放鱼通知', text: '今早 6 点放鲫鱼 800 斤，开口好，速来！' },
  { label: '补鱼预告', text: '明晚 8 点补草鱼 300 斤，夜钓票提前订。' },
  { label: '今日口好', text: '今天全天口好，12 号位一下午 23 尾鲫鱼，抓紧下竿！' },
  { label: '临时闭塘', text: '因塘口维护，今天下午临时闭塘半天，已购票钓友可免费改期。' },
]

export interface DayStat {
  day: string
  tickets: number
  income: number
}

export const WEEK_STATS: DayStat[] = [
  { day: '一', tickets: 32, income: 2176 },
  { day: '二', tickets: 28, income: 1904 },
  { day: '三', tickets: 35, income: 2380 },
  { day: '四', tickets: 30, income: 2040 },
  { day: '五', tickets: 38, income: 2584 },
  { day: '六', tickets: 62, income: 4216 },
  { day: '日', tickets: 46, income: 3128 },
]
