import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useParams } from 'react-router-dom'
import { Star, Camera, X, Loader2 } from 'lucide-react'
import PageHeader from '@/components/trade/PageHeader'
import Toast from '@/components/trade/Toast'
import SuccessCheck from '@/components/trade/SuccessCheck'
import { findOrder } from '@/data/orders'
import { trpc } from '@/providers/trpc'
import { mapMyOrder } from '@/lib/live'

const STAR_TEXTS = ['不会再去了', '一般般', '还行', '不错，会再来', '爆护！强烈推荐']
const POSITIVE_TAGS = ['鱼口好', '塘主热情', '环境干净', '停车方便', '钓位宽敞', '性价比高', '放鱼实在']
const NEGATIVE_TAGS = ['鱼口差', '人太多', '位置偏', '设施旧', '服务一般']
const MAX_LEN = 200
const MAX_PHOTOS = 3

/** 评价页：星级评分（文案联动）+ 标签云 + 文字评价 + 晒图 + 提交成功回流首页 */
export default function Review() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  // 真实订单（orders.mine 按 id 查找）；演示订单仅按 id 精确匹配，找不到绝不拿别的订单顶替
  const mineQuery = trpc.app.orders.mine.useQuery(undefined, { retry: 1 })
  const reviewMut = trpc.app.orders.review.useMutation()
  const utils = trpc.useUtils()
  const liveOrder = mineQuery.data?.find((o) => String(o.id) === orderId)
  const order = liveOrder ? mapMyOrder(liveOrder) : findOrder(orderId)

  const [stars, setStars] = useState(0)
  const [tags, setTags] = useState<string[]>([])
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)

  const fireToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2200)
  }

  const tagPool = stars >= 4 ? POSITIVE_TAGS : stars >= 1 ? NEGATIVE_TAGS : POSITIVE_TAGS

  const pickStar = (n: number) => {
    setStars(n)
    setTags([])
  }

  const toggleTag = (t: string) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))

  /** 真实添加晒图：本地相册选图 → canvas 压缩为 JPEG dataURL（≤1024px，控制体积） */
  const onPickFile = (file: File | undefined) => {
    if (!file || photos.length >= MAX_PHOTOS) return
    if (!file.type.startsWith('image/')) {
      fireToast('请选择图片文件')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 1024 / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          fireToast('图片处理失败，请换一张试试')
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const url = canvas.toDataURL('image/jpeg', 0.75)
        setPhotos((prev) => [...prev, url].slice(0, MAX_PHOTOS))
      }
      img.onerror = () => fireToast('图片读取失败，请换一张试试')
      img.src = String(reader.result)
    }
    reader.onerror = () => fireToast('图片读取失败，请换一张试试')
    reader.readAsDataURL(file)
  }

  const submit = () => {
    if (!stars || submitting) return
    setSubmitting(true)
    const finish = () => {
      setSubmitting(false)
      setDone(true)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(30)
    }
    // 真实订单：orders.review 提交（后端同步把订单置为已完成）；失败展示真实错误，不伪装成功
    if (liveOrder) {
      reviewMut.mutate(
        { orderId: liveOrder.id, rating: stars, content: text, tags, images: photos },
        {
          onSuccess: () => {
            utils.app.orders.mine.invalidate()
            finish()
          },
          onError: (e) => {
            setSubmitting(false)
            fireToast(e.message || '评价失败，请稍后再试')
          },
        },
      )
    } else {
      // 演示订单（后端不可用时的本地数据）：仅演示状态流转
      window.setTimeout(finish, 800)
    }
  }

  /* 提交成功：全屏轻量反馈，回流首页社区流 */
  if (done) {
    return (
      <motion.div
        className="flex flex-col items-center bg-paper px-8 pt-20"
        style={{
          minHeight: 'calc(100dvh - max(var(--safe-top, 0px), 44px))',
          paddingBottom: 'max(var(--safe-bottom, 0px), 40px)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <SuccessCheck size={96} />
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3, ease: 'easeOut' }}
          className="mt-5 text-[28px] font-bold leading-[34px] text-ink"
        >
          感谢分享！
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.38, ease: 'easeOut' }}
          className="mt-1 text-[13px] leading-[18px] text-ink-60"
        >
          评价已同步到社区
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.5, ease: 'easeOut' }}
          className="mt-auto w-full pt-10"
        >
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/')}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-olive text-[15px] font-semibold leading-[22px] text-paper-white"
          >
            去社区看看
          </motion.button>
        </motion.div>
      </motion.div>
    )
  }

  /* 真实订单加载中：骨架屏，避免闪烁「订单不存在」 */
  if (mineQuery.isLoading && !order) {
    return (
      <div className="min-h-full animate-pulse bg-paper pb-32">
        <PageHeader title="评价订单" />
        <div className="mx-4 mt-2 flex items-center gap-3">
          <div className="h-14 w-14 rounded-lg bg-paper-white" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-36 rounded bg-paper-white" />
            <div className="h-3 w-24 rounded bg-paper-white" />
          </div>
        </div>
        <div className="mx-4 mt-8 h-32 rounded-2xl bg-paper-white" />
      </div>
    )
  }

  /* 找不到对应 orderId 的订单：明确空态，不拿别的订单顶替 */
  if (!order) {
    return (
      <div className="flex min-h-full flex-col items-center bg-paper px-8 pb-16 text-center">
        <PageHeader title="评价订单" />
        <img src="/empty-creel.svg" alt="空鱼护" className="mt-16 h-32 w-40 opacity-80" />
        <p className="mt-4 text-[15px] leading-[22px] text-ink-60">订单不存在或已被删除</p>
        <button
          type="button"
          onClick={() => navigate('/tickets')}
          className="mt-5 h-12 rounded-xl bg-olive px-6 text-[15px] font-semibold text-paper-white"
        >
          返回我的票券
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-paper pb-32">
      <PageHeader title="评价订单" />
      <Toast message={toast} show={!!toast} />

      {/* 钓场摘要 + 星级 */}
      <section className="px-4 pt-2">
        <div className="flex items-center gap-3">
          <img src={order.pond.cover} alt={order.pond.name} className="h-14 w-14 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-[22px] text-ink">{order.pond.name}</p>
            <p className="mt-0.5 text-[12px] leading-4 text-ink-60">
              {order.ticketName} ×{order.qty} · {order.dateShort}
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-[18px] font-semibold leading-6 text-ink">这次钓得怎么样？</p>
        <div className="mt-3 flex items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const active = n <= stars
            return (
              <motion.button
                key={n}
                type="button"
                aria-label={`${n} 星`}
                onClick={() => pickStar(n)}
                initial={false}
                animate={{ scale: active && n === stars ? [1, 1.3, 1] : 1 }}
                transition={{ delay: 0.05 * (n - 1), type: 'spring', stiffness: 400, damping: 14 }}
                className="p-0.5"
              >
                <Star
                  size={40}
                  strokeWidth={1.5}
                  className={active ? 'fill-olive text-olive' : 'fill-transparent text-[#2d1e1e33]'}
                />
              </motion.button>
            )
          })}
        </div>
        <div className="mt-2 flex h-[18px] items-center justify-center">
          <AnimatePresence mode="wait">
            {stars > 0 && (
              <motion.p
                key={stars}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="text-[13px] leading-[18px] text-olive"
              >
                {STAR_TEXTS[stars - 1]}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* 标签化反馈 */}
      <section className="mx-4 mb-5 mt-2">
        <p className="text-[15px] font-semibold leading-[22px] text-ink">
          {stars >= 1 && stars <= 3 ? '说说差在哪（可多选）' : '说说好在哪（可多选）'}
        </p>
        <AnimatePresence mode="wait">
          <motion.div
            key={stars >= 4 || stars === 0 ? 'pos' : 'neg'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="mt-3 flex flex-wrap gap-2"
          >
            {tagPool.map((t) => {
              const active = tags.includes(t)
              return (
                <motion.button
                  key={t}
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  animate={{ scale: active ? 1.05 : 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                  onClick={() => toggleTag(t)}
                  className={`rounded-full px-3 py-1.5 text-[13px] leading-[18px] ${
                    active ? 'bg-olive text-paper-white' : 'border border-line bg-paper-white text-ink'
                  }`}
                >
                  {t}
                </motion.button>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </section>

      {/* 文字评价 */}
      <section className="mx-4 mb-5">
        <div className="relative rounded-xl border border-line bg-paper-white focus-within:border-olive">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
            placeholder="分享你的渔获和体验，帮助更多钓友…"
            rows={4}
            className="h-[120px] w-full resize-none rounded-xl bg-transparent p-3 text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-40"
          />
          <span className="pointer-events-none absolute bottom-2 right-3 font-num text-[12px] leading-4 tracking-[0.02em] text-ink-40">
            {text.length}/{MAX_LEN}
          </span>
        </div>
      </section>

      {/* 晒图上传（真实本地选图，压缩后随评价提交） */}
      <section className="mx-4">
        <div className="flex items-baseline gap-2">
          <p className="text-[15px] font-semibold leading-[22px] text-ink">晒晒渔获</p>
          <p className="text-[12px] leading-4 text-ink-60">晒图的钓友多钓 10 条</p>
        </div>
        <div className="mt-3 flex gap-2">
          <AnimatePresence>
            {photos.map((src, idx) => (
              <motion.div
                key={`${idx}-${src.length}`}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                className="relative h-[88px] w-[88px] shrink-0"
              >
                <img src={src} alt="渔获晒图" className="h-full w-full rounded-lg object-cover" />
                <button
                  type="button"
                  aria-label="删除照片"
                  onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-paper-white"
                >
                  <X size={12} strokeWidth={2.2} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          {photos.length < MAX_PHOTOS && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => fileRef.current?.click()}
              className="flex h-[88px] w-[88px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#2d1e1e33] text-ink-60"
            >
              <Camera size={22} strokeWidth={1.8} />
              <span className="text-[12px] leading-4">添加</span>
            </motion.button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onPickFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      </section>

      {/* 吸底提交栏 */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[420px] border-t border-line bg-paper-white px-4 pt-3"
        style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 16px)' }}
      >
        <motion.button
          type="button"
          whileTap={stars ? { scale: 0.97 } : undefined}
          onClick={submit}
          disabled={!stars || submitting}
          className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold leading-[22px] text-paper-white ${
            stars ? 'bg-olive' : 'bg-olive/40'
          }`}
        >
          {submitting && <Loader2 size={18} strokeWidth={2} className="animate-spin" />}
          {submitting ? '发布中…' : stars ? '发布评价' : '先打个星吧'}
        </motion.button>
      </div>
    </div>
  )
}
