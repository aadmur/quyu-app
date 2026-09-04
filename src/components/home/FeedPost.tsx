import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, MessageCircle, Send, Bookmark, MapPin, ChevronRight, Link2 } from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import CommentSheet from '@/components/home/CommentSheet'
import type { FeedPost as FeedPostData } from '@/data/home'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/components/LoginSheet'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'

interface FeedPostProps {
  /** 真实数据帖子会带 postId（后端数值 id），用于点赞/评论/曝光埋点 */
  post: FeedPostData & { postId?: number }
  index: number
  onCollect: () => void
}

function formatNum(n: number) {
  return n.toLocaleString('en-US')
}

/** 信息流帖子（FeedPost）：通栏白底，双击点赞、评论弹层、收藏 toast、钓点挂载条 */
export default function FeedPost({ post, index, onCollect }: FeedPostProps) {
  const navigate = useNavigate()
  const postId = post.postId
  const likeMut = trpc.app.posts.like.useMutation()
  const trackMut = trpc.app.track.useMutation()
  const articleRef = useRef<HTMLElement | null>(null)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(post.likes)
  const [burstKey, setBurstKey] = useState(0)
  const [collected, setCollected] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [imgIndex, setImgIndex] = useState(0)
  const lastTap = useRef(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const { toast, showToast } = useToast()

  // 帖子链接：暂无详情页，真实帖子带 ?post= 参数，演示帖子退化为当前地址
  const postUrl = postId != null ? `${window.location.origin}/?post=${postId}` : window.location.href

  // 帖子曝光埋点：进入视口 50% 即上报 impression（仅真实数据帖子）
  useEffect(() => {
    if (postId == null) return
    const el = articleRef.current
    const root = document.getElementById('app-scroll')
    if (!el) return
    const ob = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return
        trackMut.mutate({ postId, action: 'impression' })
        ob.disconnect()
      },
      { root: root ?? null, threshold: 0.5 },
    )
    ob.observe(el)
    return () => ob.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId])

  /** 点赞：乐观更新 UI，真实帖子同步 posts.like（后端顺带更新画像）；失败回滚并提示 */
  const syncLike = (nextLiked: boolean) => {
    if (postId == null) return
    likeMut.mutate(
      { postId },
      {
        onSuccess: (r) => setLiked(r.liked ?? nextLiked),
        onError: () => {
          setLiked(!nextLiked)
          setLikeCount((c) => Math.max(0, c + (nextLiked ? -1 : 1)))
          showToast('点赞失败，请稍后再试')
        },
      },
    )
  }

  const doLike = () => {
    if (!liked) {
      setLiked(true)
      setLikeCount((c) => c + 1)
      syncLike(true)
    }
    setBurstKey((k) => k + 1)
  }

  const { requireAuth, loginSheet } = useAuthGate()

  const toggleLike = () => {
    if (!liked && !requireAuth('点赞')) return
    const next = !liked
    // 计数更新移出 setLiked updater，避免 updater 内副作用在 StrictMode 下双计
    setLiked(next)
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)))
    syncLike(next)
  }

  /** 更多菜单 · 复制帖子链接 */
  const copyPostLink = async () => {
    setMenuOpen(false)
    try {
      await navigator.clipboard.writeText(postUrl)
      showToast('链接已复制')
    } catch {
      showToast('复制失败，请稍后再试')
    }
  }

  /** 分享：优先系统分享；不可用或失败时复制链接兜底（用户取消则不兜底） */
  const sharePost = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `趣渔 · ${post.author} 的渔获`, text: post.caption, url: postUrl })
        return
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(postUrl)
      showToast('链接已复制')
    } catch {
      showToast('分享失败，请稍后再试')
    }
  }

  /** 双击（双点）点赞：300ms 内两次点按触发 */
  const onImageTap = () => {
    const now = Date.now()
    if (now - lastTap.current < 300) doLike()
    lastTap.current = now
  }

  const topComment = post.comments[0]
  const tags = useMemo(() => post.caption.split(/(\s+)/g), [post.caption])

  return (
    <motion.article
      ref={articleRef}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, ease: 'easeOut', delay: Math.min(index, 3) * 0.08 }}
      className="border-b border-line bg-paper-white"
    >
      {/* 1. 帖子头 */}
      <div className="flex h-12 items-center gap-2.5 px-3">
        <img src={post.avatar} alt={post.author} className="h-10 w-10 rounded-full bg-paper object-cover" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-[22px] text-ink">
            {post.author}
            {post.official && (
              <span className="rounded-full bg-lake-tint px-2 py-0.5 text-[11px] font-normal leading-4 text-lake">
                官方
              </span>
            )}
          </p>
          <p className="truncate text-[13px] leading-[18px] text-ink-60">
            {post.time}
            {post.location ? ` · ${post.location}` : ''}
          </p>
        </div>
        <div className="relative">
          <button type="button" aria-label="更多" onClick={() => setMenuOpen((v) => !v)} className="text-ink">
            <MoreHorizontal size={24} strokeWidth={1.8} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="关闭菜单"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="absolute right-0 top-8 z-40 w-32 overflow-hidden rounded-xl border border-line bg-paper-white shadow-[0_8px_24px_rgba(45,30,30,0.12)]"
                >
                  <button
                    type="button"
                    onClick={copyPostLink}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] leading-[18px] text-ink active:bg-olive-tint"
                  >
                    <Link2 size={16} strokeWidth={1.8} className="text-ink-60" />
                    复制链接
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 2. 主图（通栏 1:1，双击点赞；多图横滑 + 圆点） */}
      <div className="relative select-none" onClick={onImageTap}>
        <div
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
          onScroll={(e) => {
            const el = e.currentTarget
            setImgIndex(Math.round(el.scrollLeft / el.clientWidth))
          }}
        >
          {post.images.map((src, i) => (
            <motion.img
              key={src}
              src={src}
              alt={`${post.author} 的渔获 ${i + 1}`}
              initial={{ scale: 1.06 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="aspect-square w-full shrink-0 snap-center bg-paper object-cover"
              draggable={false}
              loading={index > 1 ? 'lazy' : undefined}
            />
          ))}
        </div>

        {/* 双击爆出实心鱼 */}
        <AnimatePresence>
          {burstKey > 0 && (
            <motion.div
              key={burstKey}
              className="pointer-events-none absolute inset-0 flex items-center justify-center text-heart"
              initial={{ opacity: 1, scale: 0, rotate: -12 }}
              animate={{ opacity: [1, 1, 0], scale: [0, 1.3, 1], rotate: [-12, 0, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, times: [0, 0.6, 1], ease: 'easeOut' }}
            >
              <FishIcon active size={96} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* 多图圆点指示 */}
        {post.images.length > 1 && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {post.images.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === imgIndex ? 'bg-olive' : 'bg-ink-40/30'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* 3. 操作栏 */}
      <div className="flex h-11 items-center gap-4 px-3">
        <motion.button
          type="button"
          aria-label="点赞"
          onClick={toggleLike}
          animate={liked ? { scale: [1, 1.25, 1] } : { scale: 1 }}
          transition={{ duration: 0.3 }}
          className={liked ? 'text-heart' : 'text-ink'}
        >
          <FishIcon active={liked} size={24} />
        </motion.button>
        <button type="button" aria-label="评论" onClick={() => setShowComments(true)} className="text-ink">
          <MessageCircle size={24} strokeWidth={1.8} />
        </button>
        <button type="button" aria-label="分享" onClick={sharePost} className="text-ink">
          <Send size={24} strokeWidth={1.8} />
        </button>
        <motion.button
          type="button"
          aria-label="收藏"
          className={`ml-auto ${collected ? 'text-olive' : 'text-ink'}`}
          animate={collected ? { scale: [1, 1.2, 1] } : { scale: 1 }}
          transition={{ duration: 0.25 }}
          onClick={() => {
            if (!collected) {
              setCollected(true)
              onCollect()
            } else {
              setCollected(false)
            }
          }}
        >
          <Bookmark size={24} strokeWidth={1.8} fill={collected ? 'currentColor' : 'none'} />
        </motion.button>
      </div>

      {/* 4. 点赞数 */}
      <p className="px-3 text-[15px] font-semibold leading-[22px] text-ink">
        <motion.span
          key={likeCount}
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="font-num text-[17px]"
        >
          {formatNum(likeCount)}
        </motion.span>{' '}
        次点赞
      </p>

      {/* 5. 正文（超 2 行折叠） */}
      <p
        className={`px-3 pt-0.5 text-[15px] leading-[22px] text-ink ${expanded ? '' : 'line-clamp-2'}`}
      >
        <span className="font-semibold">{post.author} </span>
        {tags.map((t, i) =>
          t.startsWith('#') ? (
            <span key={i} className="text-olive">
              {t}
            </span>
          ) : (
            <span key={i}>{t}</span>
          ),
        )}
      </p>
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="px-3 text-[15px] leading-[22px] text-ink-60"
        >
          … 更多
        </button>
      )}

      {/* 6. 钓点挂载条 */}
      {post.spot && (
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(`/pond/${post.spot!.id}`)}
            className="flex w-full items-center gap-1.5 rounded-full bg-olive-tint px-3 py-2 text-left"
          >
            <MapPin size={16} strokeWidth={1.8} className="shrink-0 text-olive" />
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-olive">
              {post.spot.name} · <span className="font-num text-[14px]">¥{post.spot.price}</span> 起
            </span>
            <ChevronRight size={16} strokeWidth={1.8} className="shrink-0 text-olive" />
          </button>
        </div>
      )}

      {/* 7. 评论预览 */}
      <button
        type="button"
        onClick={() => setShowComments(true)}
        className="block w-full px-3 pt-1.5 text-left text-[13px] leading-[18px] text-ink-60"
      >
        查看全部 {post.commentCount} 条评论
      </button>
      {topComment && (
        <p className="truncate px-3 pt-0.5 text-[13px] leading-[18px] text-ink-60">
          <span className="font-semibold text-ink">{topComment.name}</span> {topComment.text}
        </p>
      )}

      {/* 8. 时间 */}
      <p className="px-3 pb-3 pt-1 text-[12px] leading-4 text-ink-40">{post.time}</p>

      <AnimatePresence>
        {showComments && (
          <CommentSheet
            comments={post.comments}
            total={post.commentCount}
            postId={postId}
            onClose={() => setShowComments(false)}
          />
        )}
      </AnimatePresence>

      {loginSheet}
      <Toast message={toast} />
    </motion.article>
  )
}
