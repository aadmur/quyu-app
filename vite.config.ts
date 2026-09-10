import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /**
         * vendor 分组切块（QY-PERF-002）。
         *
         * 目的有二：
         * 1. 把「几乎不随业务变化的第三方库」与「每次发版都变的业务代码」
         *    分离，使前者能被浏览器长期缓存 —— 只改业务逻辑时，用户
         *    二次访问只需重新下载业务 chunk。
         * 2. 避免 React 与 framer-motion 挤在同一 chunk 里被整体失效。
         *
         * 注意：这里只做 vendor 分组，业务页面的拆分靠 App.tsx 的
         * React.lazy 动态 import 自动完成，无需在此枚举。
         *
         * ⚠️ framer-motion 必须**排除**在 manualChunks 之外（QY-PERF-005 踩坑记录）：
         * manualChunks 一旦命中，Rollup 会把整个包（含动态 import 的 domMax）
         * 强制塞进同一个 chunk，而该 chunk 被 index.html 静态引用 →
         * domMax 的 layout/drag 代码被拖回首屏，LazyMotion 收益归零
         * （实测首屏 br 从 221 KB 反弹到 233 KB）。
         * 因此这里只显式分组，把 framer-motion 留给 Rollup 按
         * 「谁静态引用谁」自动切分：domAnimation 随 entry，domMax 独立懒加载。
         */
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react"
          if (/[\\/]node_modules[\\/](@trpc|@tanstack)[\\/]/.test(id)) return "vendor-data"
          if (/[\\/]node_modules[\\/]react-router/.test(id)) return "vendor-router"
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "vendor-icons"
          if (/[\\/]node_modules[\\/](date-fns|zod|superjson|jose|nanoid|cookie)[\\/]/.test(id)) return "vendor-utils"
          if (/[\\/]node_modules[\\/]@capacitor[\\/]/.test(id)) return "vendor-capacitor"
          return undefined
        },
      },
    },
  },
});
