/** 「我的」个人主页 + 发布页模拟数据（全部中文，无后端） */

/* ------------------------------ 个人资料 ------------------------------ */

export interface Profile {
  name: string
  avatar: string
  cover: string
  level: string
  bio: string
  stats: { catches: number; following: number; followers: number }
  /** 待使用票券数 */
  pendingTickets: number
}

export const PROFILE: Profile = {
  name: '江边老陈',
  avatar: '/avatar-1.png',
  cover: '/profile-cover.jpg',
  level: '钓友 LV6',
  bio: '二十年野钓佬，专攻翘嘴和鲫鱼 · 武汉',
  stats: { catches: 128, following: 356, followers: 892 },
  pendingTickets: 1,
}

/* ------------------------------ 渔获墙九宫格 ------------------------------ */

export interface CatchItem {
  id: string
  src: string
  /** 多图帖：右上角层叠图标 */
  multi?: boolean
  /** 视频帖：叠播放三角 */
  video?: boolean
  likes: number
  commentCount: number
  caption: string
  time: string
}

export const CATCH_WALL: CatchItem[] = [
  { id: 'w1', src: '/feed-1.jpg', likes: 1283, commentCount: 86, caption: '凌晨四点半的翘嘴，6.8 斤，值了！', time: '2 小时前' },
  { id: 'w2', src: '/feed-2.jpg', multi: true, likes: 462, commentCount: 31, caption: '一下午 23 尾鲫鱼，12 号位永远的神', time: '3 天前' },
  { id: 'w3', src: '/feed-3.jpg', likes: 358, commentCount: 24, caption: '路亚鳜鱼，花纹漂亮得不像话', time: '5 天前' },
  { id: 'w4', src: '/feed-4.jpg', likes: 689, commentCount: 45, caption: '青龙湾的黄昏，钓的不是鱼是心情', time: '1 周前' },
  { id: 'w5', src: '/feed-5.jpg', likes: 521, commentCount: 38, caption: '夜钓老周家斤塘，一目红点亮整夜', time: '1 周前' },
  { id: 'w6', src: '/feed-6.jpg', video: true, likes: 1042, commentCount: 73, caption: '草鱼入护瞬间，水花炸开', time: '2 周前' },
  { id: 'w7', src: '/feed-7.jpg', multi: true, likes: 897, commentCount: 112, caption: '带孙子出钓，传承从一根小竿开始', time: '3 周前' },
  { id: 'w8', src: '/review-1.jpg', likes: 245, commentCount: 18, caption: '斤塘大鲫一尾，半斤多', time: '1 个月前' },
  { id: 'w9', src: '/pond-qinglong-2.jpg', likes: 176, commentCount: 12, caption: '木栈道钓台，我的老位置', time: '1 个月前' },
]

/* ------------------------------ 鱼获统计 ------------------------------ */

export interface CatchStat {
  species: string
  count: number
}

export const CATCH_STATS: CatchStat[] = [
  { species: '翘嘴', count: 12 },
  { species: '鲫鱼', count: 86 },
  { species: '草鱼', count: 9 },
  { species: '鳜鱼', count: 3 },
]

/* ------------------------------ 发布页 ------------------------------ */

/** 鱼种（发布选择层 2 行 × 4 列） */
export const FISH_SPECIES = ['鲫鱼', '鲤鱼', '草鱼', '翘嘴', '青鱼', '鳊鱼', '鲈鱼', '鳜鱼'] as const

export interface PublishSpot {
  id: string
  name: string
  distance: string
}

/** 钓点选择层列表（塘名 + 距离） */
export const PUBLISH_SPOTS: PublishSpot[] = [
  { id: 'qinglong', name: '青龙湾生态钓场', distance: '3.2km' },
  { id: 'ludao', name: '鹭岛湖路亚基地', distance: '8.6km' },
  { id: 'laozhou', name: '老周家斤塘', distance: '12.4km' },
  { id: 'yunxi', name: '云溪谷休闲钓园', distance: '26.8km' },
]

/** 文案话题建议胶囊 */
export const PUBLISH_TOPICS = ['#早口', '#翘嘴', '#爆护', '#野钓日记'] as const

/** 发布成功 toast 文案 */
export const PUBLISH_SUCCESS_TOAST = '发布成功，钓友们来看渔获啦'
