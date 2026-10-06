import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Flag, Images, Loader2, Send, Trash2, X } from 'lucide-react'
import FishIcon from '@/components/FishIcon'
import ReportSheet from '@/components/community/ReportSheet'
import { trpc } from '@/providers/trpc'
import { appendReplies, buildCommentTree, patchComment } from '@/lib/commentTree'
import { capturePhoto, pickImages } from '@/lib/native'
import { mapComment } from '@/lib/live'
import type { CommentView, CommentsCursor } from '@/lib/live'
import { patchFeedPost, patchPostDetail } from '@/lib/postCache'
import { setTopComment } from '@/lib/commentPreview'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'

/** 每页顶层评论数（与后端 limit 约定一致） */
const PAGE_SIZE = 20

/**
 * 评论配图张数上限：与后端权威口径 api/services/imageStore.ts 的
 * `IMAGE_SLOT_LIMITS.comments.maxCount` 对齐（评论图定位为「补充说明」，比帖子 9 张收紧到 4 张）。
 * 刻意不 import 服务端常量：imageStore 静态依赖 node:crypto / node:fs，一旦被浏览器包引到 build 直接炸。
 * 超上限有两道服务端兜底：feature-router 的 zod `.max()`（422 前拦）+ ingestImages 的张数校验（BAD_REQUEST）。
 */
const COMMENT_IMAGE_MAX = 4

/**
 * 排序 Tab：key 与后端 posts.comments 的 sort 枚举一一对应，数组顺序 = 下划线指示器的平移顺序。
 * 指示器用 CSS transform + transition 手写（与 Home 信息流 Tab / Favorites Tab 同一手法），
 * **不用 layoutId** —— layoutId 属于 layout 投影能力，会把本组件的依赖链拖进 domMax
 * （见 scripts/check-motion-boundary.mjs 不变量 1）。
 */
const SORT_TABS = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '热门' },
] as const

type CommentSortKey = (typeof SORT_TABS)[number]['key']

/** 单个 Tab 宽度（w-9 = 2.25rem）：指示器按它平移，改一处要同步改 translate 值 */
const SORT_TAB_WIDTH = '2.25rem'

/**
 * 一套排序 = 一条独立的 keyset 流。
 *
 * 后端两套排序的游标不可互换：latest 走 (created_at,id)、hot 走 (like_count,created_at,id)，
 * hot 的 likeCount 阈值是拿游标里的 id 现读锚点行得来的（community.ts:369-395）。
 * 所以「切排序后重置游标和列表」这件事，正确实现方式是**按排序分开存**一条流的列表与两级游标：
 * - 两条流的游标物理隔离，不可能串页；
 * - 切回来时显示那条流自己攒过的东西，不会闪一帧空列表，也不会把自己刚发的评论清空掉。
 */
interface SortStream {
  items: CommentView[]
  /** 已经在请求里的游标（null = 首页） */
  cursor: CommentsCursor | null
  /** 服务端回给下一页的游标：只有点「加载更多评论」才提升为 cursor */
  nextCursor: CommentsCursor | null
  hasMore: boolean
}

const emptyStream = (): SortStream => ({ items: [], cursor: null, nextCursor: null, hasMore: false })
const emptyStreams = (): Record<CommentSortKey, SortStream> => ({ latest: emptyStream(), hot: emptyStream() })

interface CommentSectionProps {
  postId: number
  /** 当前登录用户 id：评论「删除」入口只对作者本人出现 */
  meId: number | null
  /** page = /post/:id 路由页（输入条 sticky 吸底）；sheet = 帖子弹层（输入条是 flex 末块） */
  variant: 'page' | 'sheet'
  /** 列表页点「评论」按钮打开弹层时置为 true：自动聚焦输入框并弹起键盘 */
  autoFocusInput?: boolean
  /** 帖子内点「评论」图标时自增：通知本组件聚焦输入框（输入框在本组件里，父组件拿不到 ref） */
  focusSignal?: number
  requireAuth: (action: string) => boolean
  onToast: (msg: string) => void
}

