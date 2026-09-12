import { useMemo, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Camera, ChevronLeft, Loader2, MapPin, RefreshCw, Sparkles, Wallet } from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/hooks/useAuthGate'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'
import { capturePhoto } from '@/lib/native'
import type { FishSpotResult } from '../../api/kimi/k3'

/** 品牌 loading（分支③：非流式 + 水波荡漾动画，替代普通转圈） */
const LOADING_CSS = `
.qy-ripple { position: relative; width: 96px; height: 96px; }
.qy-ripple span {
  position: absolute; inset: 0; border-radius: 50%;
  border: 2px solid rgba(63, 167, 224, 0.55);
  animation: qy-ripple-wave 1.8s ease-out infinite;
}
.qy-ripple span:nth-child(2) { animation-delay: 0.6s; }
.qy-ripple span:nth-child(3) { animation-delay: 1.2s; }
.qy-ripple .qy-ripple-core {
  position: absolute; inset: 30px; border: none; border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #8fd8ff, #1e6fa8 70%, #0d3b5c);
  animation: qy-ripple-pulse 1.4s ease-in-out infinite;
}
@keyframes qy-ripple-wave {
  0% { transform: scale(0.45); opacity: 0.9; }
  100% { transform: scale(1.25); opacity: 0; }
}
@keyframes qy-ripple-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
`

function scoreTone(score: number): { text: string; bar: string; label: string } {
  if (score >= 75) return { text: 'text-lake', bar: 'bg-lake', label: '好钓点' }
  if (score >= 50) return { text: 'text-clay', bar: 'bg-clay', label: '可一试' }
  return { text: 'text-heart', bar: 'bg-heart', label: '不太理想' }
}

/**
 * 哪钓页 /fish-spot：拍照 → 压缩 → K3 识别 → 结构化卡片。
 * 计费：前 N 次免费，之后按次扣余额；余额不足引导充值。
 */
