/**
 * 冷启动首屏埋点（QY-PERF-008）
 *
 * 目的：给「冷启动首屏（APK）< 2s」这条设计指标一把可重复的尺子。
 * 此前该指标与「下单接口 P99」在功能需求清单里一直是「待补测」，导致本轮
 * 优化（传输 −80%）无法给出前后对比。
 *
 * 采集内容（均为浏览器原生 Performance API，不引入任何依赖）：
 *   ttfbMs           首字节
 *   fcpMs            首次内容绘制
 *   lcpMs            最大内容绘制
 *   interactiveMs    首屏可交互（由 Layout 首帧提交后调用 markFirstInteractive）
 *   domContentLoadedMs / loadMs
 *   transferBytes    本次页面加载实际传输字节（含缓存命中为 0 的部分）
 *   requestCount     资源请求数
 *   effectiveType / downlinkMbps / deviceMemoryGb / hardwareConcurrency / dpr
 *   path / sessionKind / ua
 *
 * 设计约束：
 * - 埋点绝不影响业务：所有 API 全部 try/catch + 特性检测，失败静默。
 * - 上报用 sendBeacon（不阻塞、可存活于页面卸载），降级 fetch(keepalive)。
 * - 每个页面加载只上报一次；LCP 会在页面隐藏时才最终确定，故在
 *   visibilitychange/pageshow 之后取最终值再上报。
 * - 可用 localStorage.qy_perf_off = '1' 关闭；window.__QY_PERF__ 暴露原始数据
 *   便于真机手工核对（SOP 见 docs/运营/真机冷启动测量SOP.md）。
 */

export interface PerfMetrics {
  ttfbMs?: number
  fcpMs?: number
  lcpMs?: number
  interactiveMs?: number
  domContentLoadedMs?: number
  loadMs?: number
  transferBytes?: number
  decodedBytes?: number
  requestCount?: number
  effectiveType?: string
  downlinkMbps?: string
  deviceMemoryGb?: number
  hardwareConcurrency?: number
  dpr?: number
  path?: string
  sessionKind?: string
  ua?: string
}

const PERF_ENDPOINT = '/api/perf'
const OFF_KEY = 'qy_perf_off'

let started = false
let interactiveAt: number | null = null
let lcpValue: number | null = null
let reported = false
const metrics: PerfMetrics = {}

function now(): number {
  return Math.round(performance.now() * 100) / 100
}

function safe(fn: () => void): void {
  try {
    fn()
  } catch {
    // 埋点自身故障不得冒泡到业务
  }
}

function isOff(): boolean {
  try {
    return window.localStorage.getItem(OFF_KEY) === '1'
  } catch {
    return false
  }
}

/** 导航时序：TTFB / DOMContentLoaded / load / 会话类型 */
function collectNavigation(): void {
  const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  if (!nav) return
  metrics.ttfbMs = Math.round(nav.responseStart)
  metrics.domContentLoadedMs = Math.round(nav.domContentLoadedEventEnd)
  metrics.loadMs = Math.round(nav.loadEventEnd || nav.domComplete)
  // navigate=冷启动（新文档）；reload/back_forward 不算冷启动
  metrics.sessionKind = nav.type
}
/** FCP：paint 条目中的 first-contentful-paint */
function observePaint(): void {
  if (typeof PerformanceObserver !== 'function') return
  const po = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint') {
        metrics.fcpMs = Math.round(entry.startTime)
      }
    }
  })
  po.observe({ type: 'paint', buffered: true })
}

/** LCP：持续取最新值，最终值在页面隐藏时才确定 */
function observeLcp(): void {
  if (typeof PerformanceObserver !== 'function') return
  try {
    const po = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      if (last) lcpValue = Math.round(last.startTime)
    })
    // largest-contentful-paint 未进 TS 标准 DOM 联合类型，这里按字符串订阅
    po.observe({ type: 'largest-contentful-paint', buffered: true } as PerformanceObserverInit)
  } catch {
    // Safari 早期版本不支持，忽略
  }
}

/** 资源体积与请求数：reflect 真实传输量（缓存命中 transferSize 为 0） */
function collectResources(): void {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  let transfer = 0
  let decoded = 0
  for (const e of entries) {
    transfer += e.transferSize || 0
    decoded += e.decodedBodySize || 0
  }
  metrics.transferBytes = transfer
  metrics.decodedBytes = decoded
  metrics.requestCount = entries.length
}

/** 设备与网络画像：用于分档统计（慢机慢网才是冷启动的真实场景） */
function collectDevice(): void {
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { effectiveType?: string; downlink?: number }
  }
  if (typeof nav.hardwareConcurrency === 'number') metrics.hardwareConcurrency = nav.hardwareConcurrency
  if (typeof nav.deviceMemory === 'number') metrics.deviceMemoryGb = nav.deviceMemory
  if (nav.connection?.effectiveType) metrics.effectiveType = nav.connection.effectiveType
  if (typeof nav.connection?.downlink === 'number') metrics.downlinkMbps = String(nav.connection.downlink)
  metrics.dpr = window.devicePixelRatio
  metrics.path = window.location.pathname
  metrics.ua = navigator.userAgent.slice(0, 512)
}

/** 上报（只发一次） */
function report(): void {
  if (reported || isOff()) return
  reported = true
  // 导航时序必须在 load 之后读取：init 阶段 domContentLoadedEventEnd / loadEventEnd
  // 尚未发生，此时读到的是 0（实测踩过：loadMs 恒为 0）。
  safe(collectNavigation)
  safe(collectResources)
  if (lcpValue != null) metrics.lcpMs = lcpValue
  if (interactiveAt != null) metrics.interactiveMs = interactiveAt

  const payload = JSON.stringify(metrics)
  safe(() => {
    ;(window as unknown as { __QY_PERF__?: PerfMetrics }).__QY_PERF__ = { ...metrics }
  })

  safe(() => {
    if (typeof navigator.sendBeacon === 'function') {
      // sendBeacon 不接受自定义 Content-Type，但服务端用 c.req.json() 解析
      // 需要它是 JSON —— 用 Blob 显式声明类型
      const blob = new Blob([payload], { type: 'application/json' })
      if (navigator.sendBeacon(PERF_ENDPOINT, blob)) return
    }
    void fetch(PERF_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {})
  })
}

/**
 * 标记「首屏可交互」。
 * 由 Layout 在首帧提交后调用（内部再等两帧，确保真有一帧已绘制）。
 */
export function markFirstInteractive(): void {
  if (interactiveAt != null) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      interactiveAt = now()
    })
  })
}

/** 启动采集。在 main.tsx 渲染前调用，保证能拿到 buffered 的 paint 条目。 */
export function initPerfMonitor(): void {
  if (started || typeof window === 'undefined') return
  started = true
  if (isOff()) return

  safe(collectDevice)
  safe(observePaint)
  safe(observeLcp)

  const flush = () => report()
  // load 后再等 1.2s，给 LCP/资源条目留出落定时间
  window.addEventListener('load', () => {
    window.setTimeout(flush, 1200)
  })
  // 页面进入后台/卸载时兜底上报（移动端最可靠的时机）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)
}

export const __perfInternals = { PERF_ENDPOINT, OFF_KEY, metrics }
