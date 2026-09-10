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
 * 隐私政策（QY-E-002）：趣渔钓鱼社区。
 * 如实说明数据收集范围、用途、存储位置与用户权利，不承诺不存在的能力。
 */
export default function Privacy() {
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
        <h1 className="text-[16px] font-semibold text-ink">隐私政策</h1>
      </header>

      <div className="px-5 pb-10 pt-2">
        <p className="text-[12px] leading-[18px] text-ink-40">更新日期：2026 年 · 适用于「趣渔」钓鱼社区</p>

        <Section title="一、我们收集哪些数据">
          <p>1. 账号信息：你注册或登录时提供的用户名、昵称、头像，以及 Kimi 授权登录返回的基础资料。</p>
          <p>2. 定位信息：仅在你发布渔获并主动开启「显示定位」时，记录当次发布的 GPS 坐标与可读地址；我们不会持续追踪你的位置。</p>
          <p>3. 相册图片：你主动选择上传的渔获照片，用于帖子展示。</p>
          <p>4. 行为事件：你在信息流中的曝光、点击、点赞、评论、完读等行为，用于个性化推荐与产品改进。</p>
          <p>5. 交易信息：门票订单、核销记录（当前为测试环境，不涉及真实支付数据）。</p>
        </Section>

        <Section title="二、数据用途">
          <p>1. 提供核心功能：账号登录、发帖互动、门票预订与核销。</p>
          <p>2. 个性化推荐：基于行为事件生成鱼种与钓场偏好画像，为你推荐更相关的内容。</p>
          <p>3. 安全保障：内容审核、举报处理与异常行为识别。</p>
          <p>我们不会将你的个人信息出售给任何第三方。</p>
        </Section>

        <Section title="三、数据存储与安全">
          <p>1. 你的数据存储于阿里云（成都）服务器，访问全程加密传输。</p>
          <p>2. 我们采用最小权限、操作审计等措施保护数据安全，仅在提供服务所必需的期限内保留你的数据。</p>
        </Section>

        <Section title="四、你的权利">
          <p>1. 查询与更正：你可以在「我的」页面查看并修改昵称、头像、简介等资料。</p>
          <p>2. 删除内容：你可以删除自己发布的帖子；删除后内容立即下架，互动数据按社区规则保留。</p>
          <p>3. 注销账号：你可以在「我的 → 设置 → 注销账号」自助申请注销；申请后进入 7 天冷静期，期间重新登录或点「撤销注销」即可取消，到期后账号匿名化且不可恢复。如需人工协助，也可通过「我的」页面反馈入口联系我们。</p>
          <p>4. 撤回授权：你可以在系统设置中随时关闭定位、相册等权限，已授权期间产生的数据不受影响。</p>
        </Section>

        <Section title="五、未成年人保护">
          <p>趣渔面向成年钓鱼爱好者。未成年人请在监护人陪同下使用本服务。</p>
        </Section>

        <Section title="六、政策更新">
          <p>本政策如有更新，将在应用内公示。涉及重大变更时，我们会以更显著的方式通知你。</p>
        </Section>
      </div>
    </div>
  )
}
