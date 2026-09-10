import { useRef, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Camera, X, Loader2, Store, CircleCheck, CircleX, Clock } from 'lucide-react'
import PageHeader from '@/components/trade/PageHeader'
import Toast from '@/components/trade/Toast'
import { trpc } from '@/providers/trpc'

const MAX_PHOTOS = 4
const MAX_NOTE = 500

/**
 * 塘主入驻申请页 /pond-apply（QY-D-002）：
 * 顶部显示最近一次申请状态（审核中/已通过含认领码/已拒绝含备注），
 * 下方为申请表单（塘名/地区/地址/电话/票种意向/照片≤4/补充说明）。
 * 有 pending 申请时表单禁用；被拒绝后可修改重新提交。
 */
export default function PondApply() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const me = meQuery.data ?? null

  const mineQuery = trpc.app.pondApply.mine.useQuery(undefined, { enabled: !!me, retry: false })
  const latest = mineQuery.data ?? null

  const [pondName, setPondName] = useState('')
  const [region, setRegion] = useState('')
  const [address, setAddress] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [ticketDesc, setTicketDesc] = useState('')
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)

  const fireToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2400)
  }

  const submitMut = trpc.app.pondApply.submit.useMutation({
    onSuccess: async () => {
      await utils.app.pondApply.mine.invalidate()
      fireToast('申请已提交，请等待审核')
      // 清空表单，状态卡展示「审核中」
      setPondName(''); setRegion(''); setAddress(''); setContactPhone(''); setTicketDesc(''); setNote(''); setPhotos([])
    },
    onError: (e) => fireToast(e.message || '提交失败，请稍后再试'),
  })

  /** 相册选图 → canvas 压缩为 JPEG dataURL（≤1024px，与评价晒图同管线） */
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
        setPhotos((prev) => [...prev, canvas.toDataURL('image/jpeg', 0.75)].slice(0, MAX_PHOTOS))
      }
      img.onerror = () => fireToast('图片读取失败，请换一张试试')
      img.src = String(reader.result)
    }
    reader.onerror = () => fireToast('图片读取失败，请换一张试试')
    reader.readAsDataURL(file)
  }

  const canSubmit =
    !!me &&
    latest?.status !== 'pending' &&
    pondName.trim() && region.trim() && address.trim() && contactPhone.trim().length >= 5 && ticketDesc.trim() &&
    !submitMut.isPending

  const submit = () => {
    if (!canSubmit) return
    submitMut.mutate({
      pondName: pondName.trim(),
      region: region.trim(),
      address: address.trim(),
      contactPhone: contactPhone.trim(),
      ticketDesc: ticketDesc.trim(),
      note: note.trim() || undefined,
      photoData: photos,
    })
  }

  return (
    <div className="min-h-full bg-paper pb-32">
      <PageHeader title="塘主入驻" />
      <Toast message={toast} show={!!toast} />

      {/* 未登录引导 */}
      {!meQuery.isLoading && !me && (
        <div className="mx-4 mt-6 rounded-2xl border border-dashed border-olive bg-olive-tint p-6 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-paper-white text-olive">
            <Store size={22} strokeWidth={1.8} />
          </span>
          <p className="text-[14px] font-semibold leading-5 text-ink">登录后提交入驻申请</p>
          <p className="mt-1 text-[12px] leading-[18px] text-ink-60">审核通过后将生成钓场与认领码，即可管理你的钓场</p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="mt-4 rounded-full bg-olive px-6 py-2 text-[13px] font-semibold text-paper-white active:brightness-95"
          >
            去登录
          </button>
        </div>
      )}

      {/* 最近一次申请状态卡 */}
      {me && latest && (
        <m.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="mx-4 mt-3 rounded-2xl bg-paper-white p-4"
        >
          <div className="flex items-center gap-2.5">
            {latest.status === 'pending' && <Clock size={18} strokeWidth={1.8} className="shrink-0 text-lake" />}
            {latest.status === 'approved' && <CircleCheck size={18} strokeWidth={1.8} className="shrink-0 text-olive" />}
            {latest.status === 'rejected' && <CircleX size={18} strokeWidth={1.8} className="shrink-0 text-heart" />}
            <p className="text-[14px] font-semibold leading-5 text-ink">
              {latest.status === 'pending' && '申请审核中'}
              {latest.status === 'approved' && '入驻申请已通过'}
              {latest.status === 'rejected' && '入驻申请未通过'}
            </p>
            <span className="flex-1" />
            <span className="text-[12px] leading-4 text-ink-40">{latest.pondName}</span>
          </div>
          {latest.status === 'pending' && (
            <p className="mt-2 text-[12px] leading-[18px] text-ink-60">平台正在审核「{latest.pondName}」的入驻申请，结果将通过消息通知你。</p>
          )}
          {latest.status === 'approved' && (
            <div className="mt-2 text-[12px] leading-[18px] text-ink-60">
              {latest.claimCode ? (
                <>
                  <p>
                    认领码：<span className="font-num font-semibold text-olive">{latest.claimCode}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/owner')}
                    className="mt-2 rounded-full bg-olive px-4 py-1.5 text-[12px] font-semibold text-paper-white active:brightness-95"
                  >
                    去塘主看板认领
                  </button>
                </>
              ) : (
                <p>钓场已创建，请到塘主看板页完成认领。</p>
              )}
            </div>
          )}
          {latest.status === 'rejected' && (
            <p className="mt-2 text-[12px] leading-[18px] text-ink-60">
              {latest.reviewNote ? `审批备注：${latest.reviewNote}` : '未通过审核'}
              ，可修改资料后重新提交。
            </p>
          )}
        </m.section>
      )}

      {/* 申请表单（pending 时禁用） */}
      {me && (
        <section className="mx-4 mt-4 space-y-4">
          {latest?.status === 'pending' && (
            <p className="rounded-xl bg-lake-tint px-3 py-2 text-[12px] leading-[18px] text-lake">
              已有申请在审核中，审核通过或拒绝后才能再次提交
            </p>
          )}

          <label className="block">
            <span className="mb-1.5 block text-[13px] leading-[18px] text-ink-60">塘名</span>
            <input
              value={pondName}
              onChange={(e) => setPondName(e.target.value)}
              maxLength={64}
              placeholder="例如：青龙湾生态钓场"
              disabled={latest?.status === 'pending'}
              className="h-12 w-full rounded-xl bg-paper-white px-3 text-[15px] text-ink outline-none placeholder:text-ink-40 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] leading-[18px] text-ink-60">地区</span>
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              maxLength={64}
              placeholder="例如：武汉·江夏"
              disabled={latest?.status === 'pending'}
              className="h-12 w-full rounded-xl bg-paper-white px-3 text-[15px] text-ink outline-none placeholder:text-ink-40 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] leading-[18px] text-ink-60">详细地址</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={128}
              placeholder="街道/村镇 + 门牌或地标"
              disabled={latest?.status === 'pending'}
              className="h-12 w-full rounded-xl bg-paper-white px-3 text-[15px] text-ink outline-none placeholder:text-ink-40 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] leading-[18px] text-ink-60">联系电话</span>
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              maxLength={32}
              inputMode="tel"
              placeholder="手机或座机号码"
              disabled={latest?.status === 'pending'}
              className="h-12 w-full rounded-xl bg-paper-white px-3 font-num text-[15px] text-ink outline-none placeholder:font-sans placeholder:text-ink-40 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] leading-[18px] text-ink-60">票种意向</span>
            <input
              value={ticketDesc}
              onChange={(e) => setTicketDesc(e.target.value)}
              maxLength={255}
              placeholder="例如：全天票 98 元、夜钓票 78 元"
              disabled={latest?.status === 'pending'}
              className="h-12 w-full rounded-xl bg-paper-white px-3 text-[15px] text-ink outline-none placeholder:text-ink-40 disabled:opacity-50"
            />
          </label>

          {/* 照片上传（≤4 张，压缩后随申请提交） */}
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] leading-[18px] text-ink-60">钓场照片</span>
              <span className="text-[12px] leading-4 text-ink-40">选填，最多 {MAX_PHOTOS} 张</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <AnimatePresence>
                {photos.map((src, idx) => (
                  <m.div
                    key={`${idx}-${src.length}`}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                    className="relative h-[88px] w-[88px]"
                  >
                    <img src={src} alt="钓场照片" className="h-full w-full rounded-lg object-cover" />
                    <button
                      type="button"
                      aria-label="删除照片"
                      onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-paper-white"
                    >
                      <X size={12} strokeWidth={2.2} />
                    </button>
                  </m.div>
                ))}
              </AnimatePresence>
              {photos.length < MAX_PHOTOS && latest?.status !== 'pending' && (
                <m.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => fileRef.current?.click()}
                  className="flex h-[88px] w-[88px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#2d1e1e33] text-ink-60"
                >
                  <Camera size={22} strokeWidth={1.8} />
                  <span className="text-[12px] leading-4">添加</span>
                </m.button>
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
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[13px] leading-[18px] text-ink-60">补充说明（选填）</span>
            <div className="relative rounded-xl bg-paper-white">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                rows={3}
                placeholder="鱼种、设施、营业情况等补充信息"
                disabled={latest?.status === 'pending'}
                className="w-full resize-none rounded-xl bg-transparent px-3 py-3 text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-40 disabled:opacity-50"
              />
              <span className="pointer-events-none absolute bottom-2 right-3 font-num text-[12px] leading-4 text-ink-40">
                {note.length}/{MAX_NOTE}
              </span>
            </div>
          </label>
        </section>
      )}

      {/* 吸底提交栏 */}
      {me && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[420px] border-t border-line bg-paper-white px-4 pt-3"
          style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 16px)' }}
        >
          <m.button
            type="button"
            whileTap={canSubmit ? { scale: 0.97 } : undefined}
            onClick={submit}
            disabled={!canSubmit}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold leading-[22px] text-paper-white ${
              canSubmit ? 'bg-olive' : 'bg-olive/40'
            }`}
          >
            {submitMut.isPending && <Loader2 size={18} strokeWidth={2} className="animate-spin" />}
            {submitMut.isPending ? '提交中…' : latest?.status === 'pending' ? '审核中，暂不可提交' : latest?.status === 'rejected' ? '重新提交申请' : '提交入驻申请'}
          </m.button>
        </div>
      )}
    </div>
  )
}
