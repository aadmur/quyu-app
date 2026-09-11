import { Link } from 'react-router-dom'
import { FishOff } from 'lucide-react'

/**
 * 404 页面（App.tsx 的 `path="*"` 兜底路由）
 *
 * 此前是脚手架遗留的英文卡片（Text-muted-foreground + shadcn Card/Button），
 * 本次（QY-PERF-007）改为产品设计系统，移除最后一份 shadcn 依赖。
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col items-center justify-center bg-paper px-6 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-olive-tint text-olive">
        <FishOff size={30} strokeWidth={1.6} />
      </span>
      <p className="mt-4 font-num text-[44px] leading-none text-olive">404</p>
      <h1 className="mt-2 text-[17px] font-semibold leading-6 text-ink">这条鱼游走了</h1>
      <p className="mt-1.5 text-[13px] leading-5 text-ink-60">
        页面不存在或已被移除，回首页看看今天的鱼讯吧
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-full bg-olive text-[15px] font-semibold text-paper-white active:brightness-95"
      >
        回首页
      </Link>
    </div>
  )
}
