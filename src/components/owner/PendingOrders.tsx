import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { PendingOrder } from '@/data/owner'

interface PendingOrdersProps {
  orders: PendingOrder[]
  total: number
  onVerify: (order: PendingOrder) => void
}

const PREVIEW_COUNT = 3

/** 待核销订单列表：默认显示前 3 条，「查看全部」本地展开；核销成功后该项滑出消失，其余 layout 上移补位 */
export default function PendingOrders({ orders, total, onVerify }: PendingOrdersProps) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? orders : orders.slice(0, PREVIEW_COUNT)
  const canExpand = orders.length > PREVIEW_COUNT

  return (
    <section className="mx-4 mb-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">待核销 {total}</h2>
        {canExpand && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[13px] font-semibold leading-[18px] text-olive"
          >
            {showAll ? '收起 ↑' : '查看全部 →'}
          </button>
        )}
      </div>
      <motion.div layout>
        <AnimatePresence initial={false}>
          {visible.map((order, i) => (
            <motion.div
              key={order.id}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.3, ease: 'easeOut', delay: i * 0.06 }}
              className="mb-2 flex items-center gap-3 rounded-xl bg-paper-white p-3"
            >
              <img src={order.avatar} alt={order.name} className="h-10 w-10 shrink-0 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold leading-[18px] text-ink">{order.name}</p>
                <p className="truncate text-[12px] leading-4 text-ink-60">
                  {order.ticket} · {order.seat} · {order.note}
                </p>
              </div>
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => onVerify(order)}
                className="h-8 shrink-0 rounded-full border border-olive px-3.5 text-[13px] font-semibold leading-none text-olive"
              >
                核销
              </motion.button>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
      {orders.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-paper-white px-6 py-6 text-center">
          <img src="/empty-creel.svg" alt="" className="h-16 w-auto" />
          <p className="text-[13px] leading-[18px] text-ink-60">到场钓友都已核销，喝口茶歇会儿</p>
        </div>
      )}
    </section>
  )
}
