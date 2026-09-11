/** 钓点页与鱼塘详情页模拟数据：4 家钓场 + 鱼讯 + 票种 + 钓位 + 评价（全部中文，无后端） */

export interface PondNewsFlash {
  id: string
  pondId: string
  pondName: string
  text: string
  time: string
}

/** 钓点页「实时鱼讯」横向快报 */
export const NEWS_FLASH: PondNewsFlash[] = [
  { id: 'n1', pondId: 'qinglong', pondName: '青龙湾生态钓场', text: '今早 6 点放鲫鱼 800 斤，开口好，速来！', time: '10 分钟前' },
  { id: 'n2', pondId: 'ludao', pondName: '鹭岛湖路亚基地', text: '鲈鱼开口期，建议用亮片', time: '1 小时前' },
  { id: 'n3', pondId: 'laozhou', pondName: '老周家斤塘', text: '明晚 8 点补草鱼 300 斤，夜钓票提前订', time: '3 小时前' },
]

export type SeatStatus = 'free' | 'sold' | 'vip'

export interface Seat {
  no: number
  status: SeatStatus
  /** 选中后的注释说明 */
  note: string
}

export interface TicketType {
  id: string
  name: string
  desc: string
  price: number
  /** 右上角徽章，如「热门」 */
  badge?: string
}

export interface PondReview {
  id: string
  author: string
  avatar: string
  rating: number
  text: string
  image?: string
  time: string
}

export interface Pond {
  id: string
  name: string
  /** 城区/城市，如「武汉 · 江夏」 */
  region: string
  address: string
  /** 地址后缀，如「停车免费」 */
  addressExtra?: string
  rating: number
  reviewCount: number
  priceFrom: number
  distanceKm: number
  /** 列表大卡标签胶囊 */
  tags: string[]
  /** 筛选分类：night 可夜钓 / jintang 斤塘 / lure 路亚 / stocking 有放鱼 */
  categories: Array<'night' | 'jintang' | 'lure' | 'stocking'>
  cover: string
  album: string[]
  /** 今日鱼讯横幅（封面下缘） */
  todayNews?: string
  /** 详情页实时鱼讯卡 */
  news: { owner: string; ownerAvatar: string; text: string; time: string }
  intro: string
  seats: Seat[]
  defaultSeat: number
  tickets: TicketType[]
  reviews: PondReview[]
}

const SEAT_NOTES = [
  '临水草区，出鲫鱼',
  '近进水口，鱼口稳',
  '深水区，常出大物',
  '向阳位，晨钓首选',
  '树荫下，午后不晒',
  '塘角洄湾，藏鲤鱼',
]

function buildSeats(sold: number[], vip: number[]): Seat[] {
  return Array.from({ length: 24 }, (_, i) => {
    const no = i + 1
    const status: SeatStatus = vip.includes(no) ? 'vip' : sold.includes(no) ? 'sold' : 'free'
    return { no, status, note: SEAT_NOTES[i % SEAT_NOTES.length] }
  })
}

