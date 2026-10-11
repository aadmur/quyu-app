import { useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Camera, ChevronLeft, Loader2, RefreshCw, ScanText, Wallet } from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/hooks/useAuthGate'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'
import { capturePhoto } from '@/lib/native'
import { FISH_SPECIES } from '@/data/community'
import type { FishIdResult } from '../../api/kimi/fishId'

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

function confidenceTone(c: number): { text: string; label: string } {
  if (c >= 0.8) return { text: 'text-lake', label: '高置信' }
  if (c >= 0.55) return { text: 'text-clay', label: '较确信' }
  return { text: 'text-heart', label: '存疑' }
}

export default function FishId() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast(2200)
  const { user, requireAuth, loginSheet } = useAuthGate()

  const [photo, setPhoto] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [result, setResult] = useState<FishIdResult | null>(null)
  const [resultMeta, setResultMeta] = useState<{
    billing: 'free' | 'paid'
    costCents: number
    sampleSaved: boolean
  } | null>(null)
  const [insufficient, setInsufficient] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [corrected, setCorrected] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const balanceQ = trpc.app.fishId.balance.useQuery(undefined, { enabled: !!user, retry: false })
  const bal = balanceQ.data
  const freeRemaining = Math.max(0, (bal?.fishIdFreeLimit ?? 0) - (bal?.fishIdFreeUsed ?? 0))
  const consentGranted = Boolean(bal?.sampleConsent?.granted)

  const identifyMut = trpc.app.fishId.identify.useMutation({
    onSuccess: (data) => {
      setResult(data.result)
      setResultMeta({
        billing: data.billing,
        costCents: data.costCents,
        sampleSaved: data.sampleSaved,
      })
      setInsufficient(false)
      utils.app.fishId.balance.invalidate()
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

  const consentMut = trpc.app.fishId.sampleConsent.useMutation({
    onSuccess: () => {
      utils.app.fishId.balance.invalidate()
      showToast(consentGranted ? '已撤回授权，样本已删除' : '已授权沉淀识别样本')
    },
    onError: (e) => showToast(e.message || '操作失败'),
  })

  const correctMut = trpc.app.fishId.correct.useMutation({
    onSuccess: (_d, v) => {
      setCorrected(v.correctedFish)
      setCorrecting(false)
      showToast('已记录纠正，感谢反馈')
    },
    onError: (e) => showToast(e.message || '提交失败'),
  })

  const capture = async () => {
    if (!requireAuth('拍照识鱼')) return
    if (capturing) return
    setCapturing(true)
    try {
      const url = await capturePhoto()
      if (url) {
        setPhoto(url)
        setResult(null)
        setResultMeta(null)
        setInsufficient(false)
      }
    } finally {
      setCapturing(false)
    }
  }

  const runIdentify = () => {
    if (!photo || identifyMut.isPending) return
    if (!requireAuth('识鱼')) return
    setCorrected(null)
    setCorrecting(false)
    identifyMut.mutate({ imageData: photo })
  }

  const identifying = identifyMut.isPending

  return (
    <div className="relative flex h-full flex-col bg-paper">
      <style>{LOADING_CSS}</style>

      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-paper-white px-2">
        <button
          type="button"
          aria-label="返回"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink"
        >
          <ChevronLeft size={22} strokeWidth={2} />
        </button>
        <h1 className="text-[17px] font-semibold leading-6 text-ink">识鱼 · 拍鱼识种</h1>
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
        {/* 计费说明 */}
        <div className="mx-4 mt-3 rounded-xl bg-lake-tint px-4 py-2.5 text-[12px] leading-4 text-lake">
          {bal
            ? freeRemaining > 0
              ? `新用户福利：还可免费识鱼 ${freeRemaining} 次，之后 ¥${(bal.fishIdPriceCents / 100).toFixed(2)}/次`
              : `识鱼 ¥${(bal.fishIdPriceCents / 100).toFixed(2)}/次，当前余额 ¥${(bal.balanceCents / 100).toFixed(2)}`
            : '登录后可查看免费次数与余额'}
        </div>

        {/* 拍照区 */}
        <section className="mx-4 mt-3">
          {photo ? (
            <div className="relative overflow-hidden rounded-xl">
              <img src={photo} alt="鱼的照片" className="h-[240px] w-full object-cover" />
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
                {capturing ? '打开相机中…' : '拍一张鱼的照片'}
              </span>
              <span className="text-[12px] leading-4 text-ink-40">AI 帮你识别鱼种，支持 16 种淡水鱼</span>
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
              <ScanText size={18} strokeWidth={2} />
            )}
            {identifying ? '识别中…' : '开始识鱼'}
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

        {/* 结果卡 */}
        <AnimatePresence>
          {result && (
            <m.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              className="mx-4 mb-10 mt-4 overflow-hidden rounded-2xl bg-paper-white shadow-[0_8px_24px_rgba(45,30,30,0.08)]"
            >
              {/* 头部 */}
              <div className="bg-lake-tint px-5 py-4">
                {result.topCandidates.length > 0 ? (
                  <div className="flex items-center gap-3">
                    <span className="text-[28px] leading-none">{result.topCandidates[0].name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${confidenceTone(result.topCandidates[0].confidence).text} bg-paper-white`}>
                      {Math.round(result.topCandidates[0].confidence * 100)}% {confidenceTone(result.topCandidates[0].confidence).label}
                    </span>
                  </div>
                ) : (
                  <p className="text-[15px] leading-5 text-ink">{result.fallbackNote || '未能识别鱼种'}</p>
                )}
              </div>

              <div className="space-y-3 px-5 py-4">
                {/* Top-3 候选 */}
                {result.topCandidates.map((c, i) => (
                  <div key={c.name} className={i === 0 ? 'rounded-xl bg-lake-tint/50 px-3 py-2.5' : 'px-3 py-2'}>
                    <div className="flex items-center justify-between">
                      <span className={`text-[15px] font-medium leading-5 ${i === 0 ? 'text-lake' : 'text-ink'}`}>
                        {i + 1}. {c.name}
                      </span>
                      <span className="text-[13px] leading-4 text-ink-40">{Math.round(c.confidence * 100)}%</span>
                    </div>
                    {c.keyFeature && (
                      <p className="mt-1 text-[13px] leading-5 text-ink-60">{c.keyFeature}</p>
                    )}
                  </div>
                ))}

                {/* 兜底说明 */}
                {result.fallbackNote && result.topCandidates.length > 0 && (
                  <div className="rounded-xl bg-olive-tint px-3 py-2">
                    <p className="text-[13px] leading-5 text-ink-60">{result.fallbackNote}</p>
                  </div>
                )}
                {!result.isSupported && result.topCandidates.length === 0 && (
                  <div className="rounded-xl bg-olive-tint px-3 py-2">
                    <p className="text-[13px] leading-5 text-ink-60">
                      暂不支持识别此类鱼（仅支持 16 种淡水常见垂钓鱼种）。请补拍侧面全身照后重试。
                    </p>
                  </div>
                )}

                {/* 计费信息 */}
                {resultMeta && (
                  <div className="flex flex-wrap items-center justify-between gap-1 border-t border-line pt-3 text-[12px] leading-4 text-ink-40">
                    <span>支持鱼种 16 种 + 兜底</span>
                    <span>
                      {resultMeta.billing === 'free' ? '本次免费' : `扣费 ¥${(resultMeta.costCents / 100).toFixed(2)}`}
                      {resultMeta.sampleSaved ? ' · 样本已沉淀' : ''}
                    </span>
                  </div>
                )}

                {/* 纠正反馈（QY-FISH-006："识错了"高价值标注） */}
                {result.topCandidates.length > 0 && (
                  <div className="border-t border-line pt-3">
                    {corrected ? (
                      <p className="text-[12px] leading-4 text-lake">已纠正为 {corrected}</p>
                    ) : correcting ? (
                      <div>
                        <p className="mb-2 text-[12px] leading-4 text-ink-40">选择正确的鱼种</p>
                        <div className="flex flex-wrap gap-2">
                          {FISH_SPECIES.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => correctMut.mutate({ correctedFish: f })}
                              disabled={correctMut.isPending}
                              className="rounded-full bg-lake-tint px-3 py-1 text-[12px] leading-4 text-lake"
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCorrecting(true)}
                        className="text-[12px] leading-4 text-ink-40 underline"
                      >
                        识错了？纠正鱼种
                      </button>
                    )}
                  </div>
                )}
              </div>
            </m.section>
          )}
        </AnimatePresence>

        {/* 样本授权（QY-FISH-006 合规：默认不存图，显式授权才入样本库） */}
        {user && (
          <section className="mx-4 mb-6 rounded-xl bg-paper-white px-4 py-3">
            <button
              type="button"
              role="switch"
              aria-checked={consentGranted}
              disabled={consentMut.isPending}
              onClick={() => consentMut.mutate({ granted: !consentGranted })}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="flex-1">
                <span className="block text-[13px] font-medium leading-4 text-ink">允许沉淀我的识鱼样本</span>
                <span className="mt-1 block text-[11px] leading-4 text-ink-40">
                  用于改进鱼类识别模型。默认关闭；开启后图片与结果会入样本库，随时可撤回并删除。计费记录不受影响。
                </span>
              </span>
              <span className={`h-6 w-10 shrink-0 rounded-full p-0.5 ${consentGranted ? 'bg-lake' : 'bg-[#2d1e1e14]'}`}>
                <span className={`block h-5 w-5 rounded-full bg-paper-white transition-transform ${consentGranted ? 'translate-x-4' : ''}`} />
              </span>
            </button>
          </section>
        )}
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
            <p className="text-[14px] font-medium leading-5 text-ink-60">AI 正在识别这条鱼…</p>
          </m.div>
        )}
      </AnimatePresence>

      <Toast message={toast} />
      {loginSheet}
    </div>
  )
}
