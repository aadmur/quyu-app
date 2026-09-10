import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Home, MapPin, ShoppingBag, User, Plus, Signal, Wifi, BatteryFull } from 'lucide-react'
import { isNativeApp } from '@/lib/safeArea'
import UpdateSheet from './UpdateSheet'

/** 模拟状态栏：44px，左「9:41」，右信号/WiFi/电池线性图标，融于页面背景 */
export function StatusBar({ dark = false }: { dark?: boolean }) {
  const color = dark ? '#ffffff' : '#2d1e1e'
  return (
    <div
      className="flex h-11 shrink-0 items-center justify-between px-5 select-none"
      style={{ color }}
      aria-hidden="true"
    >
      <span className="font-num text-[15px] leading-none tracking-wide">9:41</span>
      <span className="flex items-center gap-1.5">
        <Signal size={15} strokeWidth={1.8} />
        <Wifi size={15} strokeWidth={1.8} />
        <BatteryFull size={17} strokeWidth={1.8} />
      </span>
    </div>
  )
}

const TABS = [
  { path: '/', label: '首页', icon: Home },
  { path: '/spots', label: '钓点', icon: MapPin },
  null, // 中央发布按钮占位
  { path: '/shop', label: '商城', icon: ShoppingBag },
  { path: '/me', label: '我的', icon: User },
] as const

/** 仅一级 Tab 页显示底部 TabBar；塘主端与详情/下单等二级页隐藏 */
const TAB_PATHS = ['/', '/spots', '/shop', '/me']

function TabBar() {
  const navigate = useNavigate()
  const location = useLocation()
  // 首次进入：3 秒气泡引导「点这里发渔获」
  const [showTip, setShowTip] = useState(
    () => typeof window !== 'undefined' && !window.localStorage.getItem('qy-publish-tip-seen'),
  )

  useEffect(() => {
    if (!showTip) return
    const t = window.setTimeout(() => {
      setShowTip(false)
      window.localStorage.setItem('qy-publish-tip-seen', '1')
    }, 3000)
    return () => window.clearTimeout(t)
  }, [showTip])

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  return (
    <nav
      className="shrink-0 border-t border-line bg-paper-white"
      style={{ paddingBottom: 'max(var(--safe-bottom), 12px)' }}
    >
      <div className="relative flex h-14 items-stretch justify-between px-2">
        {TABS.map((tab) => {
          if (tab === null) {
            // 中央凸起发布按钮：56px 橄榄绿圆形，凸起 12px
            return (
              <div key="publish" className="relative flex w-16 items-start justify-center">
                <AnimatePresence>
                  {showTip && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.95 }}
                      className="absolute -top-11 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-[12px] leading-4 text-paper"
                    >
                      点这里发渔获
                      <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-ink" />
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.button
                  type="button"
                  aria-label="发布渔获"
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  onClick={() => navigate('/publish')}
                  className="absolute -top-3 flex h-14 w-14 items-center justify-center rounded-full bg-olive text-paper-white shadow-[0_8px_24px_rgba(45,30,30,0.12)]"
                >
                  <Plus size={26} strokeWidth={2.2} />
                </motion.button>
              </div>
            )
          }
          const active = isActive(tab.path)
          const Icon = tab.icon
          return (
            <button
              key={tab.path}
              type="button"
              aria-label={tab.label}
              onClick={() => navigate(tab.path)}
              className="flex w-16 items-center justify-center"
            >
              <motion.span
                animate={{ y: active ? -2 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={active ? 'text-olive' : 'text-ink-40'}
              >
                <Icon size={24} strokeWidth={active ? 2.4 : 1.8} />
              </motion.span>
            </button>
          )
        })}
        <span className="sr-only">底部导航</span>
      </div>
    </nav>
  )
}

/** 桌面品牌衬底（≥768px 显示于手机壳左侧） */
function BrandBackdrop() {
  return (
    <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-4 select-none">
      <img src="/logo.svg" alt="趣渔" className="h-14 w-auto" />
      <p className="text-[22px] font-semibold leading-7 text-ink">钓鱼人的朋友圈</p>
      <p className="max-w-[16em] text-center text-[13px] leading-[18px] text-ink-60">
        刷渔获 · 找钓场 · 买票选位 · 扫码核销 · 买装备 · 晒战绩
      </p>
    </div>
  )
}

/**
 * PhoneShell 壳层：max-w-[420px] 居中、h-[100dvh]、桌面两侧品牌衬底。
 * 内含 StatusBar + 内容区（flex-1 overflow-y-auto，渲染 <Outlet/>）+ TabBar。
 */
export default function Layout() {
  const location = useLocation()
  const showTabBar = TAB_PATHS.includes(location.pathname)
  // 原生安卓壳：渲染真实状态栏让位区（--safe-top），否则渲染模拟状态栏
  const [native] = useState(() => isNativeApp())

  return (
    <div
      className="flex min-h-[100dvh] items-stretch justify-center bg-paper"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='24' viewBox='0 0 120 24'%3E%3Cpath d='M0 12 Q15 4 30 12 T60 12 T90 12 T120 12' fill='none' stroke='%232d1e1e' stroke-opacity='0.04' stroke-width='1.5'/%3E%3C/svg%3E\")",
      }}
    >
      <BrandBackdrop />
      <div className="flex h-[100dvh] w-full max-w-[420px] flex-col relative border-x border-stone-300 bg-paper shadow-[0_0_40px_rgba(45,30,30,0.08)]">
        {native ? (
          <div className="shrink-0 bg-paper" style={{ height: 'var(--safe-top)' }} />
        ) : (
          <StatusBar />
        )}
        <main id="app-scroll" className="flex-1 overflow-y-auto overscroll-contain">
          <Outlet />
        </main>
        {showTabBar && <TabBar />}
      </div>
      <div className="hidden md:block flex-1" />
      {/* APP 版本检查与更新提示（QY-G-003）：仅原生壳内可能弹出，浏览器静默 */}
      <UpdateSheet />
    </div>
  )
}
