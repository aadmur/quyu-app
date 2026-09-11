import { useEffect, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { Download } from 'lucide-react'
import { trpc } from '@/providers/trpc'

/**
 * APP 版本检查与更新提示（QY-G-003）。
 *
 * 背景：联网版 APK 通过 server.url 实时加载最新 Web 代码，但 APK 壳本身无法热更。
 * 本组件在 Layout 挂载后检查一次（每会话一次）：原生壳版本 < 服务端 latestApkVersion
 * 时弹更新提示层；纯浏览器、版本相等或更高、接口未配置/失败一律静默不打扰。
 *
 * 防御式约定：window.Capacitor / Plugins.App / getInfo 任一不可用即静默跳过；
 * versionInfo 查询失败（retry: false + 无数据）同样静默。
 */

/** 会话内只检查一次的标记键（sessionStorage：同标签页会话级） */
const SESSION_KEY = 'qy-update-checked'

/** 防御式读取原生壳版本号（@capacitor/app 的 App.getInfo().version）；任何一步不可用返回 null */
async function getNativeVersion(): Promise<number | null> {
  try {
    const cap = (
      window as unknown as {
        Capacitor?: { Plugins?: { App?: { getInfo?: () => Promise<{ version?: string }> } } }
      }
    ).Capacitor
    const getInfo = cap?.Plugins?.App?.getInfo
    if (typeof getInfo !== 'function') return null
    const info = await getInfo()
    // versionName 约定为纯数字（"11"），parseInt 兼容 "11.0" 这类写法
    const v = parseInt(String(info?.version ?? ''), 10)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

export default function UpdateSheet() {
  const [localVer, setLocalVer] = useState<number | null>(null)
  // 用户是否已关闭提示 / 已点击去更新。每次挂载重置，等价于原先「每会话最多主动弹一次」的语义
  const [dismissed, setDismissed] = useState(false)

  // 原生壳检测 + 本地版本读取：每会话一次；纯浏览器 window.Capacitor 不存在，静默跳过
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (window.sessionStorage.getItem(SESSION_KEY)) return
      window.sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      // 隐私模式等写入失败：退化为每次挂载检查，不影响功能
    }
    let alive = true
    void getNativeVersion().then((v) => {
      if (alive && v !== null) setLocalVer(v)
    })
    return () => {
      alive = false
    }
  }, [])

  // 仅在确认处于原生壳（拿到本地版本）后才发起查询；失败静默
  const infoQuery = trpc.app.versionInfo.useQuery(undefined, {
    enabled: localVer !== null,
    staleTime: Infinity,
    retry: false,
  })

  const data = infoQuery.data
  const latest = parseInt(data?.latestApkVersion ?? '', 10)
  const shouldPrompt =
    localVer !== null && Number.isFinite(latest) && latest > localVer

  // 可见性由数据直接推导（原为 effect 内 setState，会触发级联渲染）
  const open = shouldPrompt && !dismissed

  const force = data?.force === true
  /** 强制更新不给「暂不」，也不允许点遮罩关闭 */
  const close = () => {
    if (!force) setDismissed(true)
  }
  const goUpdate = () => {
    // 原生壳内 window.open 走系统浏览器打开 APK 下载地址
    if (data?.apkUrl) window.open(data.apkUrl, '_blank')
    if (!force) setDismissed(true)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.button
            type="button"
            aria-label="关闭更新提示"
            className="fixed inset-0 z-[80] bg-ink/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <m.div
            role="dialog"
            aria-label="发现新版本"
            className="fixed inset-x-0 bottom-0 z-[90] mx-auto max-w-md rounded-t-[20px] bg-paper px-6 pt-3"
            style={{ paddingBottom: 'max(var(--safe-bottom), 24px)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
            <div className="flex flex-col items-center text-center">
              <span className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-olive-tint text-olive">
                <Download size={26} strokeWidth={1.8} />
              </span>
              <h2 className="text-[17px] font-semibold text-ink">
                发现新版本 v{data?.latestApkVersion}
              </h2>
              {data?.notes ? (
                <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-line text-[13px] leading-[20px] text-ink-60">
                  {data.notes}
                </p>
              ) : (
                <p className="mt-1.5 text-[13px] leading-[20px] text-ink-60">
                  新版本包含功能更新与体验优化，建议升级
                </p>
              )}
              <button
                type="button"
                onClick={goUpdate}
                className="mt-5 h-12 w-full rounded-full bg-olive text-[15px] font-semibold text-paper-white active:brightness-95"
              >
                去更新
              </button>
              {!force && (
                <button
                  type="button"
                  onClick={close}
                  className="mt-3 text-[13px] text-ink-40"
                >
                  暂不更新
                </button>
              )}
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  )
}
