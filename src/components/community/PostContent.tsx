import { useEffect, useMemo, useRef, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Bookmark,
  ChevronRight,
  Flag,
  Loader2,
  MapPin,
  MessageCircle,
  Pencil,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import CatchViewer from '@/components/community/CatchViewer'
import CommentSection from '@/components/community/CommentSection'
import EditPostSheet from '@/components/community/EditPostSheet'
import PostShareSheet from '@/components/community/PostShareSheet'
import ShareCardSheet from '@/components/community/ShareCardSheet'
import ReportSheet from '@/components/community/ReportSheet'
import Toast from '@/components/community/Toast'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/hooks/useAuthGate'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { useToast } from '@/components/community/useToast'
import { mapCardToPostView, mapPostDetail } from '@/lib/live'
import type { PostView } from '@/lib/live'
import { patchFeedPost, patchPostDetail, removeFeedPost } from '@/lib/postCache'
import type { FeedPost } from '@/data/home'
import type { CatchItem } from '@/data/community'

/** 正文超过这个长度就先折叠（迭代前详情页是 whitespace-pre-wrap 全量铺开，长文把评论挤出屏） */
const BODY_CLAMP_LEN = 88

/**
 * 单击判定容差（px）：横向位移超过它就不算单击。
 * snap 横滑容器在手势收尾时，部分浏览器/WebView 会补发一次 click，
 * 不设这道闸就会在用户只是翻了张图之后 300ms 误开全屏大图。
 */
const SWIPE_SLOP_PX = 10

interface PostContentProps {
  postId: number
  /**
   * 列表卡片已知字段（作者/头像/时间/正文/封面/点赞数/点赞态/收藏态）。
   * v14 之后 app.feed 不再透传全量 images，弹层必须另请 posts.detail；
   * 传入 seed 让弹层在详情到达前先把这些字段渲染出来，避免开一层白屏。
   */
  seed?: FeedPost
  /** page = /post/:id 路由页；sheet = 首页帖子弹层。只差外壳吸法与返回动作 */
  variant: 'page' | 'sheet'
  /** 列表页点「评论」按钮打开弹层：直接聚焦输入框并弹起键盘 */
  autoFocusInput?: boolean
  /** 返回/关闭：路由页是 navigate(-1)，弹层交给外壳做退场 + history.back() */
  onBack: () => void
}

/**
 * 帖子渲染主体（v14 抽公用）
 *
 * 用户明确要求：帖子弹层与 /post/:id 路由页必须共用同一套渲染组件，不允许两套
 * 帖子渲染逻辑。所以详情请求、点赞/收藏/关注/编辑/删除/举报、图片放大、评论区
 * 全在这里，PostSheet 只负责弹层外壳（手势 + history + 进出场），PostDetail 只
 * 负责把路由参数递进来。
 *
 * 动效约束：本文件（含其静态依赖）只用 m.* 的基础过渡；图片放大用的 CatchViewer
 * 内含 drag="x"，属于 domMax 能力，因此它所在的弹层由 <MotionFeaturesMax> 包裹、
 * 路由页在 App.tsx 里升级为 <LazyMax>（见 scripts/check-motion-boundary.mjs 的三门禁）。
 */
export default function PostContent({ postId, seed, variant, autoFocusInput, onBack }: PostContentProps) {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const { toast, showToast } = useToast()
  const { requireAuth, loginSheet } = useAuthGate()

  const detailQuery = trpc.app.posts.detail.useQuery(
    { id: postId },
    { retry: false, enabled: Number.isFinite(postId) && postId > 0 },
  )

  const view: PostView | null = detailQuery.data
    ? mapPostDetail(detailQuery.data)
    : seed
      ? mapCardToPostView(seed, postId)
      : null

  // 当前登录用户：判定作者本人（编辑/删除入口）与评论删除入口
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const meId = meQuery.data?.id ?? null
  const isAuthor = meId != null && view?.authorId != null && meId === view.authorId

  // 关注状态（QY-COMM-005）：followState 返回 { following, followers }
  const authorId = view?.authorId ?? 0
  const followStateQuery = trpc.app.posts.followState.useQuery(
    { targetUserId: authorId },
    { retry: 1, enabled: authorId > 0 && !isAuthor },
  )
  const [following, setFollowing] = useState(false)
  const [followers, setFollowers] = useState<number | null>(null)
  useEffect(() => {
    const data = followStateQuery.data
    if (data) {
      setFollowing(data.following)
      setFollowers(data.followers)
    }
  }, [followStateQuery.data])

  const followMut = trpc.app.posts.toggleFollow.useMutation()
  const deleteMut = trpc.app.posts.delete.useMutation()
  const editMut = trpc.app.posts.edit.useMutation()
  const trackMut = trpc.app.track.useMutation()
  const reportMut = trpc.app.moderation.report.useMutation()

  const { toggleLike, likePending, toggleFavorite, favPending } = usePostInteractions({
    postId: view?.id ?? null,
    liked: view?.liked ?? false,
    likeCount: view?.likeCount ?? 0,
    collected: view?.collected ?? false,
    requireAuth,
    onToast: showToast,
  })

  const [editOpen, setEditOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [bodyExpanded, setBodyExpanded] = useState(false)
  /** 图片放大浏览：CatchViewer 当前索引，null 表示关闭 */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  /** 横滑当前位置：圆点与右上角页码跟着走 */
  const [imgIndex, setImgIndex] = useState(0)
  /** 点「评论」按钮时自增，通知 CommentSection 聚焦输入框 */
  const [focusSignal, setFocusSignal] = useState(0)
  const [burstKey, setBurstKey] = useState(0)
  const lastTap = useRef(0)
  /** 单击开大图要等双击窗口过去，否则双击点赞会顺带弹出看图 */
  const tapTimer = useRef<number | undefined>(undefined)
  /** 本次手势的起点 x 与「有没有横向滑动过」：见 onImageTap 里的滑动吞点击逻辑 */
  const swipeRef = useRef({ x: 0, moved: false })
  const tracked = useRef(false)

  useEffect(
    () => () => {
      if (tapTimer.current) window.clearTimeout(tapTimer.current)
    },
    [],
  )

  // 详情页浏览埋点（完读）：一次挂载只报一次，seed 先到也会报（帖子 id 已知）
  useEffect(() => {
    if (!view || tracked.current) return
    tracked.current = true
    trackMut.mutate({ postId: view.id, action: 'impression' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id])

  /**
   * 图片区手势：300ms 内两击 = 双击点赞；否则算单击 = 打开放大浏览。
   *
   * 迭代前 PostDetail.tsx 这段顺序写错了：`lastTap.current = now` 写在
   * `now - lastTap.current < 300` 之前，差值恒为 0，于是每次单击都放爆鱼动画，
   * 而且永远进不了「已赞时不重复点赞」的分支。这里先判后写，并补上防双击误开大图。
   * 注意：帖子内保留双击点赞（这里没有导航冲突）；信息流卡片已取消双击，单击零延迟开弹层。
   *
   * 两件事是本轮补的：
   * 1. 横滑收尾时浏览器会补发 click —— 只要本次手势真的横向动过（指针位移超阈值，
   *    或容器真的滚了）就把这次 click 吞掉，不能让它开大图；
   * 2. 大图要开在用户当前看到的那一张（原来固定第 1 张，翻到第 5 图再放大看的还是第 1 图）。
   */
  const onImageTap = () => {
    if (swipeRef.current.moved) {
      // 滑动结束的补发点击：不是用户的单击意图，直接吞掉（下一次 pointerdown 会重置这面旗）
      swipeRef.current.moved = false
      return
    }
    const now = Date.now()
    const isDouble = now - lastTap.current < 300
    lastTap.current = now
    if (isDouble) {
      if (tapTimer.current) {
        window.clearTimeout(tapTimer.current)
        tapTimer.current = undefined
      }
      if (!view?.liked) toggleLike()
      setBurstKey((k) => k + 1)
      return
    }
    if (view && view.images.length > 0) {
      // 夹一下：imgIndex 是横滑时的旧读数，seed→详情切换后图片可能变少，
      // 越界下标会让 CatchViewer 拿到 undefined 项、点了像没反应
      const start = Math.min(imgIndex, view.images.length - 1)
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = undefined
        setViewerIndex(start)
      }, 300)
    }
  }

  /** CatchViewer 需要的条目：把帖子图片列表映射成渔获浏览项，点赞/评论数取帖子当前值 */
  const viewerItems: CatchItem[] = useMemo(() => {
    if (!view) return []
    return view.images.map((src, i) => ({
      id: `${view.id}-${i}`,
      src,
      likes: view.likeCount,
      commentCount: view.commentCount,
      caption: view.content,
      time: view.time,
    }))
  }, [view])


  // 关注/取关（QY-COMM-005）：乐观切换，失败回滚
  const onToggleFollow = () => {
    if (!view || view.authorId == null) return
    if (!requireAuth('关注钓友')) return
    const next = !following
    setFollowing(next)
    setFollowers((n) => Math.max(0, (n ?? 0) + (next ? 1 : -1)))
    followMut.mutate(
      { targetUserId: view.authorId },
      {
        onSuccess: (r) => setFollowing(r.following ?? next),
        onError: () => {
          setFollowing(!next)
          setFollowers((n) => Math.max(0, (n ?? 0) + (next ? -1 : 1)))
          showToast('操作失败，请稍后再试')
        },
      },
    )
  }

  // 删帖（QY-COMM-004）：确认后软删。缓存里直接摘掉这张卡，不再 feed.invalidate() 全量重拉
  const onDeletePost = () => {
    if (!view) return
    if (!window.confirm('确定删除这条帖子吗？删除后不可恢复')) return
    deleteMut.mutate(
      { postId: view.id },
      {
        onSuccess: () => {
          removeFeedPost(utils, view.id)
          void utils.app.users.overview.invalidate()
          showToast('已删除')
          window.setTimeout(onBack, 600)
        },
        onError: () => showToast('删除失败，请稍后再试'),
      },
    )
  }

  // 保存编辑（QY-COMM-004）：仅文案。成功后局部改写两处缓存，不产生任何重新请求
  const onSaveEdit = (content: string) => {
    if (!view) return
    editMut.mutate(
      { postId: view.id, content },
      {
        onSuccess: () => {
          setEditOpen(false)
          patchPostDetail(utils, view.id, (p) => ({ ...p, content }))
          patchFeedPost(utils, view.id, (p) => ({ ...p, content }))
          showToast('已保存')
        },
        onError: () => showToast('保存失败，请稍后再试'),
      },
    )
  }

  // 举报（QY-SAFE-001）：非作者可见，理由预设 + 可选补充在 ReportSheet 里拼装
  const openReport = () => {
    if (!requireAuth('举报帖子')) return
    setReportOpen(true)
  }

  const submitReport = (reason: string) => {
    if (!view) return
    reportMut.mutate(
      { postId: view.id, reason },
      {
        onSuccess: (r) => {
          setReportOpen(false)
          showToast(r?.already ? '你已举报过该帖' : '已举报，我们会尽快处理')
        },
        onError: (e) => showToast(e.message || '举报失败，请稍后再试'),
      },
    )
  }

  // —— 详情未到且无 seed：骨架；详情报错/帖子不存在：空态 ——
  if (!view) {
    if (detailQuery.isError) {
      return (
        <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-8 text-center">
          <img src="/empty-creel.svg" alt="帖子不存在" className="h-24 w-auto opacity-80" />
          <p className="text-[15px] font-semibold text-ink">帖子不存在或已删除</p>
          <p className="text-[13px] leading-[18px] text-ink-60">链接可能已失效，回首页看看大家的渔获吧</p>
          <button
            type="button"
            onClick={() => (variant === 'sheet' ? onBack() : navigate('/'))}
            className="mt-2 h-11 rounded-full bg-olive px-8 text-[14px] font-semibold text-paper-white active:brightness-95"
          >
            {variant === 'sheet' ? '关闭' : '回首页'}
          </button>
        </div>
      )
    }
    return <PostSkeleton />
  }

  const longBody = view.content.length > BODY_CLAMP_LEN

  return (
    <div className={variant === 'sheet' ? 'flex h-full min-h-0 flex-col bg-paper-white' : 'bg-paper-white pb-4'}>
      {/* 顶栏：路由页是返回箭头 + 「帖子」，弹层是 X 关闭；作者本人给编辑/删除，否则给举报 */}
      <header
        className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-center border-b border-line bg-paper-white"
        style={{ paddingTop: 'var(--safe-top, 0px)' }}
      >
        <button
          type="button"
          aria-label={variant === 'sheet' ? '关闭' : '返回'}
          onClick={onBack}
          className="absolute left-2 flex h-10 w-10 items-center justify-center text-ink"
        >
          {variant === 'sheet' ? <X size={22} strokeWidth={1.8} /> : <ArrowLeft size={22} strokeWidth={1.8} />}
        </button>
        <span className="text-[16px] font-semibold text-ink">帖子</span>
        {/* 详情还没到时不亮编辑/删除（此时 authorId 未知，亮出来点了只会误判） */}
        {isAuthor && (
          <div className="absolute right-2 flex items-center">
            <button
              type="button"
              aria-label="编辑帖子"
              onClick={() => setEditOpen(true)}
              className="flex h-10 w-10 items-center justify-center text-ink"
            >
              <Pencil size={20} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="删除帖子"
              onClick={onDeletePost}
              disabled={deleteMut.isPending}
              className="flex h-10 w-10 items-center justify-center text-heart disabled:opacity-40"
            >
              <Trash2 size={20} strokeWidth={1.8} />
            </button>
          </div>
        )}
        {!isAuthor && view.authorId != null && (
          <button
            type="button"
            aria-label="举报帖子"
            onClick={openReport}
            className="absolute right-2 flex h-10 w-10 items-center justify-center text-ink-60"
          >
            <Flag size={19} strokeWidth={1.8} />
          </button>
        )}
      </header>

      {/* 弹层形态：正文与评论在这一层滚动（BottomSheet 的下拉关闭手势要求容器带
          qy-sheet-scroll 类并能在顶部判定）；路由页形态直接铺在页面流里。 */}
      <div className={variant === 'sheet' ? 'qy-sheet-scroll min-h-0 flex-1 overflow-y-auto' : ''}>
        {/* seed 态顶部细进度条：详情在途，避免用户在毫无提示的旧字段下以为已经加载完 */}
        {view.partial && detailQuery.isFetching && (
          <div className="h-0.5 w-full overflow-hidden bg-olive-tint">
            <div className="qy-route-progress h-full w-1/3 bg-olive" />
          </div>
        )}

        {/* 作者行 */}
        <div className="flex h-14 items-center gap-2.5 px-3">
          <img
            src={view.authorAvatar}
            alt={view.authorName}
            loading="lazy"
            className="h-10 w-10 rounded-full bg-paper object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-[22px] text-ink">{view.authorName}</p>
            <p className="text-[13px] leading-[18px] text-ink-60">
              {view.time}
              {followers != null && followers > 0 && (
                <span>
                  {' '}
                  · <span className="font-num">{followers}</span> 粉丝
                </span>
              )}
            </p>
          </div>
          {!isAuthor && view.authorId != null && (
            <m.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={onToggleFollow}
              disabled={followMut.isPending}
              className={`h-8 shrink-0 rounded-full px-4 text-[13px] font-semibold leading-4 disabled:opacity-40 ${
                following ? 'border border-line text-ink-60' : 'bg-olive text-paper-white'
              }`}
            >
              {following ? '已关注' : '关注'}
            </m.button>
          )}
        </div>

        {/* 大图：单击放大浏览，双击点赞。
            除首图外全部 loading="lazy" —— 迭代前详情页图片没有懒加载，
            一条 9 图帖会把 9 张全量图同时拉下来。
            手势闸门（缺陷 7）：onPointerDown 每次新手势把 moved 归零，指针横向位移超阈值、
            或横滑容器真的滚了（触摸滚动手势接管后浏览器不再发 pointermove，只有 scroll）
            都算「滑动过」，随后补发的 click 在 onImageTap 里被吞掉。 */}
        <div
          className="relative select-none"
          onPointerDown={(e) => {
            swipeRef.current = { x: e.clientX, moved: false }
          }}
          onPointerMove={(e) => {
            const g = swipeRef.current
            if (!g.moved && Math.abs(e.clientX - g.x) > SWIPE_SLOP_PX) g.moved = true
          }}
          onClick={onImageTap}
        >
          <div
            className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
            onScroll={(e) => {
              const el = e.currentTarget
              swipeRef.current.moved = true
              setImgIndex(Math.round(el.scrollLeft / el.clientWidth))
            }}
          >
            {(view.images.length > 0 ? view.images : ['/empty-creel.svg']).map((src, i) => (
              <img
                key={`${src}-${i}`}
                src={src}
                alt={`${view.authorName} 的渔获 ${i + 1}`}
                className="aspect-square w-full shrink-0 snap-center bg-paper object-cover"
                draggable={false}
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
              />
            ))}
          </div>
          <AnimatePresence>
            {burstKey > 0 && (
              <m.div
                key={burstKey}
                className="pointer-events-none absolute inset-0 flex items-center justify-center text-heart"
                initial={{ opacity: 1, scale: 0, rotate: -12 }}
                animate={{ opacity: [1, 1, 0], scale: [0, 1.3, 1], rotate: [-12, 0, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, times: [0, 0.6, 1], ease: 'easeOut' }}
              >
                <FishIcon active size={96} />
              </m.div>
            )}
          </AnimatePresence>
          {view.images.length > 1 && (
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
              {view.images.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full ${i === imgIndex ? 'bg-olive' : 'bg-ink-40/30'}`}
                />
              ))}
            </div>
          )}
          {/* 多图角标：提示这是可放大的一组图为而不是一张孤图 */}
          {view.images.length > 1 && (
            <span className="absolute right-2 top-2 rounded-full bg-ink/45 px-2 py-0.5 font-num text-[12px] leading-4 text-paper-white">
              {imgIndex + 1} / {view.images.length}
            </span>
          )}
        </div>

        {/* 操作栏 */}
        <div className="flex h-12 items-center gap-4 px-3">
          <m.button
            type="button"
            aria-label={view.liked ? '取消点赞' : '点赞'}
            onClick={toggleLike}
            disabled={likePending}
            animate={view.liked ? { scale: [1, 1.25, 1] } : { scale: 1 }}
            transition={{ duration: 0.3 }}
            className={view.liked ? 'text-heart' : 'text-ink disabled:opacity-40'}
          >
            <FishIcon active={view.liked} size={26} />
          </m.button>
          {/* 评论数口径（缺陷 5）：这个数是服务端 posts.comment_count，每条评论（含楼内回复）都 +1
              （community.ts:688）；评论区区头的「共 N 条讨论」是另一个口径（只数顶层楼，
              community.ts:411-415）。两个数天生不可能相等，服务端本轮不动，所以前端能做的是把单位说清：
              这里保持「图标 + 光杆数字 = 全部评论数」，区头改口径为「条讨论」，
              并用 aria-label 把「含回复」写明给读屏用户。 */}
          <button
            type="button"
            aria-label={`查看评论，共 ${view.commentCount} 条（含回复）`}
            onClick={() => setFocusSignal((n) => n + 1)}
            className="flex items-center gap-1.5 text-ink"
          >
            <MessageCircle size={24} strokeWidth={1.8} />
            <span className="font-num text-[14px]">{view.commentCount}</span>
          </button>
          <button type="button" aria-label="分享" onClick={() => setShareOpen(true)} className="text-ink">
            <Send size={24} strokeWidth={1.8} />
          </button>
          <m.button
            type="button"
            aria-label={view.collected ? '取消收藏' : '收藏'}
            className={`ml-auto ${view.collected ? 'text-olive' : 'text-ink'} disabled:opacity-40`}
            disabled={favPending}
            animate={view.collected ? { scale: [1, 1.2, 1] } : { scale: 1 }}
            transition={{ duration: 0.25 }}
            onClick={toggleFavorite}
          >
            <Bookmark size={24} strokeWidth={1.8} fill={view.collected ? 'currentColor' : 'none'} />
          </m.button>
        </div>

        {/* 点赞数 */}
        <p className="px-3 text-[15px] font-semibold leading-[22px] text-ink">
          <span className="font-num text-[17px]">{view.likeCount.toLocaleString('en-US')}</span> 次点赞
        </p>

        {/* 完整正文（超长折叠，迭代前是全量铺开） */}
        <p
          className={`whitespace-pre-wrap px-3 pt-1 text-[15px] leading-[24px] text-ink ${
            longBody && !bodyExpanded ? 'line-clamp-4' : ''
          }`}
        >
          <span className="font-semibold">{view.authorName} </span>
          {view.content}
        </p>
        {longBody && (
          <button
            type="button"
            onClick={() => setBodyExpanded((v) => !v)}
            className="px-3 text-[13px] leading-[18px] text-ink-60 active:text-olive"
          >
            {bodyExpanded ? '收起' : '全文'}
          </button>
        )}

        {/* 鱼种 / 重量 / 定位 chips */}
        {(view.fishSpecies || view.weightJin || view.locationText || view.latitude != null) && (
          <div className="flex flex-wrap gap-2 px-3 pt-2">
            {view.fishSpecies && (
              <span className="rounded-full bg-lake-tint px-3 py-1 text-[12px] leading-4 text-lake">
                {view.fishSpecies}
              </span>
            )}
            {view.weightJin != null && (
              <span className="rounded-full bg-lake-tint px-3 py-1 text-[12px] leading-4 text-lake">
                <span className="font-num">{view.weightJin}</span> 斤
              </span>
            )}
            {(view.locationText || (view.latitude != null && view.longitude != null)) && (
              <span className="flex items-center gap-1 rounded-full bg-olive-tint px-3 py-1 text-[12px] leading-4 text-olive">
                <MapPin size={12} strokeWidth={2} />
                <span>
                  {view.locationText ?? `${view.latitude!.toFixed(4)}°N, ${view.longitude!.toFixed(4)}°E`}
                </span>
              </span>
            )}
          </div>
        )}

        {/* 钓场挂载条 */}
        {view.pondSlug && (
          <div className="px-3 pt-3">
            <button
              type="button"
              onClick={() => navigate(`/pond/${view.pondSlug}`)}
              className="flex w-full items-center gap-1.5 rounded-full bg-olive-tint px-3 py-2.5 text-left"
            >
              <MapPin size={16} strokeWidth={1.8} className="shrink-0 text-olive" />
              <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-olive">查看相关钓场</span>
              <ChevronRight size={16} strokeWidth={1.8} className="shrink-0 text-olive" />
            </button>
          </div>
        )}

        {/* 评论区（含吸底输入条） */}
        <CommentSection
          postId={view.id}
          meId={meId}
          variant={variant}
          autoFocusInput={autoFocusInput}
          focusSignal={focusSignal}
          requireAuth={requireAuth}
          onToast={showToast}
        />
      </div>

      {/* 图片放大浏览：黑底全屏 + drag="x" 左右滑 + 页码指示（v14 接入，此前只有「我的」渔获墙在用） */}
      <CatchViewer
        items={viewerItems}
        index={viewerIndex}
        onChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
        author={{ name: view.authorName, avatar: view.authorAvatar }}
        liked={view.liked}
        likePending={likePending}
        onLike={toggleLike}
      />

      {/* 编辑帖子弹层（QY-COMM-004） */}
      <AnimatePresence>
        {editOpen && (
          <EditPostSheet
            initialContent={view.content}
            pending={editMut.isPending}
            onClose={() => setEditOpen(false)}
            onSave={onSaveEdit}
          />
        )}
      </AnimatePresence>

      {/* 分享面板 + 渔获分享卡片预览层（QY-COMM-009） */}
      <PostShareSheet
        open={shareOpen}
        post={{ id: view.id, authorName: view.authorName, content: view.content }}
        onClose={() => setShareOpen(false)}
        onAction={showToast}
        onMakeCard={() => setCardOpen(true)}
      />
      <ShareCardSheet open={cardOpen} postId={view.id} onClose={() => setCardOpen(false)} onAction={showToast} />

      {/* 举报帖子（QY-SAFE-001）：评论级举报在 CommentSection 里复用同一个面板 */}
      <ReportSheet
        open={reportOpen}
        subject="帖子"
        pending={reportMut.isPending}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
      />


      {loginSheet}
      <Toast message={toast} />
    </div>
  )
}

/** 帖子详情骨架：无 seed 可用时的兜底（深链冷启动 / 直接进 /post/:id） */
function PostSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <div className="flex h-12 items-center justify-center border-b border-line">
        <span className="sr-only">帖子加载中</span>
        <div className="h-5 w-16 rounded bg-line" />
      </div>
      <div className="flex items-center gap-2.5 p-3">
        <div className="h-10 w-10 rounded-full bg-line" />
        <div className="h-4 w-24 rounded bg-line" />
      </div>
      <div className="aspect-square w-full bg-paper" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-3/4 rounded bg-line" />
        <div className="h-4 w-1/2 rounded bg-line" />
      </div>
      <div className="flex items-center gap-3 px-3 pt-2 text-olive">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-[13px] leading-[18px]">正在加载帖子…</span>
      </div>
    </div>
  )
}
