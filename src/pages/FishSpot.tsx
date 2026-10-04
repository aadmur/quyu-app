import { lazy, Suspense, useMemo, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Camera, ChevronDown, ChevronLeft, ChevronUp, Loader2, MapPin, RefreshCw, Sparkles, Wallet } from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/hooks/useAuthGate'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'
import { capturePhoto, getCurrentPosition, type GeoFix } from '@/lib/native'
import {
  EMPTY_FIELDS,
  currentSeason,
  currentTimeOfDay,
  fieldsToInput,
  fieldsTouched,
  isExpertResult,
  type SpotFieldValues,
} from '@/lib/spotFields'
import type { FishSpotExpertResult, FishSpotResult } from '../../api/kimi/k3'

/** 表单与专业报告按需加载：不进首屏闭包（v13 验收：首屏体积不得回退） */
const SpotFieldForm = lazy(() => import('@/components/spots/SpotFieldForm'))
const SpotExpertReport = lazy(() => import('@/components/spots/SpotExpertReport'))

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
 * 哪钓页 /fish-spot：拍照 → 现场参数（选填）→ 识别 → 基础结论 + 可折叠专业报告。
 * 计费：基础档前 N 次免费、之后按次扣余额；专家档独立价与独立免费体验（QY-SPOT-007）。
 */
