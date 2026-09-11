import { m } from 'framer-motion'

/** 商城场景横幅：钓具平铺俯拍 + 左半渐变压字 + kenburns 入场 */
export default function ShopBanner() {
  return (
    <section className="mx-4 mb-4 mt-2 overflow-hidden rounded-2xl relative h-[140px]">
      <m.img
        src="/shop-banner.webp"
        alt="开竿季 渔具静物"
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 1.1 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
      {/* 左半 paper → 透明横向渐变，保证文字可读 */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg, #f2f0e6 0%, #f2f0e6cc 38%, #f2f0e600 72%)' }}
      />
      <div className="relative flex h-full flex-col justify-center gap-1 p-5">
        <m.h2
          className="text-[28px] font-bold leading-[34px] text-ink"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.15 }}
        >
          开竿季
        </m.h2>
        <m.p
          className="text-[13px] leading-[18px] text-ink-60"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.25 }}
        >
          全场渔具满 199 减 30
        </m.p>
        <m.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.35 }}
        >
          <m.button
            type="button"
            whileTap={{ scale: 0.94 }}
            className="mt-1.5 h-8 rounded-full bg-olive px-4 text-[13px] font-semibold leading-none text-paper-white"
            onClick={() => {
              document.getElementById('shop-feed')?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            去逛逛
          </m.button>
        </m.div>
      </div>
    </section>
  )
}
