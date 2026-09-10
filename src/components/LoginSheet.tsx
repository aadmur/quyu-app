import { AnimatePresence, m } from 'framer-motion'
import { X, LogIn } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PasswordAuthForm from './PasswordAuthForm'

/** 协议勾选本地记忆键（QY-E-002）：勾选过后下次默认勾上 */
const AGREE_KEY = 'qy_agree_terms'

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
  // 协议勾选（QY-E-002）：本地记忆，默认读取上次勾选状态
  const [agreed, setAgreed] = useState(() => {
    try {
      return window.localStorage.getItem(AGREE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [agreeHint, setAgreeHint] = useState(false)
  const formWrapRef = useRef<HTMLDivElement>(null)

  const toggleAgree = () => {
    setAgreed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(AGREE_KEY, next ? '1' : '0')
      } catch {
        // 隐私模式等场景写入失败：仅本次会话生效
      }
      if (next) setAgreeHint(false)
      return next
    })
  }

  /** PasswordAuthForm 的注册提交按钮文案为「注册并登录」（登录态为「登录」），
   *  据此在捕获阶段拦截未勾选协议时的注册提交（登录不受限）。 */
  const isRegisterSubmit = (target: EventTarget | null): boolean => {
    const btn = (target as HTMLElement | null)?.closest?.('button')
    return !!btn?.textContent?.includes('注册并登录')
  }
  const inRegisterMode = (): boolean => {
    const btns = formWrapRef.current?.querySelectorAll('button')
    const submit = btns && btns.length > 0 ? btns[btns.length - 1] : null
    return !!submit?.textContent?.includes('注册并登录')
  }
  const blockIfUnchecked = (isRegister: boolean): boolean => {
    if (agreed || !isRegister) return false
    setAgreeHint(true)
    return true
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.button
            type="button" aria-label="关闭登录引导"
            className="fixed inset-0 z-[60] bg-ink/35"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <m.div
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
              <div className="my-4 flex w-full items-center gap-3 text-[12px] text-ink-40">
                <span className="h-px flex-1 bg-line" />
                或用账号密码
                <span className="h-px flex-1 bg-line" />
              </div>
              {/* 未勾选协议时：仅拦截注册提交（捕获阶段），登录不受影响 */}
              <div
                ref={formWrapRef}
                className="w-full"
                onClickCapture={(e) => {
                  if (blockIfUnchecked(isRegisterSubmit(e.target))) {
                    e.preventDefault()
                    e.stopPropagation()
                  }
                }}
                onKeyDownCapture={(e) => {
                  if (e.key === 'Enter' && blockIfUnchecked(inRegisterMode())) {
                    e.preventDefault()
                    e.stopPropagation()
                  }
                }}
              >
                <PasswordAuthForm compact onSuccess={onClose} />
              </div>
              {/* 协议勾选行（QY-E-002）：注册前必须勾选 */}
              <div className="mt-3 flex w-full items-start gap-2 text-left">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={agreed}
                  aria-label="同意用户协议与隐私政策"
                  onClick={toggleAgree}
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                    agreed ? 'border-olive bg-olive text-paper-white' : 'border-line bg-paper-white'
                  }`}
                >
                  {agreed && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                      <path d="M1 4l2.5 2.5L9 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <p className="text-[12px] leading-[18px] text-ink-60">
                  我已阅读并同意
                  <Link to="/terms" className="text-olive" onClick={(e) => e.stopPropagation()}>
                    《用户协议》
                  </Link>
                  和
                  <Link to="/privacy" className="text-olive" onClick={(e) => e.stopPropagation()}>
                    《隐私政策》
                  </Link>
                </p>
              </div>
              {agreeHint && !agreed && (
                <p className="mt-1.5 w-full text-left text-[12px] leading-4 text-red-600">请先阅读并同意协议</p>
              )}
              <button
                type="button" onClick={onClose}
                className="mt-3 text-[13px] text-ink-40"
              >
                先逛逛，稍后再说
              </button>
            </div>
          </m.div>
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
