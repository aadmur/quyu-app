import { useCallback } from 'react'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/hooks/useAuthGate'

/** 钓场标记种类：fav=收藏，news=订阅鱼讯 */
export type PondMarkKind = 'fav' | 'news'

/** 后端 ponds.myMarks 返回形状（契约固定：pond slug 数组） */
export interface PondMarks {
  fav: string[]
  news: string[]
}

const EMPTY_MARKS: PondMarks = { fav: [], news: [] }

interface UsePondMarksOptions {
  /** 操作反馈 toast（收藏/订阅成功、失败回滚时触发） */
  onToast?: (msg: string) => void
}

/**
 * 收藏 / 订阅鱼讯后端化：ponds.myMarks 读取、ponds.toggleMark 写入。
 * 乐观更新 + 失败回滚；未登录动作由 useAuthGate 拦截弹登录层（调用方需在 JSX 末尾渲染 loginSheet）。
 * 用法：const { isFav, isSubscribed, toggleFav, toggleNews, ready, loginSheet } = usePondMarks({ onToast: show })
 */
export function usePondMarks({ onToast }: UsePondMarksOptions = {}) {
  const utils = trpc.useUtils()
  const { requireAuth, loginSheet } = useAuthGate()

  const marksQuery = trpc.app.ponds.myMarks.useQuery(undefined)
  const marks = (marksQuery.data ?? EMPTY_MARKS) as PondMarks

  const toggleMut = trpc.app.ponds.toggleMark.useMutation({
    // 乐观更新：先把标记写进 myMarks 缓存，失败时回滚
    onMutate: async (vars) => {
      await utils.app.ponds.myMarks.cancel()
      const prev = utils.app.ponds.myMarks.getData(undefined) as PondMarks | undefined
      utils.app.ponds.myMarks.setData(undefined, (old) => {
        const cur = (old ?? EMPTY_MARKS) as PondMarks
        const list = cur[vars.kind]
        const next = list.includes(vars.pondSlug)
          ? list.filter((s) => s !== vars.pondSlug)
          : [...list, vars.pondSlug]
        return { ...cur, [vars.kind]: next }
      })
      return { prev }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev) utils.app.ponds.myMarks.setData(undefined, ctx.prev)
      onToast?.(vars.kind === 'fav' ? '收藏失败，请稍后再试' : '订阅失败，请稍后再试')
    },
    onSuccess: (res, vars) => {
      // 以服务端返回的 marked 为准校准一次，再失效拉新
      utils.app.ponds.myMarks.setData(undefined, (old) => {
        const cur = (old ?? EMPTY_MARKS) as PondMarks
        const list = cur[vars.kind]
        const next = res.marked
          ? [...new Set([...list, vars.pondSlug])]
          : list.filter((s) => s !== vars.pondSlug)
        return { ...cur, [vars.kind]: next }
      })
      if (res.marked) onToast?.(vars.kind === 'fav' ? '已收藏该钓点' : '已订阅该塘鱼讯')
      void utils.app.ponds.myMarks.invalidate()
      void utils.app.ponds.myFavorites.invalidate()
    },
  })

  const toggle = useCallback(
    (slug: string, kind: PondMarkKind) => {
      if (!requireAuth(kind === 'fav' ? '收藏' : '订阅鱼讯')) return
      toggleMut.mutate({ pondSlug: slug, kind })
    },
    [requireAuth, toggleMut],
  )

  const isFav = useCallback((slug: string) => marks.fav.includes(slug), [marks])
  const isSubscribed = useCallback((slug: string) => marks.news.includes(slug), [marks])

  return {
    isFav,
    isSubscribed,
    toggleFav: (slug: string) => toggle(slug, 'fav'),
    toggleNews: (slug: string) => toggle(slug, 'news'),
    /** myMarks 首屏数据是否已就绪（就绪前标记态为空集，避免闪烁错误状态） */
    ready: marksQuery.isSuccess,
    loginSheet,
  }
}
