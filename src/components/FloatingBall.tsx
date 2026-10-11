import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LONG_PRESS_MS, MOVE_SLOP, classifyGesture, menuAnchor, type Anchor } from '@/lib/fishballMenu'

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
 *   垂直自由、水平松手吸附左右边缘、位置持久化到 localStorage。
 * 一下手势的三种结局（判定在 @/lib/fishballMenu 里，有测试钉住）：
 *   点按 → 直接进哪钓；按住 ≥ LONG_PRESS_MS → 在**球旁边**开功能菜单；位移超 MOVE_SLOP → 拖拽吸附。
 *   ⚠️ B-45 的教训：v15 一度把"点按"改成"弹菜单"，结果老用户以为哪钓打不开——
 *     菜单必须跟随球的 rect（球可拖到左缘），且点按那一下不能再被菜单占走。
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

/* 功能选择菜单（v15：哪钓 / 识鱼；B-45 修正：只在长按时出现，位置由球的 rect 推导）
   ⚠️ 可见性**不再依赖动画**：旧写法是「opacity: 0 + animation ... forwards」，
   等于"看不见"与"动画没跑"是同一件事——一旦系统抑制动画（减少动效/省电），
   用户点下去只会看到屏幕暗了一下。现在基态就是可见的，动画只负责入场过渡。 */
.qy-fishball-mask {
  position: fixed; inset: 0; z-index: 40;
  background: rgba(45, 30, 30, 0.25);
  animation: qy-mask-in 0.18s ease both;
}
.qy-fishball-menu {
  position: fixed; z-index: 41;
  display: flex; flex-direction: column; gap: 8px;
  animation: qy-menu-in 0.22s cubic-bezier(0.2,0.8,0.3,1.2) both;
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
@keyframes qy-mask-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes qy-menu-in { from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: none; } }
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
  /** 菜单位置：打开那一刻由球的实际 rect 推导（见 @/lib/fishballMenu 的 menuAnchor） */
  const [menuPos, setMenuPos] = useState<Anchor | null>(null)
  const drag = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0, moved: false, active: false })
  const hold = useRef<{ timer: number | null; downAt: number }>({ timer: null, downAt: 0 })

  const clearHold = () => {
    if (hold.current.timer !== null) {
      window.clearTimeout(hold.current.timer)
      hold.current.timer = null
    }
  }

  /** 以球此刻在视口里的位置推导菜单位置——不再钉在视口右下角（B-45 的病根） */
  const openMenu = () => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setMenuPos(menuAnchor({ left: r.left, top: r.top, width: r.width, height: r.height }, window.innerWidth, window.innerHeight))
    setShowMenu(true)
  }

  // 卸载兜底：清掉还没到点的长按计时器，避免对已卸载组件 setState
  // （悬浮球只在首页挂载；v14 收尾修过两条同类残留，这次不留）
  useEffect(() => clearHold, [])

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
    // 长按计时器：到点立刻开菜单，不等松手——"按住不动然后什么都不发生"是最坏的手感
    clearHold()
    hold.current.downAt = e.timeStamp
    hold.current.timer = window.setTimeout(() => {
      if (!drag.current.active || drag.current.moved) return
      openMenu()
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) + Math.abs(dy) > MOVE_SLOP) {
      d.moved = true
      clearHold() // 一旦认定为拖拽，长按菜单就不该再弹
      // 菜单是开在球"当时"的位置上的：球被拖走就必须带走它，
      // 否则屏幕左上角会留下一个悬空的菜单（v14 收尾时修过的"未清理定时器"同一类残留）
      setShowMenu(false)
    }
    const { W, H } = shellRect()
    // 水平：右缘(0) ↔ 左缘(-(W-HIT-2*MARGIN))；垂直：默认下方 ↔ 顶部留白
    const minX = -(W - HIT - MARGIN * 2)
    const maxUp = -(H - 76 - HIT - 56)
    const nx = Math.min(0, Math.max(minX, d.baseX + dx))
    const ny = Math.min(4, Math.max(maxUp, d.baseY + dy))
    setPos({ x: nx, y: ny })
  }

  const finishDrag = (e?: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    setDragging(false)
    clearHold()
    const heldMs = (e?.timeStamp ?? 0) - hold.current.downAt
    const action = classifyGesture({ moved: d.moved, heldMs })
    if (action === 'navigate') {
      // B-45：点一下就是进哪钓。这条路径上**不出现全屏遮罩**——于是"同一次点击的 click
      // 被刚渲染出来的遮罩接走、菜单自己把自己关掉"那条我无法复现的假设，直接失去了发生条件。
      navigate('/fish-spot')
      return
    }
    if (action === 'menu') return // 长按计时器到点时已经开过菜单了
    // 拖拽：水平吸附最近边缘，垂直保持
    const { W } = shellRect()
    const minX = -(W - HIT - MARGIN * 2)
    setPos((p) => {
      const snapped = { x: p.x < minX / 2 ? minX : 0, y: p.y }
      try { window.localStorage.setItem(POS_KEY, JSON.stringify(snapped)) } catch { /* 忽略 */ }
      return snapped
    })
  }

  const cancelDrag = () => {
    // 手势被系统接管（来电、滚动抢指针等）时：什么都不做，只收尾
    const d = drag.current
    if (!d.active) return
    d.active = false
    setDragging(false)
    clearHold()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      navigate('/fish-spot') // 键盘同样是"一下进哪钓"，与触摸同口径
    } else if (e.key === 'ContextMenu' || e.key === 'Menu') {
      e.preventDefault()
      openMenu() // 键盘上的菜单键 = 长按的等价物
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
        onPointerCancel={cancelDrag}
        onKeyDown={onKeyDown}
        /* 长按现在是"打开功能菜单"的正式手势，所以要压掉系统自带的长按上下文菜单
           （安卓 WebView 上它会长出一个复制/选择气泡，盖住我们自己的菜单）。
           键盘的 Menu/ContextMenu 键走 onKeyDown 分支，不受这里影响。 */
        onContextMenu={(e) => e.preventDefault()}
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

      {showMenu && menuPos && (
        <div
          className="qy-fishball-mask"
          /* 关闭绑 pointerdown，不绑 click：菜单是 pointerup 那一刻才渲染的，而 click 会在
             pointerup 之后按落点重新命中——绑 click 等于把「同一次点击自己关掉菜单」的风险
             留在代码里（B-45 那条我没能复现的假设，现在让它失去发生条件：点按路径上没有遮罩）。 */
          onPointerDown={(e) => {
            if (!(e.target as HTMLElement).closest('.qy-fishball-menu')) setShowMenu(false)
          }}
        >
          <div
            className="qy-fishball-menu"
            style={{ left: `${menuPos.left}px`, top: `${menuPos.top}px` }}
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
