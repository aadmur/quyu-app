import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, animate, useMotionValue, useTransform } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
import { Minus, Plus, X } from 'lucide-react'
import PageHeader from '@/components/trade/PageHeader'
import Toast from '@/components/trade/Toast'
import SeatSheet from '@/components/trade/SeatSheet'
import CashierSheet from '@/components/trade/CashierSheet'
import SuccessCheck from '@/components/trade/SuccessCheck'
import Confetti from '@/components/trade/Confetti'
import { COUPONS, addOrder, genVerifyCode, formatMoney } from '@/data/orders'
import type { Order } from '@/data/orders'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/components/LoginSheet'

const INSURANCE_PRICE = 3
const MAX_QTY = 4

/** 本地时区格式化 yyyy-MM-dd（不用 toISOString，避免 UTC 导致日期前一天） */
function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

interface CheckoutDay {
  key: string
  /** 如「周五」；首日「今天」次日「明天」 */
  weekday: string
  /** 如「10.18」 */
  label: string
  /** 如「2025.10.18 周五」 */
  full: string
  today?: boolean
}

/** 从今天起 7 天的动态日期 */
function next7Days(): CheckoutDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const label = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
    const week = `周${WEEK[d.getDay()]}`
    return {
      key: localDateKey(d),
      weekday: i === 0 ? '今天' : i === 1 ? '明天' : week,
      label,
      full: `${d.getFullYear()}.${label} ${week}`,
      today: i === 0,
    }
  })
}

/** 页面级幂等键：进入页面生成一次，支付失败重试复用，下单成功后换新 */
function genIdemKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 步骤标题行：圆形序号章（olive 底白字 Bebas）+ 标题 */
function StepTitle({ no, title, extra }: { no: number; title: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-olive font-num text-[14px] leading-none text-paper-white">
          {no}
        </span>
        <span className="text-[15px] font-semibold leading-[22px] text-ink">{title}</span>
      </div>
      {extra}
    </div>
  )
}

/** 合计金额数字滚动（0.3s counter） */
function RollingMoney({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => `¥${formatMoney(v)}`)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      mv.set(value)
      return
    }
    const controls = animate(mv, value, { duration: 0.3, ease: 'easeOut' })
    return () => controls.stop()
  }, [value, mv])
  return <motion.span className={className}>{text}</motion.span>
}

/** 支付成功全屏页：对勾描边动画 + 彩带 + 二维码缩略卡 + 双按钮 */
function PaySuccess({ order, seatNos }: { order: Order; seatNos: number[] }) {
  const navigate = useNavigate()
  return (
    <motion.div
      className="relative flex flex-col items-center bg-paper px-8 pt-16"
      style={{
        minHeight: 'calc(100dvh - max(var(--safe-top, 0px), 44px))',
        paddingBottom: 'max(var(--safe-bottom, 0px), 40px)',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <Confetti />
      <SuccessCheck size={96} />
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3, ease: 'easeOut' }}
        className="mt-5 text-[28px] font-bold leading-[34px] text-ink"
      >
        支付成功
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.38, ease: 'easeOut' }}
        className="mt-1 text-[13px] leading-[18px] text-ink-60"
      >
        核销码已生成，钓场入口出示即可
      </motion.p>

      {/* 二维码缩略卡 */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.5, ease: 'easeOut' }}
        className="mt-6 flex w-full flex-col items-center rounded-2xl bg-paper-white px-6 py-5"
      >
        <img src="/qr-demo.svg" alt="核销二维码" className="h-24 w-24" />
        <p className="mt-2 font-num text-[32px] leading-9 tracking-[0.15em] text-ink">
          {order.verifyCode.split('').join(' ')}
        </p>
        <p className="mt-1 text-[12px] leading-4 text-ink-60">
          {order.pond.name} · {order.ticketName} × {order.qty}
          {seatNos.length > 0 ? ` · ${seatNos.join('、')} 号位` : ''}
        </p>
      </motion.div>

      {/* 双按钮 */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.7, ease: 'easeOut' }}
        className="mt-auto flex w-full flex-col gap-3 pt-10"
      >
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/tickets')}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-olive text-[15px] font-semibold leading-[22px] text-paper-white"
        >
          查看我的票券
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/')}
          className="flex h-12 w-full items-center justify-center rounded-xl border border-olive bg-paper-white text-[15px] font-semibold leading-[22px] text-olive"
        >
          返回首页
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

