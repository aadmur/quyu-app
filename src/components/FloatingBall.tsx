import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 哪钓 · 水淋淋悬浮球（重新设计版）
 *
 * 视觉：
 * - 配色：清水感青碧渐变（#d9f6fb→#7fd6e6→#35aec2→#1d8093→#0e5563），
 *   冷调水珠与暖调 paper/olive/lake 形成干净对比又协调统一。
 * - 阴影：环境投影 + 近景投影 + 浅色描边环（深色背景下可辨）+ 底部水体内阴影 + 顶部边缘光，分层递进。
 * - 结构：64px 可点区（≥44px 触控目标）包 56px 球体，三层嵌套分离变换，互不冲突：
 *   button(拖拽位移 inline) → .qy-fishball-float(上下浮动动画) → .qy-fishball-sphere(状态缩放/阴影)。
 *
 * 交互四态：默认（轻浮浮动）/ 悬停（浮起+投影加深）/ 按下（下沉+投影压缩）/ 拖拽（最强浮起+暂停浮动）。
 * 拖拽：指针事件手写（不用 framer-motion drag，避免 check-motion-boundary 门禁），
 *   垂直自由、水平松手吸附左右边缘、位置持久化到 localStorage；区分点按(<6px)与拖拽。
 * 桌面(hover/鼠标拖)与移动端(触摸拖/点按)统一走 Pointer Events。
 */
const HIT = 64 // 可点区直径（px）
const MARGIN = 16 // 距壳边缘间距
const POS_KEY = 'qy-fishball-pos'

const CSS = `
.qy-fishball {
  position: absolute;
  right: ${MARGIN}px;
  bottom: calc(max(var(--safe-bottom, 0px), 12px) + 76px);
  z-index: 30;
  width: ${HIT}px;
  height: ${HIT}px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: grab;
  touch-action: none;            /* 拖拽接管手势，不与页面滚动冲突 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.3, 1.2); /* 松手吸附回弹 */
}
.qy-fishball.qy-dragging {
  cursor: grabbing;
  transition: none;              /* 拖拽中跟随手指，无过渡 */
}
.qy-fishball:focus-visible {
  outline: 2px solid #1d8093;
  outline-offset: 3px;
  border-radius: 50%;
}

/* 上下浮动层（拖拽时暂停） */
.qy-fishball-float {
  display: block;
  width: 56px;
  height: 56px;
  animation: qy-fishball-float 3.4s ease-in-out infinite;
}
.qy-fishball.qy-dragging .qy-fishball-float { animation: none; }

/* 球体：渐变 + 分层阴影 + 状态缩放 */
.qy-fishball-sphere {
  position: relative;
  display: block;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  background: radial-gradient(circle at 32% 26%, #d9f6fb 0%, #7fd6e6 22%, #35aec2 48%, #1d8093 72%, #0e5563 100%);
  box-shadow:
    0 14px 28px -6px rgba(14, 85, 99, 0.45),      /* 环境投影 */
    0 4px 10px -2px rgba(14, 85, 99, 0.30),        /* 近景投影 */
    0 0 0 1px rgba(255, 255, 255, 0.22),           /* 浅色描边环：深色背景下清晰可辨 */
    inset 0 -10px 16px -6px rgba(8, 46, 56, 0.55), /* 底部水体深度 */
    inset 0 4px 8px -2px rgba(255, 255, 255, 0.50);/* 顶部边缘光 */
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
/* 主高光（左上镜面） */
.qy-fishball-sphere::before {
  content: "";
  position: absolute;
  top: 9%; left: 15%;
  width: 36%; height: 24%;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(255,255,255,0.95), rgba(255,255,255,0) 70%);
  filter: blur(1px);
  transform: rotate(-16deg);
  pointer-events: none;
}
/* 底部反光（水体反照） */
.qy-fishball-sphere::after {
  content: "";
  position: absolute;
  bottom: 11%; right: 18%;
  width: 22%; height: 14%;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(255,255,255,0.35), rgba(255,255,255,0) 70%);
  filter: blur(1px);
  pointer-events: none;
}
/* 文案「哪钓」 */
.qy-fishball-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-weight: 700;
  font-size: 19px;
  letter-spacing: 1px;
  text-shadow: 0 1px 2px rgba(8, 46, 56, 0.55), 0 0 8px rgba(255, 255, 255, 0.30);
  pointer-events: none;
}
/* 水珠滑落 */
.qy-fishball .qy-drop {
  position: absolute;
  top: 0;
  width: 6px;
  height: 9px;
  border-radius: 50% 50% 60% 60%;
  background: linear-gradient(to bottom, rgba(255,255,255,0.95), rgba(160,220,255,0.35));
  opacity: 0;
  animation: qy-drop-fall 2.8s ease-in infinite;
  pointer-events: none;
}

/* 悬停（桌面）：浮起 + 投影加深 + 高光变亮 */
.qy-fishball:hover .qy-fishball-sphere {
  transform: scale(1.06);
  box-shadow:
    0 20px 36px -6px rgba(14, 85, 99, 0.50),
    0 6px 14px -2px rgba(14, 85, 99, 0.34),
    0 0 0 1px rgba(255, 255, 255, 0.30),
    inset 0 -10px 16px -6px rgba(8, 46, 56, 0.55),
    inset 0 5px 10px -2px rgba(255, 255, 255, 0.60);
}
/* 按下：下沉 + 投影压缩 */
.qy-fishball:active .qy-fishball-sphere {
  transform: scale(0.92);
  box-shadow:
    0 6px 14px -4px rgba(14, 85, 99, 0.40),
    0 2px 6px -2px rgba(14, 85, 99, 0.28),
    0 0 0 1px rgba(255, 255, 255, 0.20),
    inset 0 -8px 14px -6px rgba(8, 46, 56, 0.60),
    inset 0 3px 6px -2px rgba(255, 255, 255, 0.40);
}
/* 拖拽中：最强浮起 + 更强描边 */
.qy-fishball.qy-dragging .qy-fishball-sphere {
  transform: scale(1.10);
  box-shadow:
    0 26px 44px -8px rgba(14, 85, 99, 0.55),
    0 8px 18px -2px rgba(14, 85, 99, 0.36),
    0 0 0 1.5px rgba(255, 255, 255, 0.42),
    inset 0 -10px 16px -6px rgba(8, 46, 56, 0.55),
    inset 0 5px 10px -2px rgba(255, 255, 255, 0.65);
}

@keyframes qy-drop-fall {
  0% { transform: translateY(-12px) scale(0.6); opacity: 0; }
  15% { opacity: 0.9; }
  80% { opacity: 0.7; }
  100% { transform: translateY(66px) scale(1); opacity: 0; }
}
@keyframes qy-fishball-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

/* 功能选择菜单（v15：哪钓 / 识鱼） */
.qy-fishball-mask {
  position: fixed; inset: 0; z-index: 40;
  background: rgba(45, 30, 30, 0.25);
  opacity: 0; animation: qy-mask-in 0.18s ease forwards;
}
.qy-fishball-menu {
  position: fixed; z-index: 41;
  display: flex; flex-direction: column; gap: 8px;
  opacity: 0; transform: translateY(8px) scale(0.96);
  animation: qy-menu-in 0.22s cubic-bezier(0.2,0.8,0.3,1.2) forwards;
}
.qy-fishball-menu button {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 20px; border: 1px solid var(--color-line, #e0d5c5);
  border-radius: 14px; background: var(--color-paper-white, #fffaf5);
  font-size: 15px; font-weight: 600; color: var(--color-ink, #2d1e1e);
  box-shadow: 0 4px 16px rgba(45,30,30,0.10); cursor: pointer;
  transition: transform 0.12s ease;
}
.qy-fishball-menu button:active { transform: scale(0.96); }
.qy-fishball-menu button .qy-menu-icon { color: var(--color-lake, #1d8093); }
@keyframes qy-mask-in { to { opacity: 1; } }
@keyframes qy-menu-in { to { opacity: 1; transform: translateY(0) scale(1); } }
`

