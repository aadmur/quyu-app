import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Camera, ChevronRight, Loader2, MapPin, Plus, Scale, X } from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import Toggle from '@/components/community/Toggle'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'
import { SpeciesPicker, SpotPicker } from '@/components/community/PickerSheets'
import { PUBLISH_SPOTS, PUBLISH_TOPICS, PUBLISH_SUCCESS_TOAST } from '@/data/community'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/components/LoginSheet'

const EXTRA_PHOTOS = ['/feed-6.jpg', '/feed-2.jpg']

/**
 * 发布页 /publish：底部全屏弹层形态（Layout 已隐藏 TabBar）。
 * 发渔获：照片区 + 鱼种/重量 + 钓点标签 + 文案 + 发布选项。
 */
export default function Publish() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast(1800)

  // 演示预置：主图已选 feed-1.jpg，鱼种翘嘴，重量 6.8，钓点青龙湾
  const [mainPhoto, setMainPhoto] = useState<string | null>('/feed-1.jpg')
  const [extraPhotos, setExtraPhotos] = useState<string[]>(EXTRA_PHOTOS)
  const [species, setSpecies] = useState<string | null>('翘嘴')
  const [weight, setWeight] = useState('6.8')
  const [spotId, setSpotId] = useState<string | null>('qinglong')
  const [caption, setCaption] = useState('凌晨四点半的翘嘴，6.8 斤，值了！')
  const [syncSpot, setSyncSpot] = useState(true)
  const [showLocation, setShowLocation] = useState(true)

  const [speciesOpen, setSpeciesOpen] = useState(false)
  const [spotOpen, setSpotOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [closing, setClosing] = useState(false)

  const spot = useMemo(() => PUBLISH_SPOTS.find((s) => s.id === spotId) ?? null, [spotId])
  const ready = Boolean(mainPhoto && species && weight.trim())

  const closeAndGo = (to: string) => {
    setClosing(true)
    // 弹层下滑收起后跳转（时长与 transition 对齐）
    window.setTimeout(() => navigate(to), 380)
  }

  // 真实发帖：调 posts.create，成功后让首页信息流重新拉取
  const utils = trpc.useUtils()
  const createPostMut = trpc.app.posts.create.useMutation({
    onSuccess: () => {
      setPublishing(false)
      showToast(PUBLISH_SUCCESS_TOAST)
      utils.app.feed.invalidate()
      closeAndGo('/')
    },
    onError: (e) => {
      setPublishing(false)
      showToast(e.message || '发布失败，请稍后再试')
    },
  })

  const { requireAuth, loginSheet } = useAuthGate()

  const handlePublish = () => {
    if (!ready || publishing) return
    if (!requireAuth('发布渔获')) return
    setPublishing(true)
    const images = [mainPhoto, ...extraPhotos].filter((s): s is string => Boolean(s))
    createPostMut.mutate({
      content: caption.trim() || `${species ?? '渔获'} ${weight}斤`,
      images,
      pondSlug: spotId ?? undefined,
      fishSpecies: species ?? undefined,
      weightJin: weight.trim() ? Number(weight) : undefined,
    })
  }

  const appendTopic = (topic: string) => {
    setCaption((c) => (c.includes(topic) ? c : `${c}${c.endsWith(' ') || c === '' ? '' : ' '}${topic}`))
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ink/40">
      {/* 底部全屏弹层：y 100%→0，spring damping 28，顶部圆角 20 */}
      <motion.div
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
          <motion.button
            type="button"
            whileTap={ready ? { scale: 0.96 } : undefined}
            disabled={!ready || publishing}
            onClick={handlePublish}
            className={`flex h-8 min-w-[64px] items-center justify-center rounded-full px-4 text-[13px] font-semibold leading-[18px] ${
              ready ? 'bg-olive text-paper-white' : 'bg-[#2d1e1e14] text-ink-40'
            }`}
          >
            {publishing ? <Loader2 size={16} className="animate-spin" /> : '发布'}
          </motion.button>
        </header>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* Section 1 — 照片区 */}
          <section className="mx-4 mb-5 mt-2">
            {mainPhoto ? (
              <motion.div
                key={mainPhoto}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                className="relative h-[200px] overflow-hidden rounded-xl"
              >
                <img src={mainPhoto} alt="渔获主图" className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="删除主图"
                  onClick={() => setMainPhoto(null)}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink/50 text-paper-white"
                >
                  <X size={16} strokeWidth={2} />
                </button>
              </motion.div>
            ) : (
              <button
                type="button"
                onClick={() => setMainPhoto('/feed-1.jpg')}
                className="group flex h-[200px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-paper-white transition-colors hover:border-olive"
              >
                <Camera size={28} strokeWidth={1.8} className="text-ink-40 transition-colors group-hover:text-olive" />
                <span className="text-[13px] leading-[18px] text-ink-60">拍一张渔获，或从相册选择</span>
              </button>
            )}
            <div className="mt-3 flex gap-3">
              {extraPhotos.map((src) => (
                <motion.div
                  key={src}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                  className="relative h-16 w-16 overflow-hidden rounded-lg"
                >
                  <img src={src} alt="渔获附图" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="删除附图"
                    onClick={() => setExtraPhotos((list) => list.filter((p) => p !== src))}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/50 text-paper-white"
                  >
                    <X size={12} strokeWidth={2.2} />
                  </button>
                </motion.div>
              ))}
              <button
                type="button"
                aria-label="添加照片"
                onClick={() => {
                  if (!extraPhotos.includes('/feed-6.jpg')) setExtraPhotos((l) => [...l, '/feed-6.jpg'])
                  else if (!extraPhotos.includes('/feed-2.jpg')) setExtraPhotos((l) => [...l, '/feed-2.jpg'])
                }}
                className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-line bg-paper-white transition-colors hover:border-olive"
              >
                <Plus size={22} strokeWidth={1.8} className="text-ink-40" />
              </button>
            </div>
          </section>

          {/* Section 2 — 渔获信息行（鱼种 / 重量） */}
          <motion.section
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.06 } } }}
            className="mx-4 mb-5 flex gap-3"
          >
            <motion.button
              type="button"
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              onClick={() => setSpeciesOpen(true)}
              className="flex h-12 flex-1 items-center gap-2 rounded-xl bg-paper-white px-3"
            >
              <FishIcon size={20} className={species ? 'text-olive' : 'text-ink-40'} />
              <span className={`flex-1 text-left text-[15px] leading-[22px] ${species ? 'text-ink' : 'text-ink-40'}`}>
                {species ?? '鱼种'}
              </span>
              <ChevronRight size={18} strokeWidth={1.8} className="text-ink-40" />
            </motion.button>
            <motion.div
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              className="flex h-12 w-[120px] items-center gap-1 rounded-xl bg-paper-white px-3"
            >
              <Scale size={18} strokeWidth={1.8} className="shrink-0 text-ink-40" />
              <input
                value={weight}
                onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                placeholder="0.0"
                className="w-full min-w-0 bg-transparent text-right font-num text-[20px] leading-6 text-ink outline-none placeholder:text-ink-40"
              />
              <span className="shrink-0 text-[12px] leading-4 text-ink-60">斤</span>
            </motion.div>
          </motion.section>

          {/* Section 3 — 钓点标签 */}
          <section className="mx-4 mb-5">
            {spot ? (
              <motion.div
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
              </motion.div>
            ) : (
              <button
                type="button"
                onClick={() => setSpotOpen(true)}
                className="flex h-12 w-full items-center gap-2 rounded-xl bg-paper-white px-3"
              >
                <MapPin size={20} strokeWidth={1.8} className="text-ink-40" />
                <span className="flex-1 text-left text-[15px] leading-[22px] text-ink-40">添加钓点</span>
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
              className="h-[100px] w-full resize-none rounded-xl bg-paper-white p-3 text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-40"
            />
            <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
              {PUBLISH_TOPICS.map((topic) => (
                <motion.button
                  key={topic}
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={() => appendTopic(topic)}
                  className="shrink-0 rounded-full bg-olive-tint px-3 py-1 text-[12px] leading-4 text-olive"
                >
                  {topic}
                </motion.button>
              ))}
            </div>
          </section>

          {/* Section 5 — 发布选项 */}
          <section className="mx-4 mb-10 rounded-xl bg-paper-white px-4">
            <div className="flex h-12 items-center gap-3 border-b border-line">
              <FishIcon size={20} className="text-ink" />
              <div className="flex-1">
                <p className="text-[15px] leading-[22px] text-ink">同步到钓点攻略区</p>
              </div>
              <Toggle checked={syncSpot} onChange={setSyncSpot} label="同步到钓点攻略区" />
            </div>
            <div className="flex h-12 items-center gap-3">
              <MapPin size={20} strokeWidth={1.8} className="text-ink" />
              <div className="flex-1">
                <p className="text-[15px] leading-[22px] text-ink">显示定位</p>
              </div>
              <Toggle checked={showLocation} onChange={setShowLocation} label="显示定位" />
            </div>
          </section>
        </div>
      </motion.div>

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
