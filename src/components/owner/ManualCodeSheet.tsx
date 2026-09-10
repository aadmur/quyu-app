import { useEffect, useRef, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'

interface ManualCodeSheetProps {
  open: boolean
  onClose: () => void
  /** 异步核销（orders.verify）：返回 true 核销成功 */
  verify: (code: string) => Promise<boolean>
  /** 核销成功回调 */
  onSuccess: () => void
}

/** 手动输码底部弹层：6 位下划线格输入，输错抖动 + clay 提示 */
export default function ManualCodeSheet({ open, onClose, verify, onSuccess }: ManualCodeSheetProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)
  const [checking, setChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const clearTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (open) {
      setCode('')
      setError(false)
      // 弹层动画结束后聚焦唤起键盘
      const t = window.setTimeout(() => inputRef.current?.focus(), 350)
      return () => window.clearTimeout(t)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(clearTimer.current), [])

  const handleChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    setError(false)
    if (digits.length === 6 && !checking) {
      setChecking(true)
      verify(digits)
        .then((ok) => {
          if (ok) {
            window.setTimeout(onSuccess, 200)
          } else {
            setError(true)
            setShakeKey((k) => k + 1)
            clearTimer.current = window.setTimeout(() => {
              setCode('')
              setError(false)
            }, 900)
          }
        })
        .finally(() => setChecking(false))
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.div
            key="mask"
            className="fixed inset-0 z-50 mx-auto max-w-[420px] bg-ink"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <m.div
            key="sheet"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[420px] rounded-t-[20px] bg-paper-white px-6 pt-4"
            style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 40px)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          >
            <div className="mx-auto mb-4 h-1 w-9 rounded-full" style={{ backgroundColor: '#2d1e1e26' }} />
            <h2 className="text-center text-[18px] font-semibold leading-6 text-ink">手动输入核销码</h2>
            <p className="mt-1 text-center text-[13px] leading-[18px] text-ink-60">请输入钓友票券上的 6 位数字</p>

            {/* 6 格下划线输入（隐藏 input 承载真实输入） */}
            <div className="relative mt-6" onClick={() => inputRef.current?.focus()}>
              <input
                ref={inputRef}
                type="tel"
                inputMode="numeric"
                value={code}
                onChange={(e) => handleChange(e.target.value)}
                className="absolute inset-0 h-full w-full opacity-0"
                aria-label="6 位核销码"
              />
              <m.div
                key={shakeKey}
                className="flex justify-between gap-2 px-2"
                animate={shakeKey > 0 && error ? { x: [0, -8, 8, -6, 6, 0] } : { x: 0 }}
                transition={{ duration: 0.4 }}
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex h-12 w-10 items-end justify-center border-b-2 pb-1 ${
                      error ? 'border-clay' : i === code.length ? 'border-olive' : 'border-line'
                    }`}
                    style={i === code.length && !error ? undefined : i >= code.length && !error ? { borderColor: '#2d1e1e26' } : undefined}
                  >
                    <span className={`font-num text-[32px] leading-9 ${error ? 'text-clay' : 'text-ink'}`}>
                      {code[i] ?? ''}
                    </span>
                  </div>
                ))}
              </m.div>
            </div>

            <div className="mt-3 h-5 text-center">
              {error && <p className="text-[13px] leading-[18px] text-clay">核销码无效，请核对后重试</p>}
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  )
}
