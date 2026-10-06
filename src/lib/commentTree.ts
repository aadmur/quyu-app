/**
 * 两层楼中楼评论树组装（v14 抽公用）
 *
 * 迭代前这段逻辑在 PostDetail.tsx 里手写了一份（把扁平评论按 parentId 分组成
 * 「顶层 + 回复」两层），CommentSheet 又是另一套平铺形态 —— 同一份数据两种形状，
 * 而且 CommentSheet 完全忽略 parentId，楼中楼在它那儿是塌的。
 *
 * v14 删掉 CommentSheet，看帖/评论全局只剩 PostContent 一种形态；这里把组装逻辑
 * 抽成纯函数，供 PostContent（弹层 + /post/:id 路由页共用）渲染，也供「展开更多
 * 回复」追加数据后重算。
 *
 * 两个约定：
 * - 最多两层：回复只挂在顶层评论下，回复的回复也归并到同一个顶层楼（后端契约里
 *   parentId 指向的永远是顶层楼，不会真的三层嵌套）。
 * - 软删评论（deletedAt 非空）依然出现在列表里，渲染成灰色占位；它楼下的回复
 *   **不能跟着塌**，所以分组完全不看 deleted 标记。
 */
import type { CommentView } from '@/lib/live'

export interface CommentTree {
  /** 顶层评论，保持服务端顺序（sort=latest 时间倒序 / sort=hot 热度序），前端不再重排 */
  top: CommentView[]
  /**
   * 顶层评论 id → 楼内回复，按时间正序（列表整体倒序，楼内对话正序读着更自然）。
   *
   * 与后端分页方向的关系（这里刻意不「改成倒序」，说清取舍）：
   * - 后端每楼嵌的是**楼内最新 2 条**，排序 (created_at DESC, id DESC)（community.ts:434 + :461 slice）；
   * - 「展开更多回复」的 commentReplies 也是 DESC keyset，每翻一页拿到的是**更老**的一批（:503-518）；
   * - 所以「老的追加在数组尾部」并不会让顺序错乱：正序 sort 会把每一批重新放回它该在的时间位置，
   *   整楼始终时间单调递增。真正无法在前端消掉的是**方向感**：按钮在列表底部，展开出来的却是
   *   更老的回复，位置出现在按钮上方（微信式楼中楼也是这个行为）。
   *   要连这个也修掉，只有两条路：楼内改成倒序渲染（对话读起来是反的），或者后端把子分页
   *   改成「从最老开始正序翻」（动 api/ 契约）。本轮后者不允许动，前者不值，故保留正序。
   */
  replies: Map<number, CommentView[]>
}

/**
 * 把评论列表归并成两层树。
 * 入参兼容两种来源：服务端已嵌套好 replies 的 CommentNode，以及「展开更多回复」
 * 后追加进来的扁平回复（parentId 指向顶层楼）。同 id 只保留一次，避免两个来源重叠。
 */
export function buildCommentTree(list: CommentView[]): CommentTree {
  const top: CommentView[] = []
  const seenTop = new Set<number>()
  const seenReply = new Set<number>()
  const replies = new Map<number, CommentView[]>()

  const attach = (parentId: number, r: CommentView) => {
    if (seenReply.has(r.id)) return
    seenReply.add(r.id)
    const arr = replies.get(parentId)
    if (arr) arr.push(r)
    else replies.set(parentId, [r])
  }

  for (const c of list) {
    if (c.parentId == null) {
      if (!seenTop.has(c.id)) {
        seenTop.add(c.id)
        top.push(c)
      }
      // 服务端把楼内回复直接挂在 replies 上，一并收进树
      for (const r of c.replies) attach(c.id, r)
    } else {
      attach(c.parentId, c)
    }
  }

  // 楼内正序，且必须带 id 兜底才是全序：
  // 后端 comments.created_at 是无小数秒的 MySQL TIMESTAMP（db/schema.ts:188），同一秒内的两条回复
  // createdAtMs 完全相同；服务端自己的排序是 (created_at DESC, id DESC)（community.ts:434），
  // 嵌在父评论上的预览回复因此按「新→旧」到达。若这里只比 createdAtMs，Array.sort 虽然稳定，
  // 稳定 = 保持这份「新→旧」的输入序，同秒的两条就会反着显示。补上 id 升序，跟服务端兜底口径对齐。
  for (const arr of replies.values()) arr.sort((a, b) => a.createdAtMs - b.createdAtMs || a.id - b.id)

  return { top, replies }
}

/**
 * 把回复并进所属顶层楼的 replies 里（同 id 只保留一次）。
 * 两个来源会共用这个入口：「展开更多回复」翻页回来的历史回复，以及用户刚发出的
 * 那条回复（posts.comment 的返回值直接并进本地，不再整表失效重请求）。
 */
export function appendReplies(list: CommentView[], parentId: number, replies: CommentView[]): CommentView[] {
  return list.map((c) => {
    if (c.id !== parentId) return c
    const seen = new Set(c.replies.map((r) => r.id))
    const fresh = replies.filter((r) => r.id !== parentId && !seen.has(r.id))
    return fresh.length > 0 ? { ...c, replies: [...c.replies, ...fresh] } : c
  })
}

/** 评论点赞数/点赞态的不可变改写：供「乐观改一条评论」时在列表里就地替换 */
export function patchComment(list: CommentView[], id: number, mutate: (c: CommentView) => CommentView): CommentView[] {
  return list.map((c) => {
    if (c.id === id) return mutate(c)
    // 回复可能已经嵌在父评论里，也要能改到（否则楼内点赞点了没反应）
    if (c.replies.some((r) => r.id === id)) {
      return { ...c, replies: c.replies.map((r) => (r.id === id ? mutate(r) : r)) }
    }
    return c
  })
}
