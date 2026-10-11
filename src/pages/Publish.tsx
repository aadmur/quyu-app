import { useMemo, useState } from 'react'
import { m } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Camera, ChevronRight, Loader2, MapPin, Plus, Scale, ScanText, X } from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import Toggle from '@/components/community/Toggle'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'
import { SpeciesPicker, SpotPicker } from '@/components/community/PickerSheets'
import { FISH_SPECIES, PUBLISH_SPOTS, PUBLISH_TOPICS, PUBLISH_SUCCESS_TOAST } from '@/data/community'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/hooks/useAuthGate'
import { pickImages, getCurrentPosition, reverseGeocode, type GeoFix, type GeoFailReason } from '@/lib/native'

const GEO_FAIL_TIPS: Record<GeoFailReason, string> = {
  'no-plugin': '当前安装包不含定位模块，请安装最新版 APK',
  denied: '定位权限被拒绝，请在系统设置中允许定位',
  timeout: '定位超时，请到开阔处并确认系统定位已开启',
  unsupported: '当前环境不支持定位',
}

const MAX_PHOTOS = 9

/**
 * 发布页 /publish：底部全屏弹层形态（Layout 已隐藏 TabBar）。
 * 发渔获：真实相册选图（原生走 Capacitor Camera，Web 走文件选择）+ 鱼种/重量 + 钓点标签 + 文案 + 真实 GPS 定位。
 */
