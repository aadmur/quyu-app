import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { Search, ShoppingBag, Receipt } from 'lucide-react'
import Lenis from 'lenis'
import ShopBanner from '@/components/shop/ShopBanner'
import CategoryTabs from '@/components/shop/CategoryTabs'
import ProductCard from '@/components/shop/ProductCard'
import ProductDetailSheet from '@/components/shop/ProductDetailSheet'
import CartSheet from '@/components/shop/CartSheet'
import ProductOrdersSheet from '@/components/shop/ProductOrdersSheet'
import { PRODUCTS } from '@/data/shop'
import type { Product } from '@/data/shop'
import { trpc } from '@/providers/trpc'
import { useAuthGate } from '@/components/LoginSheet'
import type { ProductItem } from '@/lib/live'

/** 后端分类 → 前端分类胶囊（数据库分类名与 UI 胶囊名的映射） */
const CATEGORY_MAP: Record<string, string> = {
  灯具: '夜钓装备',
  座椅: '钓椅钓箱',
  鱼护: '鱼护配件',
}

function formatSales(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n)
}

/** 商品 → 展示模型（无原价/评价字段时用合理占位，保持卡片 UI 不变） */
function mapProduct(p: ProductItem): Product {
  const category = CATEGORY_MAP[p.category] ?? p.category
  return {
    id: String(p.id),
    name: p.name,
    fullName: p.desc ? `${p.name} · ${p.desc}` : p.name,
    image: p.image,
    price: p.price,
    originalPrice: Math.round(p.price * 1.3),
    sales: formatSales(p.sales),
    category,
  }
}

interface FlyState {
  key: number
  image: string
  fromX: number
  fromY: number
  toX: number
  toY: number
}

/** 单件商品购买上限（与后端 order 入参校验一致） */
const MAX_QTY = 99