export default function FishSpot() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast(2200)
  const { user, requireAuth, loginSheet } = useAuthGate()

  const [photo, setPhoto] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [geo, setGeo] = useState<GeoFix | null>(null)
  const [result, setResult] = useState<FishSpotResult | FishSpotExpertResult | null>(null)
  const [resultMeta, setResultMeta] = useState<{
    billing: 'free' | 'paid'
    costCents: number
    tier: 'basic' | 'expert'
    ruleHit: boolean
    sampleSaved: boolean
  } | null>(null)
  const [insufficient, setInsufficient] = useState(false)
  const [tier, setTier] = useState<'basic' | 'expert'>('basic')
  const [formOpen, setFormOpen] = useState(false)
  const [fields, setFields] = useState<SpotFieldValues>(EMPTY_FIELDS)
  const [reportOpen, setReportOpen] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const balanceQ = trpc.app.fishSpot.balance.useQuery(undefined, { enabled: !!user, retry: false })
  const bal = balanceQ.data
  const freeRemaining = useMemo(
    () => Math.max(0, (bal?.freeLimit ?? 0) - (bal?.freeUsed ?? 0)),
    [bal],
  )
  const expertFreeRemaining = Math.max(0, (bal?.expertFreeLimit ?? 0) - (bal?.expertFreeUsed ?? 0))
  const consentGranted = Boolean(bal?.sampleConsent?.granted)

  const identifyMut = trpc.app.fishSpot.identify.useMutation({
    onSuccess: (data) => {
      setResult(data.result)
      setResultMeta({
        billing: data.billing,
        costCents: data.costCents,
        tier: data.tier,
        ruleHit: data.ruleHit,
        sampleSaved: data.sampleSaved,
      })
      setReportOpen(data.tier === 'expert')
      setFeedback(null)
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

  const consentMut = trpc.app.fishSpot.sampleConsent.useMutation({
    onSuccess: () => {
      utils.app.fishSpot.balance.invalidate()
      showToast(consentGranted ? '已撤回授权，样本已删除' : '已授权沉淀识别样本')
    },
    onError: (e) => showToast(e.message || '操作失败'),
  })

  const feedbackMut = trpc.app.fishSpot.feedback.useMutation({
    onSuccess: (_d, v) => {
      setFeedback(v.rating)
      showToast('感谢反馈')
    },
    onError: (e) => showToast(e.message || '提交失败'),
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
        setResultMeta(null)
        setInsufficient(false)
        // QY-SPOT-002：拍照后自动补传坐标（getCurrentPosition 内部有硬超时，永不卡死）
        const loc = await getCurrentPosition()
        setGeo(loc.fix)
        if (!loc.fix) showToast('未获取到定位，不影响识别')
      }
    } finally {
      setCapturing(false)
    }
  }

  const runIdentify = () => {
    if (!photo || identifyMut.isPending) return
    if (!requireAuth('识别钓点')) return
    identifyMut.mutate({
      imageData: photo,
      tier,
      ...(geo ? { latitude: geo.latitude, longitude: geo.longitude } : {}),
      ...fieldsToInput(fields),
    })
  }

  const toggleForm = () => {
    if (formOpen) {
      setFormOpen(false)
      return
    }
    setFormOpen(true)
    // 首次展开时按当下时间预置季节与时段（仍可覆盖）
    if (!fieldsTouched(fields)) setFields({ ...fields, season: currentSeason(), timeOfDay: currentTimeOfDay() })
  }

  const tone = result ? scoreTone(result.score) : null
  const identifying = identifyMut.isPending
  const expert = result && isExpertResult(result) ? result : null

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
        {/* 档位选择（QY-SPOT-007 分层定价） */}
        <section className="mx-4 mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setTier('basic')}
            aria-pressed={tier === 'basic'}
            className={`flex-1 rounded-xl border px-3 py-2 text-left transition-colors ${
              tier === 'basic' ? 'border-lake bg-lake-tint' : 'border-line bg-paper-white'
            }`}
          >
            <p className="text-[13px] font-semibold leading-4 text-ink">基础识别</p>
            <p className="mt-0.5 text-[11px] leading-3 text-ink-40">
              {bal
                ? freeRemaining > 0
                  ? `免费 ${freeRemaining} 次，之后 ¥${(bal.priceCents / 100).toFixed(2)}`
                  : `¥${(bal.priceCents / 100).toFixed(2)}/次`
                : '快速结论'}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setTier('expert')}
            aria-pressed={tier === 'expert'}
            className={`flex-1 rounded-xl border px-3 py-2 text-left transition-colors ${
              tier === 'expert' ? 'border-lake bg-lake-tint' : 'border-line bg-paper-white'
            }`}
          >
            <p className="flex items-center gap-1 text-[13px] font-semibold leading-4 text-ink">
              专家报告
              {bal && bal.expertPriceCents > bal.priceCents ? <Sparkles size={12} className="text-lake" /> : null}
            </p>
            <p className="mt-0.5 text-[11px] leading-3 text-ink-40">
              {bal
                ? expertFreeRemaining > 0
                  ? `含体验 ${expertFreeRemaining} 次，之后 ¥${(bal.expertPriceCents / 100).toFixed(2)}`
                  : `¥${(bal.expertPriceCents / 100).toFixed(2)}/次`
                : '钓组·饵料·水情'}
            </p>
          </button>
        </section>

        {/* 计费与规则库说明 */}
        <div className="mx-4 mt-2 rounded-xl bg-lake-tint px-4 py-2.5 text-[12px] leading-4 text-lake">
          {tier === 'expert'
            ? '专家报告走「看图取特征 → 知识库规则 → 结论」两段链路，专业数值来自规则库，耗时略长'
            : bal
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
              <p className="absolute bottom-0 left-0 right-0 flex items-center gap-1 bg-ink/45 px-3 py-1.5 text-[11px] leading-4 text-paper-white">
                <MapPin size={12} strokeWidth={2} />
                {geo ? `已带坐标 ${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}` : capturing ? '定位获取中…' : '未带坐标（不影响识别）'}
              </p>
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

        {/* 补充现场信息（默认收起，不影响主流程 — QY-SPOT-001） */}
        <section className="mx-4 mt-3">
          <button
            type="button"
            onClick={toggleForm}
            aria-expanded={formOpen}
            className="flex h-10 w-full items-center justify-between rounded-xl bg-paper-white px-4 text-[13px] font-medium text-ink-60"
          >
            <span>
              补充现场信息
              {fieldsTouched(fields) && !formOpen ? <span className="ml-1 text-[11px] text-lake">已填</span> : null}
            </span>
            {formOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <AnimatePresence>
            {formOpen && (
              <Suspense
                fallback={
                  <div className="mt-3 flex h-12 items-center justify-center rounded-xl bg-paper-white text-[12px] text-ink-40">
                    表单加载中…
                  </div>
                }
              >
                <SpotFieldForm value={fields} onChange={setFields} disabled={identifying} />
              </Suspense>
            )}
          </AnimatePresence>
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
            {identifying ? '识别中…' : tier === 'expert' ? '生成专家报告' : '开始识别'}
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

                {/* 专家报告折叠区（QY-SPOT-006，按需加载） */}
                {expert && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setReportOpen((v) => !v)}
                      aria-expanded={reportOpen}
                      className="flex h-9 w-full items-center justify-between rounded-xl border border-line px-3 text-[13px] font-medium text-lake"
                    >
                      <span>{reportOpen ? '收起专业报告' : '查看专业报告（钓组·饵料·水情）'}</span>
                      {reportOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {reportOpen && (
                      <Suspense
                        fallback={
                          <div className="mt-3 flex h-10 items-center justify-center rounded-xl bg-paper text-[12px] text-ink-40">
                            报告加载中…
                          </div>
                        }
                      >
                        <SpotExpertReport result={expert} />
                      </Suspense>
                    )}
                  </div>
                )}

                {/* 反馈（QY-SPOT-008 反馈闭环） */}
                <div className="flex items-center gap-2 border-t border-line pt-3">
                  <span className="text-[12px] leading-4 text-ink-40">这条结论有用吗</span>
                  {[
                    { key: 'useful', label: '有用' },
                    { key: 'bait_miss', label: '饵料不符' },
                    { key: 'inaccurate', label: '不准' },
                  ].map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => feedbackMut.mutate({ rating: o.key as 'useful' | 'bait_miss' | 'inaccurate' })}
                      disabled={feedbackMut.isPending}
                      className={`rounded-full px-3 py-1 text-[12px] leading-4 ${
                        feedback === o.key ? 'bg-lake text-paper-white' : 'bg-paper text-ink-60'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>

                {/* 置信度 + 本次计费 + 规则命中 */}
                <div className="flex flex-wrap items-center justify-between gap-1 border-t border-line pt-3 text-[12px] leading-4 text-ink-40">
                  <span>识别置信度 {Math.round(result.confidence * 100)}%</span>
                  {resultMeta?.tier === 'expert' && (
                    <span>{resultMeta.ruleHit ? '已命中知识库规则' : '未命中规则（已降级）'}</span>
                  )}
                  {resultMeta && (
                    <span>
                      {resultMeta.tier === 'expert' ? '专家报告' : '基础识别'} ·{' '}
                      {resultMeta.billing === 'free' ? '本次免费' : `扣费 ¥${(resultMeta.costCents / 100).toFixed(2)}`}
                      {resultMeta.sampleSaved ? ' · 样本已沉淀' : ''}
                    </span>
                  )}
                </div>
              </div>
            </m.section>
          )}
        </AnimatePresence>

        {/* 样本授权（QY-SPOT-008 合规：默认不存图，显式授权才入样本库） */}
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
                <span className="block text-[13px] font-medium leading-4 text-ink">允许沉淀我的识别样本</span>
                <span className="mt-1 block text-[11px] leading-4 text-ink-40">
                  用于改进垂类模型。默认关闭；开启后图片与结论会入样本库，随时可撤回并删除。计费记录不受影响。
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
            <p className="text-[14px] font-medium leading-5 text-ink-60">
              {tier === 'expert' ? 'AI 正在观察水域并比对专业规则…' : 'AI 正在观察这片水域…'}
            </p>
          </m.div>
        )}
      </AnimatePresence>

      <Toast message={toast} />
      {loginSheet}
    </div>
  )
}
