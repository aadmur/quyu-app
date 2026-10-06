import { useCallback, useRef, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Flag, Loader2, MapPin, Phone } from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { relativeTime } from '@/lib/live'

/** 从 tRPC 错误中取服务端错误码（网络层失败时无 code） */
function errCode(e: unknown): string | undefined {
  return (e as { data?: { code?: string } } | null)?.data?.code
}

/** 审核队列条目（与 api/services/moderation.ts ReportQueueItem 对齐；路由接线后由 tRPC 类型接管） */
interface QueueItem {
  id: number
  postId: number
  reason: string
  createdAt: string | Date
  reporterId: number
  reporterName: string | null
  post: {
    content: string
    authorName: string
    cover: string | null
    pondSlug: string | null
  }
  /** 0 = 整帖举报；非 0 = 评论举报（v14） */
  commentId: number
  /** 评论举报时的目标评论内容与作者；整帖举报为 null */
  comment: { id: number; content: string; authorName: string } | null
}

/** 入驻申请条目（与 api/services/pondApplication.ts ApplicationQueueItem 对齐） */
interface ApplicationItem {
  id: number
  userId: number
  applicantName: string | null
  pondName: string
  region: string
  address: string
  contactPhone: string
  ticketDesc: string
  photos: string[]
  note: string | null
  status: string
  createdAt: string | Date
}

/**
 * 入驻申请审批面板（QY-D-002，仅全局 admin 可见/可用；塘主不展示此 Tab）：
 * pending 列表全字段 + 照片墙；通过 = 自动建塘 + 认领码 + 通知；拒绝 = 必填备注 + 通知。
 * 服务端 CAS 幂等，重复操作返回当前状态并刷新列表。
 */
function ApplicationsPanel({
  showToast,
}: {
  showToast: (text: string) => void
}) {
  const utils = trpc.useUtils()
  const listQuery = trpc.app.pondApply.list.useQuery(undefined, { retry: false })
  const reviewMut = trpc.app.pondApply.review.useMutation()
  // 拒绝备注：按申请 id 展开的输入框
  const [rejectingId, setRejectingId] = useState<number | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  const items = (listQuery.data ?? []) as ApplicationItem[]

  const review = useCallback(
    (applicationId: number, action: 'approve' | 'reject', reviewNote?: string) => {
      reviewMut.mutate(
        { applicationId, action, reviewNote },
        {
          onSuccess: (r) => {
            if (r.already) {
              showToast('该申请已被审批')
            } else if (action === 'approve') {
              showToast(`已通过，认领码 ${r.claimCode ?? ''}`)
            } else {
              showToast('已拒绝并通知申请人')
            }
            setRejectingId(null)
            setRejectNote('')
            utils.app.pondApply.list.invalidate()
          },
          onError: (e) => {
            showToast(e.message || '操作失败，请稍后再试')
            utils.app.pondApply.list.invalidate()
          },
        },
      )
    },
    [reviewMut, utils, showToast],
  )

  if (listQuery.isLoading) {
    return (
      <div className="mx-4 mt-2 space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="animate-pulse rounded-2xl bg-paper-white p-4">
            <div className="h-4 w-1/2 rounded bg-line" />
            <div className="mt-2 h-3 w-2/3 rounded bg-line" />
          </div>
        ))}
      </div>
    )
  }

  if (listQuery.error) {
    return <p className="mx-4 mt-8 text-center text-[13px] leading-[18px] text-ink-40">加载失败，请稍后重试</p>
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-8 pt-20 text-center">
        <img src="/empty-creel.svg" alt="暂无待审申请" className="h-24 w-auto opacity-80" />
        <p className="text-[15px] font-semibold text-ink">暂无待审核的入驻申请</p>
        <p className="text-[13px] leading-[18px] text-ink-60">新的塘主入驻申请会出现在这里</p>
      </div>
    )
  }

  return (
    <ul className="mx-4 mt-2 space-y-3">
      {items.map((a) => (
        <m.li
          key={a.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="rounded-2xl bg-paper-white p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-semibold leading-[22px] text-ink">{a.pondName}</p>
            <span className="text-[12px] leading-4 text-ink-40">{relativeTime(a.createdAt)}</span>
          </div>
          <p className="mt-1 text-[12px] leading-4 text-ink-60">
            {a.applicantName ?? `用户 #${a.userId}`} 申请 · {a.region}
          </p>

          {/* 全字段明细 */}
          <div className="mt-3 space-y-1.5 rounded-xl bg-paper px-3 py-2.5 text-[12px] leading-[18px] text-ink-60">
            <p><span className="text-ink-40">详细地址：</span>{a.address}</p>
            <p className="flex items-center gap-1">
              <Phone size={11} strokeWidth={2} className="text-ink-40" />
              <span className="font-num">{a.contactPhone}</span>
            </p>
            <p><span className="text-ink-40">票种意向：</span>{a.ticketDesc}</p>
            {a.note && <p><span className="text-ink-40">补充说明：</span>{a.note}</p>}
          </div>

          {/* 照片墙 */}
          {a.photos.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {a.photos.map((src, i) => (
                <img
                  key={`${a.id}-${i}`}
                  src={src}
                  alt={`申请照片 ${i + 1}`}
                  className="h-16 w-16 shrink-0 rounded-xl bg-paper object-cover"
                />
              ))}
            </div>
          )}

          {/* 操作：通过 / 拒绝（拒绝展开备注输入，必填） */}
          {rejectingId === a.id ? (
            <div className="mt-3">
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value.slice(0, 255))}
                rows={2}
                placeholder="请填写拒绝原因（必填，将通知申请人）"
                className="w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-40"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setRejectingId(null); setRejectNote('') }}
                  className="h-9 flex-1 rounded-full border border-line text-[13px] font-semibold text-ink-60 active:brightness-95"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!rejectNote.trim() || reviewMut.isPending}
                  onClick={() => review(a.id, 'reject', rejectNote.trim())}
                  className="flex h-9 flex-1 items-center justify-center rounded-full bg-heart text-[13px] font-semibold text-paper-white active:brightness-95 disabled:opacity-40"
                >
                  {reviewMut.isPending ? <Loader2 size={15} className="animate-spin" /> : '确认拒绝'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => { setRejectingId(a.id); setRejectNote('') }}
                disabled={reviewMut.isPending}
                className="h-9 flex-1 rounded-full border border-line text-[13px] font-semibold text-ink-60 active:brightness-95 disabled:opacity-40"
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={() => review(a.id, 'approve')}
                disabled={reviewMut.isPending}
                className="flex h-9 flex-1 items-center justify-center rounded-full bg-olive text-[13px] font-semibold text-paper-white active:brightness-95 disabled:opacity-40"
              >
                {reviewMut.isPending ? <Loader2 size={15} className="animate-spin" /> : '通过并建塘'}
              </button>
            </div>
          )}
        </m.li>
      ))}
    </ul>
  )
}

