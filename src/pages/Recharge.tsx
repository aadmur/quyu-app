import { useState } from 'react'
import { m } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Loader2, Wallet } from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/hooks/useAuthGate'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'

const PRESETS = [1000, 3000, 5000, 10000] // 分

/**
 * 充值中心 /fish-spot/recharge：预付费余额充值（分支⑤）。
 * PAY_MOCK=true 立即到账；真实拉起待商户号（pending 时提示未就绪）。
 */
export default function Recharge() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast(2200)
  const { user, requireAuth, loginSheet } = useAuthGate()
  const [amount, setAmount] = useState(3000)

  const utils = trpc.useUtils()
  const balanceQ = trpc.app.fishSpot.balance.useQuery(undefined, { enabled: !!user, retry: false })
  const bal = balanceQ.data

  const rechargeMut = trpc.app.fishSpot.recharge.useMutation({
    onSuccess: (data) => {
      if (data.status === 'paid') {
        showToast(`充值成功，余额 ¥${(data.balanceCents / 100).toFixed(2)}`)
        utils.app.fishSpot.balance.invalidate()
        window.setTimeout(() => navigate(-1), 800)
      } else {
        showToast('在线支付尚未开通，请联系运营人工充值')
      }
    },
    onError: (e) => showToast(e.message || '充值失败，请稍后再试'),
  })

  const submit = () => {
    if (!requireAuth('充值')) return
    if (rechargeMut.isPending) return
    rechargeMut.mutate({ amountCents: amount })
  }

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-paper-white px-2">
        <button
          type="button"
          aria-label="返回"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink"
        >
          <ChevronLeft size={22} strokeWidth={2} />
        </button>
        <h1 className="text-[17px] font-semibold leading-6 text-ink">充值中心</h1>
        <span className="w-9" />
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* 当前余额 */}
        <section className="mx-4 mt-4 flex items-center gap-3 rounded-2xl bg-lake-tint px-5 py-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-paper-white text-lake">
            <Wallet size={22} strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-[12px] leading-4 text-ink-60">当前余额</p>
            <p className="font-num text-[28px] leading-8 text-ink">
              ¥{bal ? (bal.balanceCents / 100).toFixed(2) : '--'}
            </p>
          </div>
        </section>

        {/* 金额选择 */}
        <section className="mx-4 mt-5">
          <p className="text-[13px] font-medium leading-5 text-ink-60">选择充值金额</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {PRESETS.map((cents) => {
              const active = amount === cents
              return (
                <m.button
                  key={cents}
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setAmount(cents)}
                  className={`flex h-16 flex-col items-center justify-center rounded-xl border text-[15px] font-semibold ${
                    active ? 'border-lake bg-lake-tint text-lake' : 'border-line bg-paper-white text-ink'
                  }`}
                >
                  ¥{cents / 100}
                  <span className="mt-0.5 text-[11px] font-normal leading-3 text-ink-40">
                    约可识别 {Math.floor(cents / Math.max(1, bal?.priceCents ?? 50))} 次
                  </span>
                </m.button>
              )
            })}
          </div>
        </section>

        {/* 充值按钮 */}
        <section className="mx-4 mb-10 mt-6">
          <m.button
            type="button"
            whileTap={{ scale: 0.97 }}
            disabled={rechargeMut.isPending}
            onClick={submit}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-lake text-[15px] font-semibold text-paper-white disabled:opacity-60"
          >
            {rechargeMut.isPending && <Loader2 size={18} className="animate-spin" />}
            {rechargeMut.isPending ? '充值中…' : `立即充值 ¥${amount / 100}`}
          </m.button>
          <p className="mt-3 text-center text-[12px] leading-4 text-ink-40">
            充值用于「哪钓」AI 钓点识别按次扣费，识别失败自动退还
          </p>
        </section>
      </div>

      <Toast message={toast} />
      {loginSheet}
    </div>
  )
}
