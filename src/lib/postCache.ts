/**
 * 帖子计数的缓存改写工具（v14「帖子交互优化」）
 *
 * 为什么要它：迭代前点赞/评论/收藏成功后普遍甩一句 `utils.app.feed.invalidate()`，
 * 这是**整键失效大锤** —— app.feed 的所有已缓存分页（用户可能已经刷了 20 页）
 * 全部标记为 stale，回到首页时一次性全部重请求，既白屏又压服务器。
 *
 * 正确做法（本项目已有样板：hooks/usePondMarks.ts 的 onMutate 乐观写缓存）：
 * 把新值直接写进缓存里那一条帖子上，只改该改的字段，不产生任何网络往返。
 * 失败时由调用方拿旧值再调一次本函数反向写回，即为回滚。
 *
 * 关键前提（v14 回归修复时补上的）：首页三个列表（推荐流 / 关注流 / 搜索结果）的卡片
 * 都是**渲染时从各自的 react-query 缓存现取数据**的（见 pages/Home.tsx 的 toCards），
 * 所以「写缓存」在这里等价于「改 UI」。早先那种「把查询结果拷进 useState 本地副本」
 * 的写法下，这里改了缓存、UI 却读副本，点赞点了没反应 —— 修的是渲染端，缓存端一直是对的。
 *
 * 也因此：三条列表都要写。只写 app.feed 的话，在「关注」Tab 或搜索结果里点赞
 * 就是请求发了、缓存改了、卡片不动，正好是这次回归的同一个形状。
 */
import { getQueryKey } from '@trpc/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { trpc } from '@/providers/trpc'
import type { FeedItem, PostDetailData, SearchFeedItem } from '@/lib/live'

type Utils = ReturnType<typeof trpc.useUtils>

/** posts.search 一页的缓存内容（后端出参 {items, hasMore}） */
type SearchPage = { items: SearchFeedItem[]; hasMore: boolean }

/**
 * 改写 items 里 id 命中的那条；**没命中就返回同一个数组引用**。
 * 引用不变很重要 —— react-query 靠引用相等判断「数据没变」，
 * 每次都新建数组会让用户点一条帖子就把整屏卡片全刷一遍。
 */
function mapCardById<T extends { id: number }>(items: T[], postId: number, mutate: (p: T) => T): T[] {
  if (!items.some((it) => Number(it.id) === postId)) return items
  return items.map((it) => (Number(it.id) === postId ? mutate(it) : it))
}

/** 同上，剔除版本 */
function dropCardById<T extends { id: number }>(items: T[], postId: number): T[] {
  if (!items.some((it) => Number(it.id) === postId)) return items
  return items.filter((it) => Number(it.id) !== postId)
}

/**
 * 改写 app.feed 各分页缓存里目标帖子的字段。
 *
 * setQueriesData 的第一个参数是 tRPC 的 query key 过滤（app.feed 的 page/pageSize
 * 都有 zod default → 类型上可选，所以空对象匹配该 procedure 的全部变量组合），
 * 第三个参数是分页响应的 updater —— 这里对**每一页**生效，用户翻到的任何一页里
 * 那条帖子的点赞数都会同步更新。
 *
 * 返回的对象用 `{ ...old, items }` 而不是重建字面量：feed 的出参除了 items/hasMore
 * 还带 profile（推荐依据），漏抄一个字段就会在写回缓存时把它抹掉。
 */
export function patchFeedPost(utils: Utils, postId: number, mutate: (p: FeedItem) => FeedItem) {
  utils.app.feed.setQueriesData({}, {}, (old) => {
    if (!old) return old
    const items = mapCardById(old.items, postId, mutate)
    return items === old.items ? old : { ...old, items }
  })
}

/** 改写 app.posts.followingFeed（关注流）各分页缓存里目标帖子的字段 */
export function patchFollowingPost(utils: Utils, postId: number, mutate: (p: FeedItem) => FeedItem) {
  utils.app.posts.followingFeed.setQueriesData({}, {}, (old) => {
    if (!old) return old
    const items = mapCardById(old.items, postId, mutate)
    return items === old.items ? old : { ...old, items }
  })
}

