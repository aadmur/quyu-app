import { motion } from 'framer-motion'
import { SHOP_CATEGORIES } from '@/data/shop'

interface CategoryTabsProps {
  active: string
  onChange: (cat: string) => void
}

/** 分类胶囊横滑：激活 olive 底白字 + layoutId 滑动背景 */
export default function CategoryTabs({ active, onChange }: CategoryTabsProps) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
      {SHOP_CATEGORIES.map((cat) => {
        const isActive = cat === active
        return (
          <motion.button
            key={cat}
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => onChange(cat)}
            className={`relative h-8 shrink-0 rounded-full px-3.5 text-[13px] leading-none ${
              isActive ? 'font-semibold text-paper-white' : 'border border-line bg-paper-white text-ink'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId="shop-cat-pill"
                className="absolute inset-0 rounded-full bg-olive"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative z-10">{cat}</span>
          </motion.button>
        )
      })}
    </div>
  )
}