/** 商城页 /shop：TopBar + 场景横幅 + 分类横滑 + 两列瀑布流 + 详情抽屉 + 加购飞入动画 */
export default function Shop() {
  const [category, setCategory] = useState<string>('推荐')
  const [detail, setDetail] = useState<Product | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [addedCount, setAddedCount] = useState(0)
  const [fly, setFly] = useState<FlyState | null>(null)
  const [toast, setToast] = useState('')
  // 真实搜索与购物车
  const [searchOpen, setSearchOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [cart, setCart] = useState<{ productId: number; name: string; price: number; image: string; qty: number }[]>([])
  const [ordering, setOrdering] = useState(false)
  const cartRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const flyKey = useRef(0)

  // Lenis 丝滑滚动（商城列表启用，作用于手机壳内容区）
  useEffect(() => {
    const wrapper = document.getElementById('app-scroll')
    if (!wrapper || !rootRef.current) return
    const lenis = new Lenis({ wrapper, content: rootRef.current, lerp: 0.12 })
    let raf = 0
    const loop = (time: number) => {
      lenis.raf(time)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      lenis.destroy()
    }
  }, [])

  const showToast = useCallback((text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2200)
  }, [])

  // 真实商品列表；接口异常回退 mock（mock 商品 id 为 'rod-36' 等字符串，不可下单）
  const productsQuery = trpc.app.products.list.useQuery(undefined, { retry: 1 })
  const sourceProducts = useMemo(
    () => (productsQuery.data ? productsQuery.data.map(mapProduct) : PRODUCTS),
    [productsQuery.data],
  )

  // 真实搜索：有关键词时调 products.search，否则用分类列表
  const searchQuery = trpc.app.products.search.useQuery(
    { keyword },
    { enabled: keyword.trim().length > 0, retry: 1 },
  )
  const searchResults = useMemo(
    () => (searchQuery.data ? searchQuery.data.map(mapProduct) : []),
    [searchQuery.data],
  )
  const searching = keyword.trim().length > 0

  // 商品下单 mutation
  const orderMut = trpc.app.products.order.useMutation({
    onSuccess: (order) => {
      setOrdering(false)
      setCart([])
      setAddedCount(0)
      setCartOpen(false)
      setDetail(null)
      showToast(`下单成功，共 ¥${order.totalAmount}，订单号 ${order.id}`)
    },
    onError: (e) => {
      setOrdering(false)
      showToast(e.message || '下单失败，请稍后再试')
    },
  })

  // 加购：真实维护购物车数组。mock 回退下 productId 非有限数字（NaN），拦截并提示；返回是否加购成功
  const addToCart = useCallback((product: Product): boolean => {
    const pid = Number(product.id)
    if (!Number.isFinite(pid)) {
      showToast('网络异常暂不可下单')
      return false
    }
    const exist = cart.find((i) => i.productId === pid)
    if (exist && exist.qty >= MAX_QTY) {
      showToast(`每单限购 ${MAX_QTY} 件`)
      return false
    }
    setCart((c) =>
      exist
        ? c.map((i) => (i.productId === pid ? { ...i, qty: i.qty + 1 } : i))
        : [...c, { productId: pid, name: product.name, price: product.price, image: product.image, qty: 1 }],
    )
    return true
  }, [cart, showToast])

  // 改数量：qty<=0 时移除；上限 99，到顶提示
  const setQty = useCallback((productId: number, qty: number) => {
    let next = qty
    if (next > MAX_QTY) {
      next = MAX_QTY
      showToast(`每单限购 ${MAX_QTY} 件`)
    }
    setCart((c) => (next <= 0 ? c.filter((i) => i.productId !== productId) : c.map((i) => (i.productId === productId ? { ...i, qty: next } : i))))
  }, [showToast])

  const { requireAuth, loginSheet } = useAuthGate()

  // 结算：提交真实订单（未登录先引导；mock 商品已拦截在加购环节，此处兜底校验）
  const checkout = useCallback(() => {
    if (!cart.length) { showToast('购物车是空的'); return }
    if (ordering) return
    if (cart.some((i) => !Number.isFinite(i.productId))) { showToast('网络异常暂不可下单'); return }
    if (!requireAuth('下单购物')) return
    setOrdering(true)
    orderMut.mutate({
      items: cart.map((i) => ({ productId: i.productId, qty: i.qty })),
      idempotencyKey: `shop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
  }, [cart, ordering, orderMut, showToast, requireAuth])

  // 立即购买：单件直接下单（未登录先引导；mock 商品 id 非数字时拦截）
  const buyNow = useCallback(() => {
    if (!detail || ordering) return
    const pid = Number(detail.id)
    if (!Number.isFinite(pid)) { showToast('网络异常暂不可下单'); return }
    if (!requireAuth('下单购物')) return
    setOrdering(true)
    orderMut.mutate({
      items: [{ productId: pid, qty: 1 }],
      idempotencyKey: `buy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
  }, [detail, ordering, orderMut, requireAuth, showToast])

  const filtered = useMemo(() => {
    if (searching) return searchResults
    return category === '推荐' ? sourceProducts : sourceProducts.filter((p) => p.category === category)
  }, [searching, searchResults, category, sourceProducts])
  // 两列瀑布：奇偶分列，左列先于右列入场
  const columns = useMemo(() => {
    const left: { p: Product; i: number }[] = []
    const right: { p: Product; i: number }[] = []
    filtered.forEach((p, i) => (i % 2 === 0 ? left : right).push({ p, i }))
    return [left, right]
  }, [filtered])

  const cartCount = cart.reduce((s, i) => s + i.qty, 0)

  // 加购飞入动画：商品图从详情页缩放飞向右上角购物袋（同时入真实购物车）
  const handleAddToCart = useCallback((product: Product, fromRect: DOMRect) => {
    if (!addToCart(product)) return
    const target = cartRef.current?.getBoundingClientRect()
    if (!target) {
      setAddedCount((c) => c + 1)
      return
    }
    flyKey.current += 1
    setFly({
      key: flyKey.current,
      image: product.image,
      fromX: fromRect.left + fromRect.width / 2,
      fromY: fromRect.top + Math.min(fromRect.height / 2, 160),
      toX: target.left + target.width / 2,
      toY: target.top + target.height / 2,
    })
  }, [addToCart])

  return (
    <div ref={rootRef}>
      {/* Section 1 — TopBar */}
      <m.header
        className="sticky top-0 z-20 flex h-12 items-center justify-between bg-paper px-4"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <h1 className="text-[22px] font-bold leading-7 text-ink">商城</h1>
        <div className="flex items-center gap-5">
          <button type="button" aria-label="搜索商品" className="text-ink" onClick={() => setSearchOpen((v) => !v)}>
            <Search size={24} strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="我的订单" className="text-ink" onClick={() => setOrdersOpen(true)}>
            <Receipt size={24} strokeWidth={1.8} />
          </button>
          <button
            ref={cartRef}
            type="button"
            aria-label="购物车"
            className="relative text-ink"
            onClick={() => setCartOpen(true)}
          >
            <ShoppingBag size={24} strokeWidth={1.8} />
            {cartCount > 0 && (
              <AnimatePresence mode="popLayout">
                <m.span
                  key={2 + addedCount}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                  className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 font-num text-[11px] leading-none text-paper-white"
                >
                  {cartCount}
                </m.span>
              </AnimatePresence>
            )}
          </button>
        </div>
      </m.header>

      {/* Section 2 — 场景横幅 */}
      <ShopBanner />

      {/* 搜索框（展开时显示） */}
      <AnimatePresence>
        {searchOpen && (
          <m.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden px-4"
          >
            <input
              autoFocus
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索商品：鱼竿 / 浮漂 / 饵料…"
              className="mb-2 w-full rounded-full border border-ink/10 bg-paper-white px-4 py-2 text-[14px] text-ink outline-none placeholder:text-ink-40"
            />
          </m.div>
        )}
      </AnimatePresence>

      {/* Section 3 — 分类胶囊横滑 */}
      <CategoryTabs active={category} onChange={setCategory} />

      {/* Section 4 — 商品两列瀑布流（切换分类重新 stagger 入场） */}
      {productsQuery.isLoading && !productsQuery.error ? (
        <section className="flex animate-pulse gap-2.5 px-4 pb-[100px]">
          {[0, 1].map((ci) => (
            <div key={`sk-col-${ci}`} className="flex w-1/2 flex-col gap-2.5">
              {[0, 1].map((i) => (
                <div key={`sk-${ci}-${i}`} className="overflow-hidden rounded-2xl bg-paper-white">
                  <div className="aspect-square w-full bg-paper" />
                  <div className="space-y-2 p-3">
                    <div className="h-3 w-full rounded bg-paper" />
                    <div className="h-3 w-16 rounded bg-paper" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>
      ) : (
      <section id="shop-feed" className="flex gap-2.5 px-4 pb-[100px]">
        {columns.map((col, ci) => (
          <div key={`${category}-${ci}`} className="flex w-1/2 flex-col gap-2.5">
            {col.map(({ p }) => (
              <ProductCard key={p.id} product={p} index={ci} onOpen={setDetail} />
            ))}
            {col.length === 0 && <div className="h-px" />}
          </div>
        ))}
      </section>
      )}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-8 pb-24 pt-6 text-center">
          <img src="/empty-creel.svg" alt="空空如也" className="h-24 w-auto" />
          <p className="text-[15px] leading-[22px] text-ink-60">
            {searching ? `没有找到「${keyword}」相关商品` : '这个分类还没到货，看看别的吧'}
          </p>
        </div>
      )}

      {/* 商品详情弹层 */}
      <ProductDetailSheet
        product={detail}
        onClose={() => setDetail(null)}
        onAddToCart={handleAddToCart}
        onBuyNow={buyNow}
      />

      {/* 购物车抽屉 */}
      <CartSheet
        open={cartOpen}
        items={cart}
        ordering={ordering}
        onClose={() => setCartOpen(false)}
        onSetQty={setQty}
        onCheckout={checkout}
      />

      {/* 我的商品订单弹层 */}
      <ProductOrdersSheet open={ordersOpen} onClose={() => setOrdersOpen(false)} />

      {/* 加购飞入动画元素 */}
      <AnimatePresence>
        {fly && (
          <m.img
            key={fly.key}
            src={fly.image}
            alt=""
            className="pointer-events-none fixed z-50 h-12 w-12 rounded-full object-cover shadow-[0_8px_24px_rgba(45,30,30,0.12)]"
            style={{ left: fly.fromX - 24, top: fly.fromY - 24 }}
            initial={{ scale: 1, opacity: 1 }}
            animate={{
              x: fly.toX - fly.fromX,
              y: fly.toY - fly.fromY,
              scale: 0.15,
              opacity: 0.5,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            onAnimationComplete={() => {
              setFly(null)
              setAddedCount((c) => c + 1)
            }}
          />
        )}
      </AnimatePresence>

      {/* 登录引导 */}
      {loginSheet}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[320px] rounded-full bg-ink px-4 py-2 text-center text-[13px] leading-[18px] text-paper"
          >
            {toast}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
