import { useEffect, useRef, useState } from 'react'
import PostContent from '@/components/community/PostContent'
import BottomSheet from '@/components/home/BottomSheet'
import { MotionFeaturesMax } from '@/providers/motion'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import type { FeedPost } from '@/data/home'

interface PostSheetProps {
  postId: number
  /** 列表卡片已知字段：详情到达前先乐观渲染，避免开一层白屏 */
  seed?: FeedPost
  /** 由「评论」按钮打开：弹层内直接聚焦评论输入框并弹键盘 */
  autoFocusInput?: boolean
  /** 退场动画播完后回调：由 Home 关掉状态并 history.back() */
  onClose: () => void
}

/** 进出场时长（ms）：与 CSS transition 保持一致 */
const TRANSITION_MS = 280

/**
 * 帖子全屏弹层（v14 核心改动）
 *
 * 为什么是弹层而不是路由跳转：/ 与 /post/:id 是 Layout 下的兄弟路由，走 navigate
 * 会把 Home 整棵卸载，分页累积、滚动位置、tab 停留位、点赞态全丢。弹层让 Home
 * 活着留在原地，这些状态从根上就不会丢；/post/:id 路由仍然保留，只服务深链冷启动
 * （分享链接、二维码、外部浏览器直达）—— 两者共用 PostContent，不存在两套渲染。
 *
 * 三条性能铁律在这里的落点：
 * 1. 本文件必须由 Home 用 import() 动态引入（Home 在首屏静态闭包里）。它静态依赖
 *    PostContent → CatchViewer，而 CatchViewer 用了 drag="x"，一旦被静态引入就会
 *    踩坏 check-motion-boundary.mjs 的不变量 1。
 * 2. 下拉关闭复用自研 BottomSheet（Pointer Events），不用 framer-motion 的 drag，
 *    首屏因此不必为手势引入 domMax 能力包（+11.9 KB br）。
 * 3. CatchViewer 的 drag 需要 domMax 运行时能力，所以在弹层内单独包一层
 *    <MotionFeaturesMax>：domMax 只在用户真的点开帖子后才下载。
 *
 * 进出场是纯 CSS transform（translateY），不用 layoutId —— layoutId 属于 layout
 * 投影能力，会把首屏拖进 domMax。
 */
export default function PostSheet({ postId, seed, autoFocusInput, onClose }: PostSheetProps) {
  const [entered, setEntered] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)
  /** 键盘弹起时整棵弹层收缩，滚动区跟着变短，最后一条评论不会被键盘吃掉 */
  const inset = useKeyboardInset()

  // 挂载后下一帧才收 translateY：同帧内改 style 浏览器不会播过渡
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  // 弹层打开时锁背景滚动（与 StoryPlayer 同一手法：内容区是 #app-scroll）
  useEffect(() => {
    const scroller = document.getElementById('app-scroll')
    if (!scroller) return
    scroller.style.overflow = 'hidden'
    return () => {
      scroller.style.overflow = ''
    }
  }, [])

  /**
   * 用 closeTimer 这个 ref 而不是 `closing` 做幂等守卫：
   * Escape 的监听器挂在 useEffect([]) 上，捕获的是首帧的 startClose 闭包，
   * 里面的 `closing` 永远读到 false —— 连按两次会排两个定时器、onClose 跑两次，
   * 而 Home 的关闭回调要做 history.back()，退两格会把用户直接甩出首页。
   * ref 是可变当前值，不受闭包过期影响。
   */
  const startClose = () => {
    if (closeTimer.current) return
    setClosing(true)
    closeTimer.current = window.setTimeout(onClose, TRANSITION_MS)
  }

  // Escape 关闭：BottomSheet 的下拉手势只认触摸/笔指针（pointerType==='mouse' 直接放弃），
  // 桌面端因此没有"下拉"这个动作。除了左上角返回按钮，这里补一条桌面用户的肌肉记忆。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        startClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // startClose 每次渲染重建，但它只读 ref/setState，不入依赖不会造成监听器漂移
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = entered && !closing

  return (
    <div
      role="dialog"
      aria-label="帖子详情"
      className="fixed inset-0 z-50 mx-auto flex max-w-[420px] flex-col bg-paper-white shadow-[0_0_40px_rgba(45,30,30,0.18)]"
      style={{
        transform: shown ? 'translateY(0)' : 'translateY(100%)',
        transition: `transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        ...(inset > 0 ? { height: `calc(100% - ${inset}px)` } : null),
      }}
    >
      <MotionFeaturesMax>
        <BottomSheet
          onClose={startClose}
          threshold={120}
          elastic={0.5}
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
        >
          {/*
            下拉把手：BottomSheet 的手势只在触点落在弹层顶部 48px 内时才接管，
            没有可见锚点用户就不知道该从哪儿下拉 —— 这条药丸既是视觉提示，也正是那个可拖区域。
            高度压在 48px 判定内；键盘用户走 Escape 或左上角返回，所以不进 tab 序列。
          */}
          <div aria-hidden="true" className="flex h-4 shrink-0 items-center justify-center">
            <span className="h-1 w-9 rounded-full bg-ink/15" />
          </div>
          {/* key={postId}：换帖时整棵重挂，评论/输入/滚动位置不会串台 */}
          <PostContent
            key={postId}
            postId={postId}
            seed={seed}
            variant="sheet"
            autoFocusInput={autoFocusInput}
            onBack={startClose}
          />
        </BottomSheet>
      </MotionFeaturesMax>
    </div>
  )
}
