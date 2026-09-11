import { useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import { trpc } from '@/providers/trpc'
import LoginSheet from '@/components/LoginSheet'

/**
 * 登录门槛钩子：检查当前用户，未登录则弹出引导层。
 * 用法：const { requireAuth, loginSheet } = useAuthGate()
 * 在 JSX 末尾渲染 {loginSheet}；操作时 if (!requireAuth('下单')) return
 *
 * 从 components/LoginSheet.tsx 拆出：钩子与组件同文件会让 Fast Refresh 退化为整页刷新。
 */
export function useAuthGate(): {
  user: { id: number; name?: string | null; avatar?: string | null } | null | undefined
  requireAuth: (actionText?: string) => boolean
  loginSheet: ReactElement
} {
  const meQuery = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, retry: false })
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState('继续操作')
  const user = meQuery.data

  const requireAuth = useCallback(
    (actionText = '继续操作') => {
      // auth.me 查询中：无法判定登录态，静默放行拦截（不弹层、不执行操作），避免误伤已登录用户
      if (meQuery.isLoading) return false
      // 仅确认未登录（data === null）才弹引导层
      if (meQuery.data === null) {
        setAction(actionText)
        setOpen(true)
        return false
      }
      return true
    },
    [meQuery.isLoading, meQuery.data],
  )

  return {
    user,
    requireAuth,
    loginSheet: <LoginSheet open={open} actionText={action} onClose={() => setOpen(false)} />,
  }
}