/**
 * 改写 app.posts.search 各分页缓存（所有关键词、所有页码）。
 *
 * ⚠ 参数是 QueryClient 而不是其它几个函数收的 utils，原因有两个，都是硬约束：
 * 1. tRPC 的 procedure utils（`trpc.useUtils()`）上没有 queryClient，而裸的
 *    `utils.app.posts.search.setQueriesData` 第一个参数要和 procedure **入参同形** ——
 *    search 的 keyword 是必填，可点赞发生那一刻我们并不知道（也不该知道）用户搜的是哪个词。
 * 2. react-query 自己的 `queryClient.setQueriesData({queryKey})` 才给得出
 *    「该 procedure 的全部 key」这个语义（getQueryKey 不带 input 就是它的前缀）。
 * 调用方因此需要 useQueryClient()（见 hooks/usePostInteractions.ts）。
 *
 * 泛型参数是这一页的缓存类型（react-query 从 store 取到的是 unknown），
 * 显式传给 setQueriesData 的 TQueryFnData 就够了，不需要任何 as 断言。
 */
export function patchSearchPost(queryClient: QueryClient, postId: number, mutate: (p: FeedItem) => FeedItem) {
  queryClient.setQueriesData<SearchPage>(
    { queryKey: getQueryKey(trpc.app.posts.search) },
    (old) => {
      if (!old) return old
      const items = mapCardById(old.items, postId, mutate)
      return items === old.items ? old : { ...old, items }
    },
  )
}

/** 改写 posts.detail 缓存里目标帖子的字段（弹层与 /post/:id 路由页共用同一个 key） */
export function patchPostDetail(utils: Utils, postId: number, mutate: (p: PostDetailData) => PostDetailData) {
  utils.app.posts.detail.setQueriesData({ id: postId }, {}, (old) => {
    if (!old) return old
    return mutate(old)
  })
}

/**
 * 会话切换（登录成功 / 退出登录）时整份清空查询缓存。
 *
 * 为什么不是逐个 invalidate：本项目的缓存键只有入参（`app.feed` 的 `{page,pageSize}` 等），
 * **不含用户 id**，而出参里带着 viewer 级字段——`liked`/`collected`、收藏列表、评论点赞态、
 * 我的订单。登录与退出都在 SPA 内完成（`PasswordAuthForm` 与 `Profile` 原先只 invalidate `auth.me`，
 * 页面不重载），于是换账号后**上一个账号的这些状态会继续显示**，直到 staleTime(30s)/gcTime(5min)
 * 各自过期为止：用户在"我的收藏"里看到的是别人点过的帖子。
 * 逐条列清单去 invalidate 迟早漏一个 procedure；而"会话变了 ⇒ 所有 viewer 级数据作废"这条不变量，
 * 只有整体清空才守得住。代价是切换后当前页会短暂回到骨架屏，这是正确行为——旧数据本就属于别人。
 */
export function resetViewerCache(queryClient: QueryClient) {
  queryClient.clear()
}

/**
 * 从所有已缓存分页里剔除一条帖子（删帖后用）。
 * 迭代前删帖甩的是 feed.invalidate()：为了消失一张卡，把用户刷过的每一页
 * 全部重请求一遍。这里直接在缓存里把它摘掉，零网络往返。
 *
 * 推荐流与关注流都要摘：只摘 feed 的话，删掉的帖子会继续挂在「关注」Tab 里，
 * 点进去是一条「帖子不存在」。搜索结果不在这里摘 —— 它的 key 带必填 keyword，
 * 只能像 patchSearchPost 那样走 queryClient，而本函数的调用方（PostContent 的删帖）
 * 只持有 utils。删帖后搜索页仍会短暂留着这条卡，刷新即消失，属于已知的剩余问题。
 */
export function removeFeedPost(utils: Utils, postId: number) {
  utils.app.feed.setQueriesData({}, {}, (old) => {
    if (!old) return old
    const items = dropCardById(old.items, postId)
    return items === old.items ? old : { ...old, items }
  })
  utils.app.posts.followingFeed.setQueriesData({}, {}, (old) => {
    if (!old) return old
    const items = dropCardById(old.items, postId)
    return items === old.items ? old : { ...old, items }
  })
}