/**
 * 评论区：两层楼中楼 + 游标分页 + 热门/最新切换 + 评论点赞/回复/删除/举报 + 评论配图。
 *
 * 由 PostContent 持有，因此帖子弹层与 /post/:id 路由页共用同一套评论渲染 ——
 * 迭代前这里是两套形态（详情页两层树 + CommentSheet 平铺且完全忽略 parentId），
 * v14 删掉了 CommentSheet，全局只剩这一种。
 *
 * 缓存策略：所有变更（发评论/点赞/删除）都直接改写本地列表与帖子计数，
 * 不做 `feed.invalidate()` 那种整键失效 —— 用户退回首页时不该把所有分页重拉一遍。
 *
 * 动效约束：本文件（含排序 Tab 下划线、配图预览）只用 CSS transition，不引 framer-motion，
 * 更不碰 layoutId —— 后端 hot 排序（community.ts:366-399）本轮才刚被前端接上，
 * 别为了一颗下划线把 domMax 能力带进弹层依赖链（scripts/check-motion-boundary.mjs 会拦）。
 */
export default function CommentSection({
  postId,
  meId,
  variant,
  autoFocusInput,
  focusSignal = 0,
  requireAuth,
  onToast,
}: CommentSectionProps) {
  const utils = trpc.useUtils()
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** 键盘遮挡高度：路由页把吸底输入条抬高同样距离（弹层由外壳整体收缩，这里不用） */
  const inset = useKeyboardInset()

  const [sort, setSort] = useState<CommentSortKey>('latest')
  /** 两种排序各一条流（游标与列表都按排序隔离，见 SortStream 注释） */
  const [streams, setStreams] = useState<Record<CommentSortKey, SortStream>>(emptyStreams)
  /** 区头计数：服务端 total = COUNT(*) WHERE parent_id IS NULL，只数顶层楼，与帖子的 commentCount 不同口径 */
  const [total, setTotal] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  /** 待发评论配图（压缩后的 dataURL）：随 posts.comment 的 images 上行，服务端机审后落盘换成 URL */
  const [pending, setPending] = useState<{ key: string; src: string }[]>([])
  /** 原生相册/相机调用在途：pickImages 在部分机型上可能几十秒不返回，期间不许重复调起 */
  const [picking, setPicking] = useState(false)
  /** 待发图的 React key 自增序号：只在事件回调里取用，不进渲染路径（渲染期取值会被 react-hooks/purity 拦） */
  const pendingSeq = useRef(0)
  const [replyTarget, setReplyTarget] = useState<{ id: number; name: string } | null>(null)
  const [reportTarget, setReportTarget] = useState<CommentView | null>(null)
  /** 正在请求中的评论点赞 id：只禁用被点的那一颗，不让整排按钮变灰 */
  const [likeBusy, setLikeBusy] = useState<number | null>(null)

  /** 当前排序那条流：列表、游标、hasMore 全部从这里读 */
  const stream = streams[sort]

  const commentsQuery = trpc.app.posts.comments.useQuery(
    { postId, sort, limit: PAGE_SIZE, ...(stream.cursor ? { cursor: stream.cursor } : {}) },
    { retry: 1 },
  )
  const commentMut = trpc.app.posts.comment.useMutation()
  const likeMut = trpc.app.posts.toggleCommentLike.useMutation()
  const deleteMut = trpc.app.posts.deleteComment.useMutation()
  const reportMut = trpc.app.moderation.report.useMutation()

  /** 只改当前排序这一条流（游标/hasMore/追加服务端页） */
  const patchStream = useCallback((key: CommentSortKey, fn: (s: SortStream) => SortStream) => {
    setStreams((prev) => ({ ...prev, [key]: fn(prev[key]) }))
  }, [])

  /** 点赞/删除/楼内回复这类「单条评论变了」要同时反映到两条流，否则切个排序数字就回去了 */
  const patchAllStreams = useCallback((fn: (items: CommentView[]) => CommentView[]) => {
    setStreams((prev) => ({
      latest: { ...prev.latest, items: fn(prev.latest.items) },
      hot: { ...prev.hot, items: fn(prev.hot.items) },
    }))
  }, [])

  // 服务端分页到达后按 id 去重合并（refetch / 翻页重叠都不会让评论翻倍）
  useEffect(() => {
    const data = commentsQuery.data
    if (!data) return
    const incoming = data.items.map(mapComment)
    patchStream(sort, (s) => {
      const seen = new Set(s.items.map((c) => c.id))
      const fresh = incoming.filter((c) => !seen.has(c.id))
      return {
        ...s,
        items: fresh.length > 0 ? [...s.items, ...fresh] : s.items,
        hasMore: !!data.hasMore,
        nextCursor: data.nextCursor ?? null,
      }
    })
    setTotal(Number(data.total ?? 0))
    // 「首条评论预览」写进本地旁路缓存，供信息流卡片补上预览行（见 lib/commentPreview.ts）。
    // 只在「最新」口径的首页面写：卡片那行的语义是「最新一条评论」，热门序的 items[0] 是
    // 赞最多的老评论，拿它覆盖预览会让信息流莫名其妙；翻页时 incoming[0] 更不是首条。
    const first = incoming[0]
    if (first && !first.deleted && sort === 'latest' && stream.cursor == null) {
      setTopComment(postId, { name: first.name, text: first.text })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsQuery.data])

  // 列表整体时间倒序（hot 则热度序），楼内对话正序更自然：交给 buildCommentTree 统一排序
  const tree = useMemo(() => buildCommentTree(stream.items), [stream.items])

  // 评论按钮进弹层即聚焦；帖子内点「评论」图标也走同一条路（focusSignal 自增）。
  // iOS 对非用户手势内触发的 focus 可能不弹键盘，这里尽力而为（真机验证项）。
  useEffect(() => {
    if (!autoFocusInput && focusSignal === 0) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(t)
  }, [autoFocusInput, focusSignal])

  /** 评论数变化后同步帖子计数（列表卡片 + 详情两处缓存） */
  const bumpCommentCount = useCallback(
    (delta: number) => {
      patchPostDetail(utils, postId, (p) => ({ ...p, commentCount: Math.max(0, Number(p.commentCount) + delta) }))
      patchFeedPost(utils, postId, (p) => ({ ...p, commentCount: Math.max(0, Number(p.commentCount) + delta) }))
    },
    [postId, utils],
  )

  /**
   * 切换排序 = 换一条流来读。
   * 因为 streams 按排序分开存，这里不需要（也不能）去动另一条流的游标：
   * 目标排序若还没请求过，它的 cursor 本来就是 null → 从首页开始；请求过则原地续上，
   * 两种情况下都不会把另一套排序的游标当锚点用（后端 latest/hot 的 keyset 语义不同）。
   */
  const onSortChange = (next: CommentSortKey) => {
    if (next === sort) return
    setSort(next)
  }

  /** 配图已满 4 张时给一句明确提示，而不是让按钮点了没反应（按钮此时仍 ENABLED，见输入条注释） */
  const imageRoom = () => {
    if (pending.length >= COMMENT_IMAGE_MAX) {
      onToast(`评论最多带 ${COMMENT_IMAGE_MAX} 张图`)
      return false
    }
    return true
  }

  /** 相册多选（原生 Capacitor 选择器 / Web 文件选择），已压缩为 dataURL，追加到待发列表 */
  const addFromAlbum = async () => {
    if (picking || commentMut.isPending || !imageRoom()) return
    setPicking(true)
    try {
      const urls = await pickImages(COMMENT_IMAGE_MAX - pending.length)
      if (urls.length === 0) return
      // key 在事件回调里同步生成，不放进 setPending 的 updater：updater 会在渲染期被调用
      // （StrictMode 下还调两次），在那里读写 ref 既违反 react-hooks/refs 也会漂号
      pendingSeq.current += urls.length
      const start = pendingSeq.current - urls.length
      const added = urls.map((src, i) => ({ key: `c${start + i}`, src }))
      setPending((list) => [...list, ...added].slice(0, COMMENT_IMAGE_MAX))
    } catch {
      onToast('打开相册失败，请重试')
    } finally {
      setPicking(false)
    }
  }

  /** 拍照（原生是「拍照 / 从相册选择」二选一，Web 退化为选一张文件） */
  const addFromCamera = async () => {
    if (picking || commentMut.isPending || !imageRoom()) return
    setPicking(true)
    try {
      const shot = await capturePhoto()
      if (shot) {
        pendingSeq.current += 1
        const added = { key: `c${pendingSeq.current}`, src: shot }
        setPending((list) => [...list, added].slice(0, COMMENT_IMAGE_MAX))
      }
    } catch {
      onToast('拍照失败，请重试')
    } finally {
      setPicking(false)
    }
  }

  const removePendingImage = (index: number) => {
    setPending((list) => list.filter((_, i) => i !== index))
  }

  const send = () => {
    const text = draft.trim()
    // 文字仍然是必填：后端 content 是 z.string().min(1)，纯图评论发不出去（feature-router.ts:226）
    if (!text || commentMut.isPending) return
    if (!requireAuth(replyTarget ? '回复评论' : '发表评论')) return
    const parentId = replyTarget?.id ?? null
    commentMut.mutate(
      {
        postId,
        content: text,
        ...(parentId != null ? { parentId } : {}),
        // 只有真的带图才传 images：服务端对「带图评论」另扣一个更紧的限流桶
        // （5 次/分钟，feature-router.ts:242-248），空数组不该占这份预算
        ...(pending.length > 0 ? { images: pending.map((p) => p.src) } : {}),
      },
      {
        // 返回的 CommentNode 直接并进本地列表：既不整表失效，也不用
        // 「作者+内容」字符串去重（原 CommentSheet 那样同名同文会误删用户自己的评论）
        onSuccess: (node) => {
          setDraft('')
          setReplyTarget(null)
          // dataURL 已经由服务端机审 + 落盘换成 URL 写进返回的 node，本地这份使命完成
          setPending([])
          const view = mapComment(node)
          // 挂在哪个顶层楼：用服务端返回的 view.parentId，不用本地 parentId。
          // 回复「回复」时后端会把它归并到顶层楼（community.ts:672 effectiveParentId），
          // 本地那个 replyTarget.id 指的是被直接回复的那条回复，拿它去 appendReplies
          // 找不到同 id 的顶层楼 → 刚发的回复当场看不见（刷新才出现）。
          patchAllStreams((items) =>
            view.parentId != null
              ? appendReplies(items, view.parentId, [view])
              : [view, ...items.filter((c) => c.id !== view.id)],
          )
          // 口径对齐服务端：posts.comment_count 对「每一条评论（含楼内回复）」都 +1
          // （community.ts:688 无条件 `commentCount + 1`）。此前回复不 bump，刷新后
          // 操作栏的数字会突然跳高一截 —— 现在跟着服务端一起加，本地与服务端不再相反。
          bumpCommentCount(1)
          // 区头 total 是「顶层楼数」（COUNT(*) WHERE parent_id IS NULL，community.ts:411-415），
          // 只有顶层评论才动它；判定用服务端的 view.parentId（回复「回复」会被归并到顶层楼，
          // 本地 parentId 那颗可能是条回复，两种情况都不该动 total）
          if (view.parentId == null) setTotal((t) => (t == null ? t : t + 1))
        },
        // 失败保留文案与配图：机审明确拒绝/超张数是确定性失败，原样重发只会再失败一次，
        // 但清空会把用户选的图一起丢掉。留着，用户逐张 X 掉问题图再发，或直接重试。
        onError: (e) => onToast(e.message || '评论发送失败'),
      },
    )
  }

  const onCommentLike = (c: CommentView) => {
    if (c.deleted || likeBusy != null) return
    if (!c.liked && !requireAuth('点赞评论')) return
    const prevLiked = c.liked
    const prevLikes = c.likes
    setLikeBusy(c.id)
    patchAllStreams((items) =>
      patchComment(items, c.id, (x) => ({ ...x, liked: !x.liked, likes: Math.max(0, x.likes + (x.liked ? -1 : 1)) })),
    )
    likeMut.mutate(
      { commentId: c.id },
      {
        onSuccess: (r) => {
          patchAllStreams((items) =>
            patchComment(items, c.id, (x) => ({ ...x, liked: r.liked, likes: Number(r.likeCount) })),
          )
        },
        onError: () => {
          patchAllStreams((items) => patchComment(items, c.id, (x) => ({ ...x, liked: prevLiked, likes: prevLikes })))
          onToast('操作失败，请稍后再试')
        },
        onSettled: () => setLikeBusy(null),
      },
    )
  }

  const onDeleteComment = (c: CommentView) => {
    if (c.deleted || deleteMut.isPending) return
    if (!window.confirm('确定删除这条评论吗？')) return
    // 后端是软删（deletedAt 打标记，行还在），所以本地也只翻 deleted 标记渲染成灰色占位：
    // 它楼下的回复必须保留，不能因为父评论被删就塌掉一整楼。
    // 计数两个口径都不动，这次是查过后端才敢写死的结论：
    // deleteComment 明确不递减 posts.comment_count（community.ts:605），
    // 而 total 的 COUNT(*) 没有 deleted_at 过滤，软删楼照旧计入。
    deleteMut.mutate(
      { commentId: c.id },
      {
        onSuccess: () => patchAllStreams((items) => patchComment(items, c.id, (x) => ({ ...x, deleted: true }))),
        onError: () => onToast('删除失败，请稍后再试'),
      },
    )
  }

  const submitCommentReport = (reason: string) => {
    const target = reportTarget
    if (!target) return
    reportMut.mutate(
      { postId, commentId: target.id, reason },
      {
        onSuccess: (r: { already?: boolean }) => {
          setReportTarget(null)
          onToast(r?.already ? '你已举报过这条评论' : '已举报，我们会尽快处理')
        },
        onError: (e) => onToast(e.message || '举报失败，请稍后再试'),
      },
    )
  }

  const startReply = (target: CommentView) => {
    if (!requireAuth('回复评论')) return
    setReplyTarget({ id: target.id, name: target.name })
    inputRef.current?.focus()
  }

  /** 「展开更多回复」：按 commentReplies 游标翻页，结果并回所属顶层楼（两条流都要跟上，回复属于哪栋楼与排序无关） */
  const appendRepliesToParent = useCallback(
    (parentId: number, list: CommentView[]) => {
      patchAllStreams((items) => appendReplies(items, parentId, list))
    },
    [patchAllStreams],
  )

  const shownCount = tree.top.length

  return (
    <>
      <section className="mt-4 border-t border-line px-3 pt-3">
        {/* 区头一行：左边计数，右边排序 Tab。
            计数文案刻意与帖子操作栏的评论数**不同**：这里 N 是「顶层楼数」（服务端 total
            = COUNT(*) WHERE parent_id IS NULL，community.ts:411-415），操作栏那个数是
            posts.comment_count（每条评论含楼内回复都 +1，community.ts:688）。服务端两个口径
            天生对不上、且本轮不动 api/，所以只能靠单位把话说清楚：区头报「条讨论」，
            操作栏那个光杆数字才是总评论数。 */}
        <div className="flex items-end justify-between gap-3 pb-2">
          <h2 className="text-[15px] font-semibold leading-[22px] text-ink">
            共{' '}
            <span className="font-num">
              {total ?? shownCount}
            </span>{' '}
            条讨论
          </h2>
          <div className="relative flex items-end" role="group" aria-label="评论排序">
            {SORT_TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-label={`评论按${label}排序`}
                aria-pressed={sort === key}
                onClick={() => onSortChange(key)}
                className={`flex h-[22px] w-9 items-center justify-center text-[13px] leading-[18px] ${
                  sort === key ? 'font-semibold text-ink' : 'text-ink-40 active:text-olive'
                }`}
              >
                {label}
              </button>
            ))}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-2 h-0.5 w-5 rounded-full bg-olive transition-transform duration-300 ease-out motion-reduce:transition-none"
              style={{ transform: `translateX(${sort === 'hot' ? SORT_TAB_WIDTH : '0'})` }}
            />
          </div>
        </div>
        {commentsQuery.isLoading && shownCount === 0 ? (
          <div className="space-y-3 py-2">
            {[0, 1, 2].map((i) => (
              <div key={`sk-${i}`} className="flex animate-pulse gap-2.5">
                <div className="h-9 w-9 shrink-0 rounded-full bg-line" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-24 rounded bg-line" />
                  <div className="h-3.5 w-2/3 rounded bg-line" />
                </div>
              </div>
            ))}
          </div>
        ) : shownCount === 0 && !commentsQuery.isFetching ? (
          <p className="py-8 text-center text-[13px] leading-[18px] text-ink-40">还没有评论，来抢沙发</p>
        ) : (
          <ul className="space-y-4 py-2">
            {tree.top.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <img
                  src={c.avatar}
                  alt={c.name}
                  loading="lazy"
                  className="h-9 w-9 shrink-0 rounded-full bg-paper object-cover"
                />
                <div className="min-w-0 flex-1">
                  {c.deleted ? (
                    <p className="text-[15px] leading-[22px] text-ink-40">该评论已删除</p>
                  ) : (
                    <>
                      <p className="text-[13px] leading-[18px] text-ink-60">
                        <span className="font-semibold text-ink">{c.name}</span> · {c.time}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[22px] text-ink">{c.text}</p>
                      {c.images.length > 0 && (
                        <div className="mt-1.5 flex gap-1.5">
                          {c.images.map((src, i) => (
                            <img
                              key={`${c.id}-${i}`}
                              src={src}
                              alt=""
                              loading="lazy"
                              className="h-16 w-16 rounded-lg bg-paper object-cover"
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {!c.deleted && (
                    <div className="mt-1 flex items-center gap-3 text-[12px] leading-4">
                      <button
                        type="button"
                        onClick={() => startReply(c)}
                        className="text-ink-40 active:text-olive"
                      >
                        回复
                      </button>
                      <button
                        type="button"
                        aria-label={c.liked ? '取消点赞评论' : '点赞评论'}
                        disabled={likeBusy === c.id}
                        onClick={() => onCommentLike(c)}
                        className={`flex items-center gap-1 disabled:opacity-40 ${c.liked ? 'text-heart' : 'text-ink-40 active:text-olive'}`}
                      >
                        <FishIcon active={c.liked} size={14} />
                        <span className="font-num">{c.likes > 0 ? c.likes : ''}</span>
                      </button>
                      {/* 评论级举报入口（v14 补）：CHANGELOG v8.8.0 写着「帖子/评论举报」，
                          但迭代前评论 DOM 上只有回复，举报只有帖子级一个入口 */}
                      <button
                        type="button"
                        aria-label="举报评论"
                        onClick={() => (requireAuth('举报评论') ? setReportTarget(c) : undefined)}
                        className="text-ink-40 active:text-olive"
                      >
                        <Flag size={13} strokeWidth={1.8} />
                      </button>
                      {meId != null && c.authorId === meId && (
                        <button
                          type="button"
                          aria-label="删除评论"
                          disabled={deleteMut.isPending}
                          onClick={() => onDeleteComment(c)}
                          className="text-ink-40 active:text-heart disabled:opacity-40"
                        >
                          <Trash2 size={13} strokeWidth={1.8} />
                        </button>
                      )}
                    </div>
                  )}
                  {/* 楼中楼（QY-COMM-006）：软删父评论也要保留这一楼，所以整块不看 c.deleted */}
                  <CommentReplies
                    parent={c}
                    replies={tree.replies.get(c.id) ?? []}
                    meId={meId}
                    likeBusy={likeBusy}
                    onLike={onCommentLike}
                    onReply={startReply}
                    onDelete={onDeleteComment}
                    onReport={(target) => (requireAuth('举报评论') ? setReportTarget(target) : undefined)}
                    onAppendReplies={appendRepliesToParent}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {stream.hasMore && (
          <button
            type="button"
            // 只在这里把暂存的 nextCursor 提升为 cursor：effect 里直接 setCursor 会让
            // 「加载更多」变成自动连翻（与楼内 CommentReplies 同款双状态）
            onClick={() => patchStream(sort, (s) => ({ ...s, cursor: s.nextCursor }))}
            disabled={commentsQuery.isFetching}
            className="mb-1 flex h-9 w-full items-center justify-center gap-1 rounded-lg text-[13px] leading-[18px] text-olive disabled:opacity-40"
          >
            {commentsQuery.isFetching ? <Loader2 size={15} className="animate-spin" /> : null}
            加载更多评论
          </button>
        )}
      </section>

      {/* 底部评论输入条（两种形态都用 sticky 吸底）
          路由页：吸的是 #app-scroll，键盘弹起时把 bottom 抬高 inset，否则会被键盘压住；
          弹层：吸的是弹层内那层滚动容器，弹层外壳已按 inset 整体收缩，所以 bottom 保持 0。
          配图预览条刻意压到 48px 高：这一条变高，键盘弹起后可见的评论区就跟着少一截
          （inset 补偿仍然只算键盘，见 hooks/useKeyboardInset.ts），真机上要复核这一坨不吃掉输入框。 */}
      <div
        className="sticky bottom-0 z-20 border-t border-line bg-paper-white px-3 py-2"
        style={{
          bottom: variant === 'page' ? inset : 0,
          paddingBottom: 'max(var(--safe-bottom, 0px), 8px)',
        }}
      >
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
        {pending.length > 0 && (
          <div className="mb-2 flex items-center gap-2">
            {pending.map((p, i) => (
              <div key={p.key} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-paper">
                <img src={p.src} alt={`待发图 ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="移除这张图"
                  disabled={commentMut.isPending}
                  onClick={() => removePendingImage(i)}
                  className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl-md bg-ink/55 text-paper-white disabled:opacity-40"
                >
                  <X size={10} strokeWidth={2.4} />
                </button>
              </div>
            ))}
            <span className="shrink-0 text-[11px] leading-3 text-ink-40">
              <span className="font-num">
                {pending.length}/{COMMENT_IMAGE_MAX}
              </span>
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          {/* 满 4 张时按钮**不置灰**（置灰了用户不知道为什么不能点），由 imageRoom() 给一句
              「评论最多带 4 张图」，旁边的 n/4 计数是同一件事的可视提示 */}
          <button
            type="button"
            aria-label="拍照附图"
            disabled={picking || commentMut.isPending}
            onClick={addFromCamera}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-40 active:text-olive disabled:opacity-40"
          >
            {picking ? <Loader2 size={18} className="animate-spin" /> : <Camera size={19} strokeWidth={1.8} />}
          </button>
          <button
            type="button"
            aria-label="从相册选择评论配图"
            disabled={picking || commentMut.isPending}
            onClick={addFromAlbum}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-40 active:text-olive disabled:opacity-40"
          >
            <Images size={19} strokeWidth={1.8} />
          </button>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={replyTarget ? `回复 @${replyTarget.name}：` : '说两句…'}
            maxLength={500}
            className="h-10 min-w-0 flex-1 rounded-full bg-paper px-4 text-[14px] text-ink outline-none placeholder:text-ink-40"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim() || commentMut.isPending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-olive text-paper-white disabled:opacity-40"
            aria-label="发送评论"
          >
            {commentMut.isPending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} strokeWidth={2} />}
          </button>
        </div>
      </div>

      {/* 评论举报面板（与帖子举报共用 ReportSheet，理由拼装只有一处） */}
      <ReportSheet
        open={reportTarget != null}
        subject="评论"
        pending={reportMut.isPending}
        onClose={() => setReportTarget(null)}
        onSubmit={submitCommentReport}
      />
    </>
  )
}

/** 楼内回复 + 「展开更多回复」游标翻页 */
interface RepliesProps {
  parent: CommentView
  replies: CommentView[]
  meId: number | null
  likeBusy: number | null
  onLike: (c: CommentView) => void
  onReply: (c: CommentView) => void
  onDelete: (c: CommentView) => void
  onReport: (c: CommentView) => void
  onAppendReplies: (parentId: number, list: CommentView[]) => void
}

function CommentReplies({
  parent,
  replies,
  meId,
  likeBusy,
  onLike,
  onReply,
  onDelete,
  onReport,
  onAppendReplies,
}: RepliesProps) {
  const [opened, setOpened] = useState(false)
  /** 已经发出去的游标（null = 首页面） */
  const [cursor, setCursor] = useState<CommentsCursor | null>(null)
  /** 服务端给的下一页游标：只在用户再点一次「展开」时才提升为 cursor（与顶层同款双状态） */
  const [nextCursor, setNextCursor] = useState<CommentsCursor | null>(null)
  const [more, setMore] = useState(false)

  const repliesQuery = trpc.app.posts.commentReplies.useQuery(
    { commentId: parent.id, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    { retry: 1, enabled: opened },
  )

  useEffect(() => {
    const data = repliesQuery.data
    if (!data) return
    onAppendReplies(parent.id, data.items.map(mapComment))
    // 这里绝不能 setCursor：query key 一变、enabled 又已经是 true，react-query 立刻请求下一页，
    // 响应再回到本 effect 再 setCursor —— 点一次「展开」就把这一楼剩下的回复全串行抽干了。
    setNextCursor(data.nextCursor ?? null)
    setMore(!!data.hasMore)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repliesQuery.data])

  // 服务端已把楼内最新 2 条嵌在父评论上（parent.replies），够多或 replyCount 一致时不给入口
  const remain = Math.max(0, parent.replyCount - replies.length)
  // 展开过之后以服务端 hasMore 为准：parent.repliesHasMore 是首页面那份快照（replyCount > 预览条数），
  // 全部回复拉完后它仍然是 true，会让按钮留在原地变成一颗点了没反应的死按钮（nextCursor 已是 null）。
  // 反过来，请求失败/还没落地时按钮必须留着——它是这一楼唯一的重试入口。
  const showMore = opened
    ? repliesQuery.isFetching || more || repliesQuery.isError || !repliesQuery.data
    : parent.repliesHasMore || remain > 0
  const moreLabel = repliesQuery.isError
    ? '展开失败，点这里重试'
    : opened
      ? '继续展开回复'
      : `展开更多回复${remain > 0 ? ` (${remain})` : ''}`

  if (replies.length === 0 && !showMore) return null

  return (
    <ul className="mt-2 space-y-3 border-l border-line pl-3">
      {replies.map((r) => (
        <li key={r.id} className="flex gap-2">
          <img
            src={r.avatar}
            alt={r.name}
            loading="lazy"
            className="h-7 w-7 shrink-0 rounded-full bg-paper object-cover"
          />
          <div className="min-w-0 flex-1">
            {r.deleted ? (
              <p className="text-[14px] leading-[20px] text-ink-40">该评论已删除</p>
            ) : (
              <>
                <p className="text-[12px] leading-4 text-ink-60">
                  <span className="font-semibold text-ink">{r.name}</span> · {r.time}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-[20px] text-ink">{r.text}</p>
                {r.images.length > 0 && (
                  <div className="mt-1.5 flex gap-1.5">
                    {r.images.map((src, i) => (
                      <img
                        key={`${r.id}-${i}`}
                        src={src}
                        alt=""
                        loading="lazy"
                        className="h-14 w-14 rounded-lg bg-paper object-cover"
                      />
                    ))}
                  </div>
                )}
              </>
            )}
            {!r.deleted && (
              <div className="mt-1 flex items-center gap-3 text-[12px] leading-4">
                <button type="button" onClick={() => onReply(r)} className="text-ink-40 active:text-olive">
                  回复
                </button>
                <button
                  type="button"
                  aria-label={r.liked ? '取消点赞评论' : '点赞评论'}
                  disabled={likeBusy === r.id}
                  onClick={() => onLike(r)}
                  className={`flex items-center gap-1 disabled:opacity-40 ${r.liked ? 'text-heart' : 'text-ink-40 active:text-olive'}`}
                >
                  <FishIcon active={r.liked} size={14} />
                  <span className="font-num">{r.likes > 0 ? r.likes : ''}</span>
                </button>
                <button type="button" aria-label="举报评论" onClick={() => onReport(r)} className="text-ink-40 active:text-olive">
                  <Flag size={13} strokeWidth={1.8} />
                </button>
                {meId != null && r.authorId === meId && (
                  <button
                    type="button"
                    aria-label="删除评论"
                    onClick={() => onDelete(r)}
                    className="text-ink-40 active:text-heart"
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                  </button>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
      {showMore && (
        <li>
          <button
            type="button"
            // 第一次点 = 打开子分页（请求首页面）；之后再点 = 把上一页攒下的游标提升为 cursor 翻下一页。
            // 一次点击最多推进一页，翻页节奏完全由用户掌握。
            // 游标已经等于「在请求里的那个」（上一次这页请求失败）时改走 refetch：
            // 再 setCursor 同一个值不会变 query key，react-query 根本不会重发，按钮就成了死按钮。
            onClick={() => {
              if (!opened) setOpened(true)
              else if (nextCursor && nextCursor !== cursor) setCursor(nextCursor)
              else void repliesQuery.refetch()
            }}
            disabled={repliesQuery.isFetching}
            className="flex items-center gap-1 text-[12px] leading-4 text-olive disabled:opacity-40"
          >
            {repliesQuery.isFetching ? <Loader2 size={13} className="animate-spin" /> : null}
            {moreLabel}
          </button>
        </li>
      )}
    </ul>
  )
}
