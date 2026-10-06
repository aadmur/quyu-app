import { useEffect, useState } from 'react'

/** 键盘高度识别阈值（px）：小于这个量级的视口收缩多是浏览器工具栏收放，不算键盘 */
const KEYBOARD_MIN_INSET = 80
/** 抖动抑制阈值（px）：过滤 visualViewport 连续 resize 事件里 1-2px 的取整噪声 */
const JITTER = 24

/**
 * 软键盘遮挡高度（v14）
 *
 * 移动端 WebView 键盘弹起时，布局视口（100dvh、fixed 的锚点）通常不变，变的只是
 * visualViewport —— 结果吸底的评论输入条会被键盘盖住或顶走。这里算出被键盘吃掉的
 * 高度，交给调用方补偿：
 * - 帖子弹层：整棵高度按 inset 收缩，滚动区跟着变短，最后一条评论仍看得见；
 * - /post/:id 路由页：sticky 输入条的 bottom 抬高 inset，正好贴在键盘上方。
 *
 * 不支持 visualViewport 的环境恒返回 0，行为退化为改造前，不会更糟。
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const measure = () => {
      // 键盘占用高度 = 布局视口高 - 可视视口高 - 可视区顶部偏移（页面被顶起时 offsetTop > 0）
      const hidden = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      setInset((prev) => {
        const next = hidden < KEYBOARD_MIN_INSET ? 0 : hidden
        return Math.abs(next - prev) < JITTER ? prev : next
      })
    }
    measure()
    vv.addEventListener('resize', measure)
    vv.addEventListener('scroll', measure)
    return () => {
      vv.removeEventListener('resize', measure)
      vv.removeEventListener('scroll', measure)
    }
  }, [])

  return inset
}