/** 详情加载骨架屏 */
function CheckoutSkeleton() {
  return (
    <div className="min-h-full animate-pulse bg-paper pb-32">
      <PageHeader title="预订门票" />
      <div className="mx-4 mb-5 mt-2 flex items-center gap-3">
        <div className="h-[60px] w-[60px] rounded-lg bg-paper-white" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded bg-paper-white" />
          <div className="h-3 w-28 rounded bg-paper-white" />
        </div>
      </div>
      <div className="mx-4 mb-6 h-16 rounded-xl bg-paper-white" />
      <div className="mx-4 mb-6 grid grid-cols-2 gap-2">
        <div className="h-[74px] rounded-xl bg-paper-white" />
        <div className="h-[74px] rounded-xl bg-paper-white" />
      </div>
      <div className="mx-4 h-44 rounded-2xl bg-paper-white" />
    </div>
  )
}

/** 下单支付页：选日期/票种/数量/钓位 → 费用明细 → 模拟收银台 → 支付成功（真实 orders.create）
 *  唯一数据源：ponds.detail（票种/价格/钓位/封面均来自后端），日期从今天起动态生成 */
export default function Checkout() {
  const location = useLocation()
  // 从钓场详情页带入的购票上下文（真实票种 id / 钓场 slug / 钓位号 / 到访日期）
  const navState = location.state as
    | { pondSlug?: string; ticketId?: string; seatNo?: number; visitDate?: string }
    | null
  const pondSlug = navState?.pondSlug ?? 'qinglong'

  const days = useMemo(next7Days, [])
  const [visitDate, setVisitDate] = useState(() =>
    navState?.visitDate && days.some((d) => d.key === navState.visitDate) ? navState.visitDate : days[0].key,
  )
  const [ticketId, setTicketId] = useState(navState?.ticketId ?? '')
  const [qty, setQty] = useState(1)
  const [seatNos, setSeatNos] = useState<number[]>(navState?.seatNo ? [navState.seatNo] : [])
  const [insurance, setInsurance] = useState(false)
  const [couponId, setCouponId] = useState<string | null>('new5')
  const [showSeatSheet, setShowSeatSheet] = useState(false)
  const [showCouponSheet, setShowCouponSheet] = useState(false)
  const [showCashier, setShowCashier] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [paidOrder, setPaidOrder] = useState<Order | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  // 幂等键：进页生成一次，失败重试复用同一键，成功后才换新
  const [idemKey, setIdemKey] = useState(genIdemKey)

  // 唯一数据源：ponds.detail；visitDate 传给后端按日返回钓位占用（旧后端忽略该参数，zod 剥离不报错）
  // placeholderData 保留上一日数据，切换日期时不整页闪骨架，新数据到达后由校验效应清理已订走钓位
  const detailQuery = trpc.app.ponds.detail.useQuery(
    { slug: pondSlug, visitDate } as { slug: string },
    { retry: 1, placeholderData: (prev) => prev },
  )
  const createOrderMut = trpc.app.orders.create.useMutation()
  const utils = trpc.useUtils()
  const { requireAuth, loginSheet } = useAuthGate()

  const detail = detailQuery.data ?? null
  const tickets = useMemo(() => detail?.tickets ?? [], [detail])
  const seatOptions = useMemo(
    () => (detail?.seats ?? []).map((s) => ({ no: s.seatNo, taken: s.isSold })),
    [detail],
  )

  // 数据就绪后校验票种：带入的 ticketId 不在该钓场真实票种中时回退到第一个票种
  useEffect(() => {
    if (tickets.length === 0) return
    if (!tickets.some((t) => String(t.id) === ticketId)) setTicketId(String(tickets[0].id))
  }, [tickets, ticketId])

  // 数据就绪/日期切换后校验钓位：剔除已订走的，全空时自动补选第一个空闲位
  useEffect(() => {
    if (!detail) return
    setSeatNos((prev) => {
      const valid = prev.filter((no) => detail.seats.some((s) => s.seatNo === no && !s.isSold))
      if (valid.length > 0) return valid
      const firstFree = detail.seats.find((s) => !s.isSold)
      return firstFree ? [firstFree.seatNo] : []
    })
  }, [detail])

  const ticket = tickets.find((t) => String(t.id) === ticketId) ?? tickets[0]
  const date = days.find((d) => d.key === visitDate) ?? days[0]
  const coupon = COUPONS.find((c) => c.id === couponId && c.available) ?? null

  const ticketPrice = ticket?.price ?? 0
  const base = ticketPrice * qty
  const insuranceFee = insurance ? INSURANCE_PRICE : 0
  const couponOff = coupon && base + insuranceFee >= coupon.min ? coupon.off : 0
  const total = Math.max(base + insuranceFee - couponOff, 0)

  const fireToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const orderSummary = `${detail?.name ?? ''} · ${ticket?.name ?? ''}`

  const changeQty = (next: number) => {
    const n = Math.min(Math.max(1, next), MAX_QTY)
    if (next > MAX_QTY) {
      fireToast('单次最多预订 4 张')
      return
    }
    setQty(n)
    setSeatNos((prev) => prev.slice(0, n)) // 减数量时裁掉多余钓位，保持 seatNos.length ≤ qty
  }

  const goPay = () => {
    if (!requireAuth('购票')) return
    if (!ticket) return
    if (seatNos.length !== qty) {
      fireToast(`还需选择 ${qty - seatNos.length} 个钓位`)
      setShowSeatSheet(true)
      return
    }
    setShowCashier(true)
  }

  const handlePaid = () => {
    if (!detail || !ticket) return
    setPlacing(true)
    const ticketName = ticket.name
    const buildOrder = (verifyCode: string, id?: number): Order => ({
      id: id != null ? String(id) : `o${Date.now()}`,
      orderNo: `QY${visitDate.replaceAll('-', '')}${Math.floor(100 + Math.random() * 900)}`,
      pond: {
        id: detail.slug,
        name: detail.name,
        cover: detail.cover,
        location: detail.region,
        rating: Number(detail.rating),
      },
      ticketName,
      qty,
      seatNo: seatNos[0] ?? null,
      dateLabel: `${date.full} · ${ticket.durationDesc ?? ticketName}`,
      dateShort: `${date.label} ${date.weekday}`,
      amount: total,
      status: 'pending',
      verifyCode,
    })

    createOrderMut.mutate(
      {
        pondSlug,
        ticketTypeId: Number(ticket.id),
        visitDate,
        quantity: qty,
        seatNos,
        totalAmount: Math.round(total),
        idempotencyKey: idemKey,
      },
      {
        onSuccess: async ({ orderId }) => {
          let order = buildOrder(genVerifyCode(), orderId)
          try {
            const mine = await utils.app.orders.mine.fetch()
            const real = mine.find((o) => o.id === orderId)
            if (real) order = buildOrder(real.verifyCode, orderId)
          } catch {
            /* 核销码获取失败则保留本地码 */
          }
          setPaidOrder(order)
          setShowCashier(false)
          setPlacing(false)
          setIdemKey(genIdemKey()) // 成功后换新键，避免下一单被幂等去重
          utils.app.orders.mine.invalidate()
          detailQuery.refetch() // 刷新钓位占用
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(30)
          document.getElementById('app-scroll')?.scrollTo({ top: 0 })
        },
        onError: (e) => {
          setPlacing(false)
          setShowCashier(false)
          const errCode = (e as { data?: { code?: string } } | null)?.data?.code
          if (errCode) {
            // 服务端明确拒绝（票种失效 / 钓位被订走 / 参数错误等）：展示真实原因，不伪造订单
            fireToast(e.message || '下单失败，请重试')
            detailQuery.refetch()
            return
          }
          // 网络不可达：演示兜底（文案明示）
          const demo = buildOrder(genVerifyCode())
          addOrder(demo)
          setPaidOrder(demo)
          fireToast('网络异常，已生成演示订单')
        },
      },
    )
  }

  if (paidOrder) return <PaySuccess order={paidOrder} seatNos={seatNos} />
  if (detailQuery.isLoading) return <CheckoutSkeleton />
  if (!detail) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-paper px-8 text-center">
        <PageHeader title="预订门票" />
        <img src="/empty-creel.svg" alt="空鱼护" className="h-32 w-40 opacity-80" />
        <p className="text-[15px] leading-[22px] text-ink-60">钓场信息加载失败，请检查网络后重试</p>
        <button
          type="button"
          onClick={() => detailQuery.refetch()}
          className="mt-2 h-12 rounded-xl bg-olive px-6 text-[15px] font-semibold text-paper-white"
        >
          重新加载
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-paper pb-32">
      <PageHeader title="预订门票" />
      <Toast message={toast} show={!!toast} />

      {/* 钓场摘要条 */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="mx-4 mb-5 mt-2 flex items-center gap-3"
      >
        <img src={detail.cover} alt={detail.name} className="h-[60px] w-[60px] rounded-lg object-cover" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-[22px] text-ink">{detail.name}</p>
          <p className="mt-0.5 text-[12px] leading-4 text-ink-60">
            {ticket ? `${ticket.name} · ${ticket.durationDesc ?? ''}` : '暂无可售票种'}
          </p>
        </div>
      </motion.div>

      {/* 步骤一 · 选择日期 */}
      <section className="mb-6">
        <div className="px-4">
          <StepTitle no={1} title="选择日期" />
        </div>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4 py-1">
          {days.map((d, i) => {
            const active = d.key === visitDate
            return (
              <motion.button
                key={d.key}
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.04 * i, ease: 'easeOut' }}
                onClick={() => setVisitDate(d.key)}
                className={`relative flex h-16 w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl ${
                  active ? 'text-paper-white' : 'border border-line bg-paper-white text-ink'
                }`}
                style={{ scale: active ? 1.05 : 1 }}
              >
                {active && (
                  <motion.span
                    layoutId="date-pill"
                    className="absolute inset-0 rounded-xl bg-olive"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                {d.today && <span className="absolute -top-1 h-1.5 w-1.5 rounded-full bg-clay" />}
                <span className={`relative text-[12px] leading-4 ${active ? 'text-paper-white' : 'text-ink-60'}`}>
                  {d.weekday}
                </span>
                <span className="relative font-num text-[20px] leading-6">{d.label}</span>
              </motion.button>
            )
          })}
        </div>
      </section>

      {/* 步骤二 · 选择票种 */}
      <section className="mb-6 px-4">
        <StepTitle no={2} title="选择票种" />
        {tickets.length === 0 ? (
          <p className="mt-3 rounded-xl border border-line bg-paper-white p-4 text-center text-[13px] leading-[18px] text-ink-60">
            该钓场暂无可售票种
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {tickets.map((t, i) => {
              const active = String(t.id) === ticketId
              return (
                <motion.button
                  key={t.id}
                  type="button"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.05 * i, ease: 'easeOut' }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setTicketId(String(t.id))}
                  className={`rounded-xl border p-3 text-left ${
                    active ? 'border-olive bg-olive-tint' : 'border-line bg-paper-white'
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[15px] font-semibold leading-[22px] text-ink">{t.name}</span>
                    <span className="font-num text-[20px] leading-6 text-clay">¥{t.price}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-4 text-ink-60">{t.durationDesc ?? ''}</p>
                </motion.button>
              )
            })}
          </div>
        )}
      </section>

      {/* 步骤三 · 选择数量 */}
      <section className="mb-6 px-4">
        <StepTitle
          no={3}
          title="选择数量"
          extra={
            <div className="flex items-center gap-3">
              <motion.button
                type="button"
                aria-label="减少数量"
                whileTap={{ scale: 0.9 }}
                onClick={() => changeQty(qty - 1)}
                disabled={qty <= 1}
                className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                  qty <= 1 ? 'border-line text-ink-40' : 'border-line text-ink'
                }`}
              >
                <Minus size={18} strokeWidth={1.8} />
              </motion.button>
              <motion.span
                key={qty}
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                className="w-6 text-center font-num text-[20px] leading-6 text-ink"
              >
                {qty}
              </motion.span>
              <motion.button
                type="button"
                aria-label="增加数量"
                whileTap={{ scale: 0.9 }}
                onClick={() => changeQty(qty + 1)}
                className={`flex h-9 w-9 items-center justify-center rounded-full border ${
                  qty >= MAX_QTY ? 'border-line text-ink-40' : 'border-olive text-olive'
                }`}
              >
                <Plus size={18} strokeWidth={1.8} />
              </motion.button>
            </div>
          }
        />
        <p className="mt-2 text-[12px] leading-4 text-ink-40">单次最多预订 4 张</p>
      </section>

      {/* 步骤四 · 钓位 */}
      <section className="mb-6 px-4">
        <StepTitle
          no={4}
          title="钓位"
          extra={
            <div className="flex items-center gap-2">
              {seatNos.length > 0 && (
                <span className="rounded-full bg-lake-tint px-2.5 py-1 text-[12px] leading-4 text-lake">
                  {[...seatNos].sort((a, b) => a - b).join('、')} 号位
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowSeatSheet(true)}
                className="text-[15px] font-semibold leading-[22px] text-olive"
              >
                {seatNos.length > 0 ? '更换' : '去选择'}
              </button>
            </div>
          }
        />
        <p className="mt-2 text-[12px] leading-4 text-ink-40">钓位免费预留，选几个钓位即几张票，入场后按号入座</p>
      </section>

      {/* 费用明细 */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15, ease: 'easeOut' }}
        className="mx-4 rounded-2xl bg-paper-white p-4"
      >
        <p className="text-[15px] font-semibold leading-[22px] text-ink">费用明细</p>
        <div className="mt-3 space-y-2.5 text-[13px] leading-[18px]">
          <div className="flex items-center justify-between">
            <span className="text-ink-60">
              {ticket?.name ?? '门票'} × {qty}
            </span>
            <span className="font-num text-[15px] text-ink">¥{formatMoney(base)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-60">
              {seatNos.length > 0 ? `${[...seatNos].sort((a, b) => a - b).join('、')} 号钓位` : '钓位（未选择）'}
            </span>
            <span className="text-ink-60">免费</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-60">鱼票保险（可选）</span>
            <span className="flex items-center gap-2">
              <span className="font-num text-[15px] text-ink">¥{formatMoney(INSURANCE_PRICE)}</span>
              <button
                type="button"
                role="switch"
                aria-checked={insurance}
                aria-label="鱼票保险"
                onClick={() => setInsurance((v) => !v)}
                className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                  insurance ? 'bg-olive' : 'bg-[#2d1e1e14]'
                }`}
              >
                <motion.span
                  layout="position"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className={`h-5 w-5 rounded-full bg-paper-white ${insurance ? 'ml-auto' : ''}`}
                />
              </button>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-60">优惠券</span>
            <button
              type="button"
              onClick={() => setShowCouponSheet(true)}
              className={`text-[13px] leading-[18px] ${couponOff > 0 ? 'font-num text-[15px] text-clay' : 'text-olive'}`}
            >
              {couponOff > 0 ? `-¥${formatMoney(couponOff)}` : '选择优惠券'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="text-[15px] font-semibold leading-[22px] text-ink">合计</span>
          <RollingMoney value={total} className="font-num text-[32px] leading-9 text-clay" />
        </div>
      </motion.section>

      {/* 吸底支付栏 */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ duration: 0.35, delay: 0.3, ease: 'easeOut' }}
        className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[420px] border-t border-line bg-paper-white"
        style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 12px)' }}
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-[12px] leading-4 text-ink-60">合计</p>
            <RollingMoney value={total} className="font-num text-[32px] leading-9 text-clay" />
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={goPay}
            disabled={!ticket || placing}
            className="flex h-12 w-40 items-center justify-center rounded-xl bg-olive text-[15px] font-semibold leading-[22px] text-paper-white disabled:opacity-50"
          >
            去支付
          </motion.button>
        </div>
      </motion.div>

      {/* 选钓位弹层（真实钓位 + 多选，与数量联动） */}
      <AnimatePresence>
        {showSeatSheet && (
          <SeatSheet
            seats={seatOptions}
            selected={seatNos}
            max={MAX_QTY}
            onClose={() => setShowSeatSheet(false)}
            onConfirm={(nos) => {
              setSeatNos(nos)
              setQty(nos.length) // 选了 N 个座位 = N 张票
              setShowSeatSheet(false)
            }}
          />
        )}
      </AnimatePresence>

      {/* 优惠券弹层 */}
      <AnimatePresence>
        {showCouponSheet && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-ink"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCouponSheet(false)}
            />
            <motion.div
              className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[420px] rounded-t-[20px] bg-paper-white"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            >
              <div className="flex h-12 items-center justify-center border-b border-line">
                <span className="text-[18px] font-semibold leading-6 text-ink">选择优惠券</span>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={() => setShowCouponSheet(false)}
                  className="absolute right-3 flex h-10 w-10 items-center justify-center text-ink-60"
                >
                  <X size={22} strokeWidth={1.8} />
                </button>
              </div>
              <div className="space-y-3 px-4 py-4" style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 20px)' }}>
                {COUPONS.map((c) => {
                  const usable = c.available && base + insuranceFee >= c.min
                  const active = couponId === c.id && usable
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!usable}
                      onClick={() => {
                        setCouponId(active ? null : c.id)
                        setShowCouponSheet(false)
                      }}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${
                        active ? 'border-olive bg-olive-tint' : usable ? 'border-line bg-paper-white' : 'border-line bg-paper opacity-60'
                      }`}
                    >
                      <div>
                        <p className="text-[15px] font-semibold leading-[22px] text-ink">{c.name}</p>
                        <p className="mt-0.5 text-[12px] leading-4 text-ink-60">
                          {c.desc}
                          {!usable && '（不可用）'}
                        </p>
                      </div>
                      <span className="font-num text-[24px] leading-7 text-clay">-¥{c.off}</span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 收银台 */}
      <AnimatePresence>
        {showCashier && (
          <CashierSheet amount={total} summary={orderSummary} onPaid={handlePaid} onClose={() => !placing && setShowCashier(false)} />
        )}
      </AnimatePresence>

      {loginSheet}
    </div>
  )
}
