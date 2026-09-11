import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'
import { initSafeArea } from '@/lib/safeArea'
import { initPerfMonitor } from '@/lib/perf'

// 首屏埋点（QY-PERF-008）：必须早于 render 启动，以便用 buffered 拿到已发生的 paint 条目。
// 内部全程 try/catch，失败静默，不影响任何业务渲染。
initPerfMonitor()

// 渲染前初始化安全区：Capacitor 安卓壳 env() 恒 0 时注入 --safe-top/--safe-bottom 兜底值
initSafeArea()

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      <App />
    </TRPCProvider>
  </BrowserRouter>,
)
