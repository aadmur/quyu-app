/**
 * 本项目为手机壳层 App 形态，无传统桌面顶部导航。
 * 此文件为轻量占位：复用 Layout 的 StatusBar 实现，保持统一引用入口。
 * 注意：不要把桌面式导航栏加进手机壳（壳层导航见 Layout.tsx 的 TabBar）。
 */
import { StatusBar } from './Layout'

export { StatusBar }
export default StatusBar