interface Pos { x: number; y: number }

function readPos(): Pos {
  try {
    const raw = window.localStorage.getItem(POS_KEY)
    if (!raw) return { x: 0, y: 0 }
    const p = JSON.parse(raw) as Partial<Pos>
    return { x: Number(p.x) || 0, y: Number(p.y) || 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

export default function FloatingBall() {
  const navigate = useNavigate()
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<Pos>(() => readPos())
  const [dragging, setDragging] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const drag = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0, moved: false, active: false })

  /** 量取手机壳尺寸（最近定位祖先），用于边缘吸附与边界钳制 */
  const shellRect = () => {
    const el = btnRef.current?.offsetParent as HTMLElement | null
    return { W: el?.clientWidth ?? 360, H: el?.clientHeight ?? 640 }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    btnRef.current?.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y, moved: false, active: true }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true
    const { W, H } = shellRect()
    // 水平：右缘(0) ↔ 左缘(-(W-HIT-2*MARGIN))；垂直：默认下方 ↔ 顶部留白
    const minX = -(W - HIT - MARGIN * 2)
    const maxUp = -(H - 76 - HIT - 56)
    const nx = Math.min(0, Math.max(minX, d.baseX + dx))
    const ny = Math.min(4, Math.max(maxUp, d.baseY + dy))
    setPos({ x: nx, y: ny })
  }

  const finishDrag = () => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    setDragging(false)
    if (!d.moved) {
      setShowMenu(true) // 点按：弹出功能选择菜单（v15：哪钓 / 识鱼）
      return
    }
    // 拖拽：水平吸附最近边缘，垂直保持
    const { W } = shellRect()
    const minX = -(W - HIT - MARGIN * 2)
    setPos((p) => {
      const snapped = { x: p.x < minX / 2 ? minX : 0, y: p.y }
      try { window.localStorage.setItem(POS_KEY, JSON.stringify(snapped)) } catch { /* 忽略 */ }
      return snapped
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setShowMenu(true)
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <button
        ref={btnRef}
        type="button"
        aria-label="AI 识别（哪钓识钓点 / 识鱼识鱼种，可拖动调整位置）"
        className={`qy-fishball${dragging ? ' qy-dragging' : ''}`}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={onKeyDown}
      >
        <span className="qy-fishball-float">
          <span className="qy-fishball-sphere">
            <span className="qy-drop" style={{ left: '22%', animationDelay: '0s' }} />
            <span className="qy-drop" style={{ left: '52%', animationDelay: '0.9s' }} />
            <span className="qy-drop" style={{ left: '72%', animationDelay: '1.7s' }} />
            <span className="qy-fishball-label">哪钓</span>
          </span>
        </span>
      </button>

      {showMenu && (
        <div className="qy-fishball-mask" onClick={() => setShowMenu(false)}>
          <div
            className="qy-fishball-menu"
            style={{ right: `${MARGIN + 4}px`, bottom: `calc(max(var(--safe-bottom, 0px), 12px) + 76px + ${HIT + 8}px)` }}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" onClick={() => { setShowMenu(false); navigate('/fish-spot') }}>
              <span className="qy-menu-icon">钓</span>
              哪钓 · 识钓点
            </button>
            <button type="button" onClick={() => { setShowMenu(false); navigate('/fish-id') }}>
              <span className="qy-menu-icon">鱼</span>
              识鱼 · 识鱼种
            </button>
          </div>
        </div>
      )}
    </>
  )
}
