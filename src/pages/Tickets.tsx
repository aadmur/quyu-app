import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/trade/PageHeader'
import Toast from '@/components/trade/Toast'
import QRCodeCard from '@/components/trade/QRCodeCard'
import { orderStore, markOrderUsed, STATUS_META, formatMoney } from '@/data/orders'
import type { Order, OrderStatus } from '@/data/orders'
import { trpc } from '@/providers/trpc'
import { mapMyOrder } from '@/lib/live'
import { useAuthGate } from '@/components/LoginSheet'

const TABS: OrderStatus[] = ['pending', 'used', 'done']

/** 订单卡：塘名/状态 + 票据信息 + 实付金额 + 状态操作（出示核销码 / 去评价 / 再来一单） */
function OrderCard({
  order,
  index,
  onShowCode,
}: {
  order: Order
  index: number
  onShowCode: (o: Order) => void
}) {
  const navigate = useNavigate()
  const meta = STATUS_META[order.status]

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.08 * index, ease: 'easeOut' }}
      className="relative mx-4 overflow-hidden rounded-2xl"
    >
      <div className="relative rounded-2xl bg-paper-white p-4">
        {/* 顶行：塘名 + 状态徽章 */}
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold leading-[22px] text-ink">{order.pond.name}</span>
          <span className={`rounded-full px-2.5 py-1 text-[12px] leading-4 ${meta.badgeClass}`}>
            {meta.label}
          </span>
        </div>

        {/* 中行：封面 + 信息列 */}
        <div className="mt-3 flex gap-3">
          <img
            src={order.pond.cover}
            alt={order.pond.name}
            className="h-16 w-16 shrink-0 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-[22px] text-ink">
              {order.ticketName} × {order.qty}
              {order.seatNo ? ` · ${order.seatNo} 号钓位` : ''}
            </p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-ink-60">{order.dateLabel}</p>
            <p className="mt-0.5 text-[12px] leading-4 text-ink-40">
              订单号 <span className="font-num tracking-[0.02em]">{order.orderNo}</span>
            </p>
          </div>
        </div>

        {/* 底行：金额 + 操作 */}
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="text-[13px] leading-[18px] text-ink-60">
            实付 <span className="font-num text-[20px] leading-6 text-clay">¥{formatMoney(order.amount)}</span>
          </span>
          {order.status === 'pending' && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => onShowCode(order)}
              className="flex h-9 items-center rounded-xl bg-olive px-4 text-[13px] font-semibold leading-[18px] text-paper-white"
            >
              出示核销码
            </motion.button>
          )}
          {order.status === 'used' && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => navigate(`/review/${order.id}`)}
              className="flex h-9 items-center rounded-xl border border-olive bg-paper-white px-4 text-[13px] font-semibold leading-[18px] text-olive"
            >
              去评价
            </motion.button>
          )}
          {order.status === 'done' && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => navigate(`/pond/${order.pond.id}`)}
              className="flex h-9 items-center rounded-xl border border-olive bg-paper-white px-4 text-[13px] font-semibold leading-[18px] text-olive"
            >
              再来一单
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/** 空状态：空鱼护插画 + 人话文案 + 次按钮「找钓点」 */
function EmptyTickets() {
  const navigate = useNavigate()
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center px-8 pb-16 pt-14"
    >
      <img src="/empty-creel.svg" alt="" className="h-40 w-[200px]" />
      <p className="mt-4 text-[15px] leading-[22px] text-ink-60">还没有票券，去钓点逛逛吧</p>
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={() => navigate('/spots')}
        className="mt-5 flex h-12 w-40 items-center justify-center rounded-xl border border-olive bg-paper-white text-[15px] font-semibold leading-[22px] text-olive"
      >
        找钓点
      </motion.button>
    </motion.div>
  )
}

/** 订单与核销码页：状态 Tab + 订单卡列表 + 核销码弹层（含已核销印章演示）
 *  数据源：trpc.app.orders.mine；「模拟塘主核销」调 orders.verify；仅网络不可达时回退演示核销 */
