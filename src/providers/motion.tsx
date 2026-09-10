/**
 * 动画能力提供者（QY-PERF-005）
 *
 * framer-motion 的 `motion.*` 组件会把「动画引擎 + 手势 + 布局动画 + 拖拽」
 * 全部打进主 chunk。实测（esbuild --bundle --minify，esm，全量依赖）：
 *
 *   motion.*                      85,3xx B  br 39,338 B（含 domMax 等价能力）
 *   m + domAnimation              85,272 B  br 27,467 B
 *   m + domMax                   132,772 B  br 39,338 B
 *
 * 关键结论：**domMax 与 motion 体积几乎相同**（domMax = domAnimation + drag +
 * layout），所以只要用了 layout/layoutId，LazyMotion 就没有体积收益。本项目
 * 原先首屏唯一的 layoutId 是 Home 的信息流 Tab 下划线（已改 CSS transition），
 * 首屏因而可以安全地只带 domAnimation，节省 11.9 KB brotli。
 *
 * 还有一个反直觉的实测结果：`drag="y"` 属性本身几乎不增加体积（27,483 B vs
 * 27,467 B），贵的是**能力包**。因此首屏的 CommentSheet / StoryPlayer 用自研
 * 的 Pointer Events 抽屉（components/home/BottomSheet.tsx）复刻下拉关闭，
 * 既不引入 domMax，也不牺牲交互。
 *
 * 使用约定：
 * - 首屏路径（Layout / Home / feed 及其静态依赖）：`m.*` + 本文件的
 *   <MotionFeatures>，能力包 domAnimation 同步加载（约 15 KB，异步反而会让
 *   首帧动画降级闪烁）。
 * - 懒加载路由若需要 layout / drag / useMotionValue：由 App.tsx 的 <LazyMax>
 *   包一层 <MotionFeaturesMax>。domMax **必须动态 import**，否则会被 App.tsx
 *   的静态引用拖回 entry chunk，前功尽弃。
 */
import { LazyMotion, domAnimation } from 'framer-motion'
import type { FeatureBundle } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'

/** domMax 的动态加载器：只有真正进入需要 layout/drag 的页面时才请求这个 chunk */
let domMaxPromise: Promise<FeatureBundle> | null = null
function loadDomMax(): Promise<FeatureBundle> {
  if (!domMaxPromise) domMaxPromise = import('framer-motion').then((mod) => mod.domMax)
  return domMaxPromise
}

/**
 * 首屏动画能力边界（仅基础过渡 + 手势，不含 layout / drag）。
 */
export function MotionFeatures({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict={false}>
      {children}
    </LazyMotion>
  )
}

/**
 * 高级动画能力边界（基础 + drag + layout）。
 *
 * domMax 走异步加载：首帧先用 domAnimation 顶着，domMax chunk 到达后由
 * LazyMotion 热切换能力包。实测该切换不影响已在途动画（LazyMotion 内部
 * 会 re-render features），代价是首帧极短的降级窗口——而这个窗口只发生在
 * 用户主动进入「我的 / 塘主端 / 下单 / 商城」等二级页时，可接受。
 */
export function MotionFeaturesMax({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<FeatureBundle | null>(null)

  useEffect(() => {
    let alive = true
    loadDomMax().then((bundle) => {
      if (alive) setFeatures(bundle)
    })
    return () => {
      alive = false
    }
  }, [])

  // domMax 到达前：不渲染子节点会闪白，所以先用基础能力渲染，
  // 让内容立刻可见、动画可用，只是 layout 投影稍后才生效。
  return (
    <LazyMotion features={features ?? domAnimation} strict={false}>
      {children}
    </LazyMotion>
  )
}