export default function FishSpot() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast(2200)
  const { user, requireAuth, loginSheet } = useAuthGate()

  const [photo, setPhoto] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [result, setResult] = useState<FishSpotResult | null>(null)
  const [lastBilling, setLastBilling] = useState<{ billing: 'free' | 'paid'; costCents: number } | null>(null)
  const [insufficient, setInsufficient] = useState(false)

  const utils = trpc.useUtils()
  const balanceQ = trpc.app.fishSpot.balance.useQuery(undefined, { enabled: !!user, retry: false })
  const bal = balanceQ.data
  const freeRemaining = useMemo(
    () => Math.max(0, (bal?.freeLimit ?? 0) - (bal?.freeUsed ?? 0)),
    [bal],
  )

  const identifyMut = trpc.app.fishSpot.identify.useMutation({
    onSuccess: (data) => {
      setResult(data.result)
      setLastBilling({ billing: data.billing, costCents: data.costCents })
      setInsufficient(false)
      utils.app.fishSpot.balance.invalidate()
    },
    onError: (e) => {
      const msg = e.message || '识别失败，请稍后再试'
      if (msg.includes('余额不足')) {
        setInsufficient(true)
        showToast('余额不足，请先充值')
      } else {
        showToast(msg)
      }
    },
  })

  const capture = async () => {
    if (!requireAuth('拍照识别钓点')) return
    if (capturing) return
    setCapturing(true)
    try {
      const url = await capturePhoto()
      if (url) {
        setPhoto(url)
        setResult(null)
        setInsufficient(false)
      }
    } finally {
      setCapturing(false)
    }
  }

  const runIdentify = () => {
    if (!photo || identifyMut.isPending) return
    if (!requireAuth('识别钓点')) return
    identifyMut.mutate({ imageData: photo })
  }

  const tone = result ? scoreTone(result.score) : null
  const identifying = identifyMut.isPending

  return (
    <div className="relative flex h-full flex-col bg-paper">
      <style>{LOADING_CSS}</style>

      {/* 头部：返回 · 标题 · 余额 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-paper-white px-2">
        <button
          type="button"
          aria-label="返回"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink"
        >
          <ChevronLeft size={22} strokeWidth={2} />
        </button>
        <h1 className="text-[17px] font-semibold leading-6 text-ink">哪钓 · 拍照识钓点</h1>
        <button
          type="button"
          onClick={() => navigate('/fish-spot/recharge')}
          className="flex h-8 items-center gap-1 rounded-full bg-lake-tint px-3 text-[13px] font-medium text-lake"
        >
          <Wallet size={15} strokeWidth={2} />
          {bal ? `¥${(bal.balanceCents / 100).toFixed(2)}` : '余额'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* 计费提示条 */}
        <div className="mx-4 mt-3 rounded-xl bg-lake-tint px-4 py-2.5 text-[12px] leading-4 text-lake">
          {bal
            ? freeRemaining > 0
              ? `新用户福利：还可免费识别 ${freeRemaining} 次，之后 ¥${(bal.priceCents / 100).toFixed(2)}/次`
              : `免费次数已用完，识别 ¥${(bal.priceCents / 100).toFixed(2)}/次，当前余额 ¥${(bal.balanceCents / 100).toFixed(2)}`
            : '登录后可查看免费次数与余额'}
        </div>

        {/* 拍照区 */}
        <section className="mx-4 mt-3">
          {photo ? (
            <div className="relative overflow-hidden rounded-xl">
              <img src={photo} alt="钓点照片" className="h-[240px] w-full object-cover" />
              <button
                type="button"
                onClick={capture}
                disabled={capturing || identifying}
                className="absolute right-2 top-2 flex h-8 items-center gap-1 rounded-full bg-ink/50 px-3 text-[12px] text-paper-white disabled:opacity-50"
              >
                <RefreshCw size={14} strokeWidth={2} />
                重拍
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={capture}
              disabled={capturing}
              className="group flex h-[240px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-paper-white transition-colors hover:border-lake disabled:opacity-60"
            >
              {capturing ? (
                <Loader2 size={30} strokeWidth={1.8} className="animate-spin text-ink-40" />
              ) : (
                <Camera size={30} strokeWidth={1.8} className="text-ink-40 transition-colors group-hover:text-lake" />
              )}
              <span className="text-[14px] leading-5 text-ink-60">
                {capturing ? '打开相机中…' : '拍一张眼前的湖泊 / 河流'}
              </span>
              <span className="text-[12px] leading-4 text-ink-40">AI 帮你判断这里是不是好钓点</span>
            </button>
          )}
        </section>

        {/* 识别按钮 */}
        <section className="mx-4 mt-4">
          <m.button
            type="button"
            whileTap={photo && !identifying ? { scale: 0.97 } : undefined}
            disabled={!photo || identifying}
            onClick={runIdentify}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold ${
              photo && !identifying ? 'bg-lake text-paper-white' : 'bg-[#2d1e1e14] text-ink-40'
            }`}
          >
            {identifying ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Sparkles size={18} strokeWidth={2} />
            )}
            {identifying ? '识别中…' : '开始识别'}
          </m.button>
          {insufficient && (
            <m.button
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => navigate('/fish-spot/recharge')}
              className="mt-2 flex h-10 w-full items-center justify-center rounded-full bg-olive text-[14px] font-semibold text-paper-white"
            >
              余额不足，去充值
            </m.button>
          )}
        </section>

        {/* 结果卡片 */}
        <AnimatePresence>
          {result && tone && (
            <m.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              className="mx-4 mb-10 mt-4 overflow-hidden rounded-2xl bg-paper-white shadow-[0_8px_24px_rgba(45,30,30,0.08)]"
            >
              {/* 评分头部 */}
              <div className="flex items-center gap-4 bg-lake-tint px-5 py-4">
                <div className="flex flex-col items-center">
                  <span className={`font-num text-[44px] leading-none ${tone.text}`}>{result.score}</span>
                  <span className="mt-1 text-[11px] leading-3 text-ink-40">综合评分</span>
                </div>
                <div className="flex-1">
                  <span className={`inline-block rounded-full px-3 py-1 text-[13px] font-semibold ${tone.text} bg-paper-white`}>
                    {tone.label}
                  </span>
                  <p className="mt-2 flex items-center gap-1 text-[14px] leading-5 text-ink">
                    <MapPin size={15} strokeWidth={1.8} className="text-lake" />
                    {result.waterType}
                  </p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-paper">
                    <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${result.score}%` }} />
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-5 py-4">
                {/* 适宜鱼种 */}
                {result.suitableFish.length > 0 && (
                  <div>
                    <p className="text-[12px] font-medium leading-4 text-ink-40">适宜目标鱼</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.suitableFish.map((f) => (
                        <span key={f} className="rounded-full bg-lake-tint px-3 py-1 text-[13px] leading-4 text-lake">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* 最佳时段 */}
                {result.bestTime && (
                  <div>
                    <p className="text-[12px] font-medium leading-4 text-ink-40">建议作钓时段</p>
                    <p className="mt-1 text-[14px] leading-5 text-ink">{result.bestTime}</p>
                  </div>
                )}
                {/* 钓法建议 */}
                {result.tips && (
                  <div>
                    <p className="text-[12px] font-medium leading-4 text-ink-40">钓法 / 装备建议</p>
                    <p className="mt-1 text-[14px] leading-5 text-ink">{result.tips}</p>
                  </div>
                )}
                {/* 注意事项 */}
                {result.warnings && (
                  <div className="rounded-xl bg-olive-tint px-3 py-2">
                    <p className="text-[12px] font-medium leading-4 text-ink-60">注意事项</p>
                    <p className="mt-0.5 text-[13px] leading-5 text-ink-60">{result.warnings}</p>
                  </div>
                )}
                {/* 置信度 + 本次计费 */}
                <div className="flex items-center justify-between border-t border-line pt-3 text-[12px] leading-4 text-ink-40">
                  <span>识别置信度 {Math.round(result.confidence * 100)}%</span>
                  {lastBilling && (
                    <span>
                      {lastBilling.billing === 'free' ? '本次免费' : `本次扣费 ¥${(lastBilling.costCents / 100).toFixed(2)}`}
                    </span>
                  )}
                </div>
              </div>
            </m.section>
          )}
        </AnimatePresence>
      </div>

      {/* 品牌 loading 覆盖层 */}
      <AnimatePresence>
        {identifying && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-paper/80 backdrop-blur-sm"
          >
            <div className="qy-ripple">
              <span />
              <span />
              <span />
              <div className="qy-ripple-core" />
            </div>
            <p className="text-[14px] font-medium leading-5 text-ink-60">AI 正在观察这片水域…</p>
          </m.div>
        )}
      </AnimatePresence>

      <Toast message={toast} />
      {loginSheet}
    </div>
  )
}
