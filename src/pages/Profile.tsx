import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { m, animate, AnimatePresence } from 'framer-motion'
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
  Heart,
  Package,
  Shield,
  Store,
  TriangleAlert,
} from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'
import CatchViewer from '@/components/community/CatchViewer'
import ProfileInsightSheet from '@/components/community/ProfileInsightSheet'
import { PROFILE } from '@/data/community'
import type { CatchItem } from '@/data/community'
import { trpc } from '@/providers/trpc'
import { resetViewerCache } from '@/lib/postCache'
import LoginSheet from '@/components/LoginSheet'
import ProductOrdersSheet from '@/components/shop/ProductOrdersSheet'

const AVATAR_CHOICES = ['/avatar-1.png', '/avatar-2.webp', '/avatar-3.webp', '/avatar-4.webp']

// QY-E-004 内置封面（public/ 现有钓场风景图）
const COVER_CHOICES = ['/pond-qinglong-1.webp', '/pond-yunxi-1.jpg', '/pond-ludao-1.webp']

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

// 仅保留有真实页面的入口（优惠券目标页不存在，已隐藏；我的收藏已恢复 → /favorites；QY-D-002 塘主入驻 → /pond-apply）
const SERVICE_ENTRIES = [
  { key: 'orders', label: '我的订单', icon: Receipt, path: '/tickets' },
  { key: 'favorites', label: '我的收藏', icon: Heart, path: '/favorites' },
  { key: 'pondApply', label: '塘主入驻', icon: Store, path: '/pond-apply' },
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
  const [productOrdersOpen, setProductOrdersOpen] = useState(false)
  const [profile, setProfile] = useState<{ name: string; avatar: string } | null>(null)
  const [editName, setEditName] = useState(PROFILE.name)
  const [editAvatar, setEditAvatar] = useState(PROFILE.avatar)
  const [editBio, setEditBio] = useState('')
  // QY-E-004 封面：保存后本地立即生效的覆盖值 + 编辑态
  const [coverOverride, setCoverOverride] = useState<string | null>(null)
  const [editCover, setEditCover] = useState(PROFILE.cover)
  // QY-E-005 注销账号：确认弹层 + 需输入「注销」二字才能提交
  const [deletionOpen, setDeletionOpen] = useState(false)
  const [deletionConfirmText, setDeletionConfirmText] = useState('')

  // 真实登录状态：auth.me 返回当前用户或 null（loading 中先显示骨架，避免闪烁）
  const utils = trpc.useUtils()
  const queryClient = useQueryClient()
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const meLoading = meQuery.isLoading
  const me = meQuery.data ?? null
  const displayName = profile?.name ?? me?.name ?? PROFILE.name
  const displayAvatar = profile?.avatar ?? me?.avatar ?? PROFILE.avatar

  // 真实概览数据：发帖数 / 获赞 / 票券 / 等级 / 渔获墙 / 鱼种分布（未登录不请求，统计显示 0/空态）
  const overviewQuery = trpc.app.users.overview.useQuery(undefined, { enabled: !!me, staleTime: 60_000 })
  const overview = overviewQuery.data ?? null
  const postCount = overview?.postCount ?? 0
  const totalLikes = overview?.totalLikes ?? 0
  const pendingTickets = overview?.pendingTickets ?? 0
  const levelText = `钓友 LV${overview?.level ?? 1}`
  const bioText = me?.bio ?? overview?.bio ?? '这个钓友很低调，还没有简介'
  // 封面来源（QY-E-004）：本地保存覆盖值 → overview.cover（users.cover）→ 内置默认封面
  const coverSrc = coverOverride ?? overview?.cover ?? PROFILE.cover

  // 渔获墙真实数据 → CatchViewer 需要的 CatchItem 结构
  const wallItems: CatchItem[] = (overview?.wall ?? []).map((w) => ({
    id: String(w.id),
    src: w.image,
    multi: w.images.length > 1,
    video: false,
    likes: 0,
    commentCount: 0,
    caption: '我的渔获',
    time: '',
  }))
  const speciesStats = overview?.speciesStats ?? []

  // 商品订单横条徽章：进行中订单数（pending+paid+shipped，未登录显示 0）
  const productOrdersQuery = trpc.app.products.mine.useQuery(undefined, { enabled: !!me, staleTime: 30_000 })
  const activeProductOrders = (productOrdersQuery.data ?? []).filter(
    (o) => o.status === 'pending' || o.status === 'paid' || o.status === 'shipped',
  ).length

  const logoutMut = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      setProfile(null)
      // 整份清空而不是挑两个 procedure invalidate：缓存键里没有用户 id，
      // 漏掉的那一个就会把上一个账号的数据显示给下一个（见 postCache.resetViewerCache）
      resetViewerCache(queryClient)
      await utils.auth.me.invalidate()
      showToast('已退出登录')
    },
  })

  // QY-E-005 注销状态：deletionRequestedAt 非空表示冷静期中；到期日 = 申请时间 + 7 天
  const deletionRequestedAt = me?.deletionRequestedAt ? new Date(me.deletionRequestedAt) : null
  const deletionDueDate = deletionRequestedAt
    ? new Date(deletionRequestedAt.getTime() + 7 * 24 * 3600 * 1000)
    : null
  const deletionDueText = deletionDueDate
    ? `${deletionDueDate.getMonth() + 1} 月 ${deletionDueDate.getDate()} 日`
    : ''

  const requestDeletionMut = trpc.auth.requestDeletion.useMutation({
    onSuccess: async () => {
      setDeletionOpen(false)
      setDeletionConfirmText('')
      setSettingsOpen(false)
      await utils.auth.me.invalidate()
      showToast('注销申请已提交，7 天冷静期内可随时撤销')
    },
    onError: (e) => showToast(e.message || '操作失败，请稍后再试'),
  })

  const cancelDeletionMut = trpc.auth.cancelDeletion.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate()
      showToast('注销申请已撤销，账号恢复正常')
    },
    onError: (e) => showToast(e.message || '操作失败，请稍后再试'),
  })

  // 编辑资料：真实保存到后端 users 表（未登录先引导登录）
  const updateMut = trpc.app.users.update.useMutation({
    onSuccess: async (u) => {
      // 用后端返回的最新用户数据刷新本地态（自定义头像走 avatarData，vars.avatar 为 undefined）
      setProfile({ name: u.name ?? displayName, avatar: u.avatar ?? displayAvatar })
      setCoverOverride(u.cover ?? null)
      setSettingsOpen(false)
      await utils.auth.me.invalidate()
      await utils.app.users.overview.invalidate()
      showToast('资料已保存')
    },
    onError: (e) => showToast(e.message || '保存失败，请稍后再试'),
  })

  const openSettings = () => {
    if (meLoading) return
    if (!me) { setLoginOpen(true); return }
    setEditName(displayName)
    setEditAvatar(displayAvatar)
    setEditBio(me.bio ?? overview?.bio ?? '')
    setEditCover(coverSrc)
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

  // 封面自定义（QY-E-004）：从相册/文件选择，等比压到最长边 1280、JPEG 0.8 读为 dataURL
  const coverFileRef = useRef<HTMLInputElement>(null)
  const pickCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_EDGE = 1280
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        setEditCover(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const shareProfile = async () => {
    // 分享实际有效内容：真实用户名 + 最新渔获战报 + 直达链接
    const latest = wallItems[0]
    const url = window.location.origin + '/me'
    const title = `${displayName}的趣渔主页`
    const text = [
      `我是「${displayName}」，${levelText}，在趣渔累计渔获 ${postCount} 尾。`,
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

  // 数据行：渔获 = 我的发帖数，获赞 = 帖子累计获赞，粉丝 = 真实关注数（v8.7.0 关注体系）
  const followStatsQuery = trpc.app.users.followStats.useQuery(undefined, { enabled: !!me, staleTime: 60_000 })
  const followers = followStatsQuery.data?.followers ?? 0
  const statsRow = [
    { label: '渔获', value: postCount, onTap: () => setWallTab('grid') },
    { label: '获赞', value: totalLikes, onTap: () => setWallTab('stats') },
    { label: '粉丝', value: followers, onTap: () => navigate('/me/follows') },
  ]
  const maxCount = speciesStats.length ? Math.max(...speciesStats.map((s) => s.count)) : 1

  return (
    <div className="bg-paper pb-8">
      {/* Section 1 — 封面 + 资料卡 */}
      <section className="relative">
        <div className="relative h-[140px] overflow-hidden">
          <m.img
            src={coverSrc}
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
              <m.button
                key={label}
                type="button"
                aria-label={label}
                whileTap={{ scale: 0.92 }}
                onClick={onTap}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/40 text-ink backdrop-blur-sm"
              >
                <Icon size={20} strokeWidth={1.8} />
              </m.button>
            ))}
          </div>
        </div>

        <div className="px-4">
          {meLoading ? (
            <div className="-mt-8 h-[88px] w-[88px] animate-pulse rounded-full border-2 border-paper-white bg-line" />
          ) : (
            <m.img
              src={displayAvatar}
              alt={displayName}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.15 }}
              className="-mt-8 h-[88px] w-[88px] rounded-full border-2 border-paper-white object-cover"
            />
          )}
          <m.div
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } } }}
          >
            <m.div
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
                {levelText}
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
                  onClick={() => setLoginOpen(true)}
                  className="ml-auto flex items-center gap-1 rounded-full bg-olive px-3.5 py-1.5 text-[12px] font-semibold leading-4 text-paper-white active:brightness-95"
                >
                  <LogIn size={13} /> 登录
                </button>
              ))}
            </m.div>
            <m.p
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              className="mt-1 text-[13px] leading-[18px] text-ink-60"
            >
              {bioText}
            </m.p>
            <m.div
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              className="mt-4 flex"
            >
              {statsRow.map((s) => (
                <m.button
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
                </m.button>
              ))}
            </m.div>
          </m.div>
        </div>
      </section>

      {/* Section 1b — 注销冷静期状态条（QY-E-005）：仅冷静期内显示 */}
      {deletionRequestedAt && (
        <m.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="mx-4 mt-4 flex items-center gap-3 rounded-2xl border border-[#e5484d33] bg-[#e5484d0d] px-4 py-3"
        >
          <TriangleAlert size={18} strokeWidth={1.8} className="shrink-0 text-[#e5484d]" />
          <p className="flex-1 text-[13px] leading-[18px] text-ink">
            账号注销中，将于 <span className="font-semibold text-[#e5484d]">{deletionDueText}</span> 永久注销
          </p>
          <button
            type="button"
            disabled={cancelDeletionMut.isPending}
            onClick={() => cancelDeletionMut.mutate()}
            className="shrink-0 rounded-full bg-paper-white px-3 py-1.5 text-[12px] font-semibold leading-4 text-ink active:bg-line disabled:opacity-60"
          >
            撤销注销
          </button>
        </m.section>
      )}

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
                  <m.span
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
      <m.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.25 }}
        className="mx-4 mt-4"
      >
        <m.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/tickets')}
          className="flex w-full items-center gap-3 rounded-2xl bg-paper-white px-4 py-3.5"
        >
          <img src="/icon-ticket.svg" alt="" className="h-6 w-6" />
          <span className="text-[15px] font-semibold leading-[22px] text-ink">我的票券</span>
          <span className="flex items-center gap-1.5 text-[12px] leading-4 text-lake">
            <span className="h-1.5 w-1.5 rounded-full bg-lake" />
            {pendingTickets} 张待使用
          </span>
          <span className="flex-1" />
          <span className="text-[12px] leading-4 text-ink-60">查看全部</span>
          <ChevronRight size={18} strokeWidth={1.8} className="text-ink-40" />
        </m.button>
      </m.section>

      {/* Section 3b — 商品订单横条（打开 ProductOrdersSheet，进行中订单数徽章） */}
      <m.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.27 }}
        className="mx-4 mt-3"
      >
        <m.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => setProductOrdersOpen(true)}
          className="flex w-full items-center gap-3 rounded-2xl bg-paper-white px-4 py-3.5"
        >
          <span className="flex h-6 w-6 items-center justify-center text-olive">
            <Package size={22} strokeWidth={1.8} />
          </span>
          <span className="text-[15px] font-semibold leading-[22px] text-ink">商品订单</span>
          {activeProductOrders > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] leading-4 text-lake">
              <span className="h-1.5 w-1.5 rounded-full bg-lake" />
              {activeProductOrders} 单进行中
            </span>
          )}
          <span className="flex-1" />
          <span className="text-[12px] leading-4 text-ink-60">查看全部</span>
          <ChevronRight size={18} strokeWidth={1.8} className="text-ink-40" />
        </m.button>
      </m.section>

      {/* Section 3c — 内容审核入口（仅全局 admin 或已绑定塘主可见） */}
      {me?.role === 'admin' && (
        <m.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.275 }}
          className="mx-4 mt-3"
        >
          <m.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/moderation')}
            className="flex w-full items-center gap-3 rounded-2xl bg-paper-white px-4 py-3.5"
          >
            <span className="flex h-6 w-6 items-center justify-center text-olive">
              <Shield size={22} strokeWidth={1.8} />
            </span>
            <span className="text-[15px] font-semibold leading-[22px] text-ink">内容审核</span>
            <span className="flex-1" />
            <span className="text-[12px] leading-4 text-ink-60">举报队列</span>
            <ChevronRight size={18} strokeWidth={1.8} className="text-ink-40" />
          </m.button>
        </m.section>
      )}

      <m.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.28 }}
        className="mx-4 mt-3"
      >
        <m.button
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
        </m.button>
      </m.section>

      {/* Section 4 — 服务入口宫格 */}
      <m.section
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.05, delayChildren: 0.3 } } }}
        className="mx-4 mb-6 mt-4 grid grid-cols-4"
      >
        {SERVICE_ENTRIES.map(({ key, label, icon: Icon, path }) => (
          <m.button
            key={key}
            type="button"
            variants={{ hidden: { opacity: 0, scale: 0.8 }, show: { opacity: 1, scale: 1 } }}
            whileTap={{ scale: 0.92 }}
            onClick={() => (path ? navigate(path) : setHelpOpen(true))}
            className="flex flex-col items-center gap-1.5"
          >
            <Icon size={28} strokeWidth={1.8} className="text-ink" />
            <span className="text-[12px] leading-4 text-ink-60">{label}</span>
          </m.button>
        ))}
      </m.section>

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
                  <m.span
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
            <m.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-3 gap-px bg-paper-white"
            >
              {wallItems.length === 0 ? (
                <div className="col-span-3 flex flex-col items-center gap-3 bg-paper-white px-4 py-12">
                  <p className="text-[13px] leading-[18px] text-ink-60">还没有渔获，去发布第一条吧</p>
                  <m.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => navigate('/publish')}
                    className="rounded-full bg-olive px-5 py-2 text-[13px] font-semibold leading-[18px] text-paper-white active:brightness-95"
                  >
                    去发布
                  </m.button>
                </div>
              ) : (
                wallItems.map((item, i) => (
                  <m.button
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
                  </m.button>
                ))
              )}
            </m.div>
          ) : (
            /* 鱼获统计 Tab（演示彩蛋）：横向条形图，scaleX 0→1 stagger */
            <m.div
              key="stats"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-paper-white px-4 py-5"
            >
              <p className="mb-4 text-[13px] leading-[18px] text-ink-60">累计鱼获 {postCount} 尾 · 按鱼种分布</p>
              {speciesStats.length === 0 ? (
                <p className="py-6 text-center text-[13px] leading-[18px] text-ink-60">还没有鱼种数据，发布渔获后自动统计</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {speciesStats.map((s, i) => (
                    <div key={s.species} className="flex items-center gap-3">
                      <span className="w-10 shrink-0 text-[13px] leading-[18px] text-ink">{s.species}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#2d1e1e0d]">
                        <m.div
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
              )}
            </m.div>
          )}
        </AnimatePresence>
      </section>

      {/* Section 6 — 页脚 */}
      <footer className="pb-8 pt-8 text-center text-[12px] leading-4 text-ink-40">
        趣渔 · v8.7.0
      </footer>

      {/* 渔获全屏浏览 */}
      <CatchViewer items={wallItems} index={viewerIndex} onChange={setViewerIndex} onClose={() => setViewerIndex(null)} />

      {/* 商品订单弹层 */}
      <ProductOrdersSheet open={productOrdersOpen} onClose={() => setProductOrdersOpen(false)} />

      {/* 我的兴趣画像弹层 */}
      <AnimatePresence>
        {insightOpen && <ProfileInsightSheet onClose={() => setInsightOpen(false)} />}
      </AnimatePresence>

      {/* 设置 · 编辑资料弹层 */}
      <AnimatePresence>
        {settingsOpen && (
          <>
            <m.button
              type="button" aria-label="关闭设置"
              className="fixed inset-0 z-40 bg-ink/35"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSettingsOpen(false)}
            />
            <m.div
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
              {/* QY-E-004 更换封面：预览 + 内置 3 张 + 相册上传（弹层仅登录后可打开） */}
              <p className="mb-2 text-[13px] text-ink-60">封面</p>
              <div className="mb-5">
                <div className="mb-2 h-20 w-full overflow-hidden rounded-xl border border-line bg-paper-white">
                  <img src={editCover} alt="封面预览" className="h-full w-full object-cover" />
                </div>
                <div className="flex items-center gap-2">
                  {COVER_CHOICES.map((c) => (
                    <button
                      key={c} type="button" onClick={() => setEditCover(c)}
                      className={`h-12 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${editCover === c ? 'border-olive' : 'border-transparent'}`}
                    >
                      <img src={c} alt="内置封面" className="h-full w-full object-cover" />
                    </button>
                  ))}
                  <button
                    type="button" onClick={() => coverFileRef.current?.click()}
                    className={`flex h-12 w-20 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border-2 border-dashed ${editCover.startsWith('data:') ? 'border-olive' : 'border-line'} bg-paper-white text-ink-40`}
                  >
                    {editCover.startsWith('data:') ? (
                      <img src={editCover} alt="自定义封面" className="h-full w-full object-cover" />
                    ) : (
                      <>
                        <ImagePlus size={16} />
                        <span className="text-[10px] leading-3">相册上传</span>
                      </>
                    )}
                  </button>
                  <input
                    ref={coverFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={pickCover}
                  />
                </div>
              </div>
              <p className="mb-2 text-[13px] text-ink-60">昵称</p>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={24}
                className="mb-4 h-12 w-full rounded-xl bg-paper-white px-3 text-[15px] text-ink outline-none"
              />
              <p className="mb-2 text-[13px] text-ink-60">简介</p>
              <textarea
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="一句话介绍自己，最多 200 字"
                className="mb-6 w-full resize-none rounded-xl bg-paper-white px-3 py-3 text-[15px] leading-[22px] text-ink outline-none"
              />
              <button
                type="button"
                disabled={updateMut.isPending || !editName.trim()}
                onClick={() => updateMut.mutate({ name: editName.trim(), avatar: editAvatar.startsWith('data:') ? undefined : editAvatar, avatarData: editAvatar.startsWith('data:') ? editAvatar : undefined, bio: editBio.trim(), cover: editCover.startsWith('data:') ? undefined : editCover, coverData: editCover.startsWith('data:') ? editCover : undefined })}
                className="flex h-12 w-full items-center justify-center rounded-full bg-olive text-[15px] font-semibold text-paper-white disabled:opacity-60"
              >
                {updateMut.isPending ? <Loader2 size={18} className="animate-spin" /> : '保存'}
              </button>
              {/* QY-E-005 注销账号入口：弱化样式（红色小号文字），冷静期内不重复展示 */}
              {!deletionRequestedAt && (
                <button
                  type="button"
                  onClick={() => { setDeletionConfirmText(''); setDeletionOpen(true) }}
                  className="mt-4 w-full text-center text-[12px] leading-4 text-[#e5484d]/80 active:text-[#e5484d]"
                >
                  注销账号
                </button>
              )}
            </m.div>
          </>
        )}
      </AnimatePresence>

      {/* QY-E-005 注销账号确认弹层：说明后果，需输入「注销」二字确认 */}
      <AnimatePresence>
        {deletionOpen && (
          <>
            <m.button
              type="button" aria-label="关闭注销确认"
              className="fixed inset-0 z-[60] bg-ink/35"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDeletionOpen(false)}
            />
            <m.div
              role="dialog" aria-label="注销账号确认"
              className="fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-md rounded-t-[20px] bg-paper px-5 pt-3"
              style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 40px)' }}
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
              <header className="mb-4 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-[#e5484d]">注销账号</h2>
                <button type="button" aria-label="关闭" onClick={() => setDeletionOpen(false)} className="text-ink-40">
                  <X size={20} />
                </button>
              </header>
              <div className="mb-5 space-y-2.5 text-[13px] leading-[19px] text-ink-80">
                <p>注销申请提交后将进入 <span className="font-semibold text-ink">7 天冷静期</span>，期间账号可正常使用，重新登录或点击「撤销注销」即可取消。</p>
                <p>冷静期结束后账号将被永久注销，<span className="font-semibold text-ink">不可恢复</span>：</p>
                <ul className="list-disc space-y-1.5 pl-5 text-ink-60">
                  <li>昵称将显示为「已注销用户」，头像、简介、封面、邮箱等个人资料被清空，无法再登录。</li>
                  <li>你发布的帖子和评论会保留，但作者显示为「已注销用户」。</li>
                  <li>门票与商品订单流水按平台对账要求保留。</li>
                  <li>关注关系和钓场收藏将被删除。</li>
                </ul>
              </div>
              <p className="mb-2 text-[13px] text-ink-60">请输入「注销」以确认操作</p>
              <input
                value={deletionConfirmText}
                onChange={(e) => setDeletionConfirmText(e.target.value)}
                maxLength={8}
                placeholder="注销"
                className="mb-4 h-12 w-full rounded-xl bg-paper-white px-3 text-[15px] text-ink outline-none"
              />
              <button
                type="button"
                disabled={requestDeletionMut.isPending || deletionConfirmText.trim() !== '注销'}
                onClick={() => requestDeletionMut.mutate()}
                className="flex h-12 w-full items-center justify-center rounded-full bg-[#e5484d] text-[15px] font-semibold text-paper-white disabled:opacity-40"
              >
                {requestDeletionMut.isPending ? <Loader2 size={18} className="animate-spin" /> : '确认注销'}
              </button>
              <button
                type="button"
                onClick={() => setDeletionOpen(false)}
                className="mt-3 w-full text-center text-[13px] leading-[18px] text-ink-60"
              >
                再想想
              </button>
            </m.div>
          </>
        )}
      </AnimatePresence>

      {/* 帮助中心弹层 */}
      <AnimatePresence>
        {helpOpen && (
          <>
            <m.button
              type="button" aria-label="关闭帮助"
              className="fixed inset-0 z-40 bg-ink/35"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setHelpOpen(false)}
            />
            <m.div
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
            </m.div>
          </>
        )}
      </AnimatePresence>

      {/* 登录引导弹层 */}
      <LoginSheet open={loginOpen} actionText="编辑资料、同步你的渔获和订单" onClose={() => setLoginOpen(false)} />

      <Toast message={toast} />
    </div>
  )
}
