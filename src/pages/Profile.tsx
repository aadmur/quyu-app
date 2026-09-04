import { useEffect, useRef, useState } from 'react'
import { motion, animate, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Settings,
  Share2,
  ChevronRight,
  Receipt,
  CircleHelp,
  LayoutGrid,
  ChartColumn,
  Layers,
  Play,
  Sparkles,
  Loader2,
  X,
  LogIn,
  ImagePlus,
} from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'
import CatchViewer from '@/components/community/CatchViewer'
import ProfileInsightSheet from '@/components/community/ProfileInsightSheet'
import { PROFILE, CATCH_WALL, CATCH_STATS } from '@/data/community'
import { trpc } from '@/providers/trpc'
import LoginSheet, { goKimiLogin } from '@/components/LoginSheet'

const AVATAR_CHOICES = ['/avatar-1.png', '/avatar-2.png', '/avatar-3.png', '/avatar-4.png']

const EASE_OUT = [0.16, 1, 0.3, 1] as [number, number, number, number]

/** 数据行数字：加载时 0 → 终值滚动 0.8s（Framer Motion，不与 GSAP 混用） */
function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    const controls = animate(0, value, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    return () => controls.stop()
  }, [value])
  return <>{display}</>
}

// 仅保留有真实页面的入口（我的收藏/优惠券目标页不存在，已隐藏）
const SERVICE_ENTRIES = [
  { key: 'orders', label: '我的订单', icon: Receipt, path: '/tickets' },
  { key: 'help', label: '帮助中心', icon: CircleHelp, path: null },
] as const

/**
 * 我的 /me（一级 Tab 页）：ins 式个人主页。
 * 封面 + 资料卡 + 数据行 + 身份切换 + 票券横条 + 服务宫格 + 渔获墙九宫格。
 */
