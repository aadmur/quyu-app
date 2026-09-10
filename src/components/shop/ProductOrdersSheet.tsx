import { useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { LogIn, Package, X } from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { relativeTime } from '@/lib/live'
import { goKimiLogin } from '@/components/LoginSheet'
import PasswordAuthForm from '@/components/PasswordAuthForm'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'

const STATUS_LABEL: Record<string, string> = {
  pending: '待付款',
  paid: '待发货',
  shipped: '待收货',
  done: '已完成',
  refunded: '已退款',
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: 'text-clay',
  paid: 'text-lake',
  shipped: 'text-olive',
  done: 'text-ink-60',
  refunded: 'text-ink-40',
}

/** 状态筛选 Tab：key 为空串表示全部 */
const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待付款' },
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '待收货' },
  { key: 'done', label: '已完成' },
  { key: 'refunded', label: '已退款' },
] as const

type OrderItem = { productId: number; name: string; price: number; qty: number }

interface ProductOrderRow {
  id: number
  userId: number
  items: OrderItem[]
  totalAmount: number
  status: string
  idempotencyKey: string | null
  createdAt: Date | string
}

interface ProductOrdersSheetProps {
  open: boolean
  onClose: () => void
}

/** 商品订单管理弹层：状态筛选 + 退款/确认收货/模拟发货进度，全部走真实接口 */
export default function ProductOrdersSheet({ open, onClose }: ProductOrdersSheetProps) {
  const { toast, showToast } = useToast()
  const utils = trpc.useUtils()
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const me = meQuery.data ?? null
  const ordersQuery = trpc.app.products.mine.useQuery(undefined, {
    enabled: open && !!me,
    retry: 1,
  })
  const orders = (ordersQuery.data ?? []) as ProductOrderRow[]
  const [tab, setTab] = useState<string>('')

  const refresh = () => utils.app.products.mine.invalidate()

  const refundMut = trpc.app.products.refund.useMutation({
    onSuccess: (r: { orderId: number; refundAmount: number }) => {
      showToast(`退款已受理，金额 ¥${r.refundAmount}`)
      refresh()
    },
    onError: (e: { message?: string }) => showToast(e.message || '退款失败，请稍后再试'),
  })
  const confirmMut = trpc.app.products.confirm.useMutation({
    onSuccess: () => {
      showToast('已确认收货')
      refresh()
    },
    onError: (e: { message?: string }) => showToast(e.message || '操作失败，请稍后再试'),
  })
  const advanceMut = trpc.app.products.advance.useMutation({
    onSuccess: (r: { orderId: number; status: string }) => {
      showToast(`已推进到「${STATUS_LABEL[r.status] ?? r.status}」（测试）`)
      refresh()
    },
    onError: (e: { message?: string }) => showToast(e.message || '操作失败，请稍后再试'),
  })
  const busyId =
    refundMut.isPending || confirmMut.isPending || advanceMut.isPending

  const filtered = tab ? orders.filter((o) => o.status === tab) : orders

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.button
            type="button"
            aria-label="关闭商品订单"
            className="fixed inset-0 z-40 bg-ink/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <m.div
            role="dialog"
            aria-label="商品订单"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-[20px] bg-paper px-5 pt-3"
            style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 32px)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-ink">商品订单</h2>
              <button type="button" aria-label="关闭" onClick={onClose} className="text-ink-40">
                <X size={20} />
              </button>
            </header>

            {/* 状态筛选 Tab */}
            <div className="no-scrollbar -mx-1 mb-3 flex gap-2 overflow-x-auto px-1">
              {STATUS_TABS.map((t) => {
                const active = tab === t.key
                return (
                  <button
                    key={t.key || 'all'}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] leading-4 ${
                      active ? 'bg-ink font-semibold text-paper-white' : 'bg-paper-white text-ink-60'
                    }`}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>

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
                <div className="mt-2 flex w-full items-center gap-3 text-[12px] text-ink-40">
                  <span className="h-px flex-1 bg-line" />
                  或用账号密码
                  <span className="h-px flex-1 bg-line" />
                </div>
                <PasswordAuthForm compact onSuccess={onClose} />
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
            ) : filtered.length === 0 ? (
              /* 空订单空态（含筛选后无结果） */
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <img src="/empty-creel.svg" alt="暂无订单" className="h-20 w-auto" />
                <p className="text-[14px] leading-5 text-ink-60">
                  {tab ? `没有「${STATUS_LABEL[tab]}」状态的订单` : '还没有商品订单，去商城逛逛吧'}
                </p>
              </div>
            ) : (
              <ul className="no-scrollbar max-h-[52vh] space-y-3 overflow-y-auto pb-2">
                {filtered.map((o) => {
                  const created = o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt)
                  const ymd = Number.isNaN(created.getTime())
                    ? ''
                    : created.toISOString().slice(0, 10).replaceAll('-', '')
                  const totalQty = o.items.reduce((s, it) => s + it.qty, 0)
                  const refundable = o.status === 'pending' || o.status === 'paid'
                  return (
                    <li key={o.id} className="rounded-2xl bg-paper-white p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-num text-[12px] leading-4 text-ink-40">
                          订单号 QY{ymd}
                          {String(o.id).padStart(4, '0')}
                        </span>
                        <span
                          className={`shrink-0 text-[12px] leading-4 ${STATUS_BADGE_CLASS[o.status] ?? 'text-lake'}`}
                        >
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
                      {/* 按状态显示操作 */}
                      {refundable && (
                        <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
                          <button
                            type="button"
                            disabled={busyId}
                            onClick={() => refundMut.mutate({ orderId: o.id })}
                            className="rounded-full border border-line px-3.5 py-1.5 text-[12px] leading-4 text-ink-60 active:bg-paper disabled:opacity-50"
                          >
                            申请退款
                          </button>
                          <button
                            type="button"
                            disabled={busyId}
                            onClick={() => advanceMut.mutate({ orderId: o.id })}
                            className="rounded-full bg-lake-tint px-3.5 py-1.5 text-[12px] leading-4 text-lake active:brightness-95 disabled:opacity-50"
                          >
                            模拟发货进度（测试）
                          </button>
                        </div>
                      )}
                      {o.status === 'shipped' && (
                        <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
                          <button
                            type="button"
                            disabled={busyId}
                            onClick={() => confirmMut.mutate({ orderId: o.id })}
                            className="rounded-full bg-olive px-3.5 py-1.5 text-[12px] font-semibold leading-4 text-paper-white active:brightness-95 disabled:opacity-50"
                          >
                            确认收货
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </m.div>
          <Toast message={toast} />
        </>
      )}
    </AnimatePresence>
  )
}
