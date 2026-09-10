/**
 * 底部抽屉外壳（QY-PERF-005）
 *
 * 为什么要自研而不是用 framer-motion 的 `drag="y"`：
 * 实测（esbuild --bundle --minify，esm，全量依赖）——
 *
 *   m + domAnimation + drag="y"          85,301 B   br 27,483 B
 *   m + domAnimation（无 drag）          85,272 B   br 27,467 B   ← drag 属性本身几乎免费
 *   m + domMax（含 drag + layout）      132,772 B   br 39,338 B   ← 但**能力包**要 +39 KB
 *
 * 也就是说：拖拽手势本身不花钱，贵的是 domMax 能力包（layout 投影系统 + 手势引擎）。
 * 而 CommentSheet / StoryPlayer 都位于**首屏静态闭包**（Home → StoryBar/FeedPost），
 * 一旦为了 drag 引入 domMax，QY-PERF-005 的全部收益（11.9 KB brotli）即刻归零。
 *
 * 因此这里用 Pointer Events + CSS 复刻「下拉关闭」：
 * - 关闭阈值与原先一致：位移 > 120px（Story 为 90px）或速度 > 500px/s
 * - 阻尼系数 0.5（Story 为 0.6），与 framer-motion 的 dragElastic 视觉一致
 * - 仅当手势从抽屉顶部把手区域起始、且列表已滚动到顶部时才接管，
 *   避免和内部 overflow-y-auto 列表抢手势
 * - 释放后若未达阈值，用 cubic-bezier 回弹；达到阈值则外部 onClose 触发退场动画
 *
 * 体积：本文件 + 全局 CSS，约 0（不引入任何依赖）。替代 domMax 的 39.3 KB brotli。
 */
import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface BottomSheetProps {
  /** 关闭回调：由调用方负责触发退场动画（本组件只负责手势判定） */
  onClose: () => void
  /** 下拉关闭阈值（px），与原 framer-motion onDragEnd 的 offset 判定一致 */
  threshold?: number
  /** 下拉阻尼（0–1），越大越"跟手"，与原 dragElastic 一致 */
  elastic?: number
  className?: string
  children: ReactNode
}

/** 速度阈值（px/s），与原 onDragEnd 的 velocity.y > 500 一致 */
const VELOCITY_THRESHOLD = 500

export default function BottomSheet({
  onClose,
  threshold = 120,
  elastic = 0.5,
  className = '',
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const startTime = useRef(0)
  const dragging = useRef(false)
  const [offset, setOffset] = useState(0)
  const [springBack, setSpringBack] = useState(false)

  /** 手势起点是否允许接管：抽屉顶部把手区域（48px 内），且内部滚动容器已在顶部 */
  const canStart = useCallback((target: EventTarget | null): boolean => {
    const sheet = sheetRef.current
    if (!sheet) return false
    const el = target as HTMLElement | null
    if (!el || !sheet.contains(el)) return false

    const rect = sheet.getBoundingClientRect()
    const y = (el as HTMLElement).getBoundingClientRect().top
    // 仅在抽屉顶部 48px（把手 + 标题栏）内起始时接管
    if (y - rect.top > 48) return false

    // 列表已滚动时，手势应交给列表滚动而非下拉关闭
    const scroller = sheet.querySelector<HTMLElement>('.qy-sheet-scroll')
    if (scroller && scroller.scrollTop > 0) return false

    return true
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!canStart(e.target)) return
      // 滑鼠以外的指针类型（触摸/笔）才启用；桌面端鼠标拖拽抽屉无意义
      if (e.pointerType === 'mouse') return
      dragging.current = true
      startY.current = e.clientY
      startTime.current = performance.now()
      setSpringBack(false)
    },
    [canStart],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      const delta = e.clientY - startY.current
      // 只允许向下拖，向上不响应（与原 dragConstraints top:0 一致）
      if (delta <= 0) {
        setOffset(0)
        return
      }
      // 越界阻尼：超过阈值后按 elastic 系数衰减，制造"拖不动了"的手感
      const damped = delta <= threshold ? delta : threshold + (delta - threshold) * elastic
      setOffset(damped)
    },
    [threshold, elastic],
  )

  const finish = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      dragging.current = false

      const delta = e.clientY - startY.current
      const elapsed = Math.max(performance.now() - startTime.current, 1)
      const velocity = (delta / elapsed) * 1000

      if (delta > threshold || velocity > VELOCITY_THRESHOLD) {
        onClose()
        setOffset(0)
        return
      }

      // 未达阈值：回弹
      setSpringBack(true)
      setOffset(0)
    },
    [threshold, onClose],
  )

  return (
    <div
      ref={sheetRef}
      className={`qy-sheet ${className}`}
      style={{
        transform: `translate3d(0, ${offset}px, 0)`,
        transition: springBack || offset === 0 ? 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {children}
    </div>
  )
}
