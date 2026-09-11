import { useState } from 'react'
import { m } from 'framer-motion'
import { NEWS_TEMPLATES } from '@/data/owner'
import { trpc } from '@/providers/trpc'

interface NewsComposerProps {
  /** 发布结果回调（ok=false 时带错误提示） */
  onPublished: (result: { ok: boolean; message?: string }) => void
}

/** 发布鱼讯快捷区：钓场胶囊选择 + 输入框 + 模板胶囊横滑 + 真实发布到 fish_news（pondSlug 必传） */
export default function NewsComposer({ onPublished }: NewsComposerProps) {
  const [text, setText] = useState('')
  // 用户手动选择的钓场；未选择时回落到列表第一个（推导，不再用 effect 回写 state）
  const [selectedSlug, setSelectedSlug] = useState('')

  // 钓场列表：pondSlug 必传，默认选中第一个钓场
  const pondsQuery = trpc.app.ponds.list.useQuery(undefined, { retry: 1 })
  const ponds = pondsQuery.data ?? []
  const pondSlug = selectedSlug || ponds[0]?.slug || ''

  const publishMut = trpc.app.ponds.publishNews.useMutation({
    onSuccess: () => {
      setText('')
      onPublished({ ok: true, message: '鱼讯已推送' })
    },
    onError: (e) => {
      onPublished({ ok: false, message: e.message || '发布失败，请稍后再试' })
    },
  })

  const publish = () => {
    if (publishMut.isPending || !text.trim() || !pondSlug) return
    publishMut.mutate({ pondSlug, content: text.trim() })
  }
  const publishing = publishMut.isPending

  return (
    <m.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mx-4 mb-4 rounded-2xl bg-paper-white p-4"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">发布鱼讯</h2>
        <p className="text-[12px] leading-4 text-ink-60">推送给订阅的钓友</p>
      </div>

      {/* 钓场选择（pondSlug 随发布提交） */}
      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
        {ponds.map((p) => {
          const active = p.slug === pondSlug
          return (
            <button
              key={p.slug}
              type="button"
              onClick={() => setSelectedSlug(p.slug)}
              className={`h-7 shrink-0 rounded-full px-3 text-[12px] leading-none ${
                active ? 'bg-olive text-paper-white' : 'bg-olive-tint text-olive'
              }`}
            >
              {p.name}
            </button>
          )
        })}
        {pondsQuery.isLoading && <span className="text-[12px] leading-7 text-ink-40">钓场加载中…</span>}
        {!pondsQuery.isLoading && ponds.length === 0 && (
          <span className="text-[12px] leading-7 text-ink-40">暂无钓场，无法发布</span>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="今早放鲫鱼 800 斤，开口好…"
        rows={3}
        className="mt-3 h-[72px] w-full resize-none rounded-xl bg-paper p-3 text-[15px] leading-[22px] text-ink outline-none transition-shadow placeholder:text-ink-40 focus:ring-1 focus:ring-olive"
      />

      {/* 快捷模板胶囊横滑 */}
      <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4">
        {NEWS_TEMPLATES.map((tpl) => (
          <m.button
            key={tpl.label}
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => setText(tpl.text)}
            className="h-7 shrink-0 rounded-full bg-olive-tint px-3 text-[12px] leading-none text-olive"
          >
            {tpl.label}
          </m.button>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <m.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={publish}
          disabled={publishing || !text.trim() || !pondSlug}
          className="flex h-9 items-center justify-center rounded-xl bg-olive px-5 text-[13px] font-semibold leading-none text-paper-white disabled:opacity-50"
        >
          {publishing ? '发布中…' : '发布'}
        </m.button>
      </div>
    </m.section>
  )
}