export default function Profile() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast()

  const [role, setRole] = useState<'angler' | 'owner'>('angler')
  const [wallTab, setWallTab] = useState<'grid' | 'stats'>('grid')
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [insightOpen, setInsightOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [profile, setProfile] = useState<{ name: string; avatar: string } | null>(null)
  const [editName, setEditName] = useState(PROFILE.name)
  const [editAvatar, setEditAvatar] = useState(PROFILE.avatar)

  // 真实登录状态：auth.me 返回当前用户或 null（loading 中先显示骨架，避免闪烁）
  const utils = trpc.useUtils()
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const meLoading = meQuery.isLoading
  const me = meQuery.data ?? null
  const displayName = profile?.name ?? me?.name ?? PROFILE.name
  const displayAvatar = profile?.avatar ?? me?.avatar ?? PROFILE.avatar

  const logoutMut = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      setProfile(null)
      await utils.auth.me.invalidate()
      showToast('已退出登录')
    },
  })

  // 编辑资料：真实保存到后端 users 表（未登录先引导登录）
  const updateMut = trpc.app.users.update.useMutation({
    onSuccess: async (u) => {
      // 用后端返回的最新用户数据刷新本地态（自定义头像走 avatarData，vars.avatar 为 undefined）
      setProfile({ name: u.name ?? displayName, avatar: u.avatar ?? displayAvatar })
      setSettingsOpen(false)
      await utils.auth.me.invalidate()
      showToast('资料已保存')
    },
    onError: (e) => showToast(e.message || '保存失败，请稍后再试'),
  })

  const openSettings = () => {
    if (meLoading) return
    if (!me) { setLoginOpen(true); return }
    setEditName(displayName)
    setEditAvatar(displayAvatar)
    setSettingsOpen(true)
  }

  // 头像自定义：从相册/文件选择，压到 256px 读为 dataURL 保存
  const avatarFileRef = useRef<HTMLInputElement>(null)
  const pickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const s = 256
        canvas.width = s
        canvas.height = s
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const min = Math.min(img.width, img.height)
        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, s, s)
        setEditAvatar(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const shareProfile = async () => {
    // 分享实际有效内容：真实用户名 + 最新渔获战报 + 直达链接
    const latest = CATCH_WALL[0]
    const url = window.location.origin + '/me'
    const title = `${displayName}的趣渔主页`
    const text = [
      `我是「${displayName}」，${PROFILE.level}，在趣渔累计渔获 ${PROFILE.stats.catches} 尾。`,
      latest ? `最新战报：${latest.caption}` : '',
      `来看我的渔获墙：${url}`,
    ].filter(Boolean).join('\n')
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url })
        return
      }
      throw new Error('no-share')
    } catch {
      try {
        await navigator.clipboard.writeText(text)
        showToast('主页名片已复制（含昵称、渔获数与链接），去粘贴分享吧')
      } catch {
        showToast('复制失败，请手动复制地址栏链接')
      }
    }
  }

  // 数据行仅保留有真实页面的入口（「关注」列表页不存在，已隐藏）
  const statsRow = [
    { label: '渔获', value: PROFILE.stats.catches, onTap: () => setWallTab('grid') },
    { label: '粉丝', value: PROFILE.stats.followers, onTap: () => setInsightOpen(true) },
  ]
  const maxCount = Math.max(...CATCH_STATS.map((s) => s.count))

  return (
    <div className="bg-paper pb-8">
      {/* Section 1 — 封面 + 资料卡 */}
      <section className="relative">
        <div className="relative h-[140px] overflow-hidden">
          <motion.img
            src={PROFILE.cover}
            alt="个人封面"
            initial={{ scale: 1.08 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.8, ease: EASE_OUT }}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-paper" />
          {/* 顶部右侧操作：白 40% 圆衬底 */}
          <div className="absolute right-4 top-3 flex gap-2">
            {[
              { icon: Settings, label: '设置', onTap: openSettings },
              { icon: Share2, label: '分享主页', onTap: shareProfile },
            ].map(({ icon: Icon, label, onTap }) => (
              <motion.button
                key={label}
                type="button"
                aria-label={label}
                whileTap={{ scale: 0.92 }}
                onClick={onTap}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/40 text-ink backdrop-blur-sm"
              >
                <Icon size={20} strokeWidth={1.8} />
              </motion.button>
            ))}
          </div>
        </div>

        <div className="px-4">
          {meLoading ? (
            <div className="-mt-8 h-[88px] w-[88px] animate-pulse rounded-full border-2 border-paper-white bg-line" />
          ) : (
            <motion.img
              src={displayAvatar}
              alt={displayName}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.15 }}
              className="-mt-8 h-[88px] w-[88px] rounded-full border-2 border-paper-white object-cover"
            />
          )}
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } } }}
          >
            <motion.div
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              className="mt-3 flex items-center gap-2"
            >
              {meLoading ? (
                <div className="h-[34px] w-32 animate-pulse rounded-lg bg-line" />
              ) : (
                <h1 className="text-[28px] font-bold leading-[34px] text-ink">{displayName}</h1>
              )}
              <span className="flex items-center gap-1 rounded-full bg-lake-tint px-2.5 py-1 text-[12px] leading-4 text-lake">
                <FishIcon size={14} className="text-lake" />
                {PROFILE.level}
              </span>
              {!meLoading && (me ? (
                <button
                  type="button"
                  onClick={() => logoutMut.mutate()}
                  className="ml-auto rounded-full bg-[#2d1e1e0d] px-3 py-1 text-[12px] leading-4 text-ink-60 active:bg-line"
                >
                  退出登录
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goKimiLogin}
                  className="ml-auto flex items-center gap-1 rounded-full bg-olive px-3.5 py-1.5 text-[12px] font-semibold leading-4 text-paper-white active:brightness-95"
                >
                  <LogIn size={13} /> 登录
                </button>
              ))}
            </motion.div>
            <motion.p
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              className="mt-1 text-[13px] leading-[18px] text-ink-60"
            >
              {PROFILE.bio}
            </motion.p>
            <motion.div
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              className="mt-4 flex"
            >
              {statsRow.map((s) => (
                <motion.button
                  key={s.label}
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={s.onTap}
                  className="flex flex-1 flex-col items-center gap-0.5"
                >
                  <span className="font-num text-[20px] leading-6 text-ink">
                    <CountUp value={s.value} />
                  </span>
                  <span className="text-[12px] leading-4 text-ink-60">{s.label}</span>
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Section 2 — 身份切换胶囊（钓友 / 塘主） */}
      <section className="mx-4 mt-4">
        <div className="flex h-10 rounded-full bg-[#2d1e1e0d] p-[3px]">
          {(
            [
              { key: 'angler', label: '钓友' },
              { key: 'owner', label: '塘主' },
            ] as const
          ).map((r) => {
            const active = role === r.key
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  setRole(r.key)
                  if (r.key === 'owner') navigate('/owner')
                }}
                className="relative flex flex-1 items-center justify-center"
              >
                {active && (
                  <motion.span
                    layoutId="role-pill"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    className="absolute inset-0 rounded-full border border-line bg-paper-white"
                  />
                )}
                <span
                  className={`relative text-[13px] leading-[18px] ${
                    active ? 'font-semibold text-ink' : 'text-ink-60'
                  }`}
                >
                  {r.label}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Section 3 — 我的票券横条 */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.25 }}
        className="mx-4 mt-4"
      >
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/tickets')}
          className="flex w-full items-center gap-3 rounded-2xl bg-paper-white px-4 py-3.5"
        >
          <img src="/icon-ticket.svg" alt="" className="h-6 w-6" />
          <span className="text-[15px] font-semibold leading-[22px] text-ink">我的票券</span>
          <span className="flex items-center gap-1.5 text-[12px] leading-4 text-lake">
            <span className="h-1.5 w-1.5 rounded-full bg-lake" />
            {PROFILE.pendingTickets} 张待使用
          </span>
          <span className="flex-1" />
          <span className="text-[12px] leading-4 text-ink-60">查看全部</span>
          <ChevronRight size={18} strokeWidth={1.8} className="text-ink-40" />
        </motion.button>
      </motion.section>

      {/* Section 3.5 — 我的兴趣画像（推荐算法可视化入口） */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.28 }}
        className="mx-4 mt-3"
      >
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => setInsightOpen(true)}
          className="flex w-full items-center gap-3 rounded-2xl bg-paper-white px-4 py-3.5"
        >
          <span className="flex h-6 w-6 items-center justify-center text-olive">
            <Sparkles size={22} strokeWidth={1.8} />
          </span>
          <span className="text-[15px] font-semibold leading-[22px] text-ink">我的兴趣画像</span>
          <span className="text-[12px] leading-4 text-ink-60">看看趣渔有多懂你</span>
          <span className="flex-1" />
          <ChevronRight size={18} strokeWidth={1.8} className="text-ink-40" />
        </motion.button>
      </motion.section>

      {/* Section 4 — 服务入口宫格 */}
      <motion.section
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.05, delayChildren: 0.3 } } }}
        className="mx-4 mb-6 mt-4 grid grid-cols-4"
      >
        {SERVICE_ENTRIES.map(({ key, label, icon: Icon, path }) => (
          <motion.button
            key={key}
            type="button"
            variants={{ hidden: { opacity: 0, scale: 0.8 }, show: { opacity: 1, scale: 1 } }}
            whileTap={{ scale: 0.92 }}
            onClick={() => (path ? navigate(path) : setHelpOpen(true))}
            className="flex flex-col items-center gap-1.5"
          >
            <Icon size={28} strokeWidth={1.8} className="text-ink" />
            <span className="text-[12px] leading-4 text-ink-60">{label}</span>
          </motion.button>
        ))}
      </motion.section>

      {/* Section 5 — 渔获墙 Tab（九宫格 / 鱼获统计） */}
      <section className="border-t border-line">
        <div className="flex h-11">
          {(
            [
              { key: 'grid', label: '渔获墙', icon: LayoutGrid },
              { key: 'stats', label: '鱼获统计', icon: ChartColumn },
            ] as const
          ).map(({ key, label, icon: Icon }) => {
            const active = wallTab === key
            return (
              <button
                key={key}
                type="button"
                aria-label={label}
                onClick={() => setWallTab(key)}
                className="relative flex flex-1 items-center justify-center"
              >
                <Icon size={22} strokeWidth={active ? 2.2 : 1.8} className={active ? 'text-ink' : 'text-ink-40'} />
                {active && (
                  <motion.span
                    layoutId="wall-tab-indicator"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    className="absolute bottom-0 h-0.5 w-10 rounded-full bg-ink"
                  />
                )}
              </button>
            )
          })}
        </div>

        <AnimatePresence mode="wait">
          {wallTab === 'grid' ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-3 gap-px bg-paper-white"
            >
              {CATCH_WALL.map((item, i) => (
                <motion.button
                  key={item.id}
                  type="button"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.04, duration: 0.25, ease: 'easeOut' }}
                  onClick={() => setViewerIndex(i)}
                  className="relative aspect-square overflow-hidden bg-paper"
                >
                  <img src={item.src} alt={item.caption} loading="lazy" className="h-full w-full object-cover" />
                  {item.multi && (
                    <Layers size={16} strokeWidth={2} className="absolute right-1.5 top-1.5 text-white drop-shadow" />
                  )}
                  {item.video && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/40">
                        <Play size={18} className="ml-0.5 fill-white text-white" />
                      </span>
                    </span>
                  )}
                </motion.button>
              ))}
            </motion.div>
          ) : (
            /* 鱼获统计 Tab（演示彩蛋）：横向条形图，scaleX 0→1 stagger */
            <motion.div
              key="stats"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-paper-white px-4 py-5"
            >
              <p className="mb-4 text-[13px] leading-[18px] text-ink-60">累计鱼获 {PROFILE.stats.catches} 尾 · 按鱼种分布</p>
              <div className="flex flex-col gap-4">
                {CATCH_STATS.map((s, i) => (
                  <div key={s.species} className="flex items-center gap-3">
                    <span className="w-10 shrink-0 text-[13px] leading-[18px] text-ink">{s.species}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#2d1e1e0d]">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: s.count / maxCount }}
                        transition={{ delay: i * 0.08, duration: 0.5, ease: 'easeOut' }}
                        style={{ transformOrigin: 'left' }}
                        className="h-full rounded-full bg-olive"
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right font-num text-[20px] leading-6 text-ink">
                      {s.count}
                      <span className="ml-0.5 font-sans text-[12px] leading-4 text-ink-60">尾</span>
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Section 6 — 页脚 */}
      <footer className="pb-8 pt-8 text-center text-[12px] leading-4 text-ink-40">
        趣渔 MVP 演示版 · v0.1.0
      </footer>

      {/* 渔获全屏浏览 */}
      <CatchViewer items={CATCH_WALL} index={viewerIndex} onChange={setViewerIndex} onClose={() => setViewerIndex(null)} />

      {/* 我的兴趣画像弹层 */}
      <AnimatePresence>
        {insightOpen && <ProfileInsightSheet onClose={() => setInsightOpen(false)} />}
      </AnimatePresence>

      {/* 设置 · 编辑资料弹层 */}
      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.button
              type="button" aria-label="关闭设置"
              className="fixed inset-0 z-40 bg-ink/35"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSettingsOpen(false)}
            />
            <motion.div
              role="dialog" aria-label="编辑资料"
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-[20px] bg-paper px-5 pt-3"
              style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 40px)' }}
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
              <header className="mb-4 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-ink">编辑资料</h2>
                <button type="button" aria-label="关闭" onClick={() => setSettingsOpen(false)} className="text-ink-40">
                  <X size={20} />
                </button>
              </header>
              <p className="mb-2 text-[13px] text-ink-60">头像</p>
              <div className="mb-5 flex items-center gap-3">
                {AVATAR_CHOICES.map((a) => (
                  <button
                    key={a} type="button" onClick={() => setEditAvatar(a)}
                    className={`h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 ${editAvatar === a ? 'border-olive' : 'border-transparent'}`}
                  >
                    <img src={a} alt="头像选项" className="h-full w-full object-cover" />
                  </button>
                ))}
                {/* 自定义：从相册/文件导入 */}
                <button
                  type="button" onClick={() => avatarFileRef.current?.click()}
                  className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-full border-2 border-dashed ${editAvatar.startsWith('data:') ? 'border-olive' : 'border-line'} bg-paper-white text-ink-40`}
                >
                  {editAvatar.startsWith('data:') ? (
                    <img src={editAvatar} alt="自定义头像" className="h-full w-full object-cover" />
                  ) : (
                    <>
                      <ImagePlus size={18} />
                      <span className="text-[10px] leading-3">自定义</span>
                    </>
                  )}
                </button>
                <input
                  ref={avatarFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={pickAvatar}
                />
              </div>
              <p className="mb-2 text-[13px] text-ink-60">昵称</p>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={24}
                className="mb-6 h-12 w-full rounded-xl bg-paper-white px-3 text-[15px] text-ink outline-none"
              />
              <button
                type="button"
                disabled={updateMut.isPending || !editName.trim()}
                onClick={() => updateMut.mutate({ name: editName.trim(), avatar: editAvatar.startsWith('data:') ? undefined : editAvatar, avatarData: editAvatar.startsWith('data:') ? editAvatar : undefined })}
                className="flex h-12 w-full items-center justify-center rounded-full bg-olive text-[15px] font-semibold text-paper-white disabled:opacity-60"
              >
                {updateMut.isPending ? <Loader2 size={18} className="animate-spin" /> : '保存'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 帮助中心弹层 */}
      <AnimatePresence>
        {helpOpen && (
          <>
            <motion.button
              type="button" aria-label="关闭帮助"
              className="fixed inset-0 z-40 bg-ink/35"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setHelpOpen(false)}
            />
            <motion.div
              role="dialog" aria-label="帮助中心"
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-[20px] bg-paper px-5 pt-3"
              style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 40px)' }}
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
              <header className="mb-4 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-ink">帮助中心</h2>
                <button type="button" aria-label="关闭" onClick={() => setHelpOpen(false)} className="text-ink-40">
                  <X size={20} />
                </button>
              </header>
              <div className="space-y-4 text-[14px] leading-[22px] text-ink-80">
                <div>
                  <p className="font-semibold text-ink">如何购买钓场票？</p>
                  <p className="text-ink-60">进入钓场详情页 → 选择票型与日期 → 下单后可在「我的票券」查看电子票，到场出示核销码即可。</p>
                </div>
                <div>
                  <p className="font-semibold text-ink">如何发布渔获？</p>
                  <p className="text-ink-60">点击底部中间「+」→ 上传照片、填鱼种重量 → 发布后出现在社区信息流。</p>
                </div>
                <div>
                  <p className="font-semibold text-ink">商品订单在哪里看？</p>
                  <p className="text-ink-60">商城下单成功后会有订单号提示，「我的订单」可查看钓场票订单。</p>
                </div>
                <div>
                  <p className="font-semibold text-ink">联系客服</p>
                  <p className="text-ink-60">工作日 9:00–18:00，邮箱 support@quyu.app</p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 登录引导弹层 */}
      <LoginSheet open={loginOpen} actionText="编辑资料、同步你的渔获和订单" onClose={() => setLoginOpen(false)} />

      <Toast message={toast} />
    </div>
  )
}