export const PONDS: Pond[] = [
  {
    id: 'qinglong',
    name: '青龙湾生态钓场',
    region: '武汉 · 江夏',
    address: '江夏区青龙山路 88 号',
    addressExtra: '停车免费',
    rating: 4.8,
    reviewCount: 326,
    priceFrom: 68,
    distanceKm: 8.2,
    tags: ['鲫鱼', '鲤鱼', '可夜钓', '有放鱼'],
    categories: ['night', 'stocking'],
    cover: '/pond-qinglong-1.webp',
    album: ['/pond-qinglong-1.webp', '/pond-qinglong-2.webp', '/pond-qinglong-3.webp', '/pond-qinglong-4.webp'],
    todayNews: '今日放鱼：鲫鱼 800 斤',
    news: {
      owner: '周长青',
      ownerAvatar: '/avatar-5.webp',
      text: '今早 6:00 放鲫鱼 800 斤，开口好，速来！明晚 20:00 补草鱼 300 斤。',
      time: '10 分钟前',
    },
    intro:
      '青龙湾生态钓场占地 60 亩，半月形湖湾，水深 1.8–3.2 米。常年投放鲫鱼、鲤鱼、草鱼，每周二、五定时补鱼。24 个标准钓位均配遮阳伞与鱼护挂点，6 个 VIP 位带遮阳棚和茶位。塘边有简餐与渔具小卖部，免费停车。',
    seats: buildSeats([3, 5, 9, 14, 16], [19, 20, 21, 22, 23, 24]),
    defaultSeat: 12,
    tickets: [
      { id: 't-half', name: '半天票', desc: '6 小时，随到随钓', price: 68 },
      { id: 't-full', name: '全天票', desc: '开园至闭园，不限时', price: 98 },
      { id: 't-night', name: '夜钓票', desc: '18:00–24:00，含头灯租赁', price: 78, badge: '热门' },
      { id: 't-vip', name: 'VIP 钓位票', desc: '遮阳棚 + 茶位 + 优先选位', price: 128 },
    ],
    reviews: [
      {
        id: 'r1',
        author: '浮漂小王子',
        avatar: '/avatar-2.webp',
        rating: 5,
        text: '12 号位 yyds，一下午 23 尾鲫鱼，塘主还送了饵料',
        image: '/review-1.webp',
        time: '3 天前',
      },
      {
        id: 'r2',
        author: '夜钓联盟',
        avatar: '/avatar-7.webp',
        rating: 4,
        text: '夜钓口不错，就是蚊子多，记得带驱蚊',
        time: '1 周前',
      },
    ],
  },
  {
    id: 'ludao',
    name: '鹭岛湖路亚基地',
    region: '武汉 · 东西湖',
    address: '东西湖区鹭岛湖大道 12 号',
    addressExtra: '路亚艇租赁',
    rating: 4.6,
    reviewCount: 189,
    priceFrom: 98,
    distanceKm: 12.5,
    tags: ['鲈鱼', '翘嘴', '路亚艇'],
    categories: ['lure'],
    cover: '/pond-ludao-1.webp',
    album: ['/pond-ludao-1.webp'],
    news: {
      owner: '老吴',
      ownerAvatar: '/avatar-6.webp',
      text: '鲈鱼开口期，建议用亮片，浅滩带傍晚连竿。',
      time: '1 小时前',
    },
    intro:
      '鹭岛湖路亚基地水面开阔 120 亩，主打鲈鱼、翘嘴路亚，配 8 艘路亚艇可租。湖心浅滩结构丰富，春末到秋初都有稳定咬口，常有白鹭伴钓，适合拍照打卡。',
    seats: buildSeats([2, 7, 11, 18], [22, 23, 24]),
    defaultSeat: 8,
    tickets: [
      { id: 't-full', name: '全天路亚票', desc: '岸钓不限时，饵自备', price: 98 },
      { id: 't-boat', name: '艇钓票', desc: '含路亚艇 4 小时 + 救生衣', price: 168, badge: '热门' },
      { id: 't-night', name: '夜钓票', desc: '18:00–24:00，翘嘴窗口期', price: 118 },
    ],
    reviews: [
      {
        id: 'r1',
        author: '路亚小辣椒',
        avatar: '/avatar-3.webp',
        rating: 5,
        text: '新竿开光，第一尾就是鳜鱼，浅滩结构确实藏鱼',
        time: '2 天前',
      },
      {
        id: 'r2',
        author: '江边老陈',
        avatar: '/avatar-1.png',
        rating: 4,
        text: '鲈鱼口好，就是周末艇要排队，建议早到',
        time: '5 天前',
      },
    ],
  },
  {
    id: 'laozhou',
    name: '老周家斤塘',
    region: '武汉 · 黄陂',
    address: '黄陂区前川街周家湾 3 号',
    addressExtra: '农家乐可订餐',
    rating: 4.5,
    reviewCount: 96,
    priceFrom: 50,
    distanceKm: 15.1,
    tags: ['斤塘', '草鱼', '农家乐'],
    categories: ['jintang', 'stocking'],
    cover: '/pond-laozhou-1.webp',
    album: ['/pond-laozhou-1.webp'],
    todayNews: '明晚补草鱼 300 斤',
    news: {
      owner: '老周',
      ownerAvatar: '/avatar-5.webp',
      text: '明晚 8 点补草鱼 300 斤，夜钓票提前订，土鸡锅也备好了。',
      time: '3 小时前',
    },
    intro:
      '老周家斤塘是黄陂乡村老塘，树荫环绕、水面 15 亩，草鱼鲤鱼密度高，渔获按斤称算。塘边自家农家乐，土鸡锅、塘鱼现杀现做，适合一家人周末出行。',
    seats: buildSeats([1, 6, 13, 20], []),
    defaultSeat: 10,
    tickets: [
      { id: 't-half', name: '半天票', desc: '6 小时，渔获按斤另计', price: 50 },
      { id: 't-full', name: '全天票', desc: '不限时，含农家茶水', price: 80 },
      { id: 't-night', name: '夜钓票', desc: '18:00–24:00，补鱼后口猛', price: 60, badge: '热门' },
    ],
    reviews: [
      {
        id: 'r1',
        author: '周大爷',
        avatar: '/avatar-4.webp',
        rating: 5,
        text: '老周人实在，草鱼劲大，中午土鸡锅一绝',
        time: '4 天前',
      },
      {
        id: 'r2',
        author: '阿杰',
        avatar: '/avatar-7.webp',
        rating: 4,
        text: '斤塘密度没得说，带小孩来也玩得住',
        time: '2 周前',
      },
    ],
  },
  {
    id: 'yunxi',
    name: '云溪谷休闲钓园',
    region: '鄂州',
    address: '鄂州市梁子湖区云溪谷路 1 号',
    addressExtra: '可住宿',
    rating: 4.7,
    reviewCount: 142,
    priceFrom: 128,
    distanceKm: 31.8,
    tags: ['溪流', '鳜鱼', '住宿'],
    categories: ['night'],
    cover: '/pond-yunxi-1.jpg',
    album: ['/pond-yunxi-1.jpg'],
    news: {
      owner: '谷主阿岚',
      ownerAvatar: '/avatar-8.webp',
      text: '山溪水位回落，鳜鱼进石滩，住宿套票含双早。',
      time: '6 小时前',
    },
    intro:
      '云溪谷休闲钓园依山而建，溪流水质清冽，主打鳜鱼、溪石斑。木亭石滩错落，夜间有星空露营区，配套民宿可住宿，适合两天一夜的轻度假垂钓。',
    seats: buildSeats([4, 10, 15], [21, 22, 23, 24]),
    defaultSeat: 6,
    tickets: [
      { id: 't-full', name: '全天票', desc: '溪钓不限时，含停车', price: 128 },
      { id: 't-stream', name: '溪钓票', desc: '石滩区专属，含导钓 1 小时', price: 158, badge: '热门' },
      { id: 't-stay', name: '住宿套票', desc: '全天钓 + 民宿一晚 + 双早', price: 298 },
    ],
    reviews: [
      {
        id: 'r1',
        author: '钓具评测老王',
        avatar: '/avatar-6.webp',
        rating: 5,
        text: '鳜鱼个头匀，水质好到能看见咬口，值这个价',
        time: '1 周前',
      },
      {
        id: 'r2',
        author: '遮阳帽阿姨',
        avatar: '/avatar-8.webp',
        rating: 4,
        text: '住了一晚很清净，就是山路弯多，天黑前到最好',
        time: '3 周前',
      },
    ],
  },
]

export function getPond(id: string | undefined): Pond | undefined {
  return PONDS.find((p) => p.id === id)
}
