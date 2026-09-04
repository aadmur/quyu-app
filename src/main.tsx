import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'
import { initSafeArea } from '@/lib/safeArea'

// 渲染前初始化安全区：Capacitor 安卓壳 env() 恒 0 时注入 --safe-top/--safe-bottom 兜底值
initSafeArea()

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      <App />
    </TRPCProvider>
  </BrowserRouter>,
)
