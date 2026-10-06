import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { trpc } from '@/providers/trpc'
import type { FeedItem } from '@/lib/live'
import { patchFeedPost, patchFollowingPost, patchPostDetail, patchSearchPost } from '@/lib/postCache'

/**
 * 演示帖（接口异常降级到 src/data/home.ts 的本地 mock）没有后端数值 id：
 * 既没有可写的缓存条目，也没有可请的接口，点赞/收藏因此**做不成**，不是「点了没反应」。
 * 迭代前卡片自带 useState，降级态下点了会假亮一下（骗人但至少有反馈）；v14 删掉本地态后
 * 这里变成彻底静默 —— 静默是最坏的反馈，用户只会认为按钮坏了。
 * 修法是给一句诚实的 toast，绝不伪造互动态。
 */
export const DEMO_LIKE_HINT = '当前为演示数据，暂不支持点赞'
export const DEMO_FAV_HINT = '当前为演示数据，暂不支持收藏'

interface PostInteractionsOptions {
  /** 后端数值 id；演示帖子没有 id 时传 null，此时只提示不支持、不发请求也不伪造状态 */
  postId: number | null
  /** 当前点赞态与点赞数：来自缓存映射后的视图，改写缓存即改写 UI */
  liked: boolean
  likeCount: number
  collected: boolean
  /** 未登录拦截（useAuthGate().requireAuth）：返回 false 表示不继续 */
  requireAuth: (action: string) => boolean
  onToast: (msg: string) => void
}

/**
 * 帖子点赞 / 收藏（v14）
 *
 * 三件事一起做：
 * 1. 乐观改写缓存而非 invalidate —— 首页三个列表（推荐流 / 关注流 / 搜索结果）的卡片
 *    与帖子弹层/详情页读的都是各自的 react-query 缓存，且渲染时**从缓存现取数据**
 *    （不再拷进本地 state），所以点一次赞几处同时变，回首页也不会触发全量重请求。
 *    注意这里必须三条列表都写：只写 app.feed 的话，在「关注」Tab 或搜索结果里点赞
 *    就是请求发了、缓存改了、卡片不动 —— 和当年只写一份缓存是同一个 bug。
 * 2. 客户端防连点 —— 迭代前只靠服务端 TokenBucket 兜底，用户狂点会吃到限流报错。
 *    现在请求在途（isPending）直接忽略点击，并把按钮置为 disabled。
 * 3. 收藏接后端（posts.toggleFavorite）—— 迭代前是纯前端 state + 一句
 *    「已收藏到渔获集」的 toast，刷新即丢、也没地方查。现在落到后端，
 * 归集在 /favorites 的「帖子」Tab。文案统一为「已收藏」：「渔获集」是从未实现过的
 *    幽灵术语，全代码库只在一句 toast 里出现过，禁止再用。
 */
export function usePostInteractions({
  postId,
  liked,
  likeCount,
  collected,
  requireAuth,
  onToast,
}: PostInteractionsOptions) {
  const utils = trpc.useUtils()
  // 搜索结果的分页 key 里带必填 keyword，tRPC 的 procedure utils 匹配不到「所有关键词」，
  // 只能拿裸 queryClient 去写（见 lib/postCache.ts 的 patchSearchPost 注释）
  const queryClient = useQueryClient()
  const likeMut = trpc.app.posts.like.useMutation()
  const favMut = trpc.app.posts.toggleFavorite.useMutation()

  const writeLikes = useCallback(
    (nextLiked: boolean, nextCount: number) => {
      if (postId == null) return
      // 三条列表的条目结构同形（后端 v14 把卡片列口径统一了），所以同一个 mutate 复用三次
      const toCards = (p: FeedItem) => ({ ...p, liked: nextLiked, likeCount: nextCount })
      patchFeedPost(utils, postId, toCards)
      patchFollowingPost(utils, postId, toCards)
      patchSearchPost(queryClient, postId, toCards)
      patchPostDetail(utils, postId, (p) => ({ ...p, liked: nextLiked, likeCount: nextCount }))
    },
    [postId, utils, queryClient],
  )

  const writeFavorite = useCallback(
    (nextCollected: boolean) => {
      if (postId == null) return
      const toCards = (p: FeedItem) => ({ ...p, collected: nextCollected })
      patchFeedPost(utils, postId, toCards)
      patchFollowingPost(utils, postId, toCards)
      patchSearchPost(queryClient, postId, toCards)
      patchPostDetail(utils, postId, (p) => ({ ...p, collected: nextCollected }))
    },
    [postId, utils, queryClient],
  )

  const toggleLike = useCallback(() => {
    if (likeMut.isPending) return
    if (postId == null) {
      onToast(DEMO_LIKE_HINT)
      return
    }
    if (!liked && !requireAuth('点赞')) return
    const next = !liked
    const nextCount = Math.max(0, likeCount + (next ? 1 : -1))
    writeLikes(next, nextCount)
    likeMut.mutate(
      { postId },
      {
        onSuccess: (r) => {
          const real = r.liked ?? next
          // 服务端结论与本地猜测不一致（并发/重复点赞被幂等吞掉）时校准一次
          if (real !== next) writeLikes(real, Math.max(0, nextCount + (real ? 1 : -1)))
        },
        onError: () => {
          writeLikes(liked, likeCount)
          onToast('点赞失败，请稍后再试')
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, liked, likeCount, requireAuth, onToast, writeLikes, likeMut.isPending])

  const toggleFavorite = useCallback(() => {
    if (favMut.isPending) return
    if (postId == null) {
      onToast(DEMO_FAV_HINT)
      return
    }
    if (!collected && !requireAuth('收藏')) return
    const next = !collected
    writeFavorite(next)
    favMut.mutate(
      { postId },
      {
        onSuccess: (r) => {
          const real = r.collected ?? next
          if (real !== next) writeFavorite(real)
          onToast(real ? '已收藏' : '已取消收藏')
        },
        onError: () => {
          writeFavorite(collected)
          onToast('收藏失败，请稍后再试')
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, collected, requireAuth, onToast, writeFavorite, favMut.isPending])

  return {
    toggleLike,
    /** 请求在途：按钮要禁用，避免连点 */
    likePending: likeMut.isPending,
    toggleFavorite,
    favPending: favMut.isPending,
  }
}
