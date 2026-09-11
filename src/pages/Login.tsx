import { useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { getKimiOAuthUrl } from '@/components/LoginSheet'
import PasswordAuthForm from '@/components/PasswordAuthForm'

/**
 * 独立登录页（/login 路由）
 *
 * 说明：App 内绝大多数登录入口走 LoginSheet 底部弹层（useAuthGate），
 * 本页只在直接访问 /login 时使用。此前是脚手架遗留的英文卡片
 * （Welcome / Sign in with Kimi + shadcn Card/Button），与产品设计系统
 * 不一致；本次（QY-PERF-007）改为与 LoginSheet 同款的 paper/olive 语言，
 * 顺便移除最后一份 shadcn 组件依赖。
 */
export default function Login() {
  const navigate = useNavigate()

  const onKimiLogin = () => {
    // 先取 /api/oauth/nonce 构造 state；接口未就绪时内部自动降级，不阻断登录
    void getKimiOAuthUrl().then((url) => {
      window.location.href = url
    })
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col items-center justify-center bg-paper px-6">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-olive-tint text-olive">
        <LogIn size={26} strokeWidth={1.8} />
      </span>
      <h1 className="mt-3 text-[19px] font-semibold leading-7 text-ink">登录趣渔</h1>
      <p className="mt-1.5 text-center text-[13px] leading-5 text-ink-60">
        登录后渔获、订单、画像都会记在你的账号下
      </p>

      <div className="mt-6 w-full">
        <button
          type="button"
          onClick={onKimiLogin}
          className="h-12 w-full rounded-full bg-olive text-[15px] font-semibold text-paper-white active:brightness-95"
        >
          使用 Kimi 账号登录
        </button>

        <div className="my-5 flex items-center gap-3 text-[12px] leading-4 text-ink-40">
          <span className="h-px flex-1 bg-line" />
          其他方式
          <span className="h-px flex-1 bg-line" />
        </div>

        <PasswordAuthForm onSuccess={() => navigate('/')} />
      </div>
    </div>
  )
}
