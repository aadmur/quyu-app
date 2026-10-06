import { useNavigate, useParams } from 'react-router-dom'
import PostContent from '@/components/community/PostContent'

/**
 * /post/:id —— 帖子详情路由页。
 *
 * v14 起它只服务**深链冷启动**：分享链接、二维码、外部浏览器直达，以及弹层
 * pushState 之后的刷新与前进后退。列表里点帖子不再跳到这里，而是打开 Home 的
 * PostSheet 弹层 —— 因为 / 与 /post/:id 是 Layout 下的兄弟路由，跳路由会把 Home
 * 整棵卸载，分页累积、滚动位置、tab、点赞态全丢。
 *
 * 渲染主体与弹层共用 PostContent（用户明确要求：不允许出现两套帖子渲染逻辑），
 * 所以这个文件只剩参数解析与返回动作。
 *
 * 性能门禁：PostContent 静态依赖 CatchViewer（内含 drag="x"，属 domMax 能力），
 * 因此 App.tsx 里本路由由 <Lazy> 升级为 <LazyMax> —— 见 check-motion-boundary.mjs 不变量 2。
 */
export default function PostDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const postId = Number(id)

  if (!Number.isFinite(postId) || postId <= 0) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-8 text-center">
        <img src="/empty-creel.svg" alt="帖子不存在" className="h-24 w-auto opacity-80" />
        <p className="text-[15px] font-semibold text-ink">帖子不存在或已删除</p>
        <p className="text-[13px] leading-[18px] text-ink-60">链接可能已失效，回首页看看大家的渔获吧</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-2 h-11 rounded-full bg-olive px-8 text-[14px] font-semibold text-paper-white active:brightness-95"
        >
          回首页
        </button>
      </div>
    )
  }

  // key={postId}：从一条帖子链接跳到另一条时整棵重挂，评论/输入/折叠态不会串台
  return <PostContent key={postId} postId={postId} variant="page" onBack={() => navigate(-1)} />
}
