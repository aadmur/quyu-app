import { AnimatePresence, motion } from 'framer-motion'
import { X, LogIn } from 'lucide-react'
import { useCallback, useState } from 'react'

/** 构造 Kimi OAuth 授权 URL。
 *  配置来源优先取服务端：GET /api/oauth/nonce 返回 { nonce, authUrl, appId }
 *  （nonce 为登录 CSRF 防护，state = base64(JSON{ r: redirectUri, n: nonce })），
 *  这样前端构建无需注入 VITE_KIMI_AUTH_URL / VITE_APP_ID，发布包不依赖构建期密钥；
 *  后端接口未就绪时降级到构建期 import.meta.env，再不行降级原 state = base64(redirectUri)，不阻断登录。 */
export async function getKimiOAuthUrl(): Promise<string> {
  let kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL as string | undefined
  let appID = import.meta.env.VITE_APP_ID as string | undefined
  const redirectUri = `${window.location.origin}/api/oauth/callback`
  let state = btoa(redirectUri)
  try {
    const resp = await fetch('/api/oauth/nonce', { credentials: 'include' })
    if (resp.ok) {
      const data = (await resp.json()) as { nonce?: string; authUrl?: string; appId?: string }
      // origin 为 punycode、nonce 由服务端生成，均为 ASCII，btoa 安全
      if (data && typeof data.nonce === 'string' && data.nonce) {
        state = btoa(JSON.stringify({ r: redirectUri, n: data.nonce }))
      }
      if (data && typeof data.authUrl === 'string' && data.authUrl) kimiAuthUrl = data.authUrl
      if (data && typeof data.appId === 'string' && data.appId) appID = data.appId
    }
  } catch {
    // nonce 接口不存在或网络失败：保持降级 state 与构建期配置，不阻断登录
  }
  if (!kimiAuthUrl || !appID) {
    throw new Error('登录服务未配置（缺少授权地址或应用 ID）')
  }
  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`)
  url.searchParams.set('client_id', appID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'profile')
  url.searchParams.set('state', state)
  return url.toString()
}

/** 跳 Kimi OAuth 授权页（与 Login 页同一套参数） */
export function goKimiLogin() {
  void getKimiOAuthUrl()
    .then((url) => {
      window.location.href = url
    })
    .catch(() => {
      window.alert('登录服务暂不可用，请稍后再试')
    })
}

interface LoginSheetProps {
  open: boolean
  actionText?: string
  onClose: () => void
}

/** 登录引导弹层：未登录用户执行关键操作时弹出 */
export default function LoginSheet({ open, actionText = '继续操作', onClose }: LoginSheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button" aria-label="关闭登录引导"
            className="fixed inset-0 z-[60] bg-ink/35"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog" aria-label="登录引导"
            className="fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-md rounded-t-[20px] bg-paper px-6 pt-3"
            style={{ paddingBottom: 'max(var(--safe-bottom), 24px)' }}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
            <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-4 top-4 text-ink-40">
              <X size={20} />
            </button>
            <div className="flex flex-col items-center text-center">
              <span className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-olive-tint text-olive">
                <LogIn size={26} strokeWidth={1.8} />
              </span>
              <h2 className="text-[17px] font-semibold text-ink">登录趣渔</h2>
              <p className="mt-1.5 text-[13px] leading-[20px] text-ink-60">
                登录后即可{actionText}，渔获、订单、画像都会记在你的账号下
              </p>
              <button
                type="button"
                onClick={goKimiLogin}
                className="mt-5 h-12 w-full rounded-full bg-olive text-[15px] font-semibold text-paper-white active:brightness-95"
              >
                使用 Kimi 账号登录
              </button>
              <button
                type="button" onClick={onClose}
                className="mt-3 text-[13px] text-ink-40"
              >
                先逛逛，稍后再说
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/** 登录门槛钩子：检查当前用户，未登录则弹出引导层。
 *  用法：const { requireAuth, loginSheet } = useAuthGate()
 *  在 JSX 末尾渲染 {loginSheet}；操作时 if (!requireAuth('下单')) return */
import { trpc } from '@/providers/trpc'
import type { ReactElement } from 'react'

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

  return { user, requireAuth, loginSheet: <LoginSheet open={open} actionText={action} onClose={() => setOpen(false)} /> }
}
