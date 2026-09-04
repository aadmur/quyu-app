import { AnimatePresence, motion } from 'framer-motion'
import { LogIn, Package, X } from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { relativeTime } from '@/lib/live'
import { goKimiLogin } from '@/components/LoginSheet'

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  paid: '已支付',
  shipped: '已发货',
  done: '已完成',
}

interface ProductOrdersSheetProps {
  open: boolean
  onClose: () => void
}

/** 我的商品订单弹层：调 products.mine 展示订单号/商品/金额/时间；未登录与空列表给对应空态 */
export default function ProductOrdersSheet({ open, onClose }: ProductOrdersSheetProps) {
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const me = meQuery.data ?? null
  const ordersQuery = trpc.app.products.mine.useQuery(undefined, {
    enabled: open && !!me,
    retry: 1,
  })
  const orders = ordersQuery.data ?? []

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="关闭我的订单"
            className="fixed inset-0 z-40 bg-ink/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="我的订单"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-[20px] bg-paper px-5 pt-3"
            style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 32px)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-ink">我的订单</h2>
              <button type="button" aria-label="关闭" onClick={onClose} className="text-ink-40">
                <X size={20} />
              </button>
            </header>

            {meQuery.isLoading ? (
              <div className="space-y-3 pb-2">
                {[0, 1].map((i) => (
                  <div key={`sk-${i}`} className="h-24 animate-pulse rounded-2xl bg-paper-white" />
                ))}
              </div>
            ) : !me ? (
              /* 未登录空态：引导登录 */
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Package size={36} strokeWidth={1.5} className="text-ink-40" />
                <p className="text-[14px] leading-5 text-ink-60">登录后查看你的商品订单</p>
                <button
                  type="button"
                  onClick={goKimiLogin}
                  className="mt-1 flex h-11 items-center gap-1.5 rounded-full bg-olive px-6 text-[14px] font-semibold text-paper-white active:brightness-95"
                >
                  <LogIn size={15} /> 使用 Kimi 账号登录
                </button>
              </div>
            ) : ordersQuery.isLoading ? (
              <div className="space-y-3 pb-2">
                {[0, 1].map((i) => (
                  <div key={`sk-${i}`} className="h-24 animate-pulse rounded-2xl bg-paper-white" />
                ))}
              </div>
            ) : ordersQuery.error ? (
              <p className="py-10 text-center text-[13px] leading-[18px] text-ink-60">
                订单加载失败，请稍后再试
              </p>
            ) : orders.length === 0 ? (
              /* 空订单空态 */
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <img src="/empty-creel.svg" alt="暂无订单" className="h-20 w-auto" />
                <p className="text-[14px] leading-5 text-ink-60">还没有商品订单，去商城逛逛吧</p>
              </div>
            ) : (
              <ul className="no-scrollbar max-h-[56vh] space-y-3 overflow-y-auto pb-2">
                {orders.map((o) => {
                  const created = o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt)
                  const ymd = Number.isNaN(created.getTime())
                    ? ''
                    : created.toISOString().slice(0, 10).replaceAll('-', '')
                  const totalQty = o.items.reduce((s, it) => s + it.qty, 0)
                  return (
                    <li key={o.id} className="rounded-2xl bg-paper-white p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-num text-[12px] leading-4 text-ink-40">
                          订单号 QY{ymd}
                          {String(o.id).padStart(4, '0')}
                        </span>
                        <span className="shrink-0 text-[12px] leading-4 text-lake">
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {o.items.map((it) => (
                          <li
                            key={it.productId}
                            className="flex items-baseline justify-between gap-2 text-[13px] leading-[18px]"
                          >
                            <span className="min-w-0 truncate text-ink">{it.name}</span>
                            <span className="shrink-0 font-num text-ink-60">×{it.qty}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
                        <span className="text-[12px] leading-4 text-ink-40">
                          {relativeTime(created)} · 共 {totalQty} 件
                        </span>
                        <span className="font-num text-[16px] font-semibold leading-5 text-clay">
                          ¥{o.totalAmount}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
