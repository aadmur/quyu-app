import { lazy, Suspense, type ReactNode } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import Login from '@/pages/Login'
import { MotionFeaturesMax } from '@/providers/motion'

/**
 * 路由级代码分割（QY-PERF-002）
 *
 * 改造前：21 个页面（合计 7267 行）全部静态 import，打进单个 943 KB 主
 * chunk。用户打开首页也要下载「我的」「塘主端」「下单」「审核队列」
 * 这些首屏永不需要的代码。
 *
 * 改造原则：
 * - 一级 Tab 页（首页）保持静态。底部 TabBar 可瞬时切换，懒加载会
 *   引入可见空白等待，收益不抵体验损失。
 * - 二级页（钓点/详情/下单/票券/塘主/审核/协议类）全部 lazy。用户
 *   点到这些页面本来就有导航过程，骨架屏足以覆盖 chunk 下载时间。
 * - Login 保持静态：它是极小的独立页面，且未登录态下多处会触发登录
 *   弹层，懒加载反而增加一次额外往返。
 */
const Spots = lazy(() => import('@/pages/Spots'))
const PondDetail = lazy(() => import('@/pages/PondDetail'))
const PostDetail = lazy(() => import('@/pages/PostDetail'))
const Checkout = lazy(() => import('@/pages/Checkout'))
const Tickets = lazy(() => import('@/pages/Tickets'))
const Favorites = lazy(() => import('@/pages/Favorites'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const Review = lazy(() => import('@/pages/Review'))
const Publish = lazy(() => import('@/pages/Publish'))
const Shop = lazy(() => import('@/pages/Shop'))
const Profile = lazy(() => import('@/pages/Profile'))
const Owner = lazy(() => import('@/pages/Owner'))
const Moderation = lazy(() => import('@/pages/Moderation'))
const PondApply = lazy(() => import('@/pages/PondApply'))
const FollowList = lazy(() => import('@/pages/FollowList'))
const FishSpot = lazy(() => import('@/pages/FishSpot'))
const FishId = lazy(() => import('@/pages/FishId'))
const Recharge = lazy(() => import('@/pages/Recharge'))
const Terms = lazy(() => import('@/pages/Terms'))
const Privacy = lazy(() => import('@/pages/Privacy'))
const NotFound = lazy(() => import('@/pages/NotFound'))

/** 路由切换占位骨架：顶部细进度条 + 内容轮廓，避免整屏白闪 */
function RouteFallback() {
  return (
    <div className="min-h-[60vh] px-4 pt-4" aria-busy="true" aria-live="polite">
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-olive-tint">
        <div className="qy-route-progress h-full w-1/3 rounded-full bg-olive" />
      </div>
      <span className="sr-only">页面加载中</span>
      <div className="mt-5 space-y-3">
        <div className="h-4 w-1/3 rounded bg-ink/[0.06]" />
        <div className="h-28 w-full rounded-xl bg-ink/[0.04]" />
        <div className="h-4 w-2/3 rounded bg-ink/[0.06]" />
      </div>
    </div>
  )
}

/** 统一包裹懒加载页面，避免 18 处重复写 Suspense */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

/**
 * 需要 domMax 能力包的懒加载路由（QY-PERF-005）
 *
 * 这些页面的组件树里含 layout 投影 / useMotionValue 数值驱动，属于
 * domAnimation 未覆盖的能力。它们各自包一层 <MotionFeaturesMax>，把
 * domMax（br +11.9 KB）严格限制在「用户真的进了这个页面」才加载：
 *
 *   spots      → Spots.tsx        layoutId="spots-filter-pill"
 *   checkout   → Checkout.tsx     layoutId="date-pill" / layout / useMotionValue
 *   tickets    → Tickets.tsx      layoutId="tickets-tab-line"
 *   shop       → CategoryTabs.tsx layoutId="shop-cat-pill"
 *   me         → Profile.tsx      layoutId="role-pill" / useMotionValue
 *   me/follows → FollowList.tsx   layoutId="follow-list-tab-indicator"
 *   post/:id   → PostContent.tsx  → CatchViewer.tsx drag="x"（v14 图片放大浏览）
 *   owner      → WeekChart.tsx    layoutId="week-metric-pill"
 *                StatsGrid.tsx    useMotionValue + useTransform + animate()
 *   moderation → Moderation.tsx   layoutId="moderation-tab"
 *
 * 其余懒加载页只用基础过渡，能力由 Layout 的 MotionFeatures(domAnimation)
 * 覆盖，不需要再加边界。
 *
 * 注意 /post/:id 这一条是 v14 新加的：帖子详情从「路由页」降级为「深链冷启动专用」，
 * 列表内点帖子改走 Home 的 PostSheet 弹层。两处共用 PostContent，而 PostContent 里
 * 的看图组件 CatchViewer 用了 drag="x"，所以路由页必须进这份名单（弹层则在
 * PostSheet 内部自己包一层 MotionFeaturesMax，domMax 只在用户真点开帖子时下载）。
 */
function LazyMax({ children }: { children: ReactNode }) {
  return (
    <Lazy>
      <MotionFeaturesMax>{children}</MotionFeaturesMax>
    </Lazy>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* 一级 Tab：静态加载，保证 Tab 切换零等待 */}
        <Route index element={<Home />} />

        {/* 二级页：按需加载 */}
        <Route path="spots" element={<LazyMax><Spots /></LazyMax>} />
        <Route path="pond/:id" element={<Lazy><PondDetail /></Lazy>} />
        {/* 帖子详情（v14 起只服务深链冷启动）：PostContent → CatchViewer 用了 drag，需要 domMax */}
        <Route path="post/:id" element={<LazyMax><PostDetail /></LazyMax>} />
        <Route path="checkout" element={<LazyMax><Checkout /></LazyMax>} />
        <Route path="tickets" element={<LazyMax><Tickets /></LazyMax>} />
        <Route path="favorites" element={<Lazy><Favorites /></Lazy>} />
        <Route path="notifications" element={<Lazy><Notifications /></Lazy>} />
        <Route path="review/:orderId" element={<Lazy><Review /></Lazy>} />
        <Route path="publish" element={<Lazy><Publish /></Lazy>} />
        <Route path="shop" element={<LazyMax><Shop /></LazyMax>} />
        <Route path="me" element={<LazyMax><Profile /></LazyMax>} />
        <Route path="me/follows" element={<LazyMax><FollowList /></LazyMax>} />
        <Route path="owner" element={<LazyMax><Owner /></LazyMax>} />
        <Route path="moderation" element={<LazyMax><Moderation /></LazyMax>} />
        <Route path="pond-apply" element={<Lazy><PondApply /></Lazy>} />
        <Route path="fish-spot" element={<Lazy><FishSpot /></Lazy>} />
        <Route path="fish-id" element={<Lazy><FishId /></Lazy>} />
        <Route path="fish-spot/recharge" element={<Lazy><Recharge /></Lazy>} />
        <Route path="terms" element={<Lazy><Terms /></Lazy>} />
        <Route path="privacy" element={<Lazy><Privacy /></Lazy>} />
        <Route path="*" element={<Lazy><NotFound /></Lazy>} />
      </Route>
      <Route path="/login" element={<Login />} />
    </Routes>
  )
}
