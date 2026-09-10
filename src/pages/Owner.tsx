import { useCallback, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import PondStatusCard from '@/components/owner/PondStatusCard'
import StatsGrid from '@/components/owner/StatsGrid'
import ScanVerifyCard from '@/components/owner/ScanVerifyCard'
import ScanOverlay from '@/components/owner/ScanOverlay'
import ManualCodeSheet from '@/components/owner/ManualCodeSheet'
import VerifyResultSheet from '@/components/owner/VerifyResultSheet'
import PendingOrders from '@/components/owner/PendingOrders'
import NewsComposer from '@/components/owner/NewsComposer'
import WeekChart from '@/components/owner/WeekChart'
import { PENDING_ORDERS, SCAN_DEMO_ORDER } from '@/data/owner'
import type { PendingOrder } from '@/data/owner'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/components/LoginSheet'

/** 核销返回的订单 → 结果弹层展示模型 */
function toPendingOrder(o: {
  id: number
  ticketName: string
  seatNos: number[]
  verifyCode: string
  visitDate?: string
}): PendingOrder {
  return {
    id: String(o.id),
    name: '钓友',
    avatar: '/avatar-1.png',
    ticket: o.ticketName,
    seat: o.seatNos.length > 0 ? `${o.seatNos[0]} 号位` : '不限钓位',
    note: o.visitDate ? `到访日 ${o.visitDate}` : '',
    code: o.verifyCode,
  }
}

/** 从 tRPC 错误中取服务端错误码与 HTTP 状态（网络层失败时二者皆无） */
function errInfo(e: unknown): { code?: string; httpStatus?: number } {
  const data = (e as { data?: { code?: string; httpStatus?: number } } | null)?.data
  return { code: data?.code, httpStatus: data?.httpStatus }
}

/** 环比上周百分比：基线为 0 时无意义，显示「—」 */
function weekOverWeek(cur: number, prev: number): string {
  if (prev === 0) return '—'
  const v = ((cur - prev) / prev) * 100
  return `${v > 0 ? '+' : ''}${v.toFixed(0)}%`
}

/**
 * 塘主端 /owner：无 TabBar 的二级工作台页。
 * 今日看板 + 扫码核销（全屏模拟）+ 发布鱼讯 + 近 7 日经营条形图。
 * 数据源：trpc.app.orders.ownerStats；核销走 orders.verify；接口异常回退 mock。
 */
export default function Owner() {
  const navigate = useNavigate()
  const [pondOpen, setPondOpen] = useState(true)
  const [localVerified, setLocalVerified] = useState(31) // mock 兜底计数
  const [orders, setOrders] = useState<PendingOrder[]>(PENDING_ORDERS)
  const [scanning, setScanning] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [verifyOrder, setVerifyOrder] = useState<PendingOrder | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  const { requireAuth, loginSheet } = useAuthGate()

  // 塘主审核员认证态：auth.me → role==='admin' 全局管理员；#6 起绑定钓场的普通塘主同权
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const me = meQuery.data ?? null
  const isVerifier = !!me && me.role === 'admin'

  // #6 多钓场绑定：我的钓场列表（admin=全部钓场，绑定塘主=pond_admins 绑定集合）
  const myPondsQuery = trpc.app.orders.myPonds.useQuery(undefined, { retry: false, enabled: !!me })
  const myPondList = myPondsQuery.data ?? []
  const pondsLoaded = !!myPondsQuery.data
  const isBoundOwner = !!me && me.role !== 'admin' && myPondList.length > 0
  const canOperate = isVerifier || isBoundOwner

  // 钓场切换：null = 全部；单钓场无需切换，直接锁定该钓场
  const [activePondId, setActivePondId] = useState<number | null>(null)
  const pondIdParam = myPondList.length === 1 ? myPondList[0].id : (activePondId ?? undefined)

  // #6 自助认领：零绑定且非 admin 时展示「绑定钓场」引导（钓场目录走公开列表接口）
  const [claimSlug, setClaimSlug] = useState('')
  const [claimCode, setClaimCode] = useState('')
  const needClaim = !!me && pondsLoaded && myPondList.length === 0
  const pondsCatalogQuery = trpc.app.ponds.list.useQuery({}, { enabled: needClaim })
  const claimMut = trpc.app.orders.claimPond.useMutation()

  const statsQuery = trpc.app.orders.ownerStats.useQuery({ pondId: pondIdParam }, { retry: 1 })
  const verifyMut = trpc.app.orders.verify.useMutation()
  const utils = trpc.useUtils()
  const stats = statsQuery.data
  const live = !!stats && !statsQuery.error
  // ownerStats 需要塘主权限：403/FORBIDDEN 时展示认证引导 + 统计空态
  const statsForbidden = !!statsQuery.error && errInfo(statsQuery.error).code === 'FORBIDDEN'

  // #7 经营周报：owner_stats_daily 近 7 个完整日 + 环比（接口异常时回退 mock 条形图）
  const weeklyQuery = trpc.app.orders.ownerWeekly.useQuery({ pondId: pondIdParam }, { retry: 1, enabled: canOperate })
  const weekly = weeklyQuery.data
  const weeklyLive = !!weekly && !weeklyQuery.error

  const verifiedCount = live ? stats.usedCount : localVerified
  const pendingOrders = useMemo<PendingOrder[]>(
    () => (live ? stats.pendingList.map(toPendingOrder) : orders),
    [live, stats, orders],
  )

  const showToast = useCallback((text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2200)
  }, [])

  /** 自助认领提交：成功 toast 并刷新钓场列表与看板数据；失败展示服务端 message（如「认领码错误」） */
  const submitClaim = useCallback(() => {
    if (!claimSlug) {
      showToast('请选择要绑定的钓场')
      return
    }
    const code = claimCode.trim()
    if (!code) {
      showToast('请输入认领码')
      return
    }
    claimMut
      .mutateAsync({ slug: claimSlug, code })
      .then((r) => {
        showToast(`已绑定钓场：${r.pondName}`)
        setClaimCode('')
        utils.app.orders.myPonds.invalidate()
        utils.app.orders.ownerStats.invalidate()
        utils.app.orders.ownerWeekly.invalidate()
      })
      .catch((e) => showToast(e instanceof Error ? e.message : '绑定失败，请稍后再试'))
  }, [claimSlug, claimCode, claimMut, utils, showToast])

  /** 统一核销入口：真实 orders.verify。按错误分级——401 弹登录、403/限流/5xx 如实提示，
   *  仅网络不可达（fetch 层失败、无 HTTP 响应）才演示兜底，且文案明示「演示」 */
  const verifyByCode = useCallback(
    (code: string, fallback: () => void): Promise<boolean> =>
      verifyMut
        .mutateAsync({ code })
        .then((r) => {
          if (r.ok && r.order) {
            setVerifyOrder(toPendingOrder(r.order))
            utils.app.orders.ownerStats.invalidate()
            utils.app.orders.mine.invalidate()
            return true
          }
          showToast(r.ok === false ? r.reason : '核销失败')
          return false
        })
        .catch((e) => {
          const { code: errCode, httpStatus } = errInfo(e)
          if (errCode === 'UNAUTHORIZED') {
            requireAuth('核销门票')
            return false
          }
          if (errCode === 'FORBIDDEN') {
            // #6 作用域核销：服务端可能返回「该订单不属于你管理的钓场」等具体文案，优先展示
            const msg = e instanceof Error ? e.message : ''
            showToast(msg || '仅认证塘主可核销')
            return false
          }
          if (errCode === 'TOO_MANY_REQUESTS') {
            showToast('操作太频繁请稍候')
            return false
          }
          // 网络不可达（fetch 层 TypeError，无服务端响应）：演示兜底
          if (!errCode && !httpStatus) {
            showToast('网络不可达，本次为演示核销')
            fallback()
            return true
          }
          // 5xx 等服务端错误：如实提示，不置成功态
          const msg = e instanceof Error ? e.message : ''
          showToast(msg ? `核销失败：${msg}` : '核销失败，请稍后再试')
          return false
        }),
    [verifyMut, utils, showToast, requireAuth],
  )

  // 核销完成：关闭结果弹层；mock 模式计数 +1 并滑出移除，真实模式由 refetch 更新
  const handleVerifyDone = useCallback(
    (order: PendingOrder) => {
      setVerifyOrder(null)
      if (!live) {
        setLocalVerified((c) => c + 1)
        setOrders((prev) => prev.filter((o) => o.id !== order.id))
      } else {
        utils.app.orders.ownerStats.invalidate()
      }
    },
    [live, utils],
  )

  return (
    <div style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 8px)' }}>
      {/* Section 1 — Header（二级页：返回 /me + 标题） */}
      <motion.header
        className="sticky top-0 z-20 flex h-12 items-center justify-between bg-paper px-2"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <button
          type="button"
          aria-label="返回我的"
          onClick={() => navigate('/me')}
          className="flex h-10 w-10 items-center justify-center text-ink"
        >
          <ChevronLeft size={24} strokeWidth={1.8} />
        </button>
        <h1 className="text-[18px] font-semibold leading-6 text-ink">塘主工作台</h1>
        <span className="h-10 w-10" aria-hidden="true" />
      </motion.header>

      {/* Section 1.5 — 钓场选择（#6）：多钓场横滑切换（含「全部」），单钓场直接展示名称 */}
      {myPondList.length === 1 && (
        <section className="mx-4 mb-3 flex items-center gap-2 rounded-2xl bg-paper-white px-4 py-3">
          <span className="text-[12px] leading-4 text-ink-60">钓场</span>
          <span className="text-[14px] font-semibold leading-5 text-ink">{myPondList[0].name}</span>
        </section>
      )}
      {myPondList.length > 1 && (
        <section className="mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          <button
            type="button"
            onClick={() => setActivePondId(null)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-[12px] font-semibold leading-none ${
              activePondId === null ? 'bg-olive text-paper-white' : 'bg-paper-white text-ink-60'
            }`}
          >
            全部
          </button>
          {myPondList.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActivePondId(p.id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-[12px] font-semibold leading-none ${
                activePondId === p.id ? 'bg-olive text-paper-white' : 'bg-paper-white text-ink-60'
              }`}
            >
              {p.name}
            </button>
          ))}
        </section>
      )}

      {/* Section 2 — 钓场卡（全站唯一深色卡） */}
      <PondStatusCard
        open={pondOpen}
        onToggle={(next) => {
          setPondOpen(next)
          if (!next) showToast('已暂停售票')
          else showToast('已恢复售票')
        }}
      />

      {/* Section 3 — 今日数据 4 宫格（ownerStats 403 时给空态，配合下方认证引导横幅） */}
      {statsForbidden ? (
        <section className="mx-4 mb-4 rounded-2xl bg-paper-white px-4 py-8 text-center">
          <p className="text-[14px] font-semibold leading-5 text-ink">今日售票与收入</p>
          <p className="mt-1 text-[12px] leading-[18px] text-ink-60">完成塘主认证后可查看今日经营数据</p>
        </section>
      ) : (
        <StatsGrid
          verifiedOverride={verifiedCount}
          overrides={live ? { tickets: stats.totalOrders, income: stats.totalAmount } : undefined}
        />
      )}

      {/* Section 4 — 扫码核销大卡 */}
      <ScanVerifyCard
        verifiedCount={verifiedCount}
        onScan={() => {
          if (!canOperate) { showToast(me ? '核销仅限已绑定钓场的塘主，请先完成认证' : '请先登录审核员账号'); return }
          setScanning(true)
        }}
        onManual={() => {
          if (!canOperate) { showToast(me ? '核销仅限已绑定钓场的塘主，请先完成认证' : '请先登录审核员账号'); return }
          setManualOpen(true)
        }}
      />

      {/* Section 5 — 待核销订单列表 */}
      <PendingOrders
        orders={pendingOrders}
        total={pendingOrders.length + (live ? 0 : 12)}
        onVerify={(order) => {
          if (live) {
            verifyByCode(order.code, () => setVerifyOrder(order))
          } else {
            setVerifyOrder(order)
          }
        }}
      />

      {/* 塘主认证引导：未登录/未绑定/ownerStats 403 时显示；已登录零绑定 → 认领码自助绑定表单（#6） */}
      {(!canOperate || statsForbidden) && !meQuery.isLoading && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-4 rounded-2xl border border-dashed border-olive bg-olive-tint p-4"
        >
          {needClaim ? (
            <>
              <p className="text-[14px] font-semibold text-ink">绑定你的钓场</p>
              <p className="mt-1 text-[12px] leading-[18px] text-ink-60">
                输入钓场认领码即可自助绑定。绑定后即可扫码核销本钓场门票、查看经营数据。
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <select
                  value={claimSlug}
                  onChange={(e) => setClaimSlug(e.target.value)}
                  className="h-10 rounded-xl border border-olive/30 bg-paper-white px-3 text-[13px] text-ink"
                >
                  <option value="">选择钓场</option>
                  {(pondsCatalogQuery.data ?? []).map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    value={claimCode}
                    onChange={(e) => setClaimCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitClaim()
                    }}
                    placeholder="输入认领码"
                    maxLength={32}
                    className="h-10 flex-1 rounded-xl border border-olive/30 bg-paper-white px-3 text-[13px] text-ink"
                  />
                  <button
                    type="button"
                    onClick={submitClaim}
                    disabled={claimMut.isPending}
                    className="h-10 shrink-0 rounded-full bg-olive px-5 text-[12px] font-semibold text-paper-white disabled:opacity-60"
                  >
                    {claimMut.isPending ? '绑定中…' : '绑定'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-[14px] font-semibold text-ink">
                {me ? '塘主审核员认证' : '登录后完成塘主认证'}
              </p>
              <p className="mt-1 text-[12px] leading-[18px] text-ink-60">
                {me
                  ? '当前账号暂未开通核销权限。提交钓场资质审核通过后，即可扫码核销门票、发布鱼讯。'
                  : '扫码核销门票、发布鱼讯仅限钓场审核员账号。请先登录，再提交钓场资质完成认证。'}
              </p>
              <div className="mt-3 flex gap-2">
                {!me && (
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
                    className="rounded-full bg-olive px-4 py-1.5 text-[12px] font-semibold text-paper-white"
                  >
                    去登录
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => showToast('认证审核中，请使用绑定钓场的账号登录后自动开通')}
                  className="rounded-full border border-olive px-4 py-1.5 text-[12px] font-semibold text-olive"
                >
                  申请塘主认证
                </button>
              </div>
            </>
          )}
        </motion.section>
      )}

      {/* Section 6 — 发布鱼讯快捷区（全局管理员/已绑定塘主可用） */}
      {canOperate ? (
        <NewsComposer onPublished={(r) => showToast(r.ok ? '鱼讯已推送' : (r.message ?? '发布失败'))} />
      ) : null}

      {/* Section 7 — 经营周报（#7：owner_stats_daily 近 7 个完整日 + 环比）；接口未就绪时回退 mock 条形图 */}
      {weeklyLive ? (
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="mx-4 mb-10 rounded-2xl bg-paper-white p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-semibold leading-6 text-ink">经营周报</h2>
            <span className="text-[12px] leading-4 text-ink-60">近 7 天</span>
          </div>

          {/* 合计 + 环比上周（上周基线为 0 显示「—」） */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label: 'GMV', value: `¥${weekly.totals.gmv.toLocaleString('zh-CN')}`, cur: weekly.totals.gmv, prev: weekly.prevWeekTotals.gmv },
              { label: '订单', value: String(weekly.totals.orders), cur: weekly.totals.orders, prev: weekly.prevWeekTotals.orders },
              { label: '核销', value: String(weekly.totals.usedCnt), cur: weekly.totals.usedCnt, prev: weekly.prevWeekTotals.usedCnt },
            ].map((m) => (
              <div key={m.label} className="rounded-xl bg-paper p-3">
                <p className="text-[12px] leading-4 text-ink-60">{m.label}</p>
                <p className="mt-1 font-num text-[18px] font-semibold leading-6 text-ink">{m.value}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-60">
                  环比 <span className="font-num">{weekOverWeek(m.cur, m.prev)}</span>
                </p>
              </div>
            ))}
          </div>

          {/* 每日 GMV 迷你柱状图（纯 CSS，最高条 olive-deep 强调） */}
          {(() => {
            const maxGmv = Math.max(...weekly.days.map((d) => d.gmv), 1)
            return (
              <div className="mt-5">
                <div className="flex items-end justify-between px-1">
                  {weekly.days.map((d) => (
                    <div key={d.day} className="flex h-[72px] flex-col items-center justify-end">
                      <span className="mb-1 font-num text-[10px] leading-3 text-ink-60">
                        {d.gmv > 0 ? (d.gmv >= 1000 ? `${(d.gmv / 1000).toFixed(1)}k` : d.gmv) : ''}
                      </span>
                      <div
                        className={`w-5 rounded-t-md ${d.gmv > 0 && d.gmv === maxGmv ? 'bg-olive-deep' : 'bg-olive'}`}
                        style={{ height: Math.max(3, Math.round((d.gmv / maxGmv) * 52)) }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between px-1">
                  {weekly.days.map((d) => (
                    <span key={d.day} className="w-5 text-center font-num text-[10px] leading-4 text-ink-60">
                      {d.day.slice(5)}
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}
        </motion.section>
      ) : (
        <WeekChart />
      )}

      {/* 全屏扫码取景（相机受环境限制时引导手动输码） */}
      <ScanOverlay
        open={scanning}
        onClose={() => setScanning(false)}
        onSwitchToManual={() => {
          setScanning(false)
          setManualOpen(true)
        }}
      />

      {/* 手动输码弹层 */}
      <ManualCodeSheet
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        verify={(code) => verifyByCode(code, () => setVerifyOrder(SCAN_DEMO_ORDER))}
        onSuccess={() => setManualOpen(false)}
      />

      {/* 核销结果弹层 */}
      <VerifyResultSheet order={verifyOrder} onDone={handleVerifyDone} />

      {/* 登录引导（401 核销时弹出） */}
      {loginSheet}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-24 z-[70] mx-auto w-fit max-w-[320px] rounded-full bg-ink px-4 py-2 text-center text-[13px] leading-[18px] text-paper"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