export default function Tickets() {
  const [tab, setTab] = useState<OrderStatus>('pending')
  const [, setTick] = useState(0) // 核销后强制刷新列表（mock 兜底用）
  const [codeOrder, setCodeOrder] = useState<Order | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)

  const mineQuery = trpc.app.orders.mine.useQuery(undefined, { retry: 1 })
  const verifyMut = trpc.app.orders.verify.useMutation()
  const utils = trpc.useUtils()
  const { requireAuth, loginSheet } = useAuthGate()
  const live = !!mineQuery.data && !mineQuery.error

  const fireToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const allOrders = useMemo<Order[]>(
    () => (mineQuery.data ? mineQuery.data.map(mapMyOrder) : orderStore),
    [mineQuery.data],
  )
  const counts = TABS.map((s) => allOrders.filter((o) => o.status === s).length)
  const list = allOrders.filter((o) => o.status === tab)

  const simulateUse = (order: Order) => {
    const markUsedLocal = () => {
      markOrderUsed(order.id)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(30)
      setTick((t) => t + 1)
    }
    if (!live) {
      // 后端不可用（网络不可达）：仅此时允许演示兜底，文案明示
      markUsedLocal()
      fireToast('演示模式：已模拟核销')
      return
    }
    verifyMut.mutate(
      { code: order.verifyCode },
      {
        onSuccess: (r) => {
          if (!r.ok) {
            fireToast(r.reason)
            return
          }
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(30)
          setCodeOrder((prev) => (prev ? { ...prev, status: 'used' } : prev))
          utils.app.orders.mine.invalidate()
          utils.app.orders.ownerStats.invalidate()
        },
        onError: (e) => {
          const errCode = (e as { data?: { code?: string } } | null)?.data?.code
          if (errCode === 'UNAUTHORIZED') {
            fireToast('请先登录')
            requireAuth('核销门票')
            return
          }
          if (errCode === 'FORBIDDEN') {
            fireToast('仅认证塘主可核销')
            return
          }
          if (errCode) {
            // 限流 / 5xx 等服务端错误：展示真实错误信息
            fireToast(e.message || '核销失败，请稍后再试')
            return
          }
          // 无服务端响应码（网络不可达）：演示兜底，文案明示
          markUsedLocal()
          fireToast('网络不可用，已演示核销')
        },
      },
    )
  }

  return (
    <div className="min-h-full bg-paper pb-8">
      <PageHeader title="我的票券" />
      <Toast message={toast} show={!!toast} />

      {/* 状态分段 Tab */}
      <div className="flex h-11 border-b border-line">
        {TABS.map((s, i) => {
          const active = tab === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => setTab(s)}
              className={`relative flex flex-1 items-center justify-center gap-1 text-[15px] leading-[22px] ${
                active ? 'font-semibold text-ink' : 'text-ink-60'
              }`}
            >
              {STATUS_META[s].tab}
              <span className="font-num text-[16px] leading-5 text-olive">{counts[i]}</span>
              {active && (
                <motion.span
                  layoutId="tickets-tab-line"
                  className="absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full bg-olive"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* 订单列表 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="space-y-3 py-3"
        >
          {mineQuery.isLoading ? (
            [0, 1].map((i) => (
              <div key={`sk-${i}`} className="mx-4 animate-pulse rounded-2xl bg-paper-white p-4">
                <div className="h-4 w-32 rounded bg-paper" />
                <div className="mt-3 flex gap-3">
                  <div className="h-16 w-16 rounded-lg bg-paper" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 w-40 rounded bg-paper" />
                    <div className="h-3 w-28 rounded bg-paper" />
                  </div>
                </div>
              </div>
            ))
          ) : list.length === 0 ? (
            <EmptyTickets />
          ) : (
            list.map((o, i) => (
              <OrderCard key={o.id} order={o} index={i} onShowCode={setCodeOrder} />
            ))
          )}
        </motion.div>
      </AnimatePresence>

      {/* 核销码弹层 */}
      <AnimatePresence>
        {codeOrder && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-ink"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setCodeOrder(null)}
            />
            <motion.div
              className="fixed inset-0 z-40 mx-auto flex max-w-[420px] items-center justify-center px-6"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            >
              <QRCodeCard
                order={codeOrder}
                used={codeOrder.status !== 'pending'}
                onSimulateUse={() => simulateUse(codeOrder)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {loginSheet}
    </div>
  )
}
