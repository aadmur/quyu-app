import { useEffect, useMemo, useRef, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, MessageCircle, Send, Bookmark, MapPin, ChevronRight, Link2 } from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import type { FeedPost as FeedPostData } from '@/data/home'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/hooks/useAuthGate'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { useTopComment } from '@/lib/commentPreview'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'

interface FeedPostProps {
  /** 真实数据帖子会带 postId（后端数值 id），用于点赞/评论/曝光埋点与打开弹层 */
  post: FeedPostData & { postId?: number }
  index: number
  /**
   * 打开帖子弹层（整卡可点）。focusComment=true 时弹层内直接聚焦评论输入框 ——
   * 这是原 CommentSheet 的替代路径：v14 删掉了 CommentSheet，看帖/评论全局只剩
   * 一种形态（它原本平铺展示、完全忽略 parentId，与详情页的两层楼中楼是
   * 「同一份数据两种形态」）。
   */
  onOpen: (focusComment?: boolean) => void
}

function formatNum(n: number) {
  return n.toLocaleString('en-US')
}

/**
 * 降级态（接口异常 → 用 src/data/home.ts 的演示数据填屏）下点开卡片的提示。
 * 措辞跟 usePostInteractions 里的两条保持一致：先说什么数据、再说不支持什么，
 * 不用「操作失败」这种把用户往错误处理里带的说法。
 */
const DEMO_OPEN_HINT = '当前为演示数据，这条帖子没有详情'

/**
 * 信息流帖子卡片（v14）
 *
 * 三处行为变化：
 * - **整卡可点**打开帖子弹层（不再路由跳转，Home 不卸载，分页/滚动/tab/点赞态都保得住）；
 * - **取消双击点赞**：卡片要响应单击导航，双击就得让位（保留双击会让每次单击白等
 *   300ms）。点赞走下方鱼图标按钮；帖子弹层/详情页内仍然保留双击点赞；
 * - **只显示首图**：feed 载荷瘦身后列表项不再有 images 数组，只有 cover；
 *   原来的多图横滑因此移除，全量图片在打开弹层时由 posts.detail 提供。
 *
 * 整卡可点也保留键盘通路：卡片本身 tabIndex=0，Enter/Space 等价于点击。演示数据卡（接口
 * 降级时填屏的本地 mock，没有 postId）不进 tab 序，但点击/回车会收到一句「当前为演示数据，
 * 这条帖子没有详情」—— 静默不响和骗一个假详情都不是可接受的答复。卡片内所有局部控件
 * （点赞/评论/分享/收藏/菜单/钓点条/展开全文）都通过 stopPropagation 拦住冒泡，不会误开弹层。
 */
