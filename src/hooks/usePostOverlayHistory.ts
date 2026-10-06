import { useCallback, useEffect, useRef } from 'react'

/**
 * 帖子弹层与地址栏 / history 的同步（v14）
 *
 * 约定：弹层打开时压一条 /post/:id 记录，关闭时 history.back()。这样刷新、
 * 前进后退、安卓物理返回都和「真的进了详情页」一致。
 *
 * 为什么用原生 pushState 而不是 react-router 的 navigate：
 * / 与 /post/:id 是 Layout 下的**兄弟路由**，走 navigate 会把 Home 整棵卸载 ——
 * 分页累积、滚动位置、tab 停留位、点赞态全丢，这正是本次要修的根因。弹层的意义
 * 就是让 Home 不卸载，所以地址栏改写必须绕开 router。
 *
 * 代价与对策：router 的 location 会停在 '/'（它不知道我们 push 过），因此
 * 浏览器/物理返回必须靠下面的 popstate 监听兜住，把「后退一格」翻译成「关弹层」。
 * 另一处已知取舍：弹层开着时用户走 TabBar 去了别的页面，我们压的那条记录会留在
 * 历史里（从新页面返回会先看到该帖的路由页版），这是 Home 卸载前无法回收的。
 */
export function usePostOverlayHistory(openPostId: number | null) {
  /** 已压进 history 的帖子 id；null 表示当前没有属于我们的记录 */
  const pushedRef = useRef<number | null>(null)

  useEffect(() => {
    if (openPostId == null) return
    pushedRef.current = openPostId
    const state = (window.history.state ?? {}) as Record<string, unknown>
    window.history.pushState({ ...state, qyPost: openPostId }, '', `/post/${openPostId}`)
  }, [openPostId])

  /**
   * 后退（浏览器按钮 / 安卓物理键 / 主动关闭）统一从这里收敛：
   * 返回真正的关闭动作，供弹层外壳在退场前调用。
   */
  const backFromPost = useCallback(() => {
    if (pushedRef.current == null) return
    pushedRef.current = null
    window.history.back()
  }, [])

  /** popstate 已经发生（地址栏回到 '/'）：标记记录已被消费，只通知外部关弹层 */
  const consumePop = useCallback(() => {
    const had = pushedRef.current != null
    pushedRef.current = null
    return had
  }, [])

  return { backFromPost, consumePop }
}
