import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'

interface EditPostSheetProps {
  /** 现有正文（预填） */
  initialContent: string
  pending: boolean
  onClose: () => void
  onSave: (content: string) => void
}

/** 编辑帖子弹层（QY-COMM-004）：底部升起，textarea 预填现文案，仅支持修改正文 */
export default function EditPostSheet({ initialContent, pending, onClose, onSave }: EditPostSheetProps) {
  const [draft, setDraft] = useState(initialContent)
  const trimmed = draft.trim()
  const canSave = trimmed.length > 0 && trimmed !== initialContent.trim() && !pending

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[70dvh] max-w-[420px] flex-col rounded-t-[20px] bg-paper-white shadow-[0_8px_24px_rgba(45,30,30,0.12)]"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
      >
        <div className="flex h-12 shrink-0 items-center justify-center border-b border-line">
          <span className="text-[15px] font-semibold leading-[22px]">编辑帖子</span>
          <button type="button" aria-label="关闭编辑" onClick={onClose} className="absolute right-3 text-ink-60">
            <X size={22} strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 px-4 py-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            rows={7}
            autoFocus
            placeholder="分享这次渔获…"
            className="w-full resize-none rounded-xl bg-paper p-3 text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-40"
          />
          <p className="mt-1 text-right font-num text-[12px] leading-4 text-ink-40">{draft.length}/1000</p>
        </div>

        <div
          className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2"
          style={{ paddingBottom: 'max(var(--safe-bottom), 8px)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-full border border-line text-[14px] font-semibold text-ink-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(trimmed)}
            disabled={!canSave}
            className="flex h-10 flex-1 items-center justify-center rounded-full bg-olive text-[14px] font-semibold text-paper-white disabled:opacity-40"
          >
            {pending ? <Loader2 size={17} className="animate-spin" /> : '保存'}
          </button>
        </div>
      </motion.div>
    </>
  )
}
