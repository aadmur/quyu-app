import { useState } from 'react'
import { trpc } from '@/providers/trpc'

interface PasswordAuthFormProps {
  /** 登录/注册成功后的回调（关闭弹层或跳转） */
  onSuccess?: () => void
  compact?: boolean
}

/** 账号密码登录/注册表单（自包含登录方式，供 Kimi OAuth 不可用的部署环境） */
export default function PasswordAuthForm({ onSuccess, compact = false }: PasswordAuthFormProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const utils = trpc.useUtils()

  const onMutSuccess = () => {
    void utils.auth.me.invalidate()
    onSuccess?.()
  }
  const loginMut = trpc.auth.loginPassword.useMutation({
    onSuccess: onMutSuccess,
    onError: (e) => setError(e.message || '登录失败，请稍后再试'),
  })
  const registerMut = trpc.auth.register.useMutation({
    onSuccess: onMutSuccess,
    onError: (e) => setError(e.message || '注册失败，请稍后再试'),
  })
  const pending = loginMut.isPending || registerMut.isPending

  const submit = () => {
    setError('')
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }
    if (mode === 'login') loginMut.mutate({ username: username.trim(), password })
    else registerMut.mutate({ username: username.trim(), password })
  }

  const inputCls =
    'h-11 w-full rounded-xl border border-line bg-paper-white px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-40 focus:border-olive'

  return (
    <div className="w-full">
      {/* 登录/注册切换 */}
      <div className="mb-3 flex rounded-full bg-olive-tint p-1 text-[13px] font-medium">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m)
              setError('')
            }}
            className={`flex-1 rounded-full py-1.5 transition-colors ${
              mode === m ? 'bg-paper-white text-olive shadow-sm' : 'text-ink-60'
            }`}
          >
            {m === 'login' ? '登录' : '注册'}
          </button>
        ))}
      </div>
      <div className="space-y-2.5">
        <input
          className={inputCls}
          placeholder="用户名（2-20 位）"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <input
          className={inputCls}
          type="password"
          placeholder={mode === 'register' ? '设置密码（至少 6 位）' : '密码'}
          value={password}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      {error && <p className="mt-2 text-[12px] leading-4 text-red-600">{error}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className={`${compact ? 'mt-3' : 'mt-4'} h-11 w-full rounded-full bg-ink text-[14px] font-semibold text-paper-white active:brightness-110 disabled:opacity-60`}
      >
        {pending ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
      </button>
    </div>
  )
}
