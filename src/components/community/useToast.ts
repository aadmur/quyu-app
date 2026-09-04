import { useCallback, useRef, useState } from 'react'

/**
 * 社区通用 toast 状态：配合 <Toast message={toast} /> 使用。
 * const { toast, showToast } = useToast()
 */
export function useToast(duration = 2000) {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const showToast = useCallback(
    (message: string) => {
      setToast(message)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setToast(null), duration)
    },
    [duration],
  )

  return { toast, showToast }
}
