import { motion } from 'framer-motion'
import type { Product } from '@/data/shop'

interface ProductCardProps {
  product: Product
  index: number
  onOpen: (product: Product) => void
}

/** 商品卡：白底圆角 12、1px line、零阴影；1:1 图 + 标签 + 价格行 */
export default function ProductCard({ product, index, onOpen }: ProductCardProps) {
  return (
    <motion.button
      type="button"
      onClick={() => onOpen(product)}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.45, ease: 'easeOut', delay: (index % 2) * 0.05 }}
      whileTap={{ scale: 0.97 }}
      className="group flex w-full flex-col overflow-hidden rounded-xl border border-line bg-paper-white text-left"
    >
      <div className="relative aspect-square w-full overflow-hidden">
        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
        {product.promo && (
          <span className="absolute left-2 top-2 rounded-full bg-clay px-2 py-0.5 text-[12px] leading-4 text-paper-white">
            {product.promo}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3 pb-3 pt-2.5">
        <p className="line-clamp-2 text-[13px] font-semibold leading-[18px] text-ink">{product.name}</p>
        {product.tag && (
          <span className="w-fit rounded-full bg-lake-tint px-2.5 py-1 text-[12px] leading-3 text-lake">
            {product.tag}
          </span>
        )}
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="font-num text-[20px] leading-6 text-clay">¥{product.price}</span>
          <span className="text-[12px] leading-4 text-ink-40 line-through">¥{product.originalPrice}</span>
          <span className="ml-auto text-[12px] leading-4 text-ink-40">已售 {product.sales}</span>
        </div>
      </div>
    </motion.button>
  )
}
