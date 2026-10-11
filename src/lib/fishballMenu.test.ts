/**
 * B-45 的回归测试：悬浮球点按必须直接进哪钓；菜单必须**跟着球**而不是钉视口角。
 * @file src/lib/fishballMenu.test.ts
 *
 * 最后两组是**负向断言**：同一夹具喂给 v8.13.0 那个 `right:20 / bottom:160` 的等价式，
 * 断言它离球真的远到"用户以为没反应"。这样这道测试就不是"我写了一个刚好等于实现的期望值"——
 * 新公式过、旧公式不过，判据的牙齿是被证明的，不是被声称的。
 */
import { describe, expect, it } from "vitest";
import {
  EDGE_PAD,
  GAP,
  LONG_PRESS_MS,
  MENU_H,
  MENU_W,
  classifyGesture,
  legacyViewportAnchor,
  menuAnchor,
  type Rect,
} from "./fishballMenu";

const VW = 416;
const VH = 577;
// 浏览器实测过的那组数：球贴左缘吸附后的大致位置
const BALL_LEFT: Rect = { left: 16, top: 425, width: 64, height: 64 };

/** 菜单中心到球中心的距离——就是用户"看不见菜单"的那个距离 */
function gapToBall(anchor: { left: number; top: number }, ball: Rect): number {
  return Math.hypot(anchor.left + MENU_W / 2 - (ball.left + ball.width / 2), anchor.top + MENU_H / 2 - (ball.top + ball.height / 2));
}

describe("手势分类：点按不再被菜单吃掉", () => {
  it("没拖动、没按住 = 直接进哪钓（把 v14 那一下的手感还回来）", () => {
    expect(classifyGesture({ moved: false, heldMs: 120 })).toBe("navigate");
  });
  it("按住到阈值才开菜单", () => {
    expect(classifyGesture({ moved: false, heldMs: LONG_PRESS_MS })).toBe("menu");
    expect(classifyGesture({ moved: false, heldMs: LONG_PRESS_MS + 400 })).toBe("menu");
  });
  it("差 1ms 没到阈值仍然是进哪钓（阈值不是摆设）", () => {
    expect(classifyGesture({ moved: false, heldMs: LONG_PRESS_MS - 1 })).toBe("navigate");
  });
  it("位移超线就算拖拽：既不跳转也不弹菜单", () => {
    expect(classifyGesture({ moved: true, heldMs: 1000 })).toBe("drag");
  });
});

describe("菜单定位：跟着球，不跟视口角", () => {
  it("球贴左缘时菜单与球左缘对齐（误差 ≤ EDGE_PAD）", () => {
    const a = menuAnchor(BALL_LEFT, VW, VH);
    expect(Math.abs(a.left - BALL_LEFT.left)).toBeLessThanOrEqual(EDGE_PAD);
    expect(a.left).toBeLessThan(VW / 2);
  });
  it("菜单摆在球上方，缝隙就是 GAP", () => {
    const a = menuAnchor(BALL_LEFT, VW, VH);
    expect(BALL_LEFT.top - (a.top + MENU_H)).toBe(GAP);
  });
  it("球在右缘（默认位）时菜单右缘贴球右缘", () => {
    const ball: Rect = { left: VW - 16 - 64, top: 425, width: 64, height: 64 };
    expect(menuAnchor(ball, VW, VH).left + MENU_W).toBe(ball.left + ball.width);
  });
  it("球被拖到接近顶部时菜单翻到球下方，且仍在视口内", () => {
    const ball: Rect = { left: 16, top: 20, width: 64, height: 64 };
    const a = menuAnchor(ball, VW, VH);
    expect(a.top).toBe(ball.top + ball.height + GAP);
    expect(a.top + MENU_H).toBeLessThanOrEqual(VH - EDGE_PAD);
  });
  it("任何球位菜单都钳在视口内（溢出到屏幕外等于'点了没反应'）", () => {
    for (const top of [0, 120, 300, 470, 520]) {
      for (const left of [0, 16, 176, 336]) {
        const a = menuAnchor({ left, top, width: 64, height: 64 }, VW, VH);
        expect(a.left).toBeGreaterThanOrEqual(EDGE_PAD);
        expect(a.left + MENU_W).toBeLessThanOrEqual(VW - EDGE_PAD);
        expect(a.top).toBeGreaterThanOrEqual(EDGE_PAD);
        expect(a.top + MENU_H).toBeLessThanOrEqual(VH - EDGE_PAD);
      }
    }
  });
});

describe("负向：这道判据能变红", () => {
  it("同一夹具下 v8.13.0 的旧公式离球远到 150px 以上（B-45 报的现象）", () => {
    const old = legacyViewportAnchor(VW, VH);
    expect(gapToBall(old, BALL_LEFT)).toBeGreaterThan(150);
  });
  it("新公式把同一个球位的距离压到 120px 以内，且严格小于旧公式", () => {
    const a = menuAnchor(BALL_LEFT, VW, VH);
    const old = legacyViewportAnchor(VW, VH);
    expect(gapToBall(a, BALL_LEFT)).toBeLessThan(gapToBall(old, BALL_LEFT));
    expect(gapToBall(a, BALL_LEFT)).toBeLessThan(120);
  });
  it("新旧公式在同一球位必须给出不同结果（相同就说明测试没测到东西）", () => {
    expect(menuAnchor(BALL_LEFT, VW, VH)).not.toEqual(legacyViewportAnchor(VW, VH));
  });
});
