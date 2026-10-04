import { m } from 'framer-motion'
import type { FishSpotExpertResult } from '../../../api/kimi/k3'

interface Props {
  result: FishSpotExpertResult
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex gap-3 py-1">
      <span className="w-[52px] shrink-0 text-[12px] leading-5 text-ink-40">{label}</span>
      <span className="flex-1 text-[13px] leading-5 text-ink">{value}</span>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[12px] font-medium leading-4 text-ink-40">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/**
 * 专家报告折叠区（QY-SPOT-006）：按 waterAnalysis / rigSetup / baitPlan 分块。
 * specificsSource=none 时明确告知「未命中规则、不给具体数值」，不做静默降级。
 * 由 FishSpot 页在档位为 expert 时动态 import。
 */
export default function SpotExpertReport({ result }: Props) {
  const degraded = result.specificsSource === 'none'
  const draft = result.knowledgeBasis.some((b) => b.reviewStatus === 'draft')

  return (
    <m.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-3 rounded-xl bg-lake-tint/60 px-4 py-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold leading-4 text-lake">专业报告</p>
        <p className="text-[11px] leading-4 text-ink-40">
          {degraded ? '未命中知识库规则' : `依据 ${result.knowledgeBasis.length} 条规则`}
        </p>
      </div>

      {degraded && (
        <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-[12px] leading-4 text-ink-60">
          本次现场条件未匹配到专业规则，以下仅保留方向性建议，<span className="font-medium">线号/钩型/调目等具体数值不提供</span>，
          以免误导。补充季节、水温或目标鱼后可提高命中率。
        </p>
      )}

      <Block title="水情分析">
        <Row label="透明度" value={result.waterAnalysis.clarity} />
        <Row label="水色" value={result.waterAnalysis.colorDesc} />
        <Row label="结构" value={result.waterAnalysis.structure} />
        <Row label="流态" value={result.waterAnalysis.flowDesc} />
      </Block>

      {!degraded && (
        <>
          <Block title="钓组配置">
            <Row label="线号" value={result.rigSetup.lineSpec} />
            <Row label="钩型" value={result.rigSetup.hookSpec} />
            <Row label="调漂" value={result.rigSetup.floatSetup} />
            <Row label="铅坠" value={result.rigSetup.sinkerSpec} />
          </Block>

          <Block title="饵料与打窝">
            <Row label="钓饵" value={result.baitPlan.bait} />
            <Row label="打窝" value={result.baitPlan.nest} />
            <Row label="策略" value={result.baitPlan.strategy} />
          </Block>
        </>
      )}

      {result.suitableFishDetail.length > 0 && (
        <Block title="目标鱼排序">
          {result.suitableFishDetail.map((f) => (
            <Row key={f.name} label={`${f.priority}. ${f.name}`} value={f.reason} />
          ))}
        </Block>
      )}

      {result.bestTimeDetail.length > 0 && (
        <Block title="分时段窗口">
          {result.bestTimeDetail.map((t) => (
            <Row key={t.period} label={t.period} value={t.reason} />
          ))}
        </Block>
      )}

      <Block title="钓位选择">
        <Row label="选位" value={result.spotPick} />
      </Block>

      {result.knowledgeBasis.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-2">
          {result.knowledgeBasis.map((b) => (
            <span key={b.ruleId} className="rounded-full bg-paper px-2 py-0.5 text-[11px] leading-4 text-ink-40">
              {b.ruleId}
              {b.fish !== '*' ? `·${b.fish}` : ''}
            </span>
          ))}
        </div>
      )}

      {draft && (
        <p className="mt-2 text-[11px] leading-4 text-ink-40">
          注：本批规则为待审定初稿（依据公开垂钓资料整理），结论仅供参考。
        </p>
      )}
    </m.section>
  )
}
