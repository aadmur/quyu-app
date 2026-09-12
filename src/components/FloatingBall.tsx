import { useNavigate } from 'react-router-dom'

/**
 * 哪钓 · 水淋淋悬浮球（分支④：纯 CSS 实现，零依赖、不增包体）。
 *
 * - 仅首页挂载（见 Layout.tsx），固定右下角、避开底部 TabBar 与安全区。
 * - 球体：径向渐变 + 表面高光（::before）+ 轻微上下浮动；
 *   水淋淋：3 颗水珠 @keyframes 从顶部滑落 + 底部内阴影营造水体感。
 * - 文案「哪钓」白色描边居中，复用品牌字。
 * - 不用 framer-motion 高级能力（layoutId/drag/useMotionValue），
 *   避免把 domMax 拉进首屏静态闭包（check-motion-boundary 门禁）。
 */
const CSS = `
.qy-fishball {
  /* 相对手机壳（Layout 内 relative 容器）绝对定位：内容滚动时保持悬浮，桌面壳预览也不跑偏 */
  position: absolute;
  right: 16px;
  bottom: calc(max(var(--safe-bottom, 0px), 12px) + 76px);
  z-index: 30;
  width: 64px;
  height: 64px;
  border: none;
  border-radius: 50%;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  background: radial-gradient(circle at 32% 28%, #8fd8ff 0%, #3fa7e0 38%, #1e6fa8 68%, #0d3b5c 100%);
  box-shadow:
    0 8px 20px rgba(13, 59, 92, 0.35),
    inset 0 -6px 12px rgba(6, 40, 64, 0.45),
    inset 0 4px 8px rgba(255, 255, 255, 0.35);
  animation: qy-fishball-float 3.2s ease-in-out infinite;
}
.qy-fishball::before {
  content: "";
  position: absolute;
  top: 8%;
  left: 14%;
  width: 38%;
  height: 26%;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 70%);
  filter: blur(1px);
  transform: rotate(-18deg);
  pointer-events: none;
}
.qy-fishball-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 20px;
  letter-spacing: 1px;
  text-shadow: 0 1px 3px rgba(6, 40, 64, 0.6), 0 0 6px rgba(255, 255, 255, 0.4);
  pointer-events: none;
}
.qy-fishball .qy-drop {
  position: absolute;
  top: 0;
  width: 6px;
  height: 9px;
  border-radius: 50% 50% 60% 60%;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.95), rgba(160, 220, 255, 0.35));
  opacity: 0;
  animation: qy-drop-fall 2.6s ease-in infinite;
  pointer-events: none;
}
@keyframes qy-drop-fall {
  0% { transform: translateY(-12px) scale(0.6); opacity: 0; }
  15% { opacity: 0.9; }
  80% { opacity: 0.7; }
  100% { transform: translateY(70px) scale(1); opacity: 0; }
}
@keyframes qy-fishball-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
.qy-fishball:active { transform: scale(0.94); }
`

export default function FloatingBall() {
  const navigate = useNavigate()
  return (
    <>
      <style>{CSS}</style>
      <button
        type="button"
        aria-label="哪钓 · 拍照识别钓点"
        className="qy-fishball"
        onClick={() => navigate('/fish-spot')}
      >
        <span className="qy-drop" style={{ left: '22%', animationDelay: '0s' }} />
        <span className="qy-drop" style={{ left: '52%', animationDelay: '0.9s' }} />
        <span className="qy-drop" style={{ left: '72%', animationDelay: '1.7s' }} />
        <span className="qy-fishball-label">哪钓</span>
      </button>
    </>
  )
}
