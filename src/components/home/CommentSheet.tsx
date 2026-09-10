import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { FeedComment } from '@/data/home'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/components/LoginSheet'
import { mapComment } from '@/lib/live'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'

interface CommentSheetProps {
  comments: FeedComment[]
  total: number
  /** 真实帖子 id：传入后评论走 posts.comments / posts.comment，失败回退本地演示 */
  postId?: number
  onClose: () => void
}

/** 评论弹层：底部升起占屏 70%，spring damping 26；评论 stagger 入场；输入框吸底 */
export default function CommentSheet({ comments, total, postId, onClose }: CommentSheetProps) {
  const [draft, setDraft] = useState('')
  const [list, setList] = useState<FeedComment[]>(comments)

  const live = postId != null
  const commentsQuery = trpc.app.posts.comments.useQuery(
    { postId: postId ?? 0 },
    { enabled: live, retry: 1 },
  )
  const commentMut = trpc.app.posts.comment.useMutation()
  const utils = trpc.useUtils()
  const { toast, showToast } = useToast()

  // 真实评论到达后替换占位列表
  useEffect(() => {
    if (commentsQuery.data) setList(commentsQuery.data.map(mapComment))
  }, [commentsQuery.data])

  const { requireAuth, loginSheet } = useAuthGate()

  const send = () => {
    const text = draft.trim()
    if (!text) return
    if (!requireAuth('发表评论')) return
    setList((prev) => [
      ...prev,
      { id: `me-${Date.now()}`, name: '我', avatar: '/avatar-8.png', text, likes: 0, time: '刚刚' },
    ])
    setDraft('')
    if (live) {
      commentMut.mutate(
        { postId, content: text, authorName: '我' },
        {
          onSuccess: () => {
            // 刷新评论列表与信息流中的帖子评论计数
            utils.app.posts.comments.invalidate({ postId })
            utils.app.feed.invalidate()
          },
          onError: (e) => showToast(e.message || '评论发送失败'),
        },
      )
    }
  }

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[70dvh] max-w-[420px] flex-col rounded-t-[20px] bg-paper-white shadow-[0_8px_24px_rgba(45,30,30,0.12)]"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose()
        }}
      >
        <div className="flex h-12 shrink-0 items-center justify-center border-b border-line">
          <span className="text-[15px] font-semibold leading-[22px]">全部 {total} 条评论</span>
          <button type="button" aria-label="关闭评论" onClick={onClose} className="absolute right-3 text-ink-60">
            <X size={22} strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {live && commentsQuery.isLoading &&
            [0, 1, 2].map((i) => (
              <div key={`sk-${i}`} className="flex animate-pulse gap-3 py-2.5">
                <div className="h-9 w-9 shrink-0 rounded-full bg-paper" />
                <div className="flex-1 space-y-1.5 pt-1">
                  <div className="h-2.5 w-28 rounded bg-paper" />
                  <div className="h-3 w-full rounded bg-paper" />
                </div>
              </div>
            ))}
          {list.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.04 * i, ease: 'easeOut' }}
              className="flex gap-3 py-2.5"
            >
              <img src={c.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-[18px] text-ink-60">
                  {c.name} · {c.time}
                </p>
                <p className="mt-0.5 text-[15px] leading-[22px] text-ink">{c.text}</p>
              </div>
              <span className="shrink-0 self-start pt-1 font-num text-[13px] leading-4 text-ink-40">
                {c.likes > 0 ? `${c.likes} 赞` : ''}
              </span>
            </motion.div>
          ))}
        </div>

        <div
          className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2"
          style={{ paddingBottom: 'max(var(--safe-bottom), 8px)' }}
        >
          <img src="/avatar-8.png" alt="" className="h-8 w-8 rounded-full object-cover" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="说点好听的…"
            className="h-10 flex-1 rounded-full bg-paper px-4 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-40"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            className={`text-[14px] font-semibold transition-colors ${draft.trim() ? 'text-olive' : 'text-ink-40'}`}
          >
            发送
          </button>
        </div>
      </motion.div>

      {loginSheet}
      <Toast message={toast} />
    </>
  )
}
