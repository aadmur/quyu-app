/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  // 只扫描真实源码：项目全为 ts/tsx，去掉 js/jsx 可少扫一遍；
  // 亦不再包含已删除的 shadcn ui 组件（QY-PERF-007）
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', '"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei"', 'sans-serif'],
        num: ['"Bebas Neue"', '"Oswald"', '-apple-system', '"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei"', 'sans-serif'],
      },
      /**
       * 色板只保留产品自有 token（QY-PERF-007）。
       * 原先还挂着 shadcn 语义色（background / foreground / card / popover /
       * primary / secondary / muted / accent / destructive / border / input /
       * ring / sidebar），它们只服务于已删除的 51 个 ui 组件，会把整套 CSS
       * 变量与对应工具类打进产物。
       */
      colors: {
        ink: {
          DEFAULT: "#2d1e1e",
          60: "#2d1e1e99",
          40: "#2d1e1e66",
        },
        paper: {
          DEFAULT: "#f2f0e6",
          white: "#ffffff",
        },
        olive: {
          DEFAULT: "#716a4b",
          deep: "#57523a",
          tint: "#716a4b14",
        },
        lake: {
          DEFAULT: "#5e7a6e",
          tint: "#5e7a6e1a",
        },
        clay: "#a8512f",
        heart: "#b3502e",
        line: "#2d1e1e14",
      },
      /**
       * 裸 `border`（不带颜色）的默认色。
       * 原实现靠 `* { @apply border-border; }` 全局设置 border-color，该规则
       * 随 shadcn 变量一并移除；若不补默认值，裸 `border` 会退回 currentColor
       * （深色文字色），出现比预期重得多的描边。这里统一取产品 hairline 色。
       */
      borderColor: {
        DEFAULT: "#2d1e1e14",
      },
      /**
       * 圆角刻度（保留）。全项目 rounded-xl 用了 101 处、rounded-lg 21 处，
       * 它们都建立在 --radius 之上；若退回 Tailwind 默认刻度，这些圆角会
       * 各缩小约 2px（xl 14px→12px、lg 10px→8px），属可见回归。
       * --radius 定义在 src/index.css 的 :root，仅依赖本产品自己的刻度。
       */
      borderRadius: {
        xs: "calc(var(--radius) - 6px)",
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
    },
  },
  // 无需插件：原先的 tailwindcss-animate 只服务 radix accordion / input-otp
  // 等已删除组件，其提供的 animate-in / fade-in 系列类在全项目零使用。
  plugins: [],
}
