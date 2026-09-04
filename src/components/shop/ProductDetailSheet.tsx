import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Star, ShieldCheck, Truck, RotateCcw } from 'lucide-react'
import type { Product } from '@/data/shop'

interface ProductDetailSheetProps {
  product: Product | null
  onClose: () => void
  /** 点击「加入购物车」：回传商品与商品图屏幕位置（用于飞入动画） */
  onAddToCart: (product: Product, fromRect: DOMRect) => void
  onBuyNow: () => void
}

const stagger = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: 'easeOut' as const, delay: 0.1 + i * 0.05 },
  }),
}

/** 商品详情底部弹层：占屏 92%，底部升起，吸底操作栏 */
export default function ProductDetailSheet({ product, onClose, onAddToCart, onBuyNow }: ProductDetailSheetProps) {
  const [page, setPage] = useState(0)
  const [spec, setSpec] = useState(0)
  const pagerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLDivElement>(null)

  const handleAdd = () => {
    if (!product) return
    const rect = imageRef.current?.getBoundingClientRect() ?? pagerRef.current?.getBoundingClientRect()
    if (rect) onAddToCart(product, rect)
  }

  return (
    <AnimatePresence>
      {product && (
        <>
          <motion.div
            key="mask"
            className="fixed inset-0 z-40 mx-auto max-w-[420px] bg-ink"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.div
            key="sheet"
            className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[92dvh] w-full max-w-[420px] flex-col overflow-hidden rounded-t-[20px] bg-paper-white"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          >
            {/* 拖拽把手 + 关闭 */}
            <div className="relative flex h-8 shrink-0 items-center justify-center">
              <span className="h-1 w-9 rounded-full bg-line" style={{ backgroundColor: '#2d1e1e26' }} />
              <button
                type="button"
                aria-label="关闭"
                onClick={onClose}
                className="absolute right-3 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-paper text-ink"
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>

            {/* 内容滚动区 */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {/* 商品大图：1:1 横滑 2 张 + 分页点 */}
              <motion.div variants={stagger} initial="hidden" animate="show" custom={0}>
                <div
                  ref={pagerRef}
                  className="no-scrollbar flex aspect-square w-full snap-x snap-mandatory overflow-x-auto"
                  onScroll={(e) => {
                    const el = e.currentTarget
                    setPage(Math.round(el.scrollLeft / el.clientWidth))
                  }}
                >
                  {[0, 1].map((i) => (
                    <div key={i} ref={i === 0 ? imageRef : undefined} className="aspect-square w-full shrink-0 snap-center">
                      <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-center gap-1.5">
                  {[0, 1].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 rounded-full transition-all ${i === page ? 'w-3.5 bg-olive' : 'w-1.5 bg-line'}`}
                      style={i === page ? undefined : { backgroundColor: '#2d1e1e26' }}
                    />
                  ))}
                </div>
              </motion.div>

              <div className="px-4 pb-6 pt-3">
                {/* 价格行 */}
                <motion.div variants={stagger} initial="hidden" animate="show" custom={1} className="flex items-center gap-2">
                  <span className="font-num text-[32px] leading-9 text-clay">¥{product.price}</span>
                  <span className="text-[13px] leading-[18px] text-ink-40 line-through">¥{product.originalPrice}</span>
                  <span className="rounded-full bg-clay/10 px-2.5 py-1 text-[12px] leading-4 text-clay">
                    直降 ¥{product.originalPrice - product.price}
                  </span>
                </motion.div>

                {/* 商品名 */}
                <motion.h2
                  variants={stagger}
                  initial="hidden"
                  animate="show"
                  custom={2}
                  className="mt-2 text-[18px] font-semibold leading-6 text-ink"
                >
                  {product.fullName}
                </motion.h2>

                {/* 服务行 */}
                <motion.div
                  variants={stagger}
                  initial="hidden"
                  animate="show"
                  custom={3}
                  className="mt-2 flex items-center gap-3 text-[13px] leading-[18px] text-ink-60"
                >
                  <span className="flex items-center gap-1">
                    <RotateCcw size={14} strokeWidth={1.8} />7 天无理由
                  </span>
                  <span className="flex items-center gap-1">
                    <ShieldCheck size={14} strokeWidth={1.8} />
                    运费险
                  </span>
                  <span className="flex items-center gap-1">
                    <Truck size={14} strokeWidth={1.8} />
                    48 小时发货
                  </span>
                </motion.div>

                {/* 规格选择 */}
                {product.specs && (
                  <motion.div variants={stagger} initial="hidden" animate="show" custom={4} className="mt-4">
                    <p className="mb-2 text-[13px] font-semibold leading-[18px] text-ink">长度</p>
                    <div className="flex gap-2">
                      {product.specs.map((s, i) => (
                        <motion.button
                          key={s}
                          type="button"
                          whileTap={{ scale: 0.94 }}
                          onClick={() => setSpec(i)}
                          className={`h-9 rounded-full px-4 text-[13px] leading-none ${
                            i === spec
                              ? 'border border-olive bg-olive-tint font-semibold text-olive'
                              : 'border border-line bg-paper-white text-ink'
                          }`}
                        >
                          {s}
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* 评价预览 */}
                {product.review && (
                  <motion.div
                    variants={stagger}
                    initial="hidden"
                    animate="show"
                    custom={5}
                    className="mt-4 rounded-xl bg-paper p-3"
                  >
                    <div className="flex items-center gap-2">
                      <img src={product.review.avatar} alt={product.review.user} className="h-7 w-7 rounded-full object-cover" />
                      <span className="text-[13px] font-semibold leading-[18px] text-ink">{product.review.user}</span>
                      <span className="ml-auto flex gap-0.5 text-[#d9a441]">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} size={13} fill="currentColor" strokeWidth={0} />
                        ))}
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] leading-[18px] text-ink-60">「{product.review.text}」</p>
                  </motion.div>
                )}
              </div>
            </div>

            {/* 吸底操作栏（paddingBottom 兼容安卓虚拟导航安全区） */}
            <div
              className="flex min-h-16 shrink-0 items-center gap-2.5 border-t border-line bg-paper-white px-4"
              style={{ paddingBottom: 'max(var(--safe-bottom, 0px), 0px)' }}
            >
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={handleAdd}
                className="h-12 flex-1 rounded-xl border border-olive text-[15px] font-semibold text-olive"
              >
                加入购物车
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={onBuyNow}
                className="h-12 flex-1 rounded-xl bg-olive text-[15px] font-semibold text-paper-white"
              >
                立即购买
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
