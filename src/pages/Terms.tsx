import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

/** 小节：标题 + 正文段落 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[15px] font-semibold leading-[22px] text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-[14px] leading-[22px] text-ink-60">{children}</div>
    </section>
  )
}

/**
 * 用户协议（QY-E-002）：趣渔钓鱼社区。
 * 注意：当前为测试环境，票务不产生真实扣款，条款中如实说明。
 */
export default function Terms() {
  const navigate = useNavigate()
  return (
    <div className="min-h-dvh bg-paper">
      <header
        className="sticky top-0 z-20 flex h-12 items-center justify-center bg-paper"
        style={{ paddingTop: 'var(--safe-top, 0px)' }}
      >
        <button
          type="button"
          aria-label="返回"
          onClick={() => navigate(-1)}
          className="absolute left-2 flex h-10 w-10 items-center justify-center text-ink"
        >
          <ChevronLeft size={24} strokeWidth={1.8} />
        </button>
        <h1 className="text-[16px] font-semibold text-ink">用户协议</h1>
      </header>

      <div className="px-5 pb-10 pt-2">
        <p className="text-[12px] leading-[18px] text-ink-40">更新日期：2026 年 · 适用于「趣渔」钓鱼社区</p>

        <Section title="一、账号">
          <p>1. 你可以使用 Kimi 账号授权登录，或使用用户名和密码注册趣渔账号。</p>
          <p>2. 你应妥善保管账号凭据，对账号下的全部操作负责。请勿将账号出借、转让给他人使用。</p>
          <p>3. 如发现账号被盗用或存在异常，请通过「我的」页面反馈入口联系我们处理。</p>
        </Section>

        <Section title="二、社区内容规范">
          <p>1. 你在趣渔发布的渔获、评论、鱼讯等内容必须真实、合法，不得包含：</p>
          <p>（1）违反国家法律法规的内容；</p>
          <p>（2）虚假渔获信息、夸大或伪造的钓况宣传；</p>
          <p>（3）广告营销、导流、诈骗信息；</p>
          <p>（4）侵犯他人肖像权、著作权等合法权益的内容。</p>
          <p>2. 其他用户可对违规内容进行举报。经审核确认违规的，平台有权下架相关内容；情节严重的，平台有权限制或封禁账号。</p>
          <p>3. 你发布的内容著作权归你所有，但你授予平台在社区内展示、推荐的非独占许可。</p>
        </Section>

        <Section title="三、票务与退款">
          <p>1. 趣渔提供钓场门票的在线预订与核销服务。票价、时长以各钓场页面展示为准。</p>
          <p>2. 重要说明：当前版本为测试环境，下单流程不产生真实扣款，所购门票仅用于功能体验与流程演示。</p>
          <p>3. 如后续接入真实支付，退款规则将以各钓场公示为准：未核销的门票通常可在到访日前申请退款，已核销门票不支持退款。具体以届时更新的协议为准。</p>
          <p>4. 因天气、钓场临时停业等原因导致无法到访的，可联系客服协商改期或退款。</p>
        </Section>

        <Section title="四、免责声明">
          <p>1. 钓鱼活动存在一定人身与财产风险，请遵守钓场安全规定，量力而行。平台不对钓场现场安全承担责任。</p>
          <p>2. 钓场信息（价格、开放时间、鱼情等）由钓场方提供或用户分享，平台尽力审核但不对其绝对准确性作担保。</p>
          <p>3. 因不可抗力、网络故障等原因造成的服务中断，平台不承担责任，但会尽力及时恢复。</p>
        </Section>

        <Section title="五、其他">
          <p>1. 平台有权根据运营需要更新本协议，更新后将在应用内公示。继续使用即视为你接受更新后的协议。</p>
          <p>2. 本协议的解释与争议解决适用中华人民共和国法律。</p>
        </Section>
      </div>
    </div>
  )
}