export default function Publish() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast(1800)

  // 全部从空白开始（无预置假数据）
  const [photos, setPhotos] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [species, setSpecies] = useState<string | null>(null)
  const [weight, setWeight] = useState('')
  const [spotId, setSpotId] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [showLocation, setShowLocation] = useState(false)
  const [geoFix, setGeoFix] = useState<GeoFix | null>(null)
  const [geoAddr, setGeoAddr] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)

  const [speciesOpen, setSpeciesOpen] = useState(false)
  const [spotOpen, setSpotOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [closing, setClosing] = useState(false)

  const spot = useMemo(() => PUBLISH_SPOTS.find((s) => s.id === spotId) ?? null, [spotId])
  // 第一张为主图；必填：至少一张照片 + 鱼种；重量选填
  const ready = Boolean(photos.length > 0 && species)

  const closeAndGo = (to: string) => {
    setClosing(true)
    window.setTimeout(() => navigate(to), 380)
  }

  // 真实发帖：调 posts.create，成功后只让首页信息流的**第一页**重新拉取
  // （v14：不再 feed.invalidate() 整键失效 —— 那会把用户刷过的每一页全部重请求一遍）
  const utils = trpc.useUtils()
  const createPostMut = trpc.app.posts.create.useMutation({
    onSuccess: () => {
      setPublishing(false)
      showToast(PUBLISH_SUCCESS_TOAST)
      void utils.app.feed.invalidate({ page: 1 })
      void utils.app.posts.followingFeed.invalidate({ page: 1 })
      closeAndGo('/')
    },
    onError: (e) => {
      setPublishing(false)
      showToast(e.message || '发布失败，请稍后再试')
    },
  })

  const fishIdMut = trpc.app.fishId.identify.useMutation({
    onSuccess: (data) => {
      const top = data.result.topCandidates[0]
      if (top && data.result.isSupported && (FISH_SPECIES as readonly string[]).includes(top.name)) {
        setSpecies(top.name)
        showToast(`已识别：${top.name}（${Math.round(top.confidence * 100)}%）`)
      } else if (top) {
        showToast(`识别到 ${top.name}，但不在可选鱼种中`)
      } else {
        showToast(data.result.fallbackNote || '未能识别，请手动选择')
      }
    },
    onError: (e) => showToast(e.message || '识鱼失败，请手动选择'),
  })

  const { requireAuth, loginSheet } = useAuthGate()

  /** 从相册选图（多选），追加到照片列表 */
  const addPhotos = async () => {
    if (picking) return
    setPicking(true)
    try {
      const urls = await pickImages(MAX_PHOTOS - photos.length)
      if (urls.length > 0) setPhotos((list) => [...list, ...urls].slice(0, MAX_PHOTOS))
    } finally {
      setPicking(false)
    }
  }

  const removePhoto = (index: number) => {
    setPhotos((list) => list.filter((_, i) => i !== index))
  }

  /** 定位开关：打开时实时获取 GPS；失败/被拒则回退关闭并提示 */
  const toggleLocation = async (next: boolean) => {
    if (!next) {
      setShowLocation(false)
      setGeoFix(null)
      setGeoAddr(null)
      return
    }
    setLocating(true)
    const { fix, reason } = await getCurrentPosition()
    if (fix) {
      setGeoFix(fix)
      setShowLocation(true)
      // 拿到坐标后逆地理出可读地址（失败回退坐标显示，不阻断）
      const addr = await reverseGeocode(fix)
      setGeoAddr(addr)
      setLocating(false)
    } else {
      setLocating(false)
      setShowLocation(false)
      showToast(reason ? GEO_FAIL_TIPS[reason] : '定位失败：请检查定位权限或稍后再试')
    }
  }

  const handlePublish = () => {
    if (!ready || publishing) return
    if (!requireAuth('发布渔获')) return
    setPublishing(true)
    createPostMut.mutate({
      content: caption.trim() || `${species ?? '渔获'}${weight.trim() ? ` ${weight.trim()}斤` : ''}`,
      images: photos,
      pondSlug: spotId ?? undefined,
      fishSpecies: species ?? undefined,
      weightJin: weight.trim() ? Number(weight) : undefined,
      latitude: showLocation && geoFix ? geoFix.latitude : undefined,
      longitude: showLocation && geoFix ? geoFix.longitude : undefined,
      locationText: showLocation && geoAddr ? geoAddr : undefined,
    })
  }

  const appendTopic = (topic: string) => {
    setCaption((c) => (c.includes(topic) ? c : `${c}${c.endsWith(' ') || c === '' ? '' : ' '}${topic}`))
  }

  const identifyFromPhoto = () => {
    if (photos.length === 0 || fishIdMut.isPending) return
    if (!requireAuth('识鱼')) return
    fishIdMut.mutate({ imageData: photos[0] })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink/40">
      {/* 底部全屏弹层：y 100%→0，spring damping 28，顶部圆角 20 */}
      <m.div
        initial={{ y: '100%' }}
        animate={{ y: closing ? '100%' : 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="mt-2 flex flex-1 flex-col overflow-hidden rounded-t-[20px] bg-paper"
      >
        {/* 头部：取消 · 发渔获 · 发布 */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <button
            type="button"
            onClick={() => closeAndGo('/')}
            className="text-[15px] leading-[22px] text-ink-60"
          >
            取消
          </button>
          <h1 className="text-[18px] font-semibold leading-6 text-ink">发渔获</h1>
          <m.button
            type="button"
            whileTap={ready ? { scale: 0.96 } : undefined}
            disabled={!ready || publishing}
            onClick={handlePublish}
            className={`flex h-8 min-w-[64px] items-center justify-center rounded-full px-4 text-[13px] font-semibold leading-[18px] ${
              ready ? 'bg-olive text-paper-white' : 'bg-[#2d1e1e14] text-ink-40'
            }`}
          >
            {publishing ? <Loader2 size={16} className="animate-spin" /> : '发布'}
          </m.button>
        </header>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* Section 1 — 照片区（真实相册选图） */}
          <section className="mx-4 mb-5 mt-2">
            {photos.length > 0 ? (
              <>
                {/* 主图 */}
                <m.div
                  key={photos[0].slice(0, 64)}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                  className="relative h-[200px] overflow-hidden rounded-xl"
                >
                  <img src={photos[0]} alt="渔获主图" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="删除主图"
                    onClick={() => removePhoto(0)}
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink/50 text-paper-white"
                  >
                    <X size={16} strokeWidth={2} />
                  </button>
                </m.div>
                {/* 附图 + 添加 */}
                <div className="mt-3 flex flex-wrap gap-3">
                  {photos.slice(1).map((src, i) => (
                    <m.div
                      key={src.slice(0, 64)}
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                      className="relative h-16 w-16 overflow-hidden rounded-lg"
                    >
                      <img src={src} alt={`渔获附图 ${i + 2}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        aria-label="删除附图"
                        onClick={() => removePhoto(i + 1)}
                        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/50 text-paper-white"
                      >
                        <X size={12} strokeWidth={2.2} />
                      </button>
                    </m.div>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <button
                      type="button"
                      aria-label="添加照片"
                      disabled={picking}
                      onClick={addPhotos}
                      className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-line bg-paper-white transition-colors hover:border-olive disabled:opacity-50"
                    >
                      {picking ? (
                        <Loader2 size={22} strokeWidth={1.8} className="animate-spin text-ink-40" />
                      ) : (
                        <Plus size={22} strokeWidth={1.8} className="text-ink-40" />
                      )}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={addPhotos}
                disabled={picking}
                className="group flex h-[200px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-paper-white transition-colors hover:border-olive disabled:opacity-60"
              >
                {picking ? (
                  <Loader2 size={28} strokeWidth={1.8} className="animate-spin text-ink-40" />
                ) : (
                  <Camera size={28} strokeWidth={1.8} className="text-ink-40 transition-colors group-hover:text-olive" />
                )}
                <span className="text-[13px] leading-[18px] text-ink-60">
                  {picking ? '打开相册中…' : '拍一张渔获，或从相册选择'}
                </span>
              </button>
            )}
            <p className="mt-2 text-[12px] leading-4 text-ink-40">最多 {MAX_PHOTOS} 张，第一张为封面</p>
          </section>

          {/* Section 2 — 渔获信息行（鱼种 / 重量） */}
          <m.section
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.06 } } }}
            className="mx-4 mb-5 flex gap-3"
          >
            <m.button
              type="button"
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              onClick={() => setSpeciesOpen(true)}
              className="flex h-12 flex-1 items-center gap-2 rounded-xl bg-paper-white px-3"
            >
              <FishIcon size={20} className={species ? 'text-olive' : 'text-ink-40'} />
              <span className={`flex-1 text-left text-[15px] leading-[22px] ${species ? 'text-ink' : 'text-ink-40'}`}>
                {species ?? '鱼种（必选）'}
              </span>
              <ChevronRight size={18} strokeWidth={1.8} className="text-ink-40" />
            </m.button>
            {photos.length > 0 && (
              <m.button
                type="button"
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                onClick={identifyFromPhoto}
                disabled={fishIdMut.isPending}
                aria-label="拍照识鱼"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-lake-tint"
              >
                {fishIdMut.isPending ? (
                  <Loader2 size={20} className="animate-spin text-lake" />
                ) : (
                  <ScanText size={20} className="text-lake" />
                )}
              </m.button>
            )}
            <m.div
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              className="flex h-12 w-[100px] items-center gap-1 rounded-xl bg-paper-white px-3"
            >
              <Scale size={18} strokeWidth={1.8} className="shrink-0 text-ink-40" />
              <input
                value={weight}
                onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1'))}
                inputMode="decimal"
                placeholder="选填"
                className="w-full min-w-0 bg-transparent text-right font-num text-[20px] leading-6 text-ink outline-none placeholder:text-ink-40"
              />
              <span className="shrink-0 text-[12px] leading-4 text-ink-60">斤</span>
            </m.div>
          </m.section>

          {/* Section 3 — 钓点标签 */}
          <section className="mx-4 mb-5">
            {spot ? (
              <m.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-olive-tint px-4"
              >
                <MapPin size={18} strokeWidth={1.8} className="text-olive" />
                <span className="text-[15px] leading-[22px] text-olive">{spot.name}</span>
                <button
                  type="button"
                  aria-label="移除钓点"
                  onClick={() => setSpotId(null)}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-olive"
                >
                  <X size={14} strokeWidth={2.2} />
                </button>
              </m.div>
            ) : (
              <button
                type="button"
                onClick={() => setSpotOpen(true)}
                className="flex h-12 w-full items-center gap-2 rounded-xl bg-paper-white px-3"
              >
                <MapPin size={20} strokeWidth={1.8} className="text-ink-40" />
                <span className="flex-1 text-left text-[15px] leading-[22px] text-ink-40">添加钓点（选填）</span>
                <ChevronRight size={18} strokeWidth={1.8} className="text-ink-40" />
              </button>
            )}
          </section>

          {/* Section 4 — 文案输入 */}
          <section className="mx-4 mb-5">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="说点什么… 比如几点开的口、用的什么饵"
              maxLength={1000}
              className="h-[100px] w-full resize-none rounded-xl bg-paper-white p-3 text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-40"
            />
            <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
              {PUBLISH_TOPICS.map((topic) => (
                <m.button
                  key={topic}
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={() => appendTopic(topic)}
                  className="shrink-0 rounded-full bg-olive-tint px-3 py-1 text-[12px] leading-4 text-olive"
                >
                  {topic}
                </m.button>
              ))}
            </div>
          </section>

          {/* Section 5 — 发布选项：真实 GPS 定位 */}
          <section className="mx-4 mb-10 rounded-xl bg-paper-white px-4">
            <div className="flex min-h-12 items-center gap-3 py-2">
              <MapPin size={20} strokeWidth={1.8} className="text-ink" />
              <div className="flex-1">
                <p className="text-[15px] leading-[22px] text-ink">显示定位</p>
                {showLocation && geoFix && (
                  <p className="text-[12px] leading-4 text-lake">
                    {geoAddr ?? `${geoFix.latitude.toFixed(4)}°N, ${geoFix.longitude.toFixed(4)}°E`}
                  </p>
                )}
                {locating && <p className="text-[12px] leading-4 text-ink-40">定位中…</p>}
              </div>
              <Toggle checked={showLocation} onChange={(v) => void toggleLocation(v)} label="显示定位" disabled={locating} />
            </div>
          </section>
        </div>
      </m.div>

      {/* 鱼种 / 钓点选择层 */}
      <SpeciesPicker open={speciesOpen} value={species} onSelect={setSpecies} onClose={() => setSpeciesOpen(false)} />
      <SpotPicker open={spotOpen} value={spotId} onSelect={setSpotId} onClose={() => setSpotOpen(false)} />

      {/* 发布成功 toast */}
      <Toast message={toast} />

      {/* 登录引导 */}
      {loginSheet}
    </div>
  )
}