/**
 * 审核队列页 /moderation（QY-SAFE-001）：
 * 全局 admin 看全站 pending 举报；绑定塘主只看自己钓场的举报；普通用户 403 空态。
 * 每条可「忽略」或「下架帖子」，处理成功后 invalidate 刷新队列。
 * QY-D-002：admin 额外可见「入驻申请」Tab（塘主不可见）。
 */
export default function Moderation() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState<'reports' | 'applications'>('reports')
  const toastTimer = useRef<number | undefined>(undefined)

  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const isAdmin = meQuery.data?.role === 'admin'

  const listQuery = trpc.app.moderation.list.useQuery(undefined, { retry: false })
  const handleMut = trpc.app.moderation.handle.useMutation()

  const showToast = useCallback((text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2200)
  }, [])

  // 403：非审核员（非 admin 且未绑定钓场）
  const forbidden = !!listQuery.error && errCode(listQuery.error) === 'FORBIDDEN'
  const items = (listQuery.data ?? []) as QueueItem[]

  /**
   * 处理举报：忽略 / 下架目标；CONFLICT = 已被他人处理，如实提示后刷新。
   * `isComment` 只决定文案——服务端按 reports.comment_id 自行判定下架对象是评论还是整帖，
   * 前端不传目标类型，避免被篡改成"用评论举报的额度删掉别人的帖子"。
   */
  const handle = useCallback(
    (reportId: number, action: 'ignore' | 'delete', isComment: boolean) => {
      handleMut.mutate(
        { reportId, action },
        {
          onSuccess: () => {
            showToast(
              action === 'delete'
                ? isComment
                  ? '评论已下架，所属帖子保留'
                  : '帖子已下架'
                : '已忽略该举报',
            )
            utils.app.moderation.list.invalidate()
          },
          onError: (e) => {
            showToast(e.message || '操作失败，请稍后再试')
            utils.app.moderation.list.invalidate()
          },
        },
      )
    },
    [handleMut, utils, showToast],
  )

  return (
    <div className="min-h-dvh bg-paper" style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 8px)' }}>
      {/* 顶栏（与塘主工作台同款二级页头部） */}
      <m.header
        className="sticky top-0 z-20 flex h-12 items-center justify-between bg-paper px-2"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <button
          type="button"
          aria-label="返回"
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center text-ink"
        >
          <ChevronLeft size={24} strokeWidth={1.8} />
        </button>
        <h1 className="text-[18px] font-semibold leading-6 text-ink">审核队列</h1>
        <span className="h-10 w-10" aria-hidden="true" />
      </m.header>

      {/* Tab 切换（QY-D-002）：入驻申请仅全局 admin 可见，塘主只见举报队列 */}
      {isAdmin && (
        <div className="mx-4 mt-1 flex h-10 rounded-full bg-[#2d1e1e0d] p-[3px]">
          {(
            [
              { key: 'reports', label: '举报队列' },
              { key: 'applications', label: '入驻申请' },
            ] as const
          ).map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="relative flex flex-1 items-center justify-center"
              >
                {active && (
                  <m.span
                    layoutId="moderation-tab"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    className="absolute inset-0 rounded-full border border-line bg-paper-white"
                  />
                )}
                <span className={`relative text-[13px] leading-[18px] ${active ? 'font-semibold text-ink' : 'text-ink-60'}`}>
                  {t.label}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {isAdmin && tab === 'applications' ? (
        <ApplicationsPanel showToast={showToast} />
      ) : (
        <>
          {/* 加载态骨架 */}
          {listQuery.isLoading && (
            <div className="mx-4 mt-2 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="animate-pulse rounded-2xl bg-paper-white p-4">
                  <div className="flex gap-3">
                    <div className="h-16 w-16 rounded-xl bg-line" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3.5 w-2/3 rounded bg-line" />
                      <div className="h-3 w-1/2 rounded bg-line" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 无权限（403） */}
          {forbidden && (
            <div className="mx-4 mt-4 rounded-2xl border border-dashed border-olive bg-olive-tint p-6 text-center">
              <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-paper-white text-olive">
                <Flag size={22} strokeWidth={1.8} />
              </span>
              <p className="text-[14px] font-semibold leading-5 text-ink">仅限审核员访问</p>
              <p className="mt-1 text-[12px] leading-[18px] text-ink-60">
                审核队列面向全局管理员与已绑定钓场的塘主开放
              </p>
            </div>
          )}

          {/* 其他加载错误 */}
          {listQuery.error && !forbidden && (
            <p className="mx-4 mt-8 text-center text-[13px] leading-[18px] text-ink-40">加载失败，请稍后重试</p>
          )}

          {/* 空队列 */}
          {!listQuery.isLoading && !listQuery.error && items.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-8 pt-20 text-center">
              <img src="/empty-creel.svg" alt="队列已清空" className="h-24 w-auto opacity-80" />
              <p className="text-[15px] font-semibold text-ink">暂无待处理举报</p>
              <p className="text-[13px] leading-[18px] text-ink-60">新的举报会实时出现在这里</p>
            </div>
          )}

          {/* 举报卡片列表 */}
          <ul className="mx-4 mt-2 space-y-3">
            {items.map((r) => (
              <m.li
                key={r.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="rounded-2xl bg-paper-white p-4"
              >
                <div className="flex gap-3">
                  {/* 帖子首图 */}
                  {r.post.cover ? (
                    <img
                      src={r.post.cover}
                      alt="被举报帖子首图"
                      className="h-16 w-16 shrink-0 rounded-xl bg-paper object-cover"
                    />
                  ) : (
                    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-paper text-ink-40">
                      <Flag size={20} strokeWidth={1.8} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[14px] leading-[20px] text-ink">{r.post.content}</p>
                    <p className="mt-1 text-[12px] leading-4 text-ink-60">
                      {r.post.authorName}
                      {r.post.pondSlug && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-olive">
                          <MapPin size={11} strokeWidth={2} />
                          {r.post.pondSlug}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/*
                  评论举报上下文（v14）：被举报的具体评论引在帖子之下。
                  审核员需要看到原话才能判断，光看"有人举报这条帖子"无法处置。
                */}
                {r.comment && (
                  <div className="mt-3 rounded-xl border-l-2 border-heart/40 bg-paper px-3 py-2">
                    <p className="text-[11px] leading-4 text-ink-40">
                      被举报评论 · {r.comment.authorName || `用户 #${r.comment.id}`}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-[19px] text-ink">
                      {r.comment.content}
                    </p>
                  </div>
                )}

                {/* 举报信息行 */}
                <div className="mt-3 flex items-center justify-between rounded-xl bg-paper px-3 py-2">
                  <span className="text-[12px] leading-4 text-ink-60">
                    {r.reporterName ?? `用户 #${r.reporterId}`} 举报 · {relativeTime(r.createdAt)}
                  </span>
                  <span className="rounded-full bg-heart/10 px-2.5 py-0.5 text-[11px] font-medium leading-4 text-heart">
                    {r.reason}
                  </span>
                </div>

                {/* 操作 */}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handle(r.id, 'ignore', !!r.comment)}
                    disabled={handleMut.isPending}
                    className="h-9 flex-1 rounded-full border border-line text-[13px] font-semibold text-ink-60 active:brightness-95 disabled:opacity-40"
                  >
                    忽略
                  </button>
                  <button
                    type="button"
                    onClick={() => handle(r.id, 'delete', !!r.comment)}
                    disabled={handleMut.isPending}
                    className="flex h-9 flex-1 items-center justify-center rounded-full bg-heart text-[13px] font-semibold text-paper-white active:brightness-95 disabled:opacity-40"
                  >
                    {handleMut.isPending ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : r.comment ? (
                      '下架评论'
                    ) : (
                      '下架帖子'
                    )}
                  </button>
                </div>
              </m.li>
            ))}
          </ul>
        </>
      )}

      {/* Toast（与 Owner 页同款） */}
      <AnimatePresence>
        {toast && (
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-24 z-[70] mx-auto w-fit max-w-[320px] rounded-full bg-ink px-4 py-2 text-center text-[13px] leading-[18px] text-paper"
          >
            {toast}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
