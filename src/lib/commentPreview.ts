/**
 * 帖子「首条评论预览」的客户端旁路缓存（v14）
 *
 * 背景：迭代前列表卡片会渲染一行首条评论预览，但 lib/live.ts 的 mapFeedPost 把
 * 真实帖子的 comments 恒写成 []，所以这个预览**对真实帖子从来没出现过**（只有
 * 本地演示数据能看到）。
 *
 * v14 之后 app.feed 载荷瘦身（连 images 都只留 cover 首图），更不可能透传评论。
 * 让每张卡片各发一次 posts.comments 去换一行预览，成本完全不可接受。
 *
 * 因此改成「谁看过这条帖子，就把他看到的首条评论留在本地」：帖子弹层/详情页拿到
 * 评论后写入这里，卡片即时补上预览（useSyncExternalStore 订阅）。冷启动时卡片只有
 * 「查看全部 N 条评论」没有预览 —— 这是诚实的：不给用户看没请求过的数据。
 *
 * 只在内存里，不落 localStorage：预览跟着会话走，重启后重新按需积累。
 */
import { useSyncExternalStore } from 'react'

export interface CommentPreview {
  name: string
  text: string
}

const previews = new Map<number, CommentPreview>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/** 写入某帖的首条评论预览；内容未变则不通知（避免卡片无谓重渲染） */
export function setTopComment(postId: number, preview: CommentPreview | null) {
  const cur = previews.get(postId)
  if (cur?.name === preview?.name && cur?.text === preview?.text) return
  if (preview) previews.set(postId, preview)
  else previews.delete(postId)
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 帖子卡片用：读首条评论预览（没有则 null，卡片退化为只显示「查看全部 N 条评论」） */
export function useTopComment(postId: number | undefined): CommentPreview | null {
  // getSnapshot 必须返回稳定引用：Map 里同一个 value 对象在被覆盖前引用不变，
  // 缺失时恒返回 null 字面量，两者都不会引起 useSyncExternalStore 的死循环重渲染。
  return useSyncExternalStore(subscribe, () => (postId == null ? null : (previews.get(postId) ?? null)))
}
