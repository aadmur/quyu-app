import { useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'

/** 举报理由预设（QY-SAFE-001） */
export const REPORT_REASONS = [
  '广告营销',
  '虚假信息',
  '违规内容',
  '其他',
] as const

interface ReportSheetProps {
  open: boolean
  /** 举报对象文案：「帖子」/「评论」，出现在标题与说明里 */
  subject: string
  pending: boolean
  onClose: () => void
  /** 入参为「预设理由 + 可选补充」拼好的完整理由 */
  onSubmit: (reason: string) => void
}

/**
 * 举报弹层（预设理由单选 + 可选补充说明）
 *
 * v14 从 PostDetail.tsx 里抽出：迭代前只有帖子级举报入口，评论上根本没有
 * （CHANGELOG v8.8.0 写着「帖子/评论举报入口」，实际只做到了帖子）。
 * 抽公用后帖子与评论共用同一个面板，理由拼装也只有一处。
 *
 * 理由与补充说明的 state 放在**只在 open 期间挂载**的内层组件里，而不是外层：
 * 外层在父级里是常驻挂载的（`open` 只控制 AnimatePresence 的内容），状态不会随关闭消失——
 * 上一次填的补充说明会被带进下一次举报，甚至从「帖子」带到「评论」上。
 * 靠卸载丢弃状态，而不是 useEffect 监听 open 复位（本项目 lint 红线 set-state-in-effect），
 * 也不在提交时复位（否则提交失败会把用户写好的说明一起清掉）。
 */
export default function ReportSheet(props: ReportSheetProps) {
  return (
    <AnimatePresence>
      {props.open ? <ReportForm {...props} /> : null}
    </AnimatePresence>
  )
}

function ReportForm({ subject, pending, onClose, onSubmit }: ReportSheetProps) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0])
  const [note, setNote] = useState('')

  return (
    <>
      <m.button
        type="button"
        aria-label={`关闭${subject}举报`}
        className="fixed inset-0 z-[60] bg-ink/35"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <m.div
        role="dialog"
        aria-label={`举报${subject}`}
        className="fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-md rounded-t-[20px] bg-paper px-5 pt-3"
        style={{ paddingBottom: 'max(var(--safe-bottom), 24px)' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <h2 className="text-[17px] font-semibold text-ink">举报{subject}</h2>
        <p className="mt-1 text-[12px] leading-[18px] text-ink-60">
          请选择举报理由，我们会尽快审核处理
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {REPORT_REASONS.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium leading-none ${
                reason === r
                  ? 'bg-olive text-paper-white'
                  : 'bg-paper-white text-ink-60'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="补充说明（可选）"
          maxLength={200}
          rows={3}
          className="mt-3 w-full resize-none rounded-xl border border-line bg-paper-white px-3.5 py-2.5 text-[14px] leading-[20px] text-ink outline-none placeholder:text-ink-40 focus:border-olive"
        />
        <button
          type="button"
          onClick={() =>
            onSubmit(note.trim() ? `${reason}：${note.trim()}` : reason)
          }
          disabled={pending}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-paper-white active:brightness-110 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 size={17} className="animate-spin" />
          ) : (
            '提交举报'
          )}
        </button>
      </m.div>
    </>
  )
}
