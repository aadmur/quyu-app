import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { m, AnimatePresence } from 'framer-motion'
import { ArrowLeft, MessageCircle, Send, MapPin, ChevronRight, Loader2, Pencil, Trash2, X, Flag } from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/components/LoginSheet'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'
import EditPostSheet from '@/components/community/EditPostSheet'
import PostShareSheet from '@/components/community/PostShareSheet'
import ShareCardSheet from '@/components/community/ShareCardSheet'
import { mapComment, relativeTime } from '@/lib/live'
import type { FeedComment } from '@/data/home'

/** 评论节点：展示模型 + parentId（QY-COMM-006 楼中楼，最多两层） */
type CommentNode = FeedComment & { parentId: number | null }

/** 举报理由预设（QY-SAFE-001） */
const REPORT_REASONS = ['广告营销', '虚假信息', '违规内容', '其他'] as const

/** 帖子详情页：分享链接落地页。大图 + 完整正文 + 钓场挂载 + 点赞/分享 + 评论区（内联） */
export default function PostDetail() {
  const { id } = useParams<{ id: string }>()
  const postId = Number(id)
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const utils = trpc.useUtils()
  const { requireAuth, loginSheet } = useAuthGate()

  const detailQuery = trpc.app.posts.detail.useQuery(
    { id: Number.isFinite(postId) ? postId : 0 },
    { retry: false, enabled: Number.isFinite(postId) && postId > 0 },
  )
  const post = detailQuery.data

  const commentsQuery = trpc.app.posts.comments.useQuery(
    { postId: Number.isFinite(postId) ? postId : 0 },
    { retry: 1, enabled: !!post },
  )
  // 全部评论（含 parentId）由前端组装两层楼中楼
  const comments: CommentNode[] = useMemo(
    () =>
      commentsQuery.data
        ? commentsQuery.data.map((c) => ({ ...mapComment(c), parentId: c.parentId != null ? Number(c.parentId) : null }))
        : [],
    [commentsQuery.data],
  )
  const commentTree = useMemo(() => {
    const top = comments.filter((c) => c.parentId == null)
    const replies = new Map<number, CommentNode[]>()
    for (const c of comments) {
      if (c.parentId == null) continue
      const list = replies.get(c.parentId) ?? []
      list.push(c)
      replies.set(c.parentId, list)
    }
    // 回复按时间正序展示（列表整体倒序，楼内对话正序更自然）
    for (const list of replies.values()) list.reverse()
    return { top, replies }
  }, [comments])

  // 当前登录用户：判定作者本人（编辑/删除入口）与是否展示关注按钮
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const meId = meQuery.data?.id ?? null
  const isAuthor = meId != null && post?.authorId != null && meId === Number(post.authorId)

  // 关注状态（QY-COMM-005）：followState 返回 { following, followers }
  const authorId = post?.authorId != null ? Number(post.authorId) : 0
  const followStateQuery = trpc.app.posts.followState.useQuery(
    { targetUserId: authorId },
    { retry: 1, enabled: authorId > 0 && !isAuthor },
  )
  const followMut = trpc.app.posts.toggleFollow.useMutation()
  const deleteMut = trpc.app.posts.delete.useMutation()
  const editMut = trpc.app.posts.edit.useMutation()
  const likeMut = trpc.app.posts.like.useMutation()
  const commentMut = trpc.app.posts.comment.useMutation()
  const trackMut = trpc.app.track.useMutation()
  // 举报（QY-SAFE-001）：非作者可见，理由预设 + 可选补充
  const reportMut = trpc.app.moderation.report.useMutation()

  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState<number | null>(null)
  const [following, setFollowing] = useState(false)
  const [followers, setFollowers] = useState<number | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0])
  const [reportNote, setReportNote] = useState('')
  const [replyTarget, setReplyTarget] = useState<{ id: number; name: string } | null>(null)
  const [imgIndex, setImgIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [burstKey, setBurstKey] = useState(0)
  const lastTap = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 关注状态服务端到达后同步本地（乐观更新先行）
  useEffect(() => {
    const data = followStateQuery.data as { following: boolean; followers: number } | undefined
    if (data) {
      setFollowing(data.following)
      setFollowers(data.followers)
    }
  }, [followStateQuery.data])

  // 详情页浏览埋点（完读）
  useEffect(() => {
    if (post) trackMut.mutate({ postId: post.id, action: 'impression' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id])

  const displayLikes = likeCount ?? post?.likeCount ?? 0

  const toggleLike = () => {
    if (!post) return
    if (!liked && !requireAuth('点赞')) return
    const next = !liked
    setLiked(next)
    setLikeCount(Math.max(0, displayLikes + (next ? 1 : -1)))
    likeMut.mutate(
      { postId: post.id },
      {
        onSuccess: (r) => setLiked(r.liked ?? next),
        onError: () => {
          setLiked(!next)
          setLikeCount(displayLikes)
          showToast('点赞失败，请稍后再试')
        },
      },
    )
  }

  const onImageTap = () => {
    const now = Date.now()
    if (now - lastTap.current < 300 && !liked) toggleLike()
    lastTap.current = now
    if (now - lastTap.current < 300) setBurstKey((k) => k + 1)
  }

  // 分享（QY-COMM-009）：打开分享面板（系统分享 / 生成分享卡片 / 复制链接）
  const openShare = () => {
    if (!post) return
    setShareOpen(true)
  }

  const sendComment = () => {
    const text = draft.trim()
    if (!text || !post) return
    if (!requireAuth(replyTarget ? '回复评论' : '发表评论')) return
    setDraft('')
    const parentId = replyTarget?.id
    setReplyTarget(null)
    commentMut.mutate(
      { postId: post.id, content: text, authorName: '我', ...(parentId != null ? { parentId } : {}) },
      {
        onSuccess: () => {
          utils.app.posts.comments.invalidate({ postId: post.id })
          utils.app.posts.detail.invalidate({ id: post.id })
          utils.app.feed.invalidate()
        },
        onError: (e) => showToast(e.message || '评论发送失败'),
      },
    )
  }

  // 进入回复模式：输入框占位变为「回复 @昵称：」，提交时携带 parentId（服务端自动归并到顶层楼）
  const startReply = (target: { id: string; name: string }) => {
    if (!requireAuth('回复评论')) return
    setReplyTarget({ id: Number(target.id), name: target.name })
    inputRef.current?.focus()
  }

  // 关注/取关（QY-COMM-005）：乐观切换，失败回滚
  const onToggleFollow = () => {
    if (!post || post.authorId == null) return
    if (!requireAuth('关注钓友')) return
    const next = !following
    setFollowing(next)
    setFollowers((n) => Math.max(0, (n ?? 0) + (next ? 1 : -1)))
    followMut.mutate(
      { targetUserId: Number(post.authorId) },
      {
        onSuccess: (r: { following?: boolean }) => setFollowing(r?.following ?? next),
        onError: () => {
          setFollowing(!next)
          setFollowers((n) => Math.max(0, (n ?? 0) + (next ? -1 : 1)))
          showToast('操作失败，请稍后再试')
        },
      },
    )
  }

  // 删帖（QY-COMM-004）：确认后软删，成功 toast 并返回上一页
  const onDeletePost = () => {
    if (!post) return
    if (!window.confirm('确定删除这条帖子吗？删除后不可恢复')) return
    deleteMut.mutate(
      { postId: post.id },
      {
        onSuccess: () => {
          utils.app.feed.invalidate()
          showToast('已删除')
          window.setTimeout(() => navigate(-1), 600)
        },
        onError: () => showToast('删除失败，请稍后再试'),
      },
    )
  }

  // 保存编辑（QY-COMM-004）：仅文案，成功后刷新详情
  const onSaveEdit = (content: string) => {
    if (!post) return
    editMut.mutate(
      { postId: post.id, content },
      {
        onSuccess: () => {
          setEditOpen(false)
          utils.app.posts.detail.invalidate({ id: post.id })
          utils.app.feed.invalidate()
          showToast('已保存')
        },
        onError: () => showToast('保存失败，请稍后再试'),
      },
    )
  }

  // 打开举报弹层（QY-SAFE-001）：未登录先走登录门槛
  const openReport = () => {
    if (!requireAuth('举报帖子')) return
    setReportReason(REPORT_REASONS[0])
    setReportNote('')
    setReportOpen(true)
  }

  // 提交举报：理由 = 预设项 + 可选补充；重复举报服务端幂等返回 already=true
  const submitReport = () => {
    if (!post) return
    const note = reportNote.trim()
    const reason = note ? `${reportReason}：${note}` : reportReason
    reportMut.mutate(
      { postId: post.id, reason },
      {
        onSuccess: (r: { already?: boolean }) => {
          setReportOpen(false)
          showToast(r?.already ? '你已举报过该帖' : '已举报，我们会尽快处理')
        },
        onError: (e) => showToast(e.message || '举报失败，请稍后再试'),
      },
    )
  }

  // —— 加载态骨架 ——
  if (detailQuery.isLoading) {
    return (
      <div className="animate-pulse">
        <div className="flex h-12 items-center border-b border-line px-3">
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
      </div>
    )
  }

  // —— 404 / 错误态 ——
  if (!post) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-8 text-center">
        <img src="/empty-creel.svg" alt="帖子不存在" className="h-24 w-auto opacity-80" />
        <p className="text-[15px] font-semibold text-ink">帖子不存在或已删除</p>
        <p className="text-[13px] leading-[18px] text-ink-60">链接可能已失效，回首页看看大家的渔获吧</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-2 h-11 rounded-full bg-olive px-8 text-[14px] font-semibold text-paper-white active:brightness-95"
        >
          回首页
        </button>
      </div>
    )
  }

  return (
    <div className="bg-paper-white pb-4">
      {/* 顶栏 */}
      <header
        className="sticky top-0 z-20 flex h-12 items-center justify-center border-b border-line bg-paper-white"
        style={{ paddingTop: 'var(--safe-top, 0px)' }}
      >
        <button
          type="button"
          aria-label="返回"
          onClick={() => navigate(-1)}
          className="absolute left-2 flex h-10 w-10 items-center justify-center text-ink"
        >
          <ArrowLeft size={22} strokeWidth={1.8} />
        </button>
        <span className="text-[16px] font-semibold text-ink">帖子</span>
        {/* 作者本人：编辑 / 删除入口（QY-COMM-004） */}
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
        {/* 非作者：举报入口（QY-SAFE-001），与作者的编辑/删除互斥不冲突 */}
        {!isAuthor && (
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

      {/* 作者行 */}
      <div className="flex h-14 items-center gap-2.5 px-3">
        <img
          src={post.authorAvatar || '/avatar-1.png'}
          alt={post.authorName}
          className="h-10 w-10 rounded-full bg-paper object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-[22px] text-ink">{post.authorName}</p>
          <p className="text-[13px] leading-[18px] text-ink-60">
            {relativeTime(post.createdAt)}
            {followers != null && followers > 0 && (
              <span>
                {' '}· <span className="font-num">{followers}</span> 粉丝
              </span>
            )}
          </p>
        </div>
        {/* 关注按钮（QY-COMM-005）：作者是自己时不显示 */}
        {!isAuthor && post.authorId != null && (
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

      {/* 大图（双击点赞） */}
      <div className="relative select-none" onClick={onImageTap}>
        <div
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
          onScroll={(e) => {
            const el = e.currentTarget
            setImgIndex(Math.round(el.scrollLeft / el.clientWidth))
          }}
        >
          {(post.images.length > 0 ? post.images : ['/empty-creel.svg']).map((src, i) => (
            <img
              key={src + i}
              src={src}
              alt={`${post.authorName} 的渔获 ${i + 1}`}
              className="aspect-square w-full shrink-0 snap-center bg-paper object-cover"
              draggable={false}
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
        {post.images.length > 1 && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {post.images.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === imgIndex ? 'bg-olive' : 'bg-ink-40/30'}`} />
            ))}
          </div>
        )}
      </div>

      {/* 操作栏 */}
      <div className="flex h-12 items-center gap-4 px-3">
        <m.button
          type="button"
          aria-label="点赞"
          onClick={toggleLike}
          animate={liked ? { scale: [1, 1.25, 1] } : { scale: 1 }}
          transition={{ duration: 0.3 }}
          className={liked ? 'text-heart' : 'text-ink'}
        >
          <FishIcon active={liked} size={26} />
        </m.button>
        <button
          type="button"
          aria-label="评论"
          onClick={() => inputRef.current?.focus()}
          className="flex items-center gap-1.5 text-ink"
        >
          <MessageCircle size={24} strokeWidth={1.8} />
          <span className="font-num text-[14px]">{post.commentCount}</span>
        </button>
        <button type="button" aria-label="分享" onClick={openShare} className="text-ink">
          <Send size={24} strokeWidth={1.8} />
        </button>
      </div>

      {/* 点赞数 */}
      <p className="px-3 text-[15px] font-semibold leading-[22px] text-ink">
        <span className="font-num text-[17px]">{displayLikes.toLocaleString('en-US')}</span> 次点赞
      </p>

      {/* 完整正文 */}
      <p className="whitespace-pre-wrap px-3 pt-1 text-[15px] leading-[24px] text-ink">
        <span className="font-semibold">{post.authorName} </span>
        {post.content}
      </p>

      {/* 鱼种 / 重量 / 定位 chips */}
      {(post.fishSpecies || post.weightJin || post.locationText || (post.latitude != null && post.longitude != null)) && (
        <div className="flex flex-wrap gap-2 px-3 pt-2">
          {post.fishSpecies && (
            <span className="rounded-full bg-lake-tint px-3 py-1 text-[12px] leading-4 text-lake">{post.fishSpecies}</span>
          )}
          {post.weightJin && (
            <span className="rounded-full bg-lake-tint px-3 py-1 text-[12px] leading-4 text-lake">
              <span className="font-num">{post.weightJin}</span> 斤
            </span>
          )}
          {(post.locationText || (post.latitude != null && post.longitude != null)) && (
            <span className="flex items-center gap-1 rounded-full bg-olive-tint px-3 py-1 text-[12px] leading-4 text-olive">
              <MapPin size={12} strokeWidth={2} />
              <span>
                {post.locationText ??
                  `${post.latitude!.toFixed(4)}°N, ${post.longitude!.toFixed(4)}°E`}
              </span>
            </span>
          )}
        </div>
      )}

      {/* 钓场挂载条 */}
      {post.pondSlug && (
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => navigate(`/pond/${post.pondSlug}`)}
            className="flex w-full items-center gap-1.5 rounded-full bg-olive-tint px-3 py-2.5 text-left"
          >
            <MapPin size={16} strokeWidth={1.8} className="shrink-0 text-olive" />
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-olive">查看相关钓场</span>
            <ChevronRight size={16} strokeWidth={1.8} className="shrink-0 text-olive" />
          </button>
        </div>
      )}

      {/* 评论区 */}
      <section className="mt-4 border-t border-line px-3 pt-3">
        <h2 className="pb-2 text-[15px] font-semibold leading-[22px] text-ink">
          评论 <span className="font-num">{post.commentCount}</span>
        </h2>
        {commentsQuery.isLoading ? (
          <div className="space-y-3 py-2">
            {[0, 1].map((i) => (
              <div key={i} className="flex animate-pulse gap-2.5">
                <div className="h-9 w-9 rounded-full bg-line" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-24 rounded bg-line" />
                  <div className="h-3.5 w-2/3 rounded bg-line" />
                </div>
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <p className="py-8 text-center text-[13px] leading-[18px] text-ink-40">还没有评论，来抢沙发</p>
        ) : (
          <ul className="space-y-4 py-2">
            {commentTree.top.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <img src={c.avatar} alt={c.name} className="h-9 w-9 shrink-0 rounded-full bg-paper object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-[18px] text-ink-60">
                    <span className="font-semibold text-ink">{c.name}</span> · {c.time}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[22px] text-ink">{c.text}</p>
                  <button
                    type="button"
                    onClick={() => startReply(c)}
                    className="mt-1 text-[12px] leading-4 text-ink-40 active:text-olive"
                  >
                    回复
                  </button>
                  {/* 楼中楼（QY-COMM-006）：顶层评论下挂回复，缩进一层，不再嵌套更深 */}
                  {(commentTree.replies.get(Number(c.id)) ?? []).length > 0 && (
                    <ul className="mt-2 space-y-3 border-l border-line pl-3">
                      {(commentTree.replies.get(Number(c.id)) ?? []).map((r) => (
                        <li key={r.id} className="flex gap-2">
                          <img src={r.avatar} alt={r.name} className="h-7 w-7 shrink-0 rounded-full bg-paper object-cover" />
                          <div className="min-w-0">
                            <p className="text-[12px] leading-4 text-ink-60">
                              <span className="font-semibold text-ink">{r.name}</span> · {r.time}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-[20px] text-ink">{r.text}</p>
                            <button
                              type="button"
                              onClick={() => startReply(r)}
                              className="mt-1 text-[12px] leading-4 text-ink-40 active:text-olive"
                            >
                              回复
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 底部评论输入条 */}
      <div
        className="sticky bottom-0 z-20 border-t border-line bg-paper-white px-3 py-2"
        style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 8px)' }}
      >
        {/* 回复模式提示条：显示「回复 @昵称」，可取消 */}
        {replyTarget && (
          <div className="mb-2 flex items-center justify-between rounded-full bg-paper px-3 py-1.5">
            <span className="min-w-0 truncate text-[12px] leading-4 text-ink-60">
              回复 <span className="font-semibold text-olive">@{replyTarget.name}</span>
            </span>
            <button
              type="button"
              aria-label="取消回复"
              onClick={() => setReplyTarget(null)}
              className="ml-2 shrink-0 text-ink-40"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendComment()}
            placeholder={replyTarget ? `回复 @${replyTarget.name}：` : '说两句…'}
            maxLength={500}
            className="h-10 flex-1 rounded-full bg-paper px-4 text-[14px] text-ink outline-none placeholder:text-ink-40"
          />
          <button
            type="button"
            onClick={sendComment}
            disabled={!draft.trim() || commentMut.isPending}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-olive text-paper-white disabled:opacity-40"
            aria-label="发送评论"
          >
            {commentMut.isPending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} strokeWidth={2} />}
          </button>
        </div>
      </div>

      {/* 编辑帖子弹层（QY-COMM-004） */}
      <AnimatePresence>
        {editOpen && (
          <EditPostSheet
            initialContent={post.content}
            pending={editMut.isPending}
            onClose={() => setEditOpen(false)}
            onSave={onSaveEdit}
          />
        )}
      </AnimatePresence>

      {/* 分享面板 + 渔获分享卡片预览层（QY-COMM-009，对所有帖子可见） */}
      <PostShareSheet
        open={shareOpen}
        post={{ id: post.id, authorName: post.authorName, content: post.content }}
        onClose={() => setShareOpen(false)}
        onAction={showToast}
        onMakeCard={() => setCardOpen(true)}
      />
      <ShareCardSheet
        open={cardOpen}
        postId={post.id}
        onClose={() => setCardOpen(false)}
        onAction={showToast}
      />

      {/* 举报弹层（QY-SAFE-001）：预设理由单选 + 可选补充说明 */}
      <AnimatePresence>
        {reportOpen && (
          <>
            <m.button
              type="button"
              aria-label="关闭举报"
              className="fixed inset-0 z-[60] bg-ink/35"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setReportOpen(false)}
            />
            <m.div
              role="dialog"
              aria-label="举报帖子"
              className="fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-md rounded-t-[20px] bg-paper px-5 pt-3"
              style={{ paddingBottom: 'max(var(--safe-bottom), 24px)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
              <h2 className="text-[17px] font-semibold text-ink">举报帖子</h2>
              <p className="mt-1 text-[12px] leading-[18px] text-ink-60">请选择举报理由，我们会尽快审核处理</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {REPORT_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReportReason(r)}
                    className={`rounded-full px-4 py-1.5 text-[13px] font-medium leading-none ${
                      reportReason === r ? 'bg-olive text-paper-white' : 'bg-paper-white text-ink-60'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <textarea
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                placeholder="补充说明（可选）"
                maxLength={200}
                rows={3}
                className="mt-3 w-full resize-none rounded-xl border border-line bg-paper-white px-3.5 py-2.5 text-[14px] leading-[20px] text-ink outline-none placeholder:text-ink-40 focus:border-olive"
              />
              <button
                type="button"
                onClick={submitReport}
                disabled={reportMut.isPending}
                className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-paper-white active:brightness-110 disabled:opacity-60"
              >
                {reportMut.isPending ? <Loader2 size={17} className="animate-spin" /> : '提交举报'}
              </button>
            </m.div>
          </>
        )}
      </AnimatePresence>

      {loginSheet}
      <Toast message={toast} />
    </div>
  )
}
