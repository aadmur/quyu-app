/**
 * 悬浮球的手势判定与菜单定位——纯函数，抽出来是为了能测。
 * @file src/lib/fishballMenu.ts
 *
 * 为什么单独一个文件：v8.13.0 把悬浮球从"点一下进哪钓"改成"点一下弹菜单"，
 * 结果用户报「哪钓打不开」（backlog B-45）。两条已确认的事实都发生在**渲染层之外**，
 * 本来只能靠肉眼在真机上看：
 *   ① 菜单是 `position: fixed` 钉在**视口**右下，而球可以拖到左缘并吸附、位置存在 localStorage 里
 *      ——浏览器实测菜单中心离球中心 186px，用户点下去只看到屏幕暗了一下；
 *   ② 点按与长按/拖拽混在一起，多一步就把老习惯打断。
 * 把"该打开菜单还是该直接进哪钓"和"菜单该开在哪"写成纯函数，这两件事就能用断言钉住，
 * 而不是等真机上再发现。定位一律**由球的实际 rect 推导**，不引用视口常量。
 */

/** 长按判定阈值：到点就立刻开菜单（不等松手，避免"按住不动然后什么都不发生"） */
export const LONG_PRESS_MS = 450;
/** 位移超过这个和就认定为拖拽，不是点按（与 FloatingBall 原实现同口径：|dx|+|dy|） */
export const MOVE_SLOP = 6;
/** 菜单尺寸：用于把菜单钳回视口内。与 CSS 里的按钮padding/字号大致对应，改样式要同步改这里 */
export const MENU_W = 168;
export const MENU_H = 96;
/** 菜单与球之间留的缝隙，以及距视口边缘的最小间距 */
export const GAP = 10;
export const EDGE_PAD = 8;

export type BallAction = 'navigate' | 'menu' | 'drag';

/**
 * 手势分类。`heldMs` 是从 pointerdown 到现在的毫秒数，`moved` 是位移是否超过 MOVE_SLOP。
 * 规则（B-45 的验收标准第 1 条）：**没拖动也没长按 = 直接进哪钓**，恢复 v14 之前那一下的手感。
 */
export function classifyGesture(input: { moved: boolean; heldMs: number }): BallAction {
  if (input.moved) return 'drag';
  return input.heldMs >= LONG_PRESS_MS ? 'menu' : 'navigate';
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Anchor {
  left: number;
  top: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * 由球的 rect 推导菜单位置：横向与球同侧对齐，纵向优先摆在球上方（放不下就摆下方），
 * 最后整体钳进视口。**不允许引用视口右下之类的固定常量**——那正是 B-45 的病根。
 */
export function menuAnchor(ball: Rect, vw: number, vh: number): Anchor {
  const ballCenterX = ball.left + ball.width / 2;
  const ballOnLeftHalf = ballCenterX < vw / 2;
  // 期望菜单与球同侧对齐：左半贴着球的左缘，右半让菜单右缘贴着球的右缘
  const wantLeft = ballOnLeftHalf ? ball.left : ball.left + ball.width - MENU_W;
  // 纵向优先上方；上方放不下就翻到球下方
  const above = ball.top - GAP - MENU_H;
  const wantTop = above >= EDGE_PAD ? above : ball.top + ball.height + GAP;
  return {
    left: clamp(wantLeft, EDGE_PAD, vw - MENU_W - EDGE_PAD),
    top: clamp(wantTop, EDGE_PAD, vh - MENU_H - EDGE_PAD),
  };
}

/**
 * 旧写法（v8.13.0 上线那一版）的定位等价式：`right: MARGIN+4`、`bottom ≈ 160`。
 * 抽成函数只为了一个用途——**让测试能证明这道判据会变红**：
 * 同一个"贴左缘"的球，它算出来的位置离球 200px 开外，正是用户报的"点了没反应"。
 */
export function legacyViewportAnchor(vw: number, vh: number): Anchor {
  return { left: vw - 20 - MENU_W, top: vh - 160 - MENU_H };
}
