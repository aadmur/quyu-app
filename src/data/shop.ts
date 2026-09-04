/** 商城页模拟数据：分类、商品、购物车预置、详情规格与评价 */

export interface Product {
  id: string
  name: string
  /** 详情页完整商品名 */
  fullName: string
  image: string
  price: number
  originalPrice: number
  /** 场景标签（如「夜钓必备」），无则不显示 */
  tag?: string
  /** 促销角标（如「直降」） */
  promo?: string
  sales: string
  category: string
  specs?: string[]
  review?: { user: string; avatar: string; text: string }
}

export const SHOP_CATEGORIES = ['推荐', '鱼竿', '浮漂', '饵料', '夜钓装备', '钓椅钓箱', '鱼护配件'] as const

export const PRODUCTS: Product[] = [
  {
    id: 'rod-36',
    name: '「轻鸿」28 调鲫竿 3.6m',
    fullName: '「轻鸿」28 调鲫竿 3.6m 碳素超轻',
    image: '/prod-rod.jpg',
    price: 299,
    originalPrice: 399,
    tag: '野钓鲫鱼',
    promo: '直降',
    sales: '2.3 万',
    category: '鱼竿',
    specs: ['3.6m', '4.5m', '5.4m'],
    review: { user: '江边老陈', avatar: '/avatar-1.png', text: '竿子很轻，遛鱼手感好' },
  },
  {
    id: 'float-3',
    name: '纳米浮漂三支套装',
    fullName: '纳米浮漂三支套装 醒目橙红漂尾',
    image: '/prod-float.jpg',
    price: 59,
    originalPrice: 89,
    tag: '新手友好',
    sales: '1.8 万',
    category: '浮漂',
    review: { user: '浮漂小王子', avatar: '/avatar-2.png', text: '漂尾很醒目，阴天也看得清' },
  },
  {
    id: 'light-blue',
    name: '夜钓蓝光头灯',
    fullName: '夜钓蓝光头灯 感应开关长续航',
    image: '/prod-light.jpg',
    price: 89,
    originalPrice: 129,
    tag: '夜钓必备',
    sales: '9600',
    category: '夜钓装备',
    review: { user: '阿杰爱钓鱼', avatar: '/avatar-6.png', text: '蓝光不晃眼，上饵看得清清楚楚' },
  },
  {
    id: 'chair-green',
    name: '折叠钓椅 墨绿',
    fullName: '折叠钓椅 墨绿牛津布 带靠背',
    image: '/prod-chair.jpg',
    price: 139,
    originalPrice: 199,
    tag: '久坐不累',
    sales: '1.2 万',
    category: '钓椅钓箱',
    review: { user: '周大爷', avatar: '/avatar-4.png', text: '坐一下午腰不酸，收起来就一根棍' },
  },
  {
    id: 'net-25',
    name: '鱼护 2.5m 速干',
    fullName: '鱼护 2.5m 速干网布 铝合金护圈',
    image: '/prod-net.jpg',
    price: 45,
    originalPrice: 69,
    sales: '3.1 万',
    category: '鱼护配件',
    review: { user: '路亚小辣椒', avatar: '/avatar-3.png', text: '速干不臭，护圈很结实' },
  },
  {
    id: 'bait-family',
    name: '饵料全家福四袋装',
    fullName: '饵料全家福四袋装 鲫鲤草鳊通杀',
    image: '/prod-bait.jpg',
    price: 66,
    originalPrice: 96,
    tag: '爆护配方',
    sales: '4.5 万',
    category: '饵料',
    review: { user: '江边老陈', avatar: '/avatar-1.png', text: '按说明开饵，一上午 20 多尾鲫鱼' },
  },
  {
    id: 'rod-45',
    name: '「轻鸿」28 调鲫竿 4.5m',
    fullName: '「轻鸿」28 调鲫竿 4.5m 碳素超轻',
    image: '/prod-rod.jpg',
    price: 359,
    originalPrice: 459,
    tag: '野钓鲫鱼',
    promo: '直降',
    sales: '8700',
    category: '鱼竿',
    specs: ['3.6m', '4.5m', '5.4m'],
    review: { user: '浮漂小王子', avatar: '/avatar-2.png', text: '4.5 米打草洞刚刚好，腰力足' },
  },
  {
    id: 'light-combo',
    name: '头灯 + 夜光漂组合',
    fullName: '夜钓头灯 + 夜光漂组合套装',
    image: '/prod-light.jpg',
    price: 119,
    originalPrice: 168,
    tag: '夜钓必备',
    sales: '5400',
    category: '夜钓装备',
    review: { user: '阿杰爱钓鱼', avatar: '/avatar-6.png', text: '一套配齐，夜钓直接出门' },
  },
]

export interface CartItem {
  productId: string
  qty: number
}

/** 购物车预置：浮漂套装 ×1 + 饵料全家福 ×1（合计 ¥125） */
export const PRESET_CART: CartItem[] = [
  { productId: 'float-3', qty: 1 },
  { productId: 'bait-family', qty: 1 },
]

export function getProduct(id: string): Product {
  return PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0]
}
