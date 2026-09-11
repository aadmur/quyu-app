import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 钓场页轻量 toast 状态：配合 <Toast message={message} /> 使用。
 * const { message, show } = useToast()
 *
 * 与组件分文件，保持 react-refresh 的 Fast Refresh 边界（同目录 Toast.tsx 只导出组件）。
 */
export function useToast(duration = 2000) {
  const [message, setMessage] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback((msg: string) => {
    setMessage(msg)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(''), duration)
  }, [duration])
  // 卸载时清掉挂起的定时器，避免在已卸载组件上 setState
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { message, show }
}
