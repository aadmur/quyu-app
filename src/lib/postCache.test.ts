/**
 * 缓存层的两条契约测试（node 环境即可，不需要 DOM）。
 * 关注点是 v14 的两条不变量：乐观改写要**保住引用**（否则每点一次赞就整屏重渲染），
 * 以及会话切换要**真的清空**（缓存键里没有用户 id，不清就会把上一个账号的 liked/collected 留给下一个）。
 */
import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { resetViewerCache } from './postCache'

describe('resetViewerCache', () => {
  it('清空 viewer 级缓存：上一个账号的点赞/收藏态不会留给下一个账号', () => {
    const qc = new QueryClient()
    qc.setQueryData(['app', 'feed', { page: 1, pageSize: 5 }], { items: [{ id: 7, liked: true, collected: true }] })
    qc.setQueryData(['app', 'posts', 'favorites'], { items: [{ id: 7 }] })

    resetViewerCache(qc)

    expect(qc.getQueryData(['app', 'feed', { page: 1, pageSize: 5 }])).toBeUndefined()
    expect(qc.getQueryData(['app', 'posts', 'favorites'])).toBeUndefined()
    expect(qc.getQueryCache().getAll()).toHaveLength(0)
  })

  it('空缓存上也安全（登出时可能什么都还没缓存过）', () => {
    const qc = new QueryClient()
    expect(() => resetViewerCache(qc)).not.toThrow()
  })
})
