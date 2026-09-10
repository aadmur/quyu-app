import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { m } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { CheckCheck, MessageCircle, Store, TicketCheck } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../api/router'
import PageHeader from '@/components/trade/PageHeader'
import FishIcon from '@/components/FishIcon'
import { trpc } from '@/providers/trpc'
import { relativeTime } from '@/lib/live'

/** 后端 notify.list 返回的通知项（从 AppRouter 推导，与 lib/live.ts 同约定） */
type NotifyItem = inferRouterOutputs<AppRouter>['app']['notify']['list'][number]

/** 类型图标与配色：like=鱼形赞（赭红），comment=评论（湖绿），verify=核销（橄榄） */
interface TypeIconProps {
  size?: number
  className?: string
}
const CommentIcon = (p: TypeIconProps) => <MessageCircle size={p.size} strokeWidth={1.8} className={p.className} />
const VerifyIcon = (p: TypeIconProps) => <TicketCheck size={p.size} strokeWidth={1.8} className={p.className} />
const ApplyIcon = (p: TypeIconProps) => <Store size={p.size} strokeWidth={1.8} className={p.className} />

const TYPE_META: Record<NotifyItem['type'], { icon: (p: TypeIconProps) => ReactNode; box: string }> = {
  like: { icon: (p) => <FishIcon size={p.size} className={p.className} />, box: 'bg-[#b3502e14] text-heart' },
  comment: { icon: CommentIcon, box: 'bg-lake-tint text-lake' },
  verify: { icon: VerifyIcon, box: 'bg-olive-tint text-olive' },
  apply: { icon: ApplyIcon, box: 'bg-olive-tint text-olive' }, // QY-D-002 入驻申请结果
}

/** 通知主文案：like/comment 为动作描述，verify 展示 preview 原文，apply 固定标题 + preview 明细 */
function notifyText(n: NotifyItem): string {
  const actor = n.actorName ?? '趣渔'
  if (n.type === 'like') return `${actor} 赞了你的帖子`
  if (n.type === 'comment') return `${actor} 评论了你的帖子`
  if (n.type === 'apply') return '塘主入驻申请结果通知'
  return n.preview ?? '你的票券核销状态有更新'
}

function NotifyRow({ item, index }: { item: NotifyItem; index: number }) {
  const navigate = useNavigate()
  const meta = TYPE_META[item.type] ?? TYPE_META.comment
  const Icon = meta.icon
  const showPreview = item.type !== 'verify' && !!item.preview

  const onTap = () => {
    if (item.type === 'verify') navigate('/tickets')
    else if (item.type === 'apply') navigate('/owner') // QY-D-002：审批通过后去塘主看板输入认领码
    else if (item.refId != null) navigate(`/post/${item.refId}`)
  }

  return (
    <m.button
      type="button"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.04 * index, ease: 'easeOut' }}
      onClick={onTap}
      className="flex w-full items-start gap-2.5 border-b border-line bg-paper-white px-4 py-3.5 text-left"
    >
      {/* 未读橄榄色圆点（已读占位保持对齐） */}
      <span
        className={`mt-[22px] h-1.5 w-1.5 shrink-0 rounded-full ${item.isRead ? 'bg-transparent' : 'bg-olive'}`}
        aria-hidden="true"
      />
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${meta.box}`}>
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-[22px] text-ink">
          <span className="font-semibold">{notifyText(item)}</span>
        </span>
        {showPreview && (
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-[18px] text-ink-60">{item.preview}</span>
        )}
        <span className="mt-1 block text-[12px] leading-4 text-ink-40">{relativeTime(item.createdAt)}</span>
      </span>
    </m.button>
  )
}

/** 消息 /notifications（二级页）：notify.list 通知流 + 全部已读（进入 2s 后自动标记，也可手动点） */
export default function Notifications() {
  const utils = trpc.useUtils()
  const listQuery = trpc.app.notify.list.useQuery(undefined, { retry: 1 })
  const unreadQuery = trpc.app.notify.unreadCount.useQuery(undefined, { retry: 1 })

  const items = listQuery.data ?? []
  const unread = unreadQuery.data?.count ?? 0

  const markAllMut = trpc.app.notify.markAllRead.useMutation({
    // 乐观更新：本地全部置为已读 + 未读数清零，随后失效拉新
    onMutate: async () => {
      await utils.app.notify.list.cancel()
      await utils.app.notify.unreadCount.cancel()
      const prevList = utils.app.notify.list.getData(undefined)
      const prevCount = utils.app.notify.unreadCount.getData(undefined)
      utils.app.notify.list.setData(undefined, (old) => old?.map((n) => ({ ...n, isRead: true })))
      utils.app.notify.unreadCount.setData(undefined, { count: 0 })
      return { prevList, prevCount }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList) utils.app.notify.list.setData(undefined, ctx.prevList)
      if (ctx?.prevCount) utils.app.notify.unreadCount.setData(undefined, ctx.prevCount)
    },
    onSettled: () => {
      void utils.app.notify.list.invalidate()
      void utils.app.notify.unreadCount.invalidate()
    },
  })

  // 进入页面 2 秒后自动全部已读（有未读才调；仅触发一次）
  const autoReadFired = useRef(false)
  const hasUnread = items.some((n) => !n.isRead) || unread > 0
  useEffect(() => {
    if (autoReadFired.current || !listQuery.data) return
    autoReadFired.current = true
    const t = window.setTimeout(() => {
      if (hasUnread) markAllMut.mutate()
    }, 2000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery.data])

  return (
    <div className="min-h-full bg-paper pb-8">
      <PageHeader title="消息" />

      {/* 工具行：未读数 + 全部已读 */}
      <div className="flex h-11 items-center justify-between px-4">
        <p className="text-[13px] leading-[18px] text-ink-60">
          {unread > 0 ? `${unread} 条未读` : '没有未读消息'}
        </p>
        <button
          type="button"
          disabled={!hasUnread || markAllMut.isPending}
          onClick={() => markAllMut.mutate()}
          className="flex items-center gap-1 text-[13px] font-semibold leading-[18px] text-olive disabled:text-ink-40"
        >
          <CheckCheck size={15} strokeWidth={1.8} />
          全部已读
        </button>
      </div>

      {listQuery.isLoading ? (
        /* 加载骨架 */
        <div>
          {[0, 1, 2, 3].map((i) => (
            <div key={`sk-${i}`} className="flex animate-pulse items-start gap-3 border-b border-line bg-paper-white px-4 py-3.5">
              <div className="h-10 w-10 shrink-0 rounded-full bg-paper" />
              <div className="flex-1 space-y-2 pt-0.5">
                <div className="h-3.5 w-40 rounded bg-paper" />
                <div className="h-3 w-full rounded bg-paper" />
                <div className="h-2.5 w-16 rounded bg-paper" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        /* 空态 */
        <m.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="flex flex-col items-center px-8 pb-16 pt-14"
        >
          <img src="/empty-creel.svg" alt="" className="h-40 w-[200px]" />
          <p className="mt-4 text-[15px] leading-[22px] text-ink-60">暂无消息</p>
        </m.div>
      ) : (
        <div>
          {items.map((item, i) => (
            <NotifyRow key={item.id} item={item} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
