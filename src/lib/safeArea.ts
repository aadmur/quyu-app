/**
 * 安全区体系（纯 Web 侧，适配 Capacitor 安卓壳）：
 *
 * 背景：Android 15 edge-to-edge 下 WebView 内容画到系统导航栏/状态栏之下，
 * 但 Capacitor 不下发 WindowInsets，CSS env(safe-area-inset-*) 恒为 0。
 *
 * 策略：
 * - index.css :root 定义 --safe-top / --safe-bottom，默认取 env()（iOS/桌面/普通浏览器行为不变）。
 * - 本模块在启动时用不可见 probe 元素实测 env(safe-area-inset-bottom) 的像素值；
 *   若为 0 且判定为安卓 WebView（Capacitor 壳），注入固定兜底值：
 *   竖屏 --safe-bottom 48px（三键导航）、--safe-top 24px（状态栏）；横屏 --safe-bottom 0px。
 * - 注入时给 <html> 加 class 'qy-native' 作为原生壳标记，并监听横竖屏切换重算。
 * - 桌面浏览器、iOS、env 有值的安卓浏览器一律不注入，保持现状。
 */

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean }
  }
}

/** 原生安卓壳判定结果缓存（UA 运行期不变，只判一次） */
let cachedNative: boolean | null = null

/** 是否运行在 Capacitor 安卓原生壳内（结果缓存，保证渲染一致） */
export function isNativeApp(): boolean {
  if (cachedNative !== null) return cachedNative
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent || ''
  const isAndroid = ua.includes('Android')
  const isWebView = ua.includes('; wv)') || window.Capacitor?.isNativePlatform?.() === true
  cachedNative = isAndroid && isWebView
  return cachedNative
}

/** 用不可见 probe 元素实测 env(safe-area-inset-bottom) 的像素值 */
function probeEnvSafeBottom(): number {
  const probe = document.createElement('div')
  probe.style.position = 'fixed'
  probe.style.left = '0'
  probe.style.bottom = '0'
  probe.style.width = '0'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)'
  document.body.appendChild(probe)
  const px = parseFloat(getComputedStyle(probe).paddingBottom) || 0
  probe.remove()
  return px
}

/** 按当前横竖屏注入兜底安全区：竖屏底 48px / 顶 24px，横屏底 0px */
function applyFallbackInsets() {
  const portrait = window.matchMedia('(orientation: portrait)').matches
  const root = document.documentElement
  root.style.setProperty('--safe-bottom', portrait ? '48px' : '0px')
  root.style.setProperty('--safe-top', '24px')
  root.classList.add('qy-native')
}

/**
 * 应用启动时调用一次（main.tsx，createRoot 之前）。
 * 仅当「安卓 WebView 且 env 探测为 0」时注入兜底值并监听横竖屏切换。
 */
export function initSafeArea(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (!isNativeApp()) return
  if (probeEnvSafeBottom() > 0) return // env 已生效（如手势导航/新壳），无需兜底
  applyFallbackInsets()
  const mq = window.matchMedia('(orientation: portrait)')
  const recalc = () => applyFallbackInsets()
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', recalc)
  else mq.addListener(recalc) // 旧 WebView 兼容
}