export default function FeedPost({ post, index, onOpen }: FeedPostProps) {
  const navigate = useNavigate()
  const postId = post.postId
  const trackMut = trpc.app.track.useMutation()
  const articleRef = useRef<HTMLElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { toast, showToast } = useToast()
  const { requireAuth, loginSheet } = useAuthGate()

  /**
   * 点赞 / 收藏。
   *
   * 「点了就亮」这件事依赖一条完整的链路，这里只在起点上写一下（v14 回归的教训）：
   * 卡片显示的 liked/likes/collected 来自 post，而 post 是 Home 在**每次渲染时从
   * react-query 缓存现算出来的**（pages/Home.tsx 的 toCards）；本组件把新值写进同一份
   * 缓存（hooks/usePostInteractions.ts → lib/postCache.ts）→ 订阅者收到通知 → Home 重渲染
   * → 这张卡拿到新的 post。列表卡片与帖子弹层因此确实读同一条缓存，改一处两处同时变。
   *
   * 迭代前这里曾有 useState(liked/likeCount/collected) 的本地乐观态 —— 视觉有效但骗人
   * （刷新即丢、别的卡片/弹层不同步），v14 把它删了却没把「卡片改读缓存」这一半补上，
   * 于是变成点了没反应。现在不需要、也不应该把本地态加回来。
   */
  const { toggleLike, likePending, toggleFavorite, favPending } = usePostInteractions({
    postId: postId ?? null,
    liked: !!post.liked,
    likeCount: post.likes,
    collected: !!post.collected,
    requireAuth,
    onToast: showToast,
  })

  // 首条评论预览：真实帖走 commentPreview 旁路（用户打开过这条帖才有），
  // 演示帖用本地数据 —— 迭代前真实帖这里永远是空的。
  const preview = useTopComment(postId)
  const topComment = preview ?? post.comments[0]

  // 帖子链接：详情页路由 /post/<id>（演示帖子无 id，退化为当前地址）
  const postUrl = postId != null ? `${window.location.origin}/post/${postId}` : window.location.href

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

  const tags = useMemo(() => post.caption.split(/(\s+)/g), [post.caption])

  /** 卡片内所有局部控件（点赞/评论/分享/收藏/菜单/钓点条/展开全文）都要挡住整卡点击 */
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  /** 整卡点击 / 键盘 Enter：演示帖没有后端 id，没有 posts.detail 可请，弹层开不出来。
   *  不能像 v14 那样静默 return —— 用户看到的是一排「点了没反应」的卡。
   *  也不给伪造：演示数据就是打不开详情，实话说明。 */
  const openPost = () => {
    if (postId == null) {
      showToast(DEMO_OPEN_HINT)
      return
    }
    onOpen(false)
  }

  /** 「评论」入口：走同一个弹层，因此演示帖同样只给提示（focusComment=true 让弹层直接聚焦输入框） */
  const openComments = () => {
    if (postId == null) {
      showToast(DEMO_OPEN_HINT)
      return
    }
    onOpen(true)
  }

  return (
    <m.article
      ref={articleRef}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, ease: 'easeOut', delay: Math.min(index, 3) * 0.08 }}
      onClick={openPost}
      tabIndex={postId != null ? 0 : -1}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        /**
         * 键盘事件从焦点元素往上冒泡，所以焦点在卡内按钮上时这里也会触发：
         * 不判 target 就会「Enter 打开弹层 + preventDefault 取消按钮自身激活」，
         * 点赞/收藏/分享/更多全部键盘不可用。只有焦点落在卡片本身时才当作整卡激活。
         */
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        openPost()
      }}
      className={`border-b border-line bg-paper-white ${postId != null ? 'cursor-pointer active:bg-paper' : ''}`}
    >
      {/* 1. 帖子头 */}
      <div className="flex h-12 items-center gap-2.5 px-3">
        <img
          src={post.avatar}
          alt={post.author}
          loading={index > 1 ? 'lazy' : undefined}
          className="h-10 w-10 rounded-full bg-paper object-cover"
        />
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
        <div className="relative" onClick={stop}>
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
                <m.div
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
                </m.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 2. 封面（通栏 1:1，只有首图；点开帖子才有全量图与放大浏览） */}
      {post.cover && (
        <div className="relative select-none">
          <m.img
            src={post.cover}
            alt={`${post.author} 的渔获`}
            initial={{ scale: 1.06 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="aspect-square w-full bg-paper object-cover"
            draggable={false}
            loading={index > 1 ? 'lazy' : undefined}
            decoding="async"
          />
        </div>
      )}

      {/* 3. 操作栏 */}
      <div className="flex h-11 items-center gap-4 px-3" onClick={stop}>
        <m.button
          type="button"
          aria-label={post.liked ? '取消点赞' : '点赞'}
          onClick={toggleLike}
          disabled={likePending}
          animate={{ scale: post.liked ? [1, 1.25, 1] : 1 }}
          transition={{ duration: 0.3 }}
          className={post.liked ? 'text-heart' : 'text-ink disabled:opacity-40'}
        >
          <FishIcon active={!!post.liked} size={24} />
        </m.button>
        <button
          type="button"
          aria-label="评论"
          onClick={openComments}
          className="flex items-center gap-1.5 text-ink"
        >
          <MessageCircle size={24} strokeWidth={1.8} />
          {post.commentCount > 0 && <span className="font-num text-[13px]">{post.commentCount}</span>}
        </button>
        <button type="button" aria-label="分享" onClick={sharePost} className="text-ink">
          <Send size={24} strokeWidth={1.8} />
        </button>
        <m.button
          type="button"
          aria-label={post.collected ? '取消收藏' : '收藏'}
          className={`ml-auto ${post.collected ? 'text-olive' : 'text-ink'} disabled:opacity-40`}
          disabled={favPending}
          animate={{ scale: post.collected ? [1, 1.2, 1] : 1 }}
          transition={{ duration: 0.25 }}
          onClick={toggleFavorite}
        >
          <Bookmark size={24} strokeWidth={1.8} fill={post.collected ? 'currentColor' : 'none'} />
        </m.button>
      </div>

      {/* 4. 点赞数 */}
      <p className="px-3 text-[15px] font-semibold leading-[22px] text-ink">
        <m.span
          key={post.likes}
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="font-num text-[17px]"
        >
          {formatNum(post.likes)}
        </m.span>{' '}
        次点赞
      </p>

      {/* 5. 正文（超 2 行折叠） */}
      <p className={`px-3 pt-0.5 text-[15px] leading-[22px] text-ink ${expanded ? '' : 'line-clamp-2'}`}>
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
          onClick={(e) => {
            stop(e)
            setExpanded(true)
          }}
          className="px-3 text-[15px] leading-[22px] text-ink-60"
        >
          … 更多
        </button>
      )}

      {/* 6. 钓点挂载条 */}
      {post.spot && (
        <div className="px-3 pt-2" onClick={stop}>
          <button
            type="button"
            onClick={(e) => {
              stop(e)
              navigate(`/pond/${post.spot!.id}`)
            }}
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

      {/* 7. 评论入口 + 首条评论预览 */}
      <div onClick={stop}>
        <button
          type="button"
          onClick={openComments}
          className="block w-full px-3 pt-1.5 text-left text-[13px] leading-[18px] text-ink-60"
        >
          查看全部 {post.commentCount} 条评论
        </button>
        {topComment && (
          <p className="truncate px-3 pt-0.5 text-[13px] leading-[18px] text-ink-60">
            <span className="font-semibold text-ink">{topComment.name}</span> {topComment.text}
          </p>
        )}
      </div>

      {/* 8. 时间 */}
      <p className="px-3 pb-3 pt-1 text-[12px] leading-4 text-ink-40">{post.time}</p>

      {loginSheet}
      <Toast message={toast} />
    </m.article>
  )
}
