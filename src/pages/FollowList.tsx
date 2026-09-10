import { useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHeader from '@/components/trade/PageHeader'
import Toast from '@/components/community/Toast'
import { useToast } from '@/components/community/useToast'
import { useAuthGate } from '@/components/LoginSheet'
import { trpc } from '@/providers/trpc'

/** 列表项契约：与 api/services/social.ts 的 FollowListItem 对齐 */
type FollowListData = Array<{ id: number; name: string; avatar: string; isFollowingBack: boolean }>

interface ListQueryResult {
  data?: FollowListData
  isLoading: boolean
  isFetching: boolean
}

// 粉丝/关注列表路由由主代理接线（feature-router：posts.followersList / posts.followingList，无入参，查当前用户）。
// 接线前用结构化断言保留调用形态，接线后删除此断言即可恢复完整类型推导。
const followListsApi = trpc.app.posts as unknown as {
  followersList: {
    useQuery: (input?: undefined, opts?: { retry?: number; enabled?: boolean }) => ListQueryResult
  }
  followingList: {
    useQuery: (input?: undefined, opts?: { retry?: number; enabled?: boolean }) => ListQueryResult
  }
}

/**
 * 粉丝/关注列表页 /me/follows（QY-E-003，二级页）。
 * 顶部 Tab「粉丝 N / 关注 N」（N 来自 users.followStats）；列表项右侧关注/已关注按钮（toggleFollow，
 * 自己不显示；未登录点按钮弹登录引导）；支持 ?tab=following 直达关注 Tab。
 */
export default function FollowList() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { toast, showToast } = useToast()
  const { user, requireAuth, loginSheet } = useAuthGate()
  const utils = trpc.useUtils()

  const tab = params.get('tab') === 'following' ? 'following' : 'followers'
  const setTab = (key: 'followers' | 'following') => {
    setParams(key === 'following' ? { tab: 'following' } : {}, { replace: true })
  }

  // Tab 计数：未登录不请求，显示 0
  const statsQuery = trpc.app.users.followStats.useQuery(undefined, { enabled: !!user, staleTime: 30_000, retry: 1 })
  const followersCount = statsQuery.data?.followers ?? 0
  const followingCount = statsQuery.data?.following ?? 0

  // 两个 Tab 的列表独立查询，切 Tab 各自缓存；未登录不请求
  const followersQuery = followListsApi.followersList.useQuery(undefined, { retry: 1, enabled: !!user })
  const followingQuery = followListsApi.followingList.useQuery(undefined, { retry: 1, enabled: !!user })

  const activeQuery = tab === 'followers' ? followersQuery : followingQuery
  const items = activeQuery.data ?? []

  // 关注/取关：乐观切换（overrides 覆盖服务端值），失败回滚 + toast
  const [overrides, setOverrides] = useState<Record<number, boolean>>({})
  const followMut = trpc.app.posts.toggleFollow.useMutation()

  const onToggleFollow = (targetId: number, current: boolean) => {
    if (!requireAuth('关注钓友')) return
    const next = !current
    setOverrides((prev) => ({ ...prev, [targetId]: next }))
    followMut.mutate(
      { targetUserId: targetId },
      {
        onSuccess: (r: { following?: boolean }) => {
          setOverrides((prev) => ({ ...prev, [targetId]: r?.following ?? next }))
          void utils.app.users.followStats.invalidate()
        },
        onError: () => {
          setOverrides((prev) => ({ ...prev, [targetId]: current }))
          showToast('操作失败，请稍后再试')
        },
      },
    )
  }

  const emptyText = tab === 'followers' ? '还没有粉丝' : '还没有关注任何人'

  return (
    <div className="min-h-full bg-paper pb-8">
      <PageHeader title="关注与粉丝" />

      {/* Tab：粉丝 N / 关注 N（下划线指示，随 Profile 渔获墙 Tab 风格） */}
      <div className="flex h-11">
        {(
          [
            { key: 'followers', label: `粉丝 ${followersCount}` },
            { key: 'following', label: `关注 ${followingCount}` },
          ] as const
        ).map(({ key, label }) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              onClick={() => setTab(key)}
              className="relative flex flex-1 items-center justify-center"
            >
              <span className={`text-[15px] leading-[22px] ${active ? 'font-semibold text-ink' : 'text-ink-40'}`}>
                {label}
              </span>
              {active && (
                <m.span
                  layoutId="follow-list-tab-indicator"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className="absolute bottom-0 h-0.5 w-10 rounded-full bg-ink"
                />
              )}
            </button>
          )
        })}
      </div>

      {!user ? (
        /* 未登录：引导登录（/me/follows 是「我的」关系列表） */
        <div className="flex flex-col items-center gap-3 px-8 pb-16 pt-14">
          <img src="/empty-creel.svg" alt="" className="h-40 w-[200px]" />
          <p className="text-[15px] leading-[22px] text-ink-60">登录后查看你的粉丝与关注</p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="mt-1 rounded-full bg-olive px-5 py-2 text-[13px] font-semibold leading-[18px] text-paper-white active:brightness-95"
          >
            去登录
          </button>
        </div>
      ) : activeQuery.isLoading ? (
        /* 加载骨架（参照通知页） */
        <div>
          {[0, 1, 2, 3].map((i) => (
            <div key={`sk-${i}`} className="flex animate-pulse items-center gap-3 border-b border-line bg-paper-white px-4 py-3.5">
              <div className="h-11 w-11 shrink-0 rounded-full bg-paper" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-32 rounded bg-paper" />
                <div className="h-3 w-20 rounded bg-paper" />
              </div>
              <div className="h-8 w-20 rounded-full bg-paper" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        /* 空态 */
        <m.div
          key={`empty-${tab}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="flex flex-col items-center px-8 pb-16 pt-14"
        >
          <img src="/empty-creel.svg" alt="" className="h-40 w-[200px]" />
          <p className="mt-4 text-[15px] leading-[22px] text-ink-60">{emptyText}</p>
        </m.div>
      ) : (
        <div>
          {items.map((item, i) => {
            const following = overrides[item.id] ?? item.isFollowingBack
            const isSelf = user.id === item.id
            return (
              <m.div
                key={item.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.04 * Math.min(i, 10), ease: 'easeOut' }}
                className="flex items-center gap-3 border-b border-line bg-paper-white px-4 py-3"
              >
                <img
                  src={item.avatar || '/avatar-1.png'}
                  alt={item.name}
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-[22px] text-ink">
                  {item.name}
                </span>
                {!isSelf && (
                  <m.button
                    type="button"
                    whileTap={{ scale: 0.95 }}
                    disabled={followMut.isPending}
                    onClick={() => onToggleFollow(item.id, following)}
                    className={`h-8 shrink-0 rounded-full px-4 text-[13px] font-semibold leading-[18px] disabled:opacity-60 ${
                      following
                        ? 'border border-line bg-paper-white text-ink-60'
                        : 'bg-olive text-paper-white active:brightness-95'
                    }`}
                  >
                    {following ? '已关注' : '关注'}
                  </m.button>
                )}
              </m.div>
            )
          })}
        </div>
      )}

      <AnimatePresence>{loginSheet}</AnimatePresence>
      <Toast message={toast} />
    </div>
  )
}
