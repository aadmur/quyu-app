/**
 * 交易履约链路模拟数据：票种 / 钓场 / 订单 / 核销码（全部中文，无后端）。
 * orderStore 为内存态演示存储：下单 /checkout 成功会 push 新订单，
 * /tickets 的「模拟塘主核销」会把待使用订单流转为已使用，
 * /review/:orderId 通过 orderId 查找对应订单。
 */

export type OrderStatus = 'pending' | 'used' | 'done'

export interface TicketType {
  id: string
  name: string
  price: number
  /** 副行说明，如「6 小时」「含遮阳棚+茶位」 */
  desc: string
  /** 时段说明，用于订单日期行 */
  timeLabel: string
}

/** design.md 四种票型：青龙湾钓场通用 */
export const TICKET_TYPES: TicketType[] = [
  { id: 'half', name: '半天票', price: 68, desc: '6 小时 · 上午场 / 下午场任选', timeLabel: '6:00–12:00' },
  { id: 'full', name: '全天票', price: 98, desc: '全天不限时 · 6:00–19:00', timeLabel: '6:00–19:00' },
  { id: 'night', name: '夜钓票', price: 78, desc: '18:00–24:00 · 今晚放草鱼', timeLabel: '18:00–24:00' },
  { id: 'vip', name: 'VIP 钓位票', price: 128, desc: '含遮阳棚 + 茶位 · 全天', timeLabel: '6:00–19:00' },
]

export interface Pond {
  id: string
  name: string
  cover: string
  location: string
  rating: number
}

export const PONDS: Pond[] = [
  { id: 'qinglong', name: '青龙湾生态钓场', cover: '/pond-qinglong-1.webp', location: '武汉 · 江夏', rating: 4.8 },
  { id: 'ludao', name: '鹭岛湖路亚基地', cover: '/pond-ludao-1.webp', location: '武汉 · 东西湖', rating: 4.6 },
  { id: 'laozhou', name: '老周家斤塘', cover: '/pond-laozhou-1.webp', location: '武汉 · 黄陂', rating: 4.5 },
]

export interface CheckoutDate {
  weekday: string
  /** 如「10.18」 */
  label: string
  /** 如「2025.10.18 周五」 */
  full: string
  today?: boolean
  /** 放鱼日：日期块底部湖水绿小横条 */
  fishNews?: boolean
}

export const CHECKOUT_DATES: CheckoutDate[] = [
  { weekday: '周五', label: '10.18', full: '2025.10.18 周五', today: true },
  { weekday: '周六', label: '10.19', full: '2025.10.19 周六', fishNews: true },
  { weekday: '周日', label: '10.20', full: '2025.10.20 周日' },
  { weekday: '周一', label: '10.21', full: '2025.10.21 周一' },
  { weekday: '周二', label: '10.22', full: '2025.10.22 周二' },
  { weekday: '周三', label: '10.23', full: '2025.10.23 周三' },
  { weekday: '周四', label: '10.24', full: '2025.10.24 周四' },
]

export interface Coupon {
  id: string
  name: string
  off: number
  min: number
  available: boolean
  desc: string
}

export const COUPONS: Coupon[] = [
  { id: 'new5', name: '新人立减 5 元', off: 5, min: 0, available: true, desc: '全场门票通用' },
  { id: 'full15', name: '满 100 减 15', off: 15, min: 100, available: false, desc: '单笔满 ¥100 可用' },
]

/** 钓位：坐标来自 seat-map.svg（viewBox 720×400，格 28×28），index+1 即钓位号 */
export interface Seat {
  no: number
  /** 百分比定位（相对 seat-map.svg 容器） */
  x: number
  y: number
  /** 已被他人订走，置灰不可选 */
  taken?: boolean
}

const SEAT_RECTS: Array<[number, number]> = [
  [47.1, 392.1], [46.3, 353.5], [50.4, 315.0], [59.4, 277.4], [73.2, 241.3], [91.5, 207.2],
  [114.0, 175.8], [140.4, 147.5], [170.2, 122.9], [203.0, 102.3], [238.1, 86.1], [275.0, 74.5],
  [313.1, 67.8], [351.7, 66.1], [390.2, 69.3], [428.0, 77.4], [464.5, 90.4], [498.9, 107.9],
  [530.9, 129.7], [559.7, 155.5], [585.0, 184.7], [606.4, 217.0], [623.4, 251.7], [635.8, 288.4],
]

const TAKEN_SEATS = new Set([3, 7, 15, 21])

export const SEATS: Seat[] = SEAT_RECTS.map(([x, y], i) => ({
  no: i + 1,
  x: ((x + 14) / 720) * 100,
  y: ((y + 14) / 400) * 100,
  taken: TAKEN_SEATS.has(i + 1),
}))

export interface Order {
  id: string
  orderNo: string
  pond: Pond
  ticketName: string
  qty: number
  seatNo: number | null
  /** 如「2025.10.19 周六 · 6:00–12:00」 */
  dateLabel: string
  /** 如「10.19 周六」，用于摘要行 */
  dateShort: string
  /** 实付金额 */
  amount: number
  status: OrderStatus
  /** 6 位核销码 */
  verifyCode: string
}

/** 内存订单存储（SPA 路由切换间保持，演示状态流转） */
export const orderStore: Order[] = [
  {
    id: 'o1',
    orderNo: 'QY2025101800632',
    pond: PONDS[0],
    ticketName: '半天票',
    qty: 1,
    seatNo: 12,
    dateLabel: '2025.10.19 周六 · 6:00–12:00',
    dateShort: '10.19 周六',
    amount: 63.0,
    status: 'pending',
    verifyCode: '836219',
  },
  {
    id: 'o2',
    orderNo: 'QY2025101100418',
    pond: PONDS[1],
    ticketName: '全天票',
    qty: 2,
    seatNo: null,
    dateLabel: '2025.10.12 周六 · 全天',
    dateShort: '10.12 周六',
    amount: 196.0,
    status: 'used',
    verifyCode: '502473',
  },
  {
    id: 'o3',
    orderNo: 'QY2025092700206',
    pond: PONDS[2],
    ticketName: '全天票',
    qty: 1,
    seatNo: 8,
    dateLabel: '2025.09.28 周六 · 全天',
    dateShort: '09.28 周六',
    amount: 50.0,
    status: 'done',
    verifyCode: '117304',
  },
]

export function findOrder(id: string | undefined): Order | undefined {
  return orderStore.find((o) => o.id === id)
}

/** 生成 6 位核销码（演示随机） */
export function genVerifyCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/** 下单成功：新订单插入列表头部，状态「待使用」 */
export function addOrder(order: Order): void {
  orderStore.unshift(order)
}

/** 塘主核销：待使用 → 已使用 */
export function markOrderUsed(id: string): void {
  const o = findOrder(id)
  if (o && o.status === 'pending') o.status = 'used'
}

export const STATUS_META: Record<OrderStatus, { label: string; tab: string; badgeClass: string }> = {
  pending: { label: '待使用', tab: '待使用', badgeClass: 'bg-olive-tint text-olive' },
  used: { label: '已核销', tab: '已使用', badgeClass: 'bg-lake-tint text-lake' },
  done: { label: '已完成', tab: '已完成', badgeClass: 'bg-[#2d1e1e0d] text-ink-60' },
}

export function formatMoney(n: number): string {
  return n.toFixed(2)
}
