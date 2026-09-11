/** 首页模拟数据：story 圈 + 渔获信息流（全部中文，无后端） */

export interface Story {
  id: string
  name: string
  avatar: string
  /** 未看 story 显示橄榄绿双环 */
  seen?: boolean
  /** 直播标记 */
  live?: boolean
  /** 官方塘 story 下方「鱼讯」小字 */
  official?: boolean
  /** story 播放页图片序列 */
  frames: string[]
  /** 官方塘 story 底部「查看钓点 →」入口 */
  spotId?: string
}

export const STORIES: Story[] = [
  { id: 's1', name: '江边老陈', avatar: '/avatar-1.png', live: true, frames: ['/feed-1.webp', '/feed-6.webp'] },
  {
    id: 's2',
    name: '青龙湾官方',
    avatar: '/pond-qinglong-1.webp',
    official: true,
    frames: ['/pond-qinglong-3.webp', '/pond-qinglong-1.webp'],
    spotId: 'qinglong',
  },
  { id: 's3', name: '路亚小辣椒', avatar: '/avatar-3.webp', frames: ['/feed-3.webp'] },
  { id: 's4', name: '浮漂小王子', avatar: '/avatar-2.webp', frames: ['/feed-2.webp', '/pond-qinglong-2.webp'] },
  { id: 's5', name: '周大爷', avatar: '/avatar-4.webp', seen: true, frames: ['/feed-7.webp'] },
  { id: 's6', name: '钓具评测老王', avatar: '/avatar-6.webp', frames: ['/prod-rod.webp'] },
  { id: 's7', name: '夜钓联盟', avatar: '/feed-5.webp', frames: ['/feed-5.webp'] },
  { id: 's8', name: '阿杰', avatar: '/avatar-7.webp', seen: true, frames: ['/feed-6.webp'] },
]

export interface FeedComment {
  id: string
  name: string
  avatar: string
  text: string
  likes: number
  time: string
}

export interface FeedPost {
  id: string
  author: string
  avatar: string
  official?: boolean
  time: string
  location?: string
  images: string[]
  caption: string
  likes: number
  commentCount: number
  comments: FeedComment[]
  /** 钓点挂载条 */
  spot?: { id: string; name: string; price: number }
}

export const FEED_POSTS: FeedPost[] = [
  {
    id: 'p1',
    author: '江边老陈',
    avatar: '/avatar-1.png',
    time: '2 小时前',
    location: '青龙湾生态钓场',
    images: ['/feed-1.webp'],
    caption: '凌晨四点半的翘嘴，6.8 斤，值了！🎣 #早口 #翘嘴',
    likes: 1283,
    commentCount: 86,
    comments: [
      { id: 'c11', name: '浮漂小王子', avatar: '/avatar-2.webp', text: '这翘嘴得有米级了吧，老陈牛逼！', likes: 45, time: '1 小时前' },
      { id: 'c12', name: '路亚小辣椒', avatar: '/avatar-3.webp', text: '四点半…钓鱼人的作息我服了', likes: 32, time: '1 小时前' },
      { id: 'c13', name: '阿杰', avatar: '/avatar-7.webp', text: '求定位，明天我也去守一个早口', likes: 18, time: '58 分钟前' },
      { id: 'c14', name: '周大爷', avatar: '/avatar-4.webp', text: '年轻人有劲头，这鱼漂亮', likes: 9, time: '半小时前' },
    ],
  },
  {
    id: 'p2',
    author: '浮漂小王子',
    avatar: '/avatar-2.webp',
    time: '3 小时前',
    location: '青龙湾生态钓场',
    images: ['/feed-2.webp'],
    caption: '青龙湾 12 号位，一下午 23 尾鲫鱼，口给得真好 #鲫鱼 #青龙湾',
    likes: 862,
    commentCount: 54,
    comments: [
      { id: 'c21', name: '江边老陈', avatar: '/avatar-1.png', text: '12 号位确实出鱼，上周我也在那爆护', likes: 21, time: '2 小时前' },
      { id: 'c22', name: '钓具评测老王', avatar: '/avatar-6.webp', text: '用的什么漂？这出口看着就舒服', likes: 12, time: '2 小时前' },
      { id: 'c23', name: '夜钓联盟', avatar: '/feed-5.webp', text: '下次试试夜钓，口更猛', likes: 6, time: '1 小时前' },
    ],
  },
  {
    id: 'p3',
    author: '路亚小辣椒',
    avatar: '/avatar-3.webp',
    time: '5 小时前',
    location: '鹭岛湖路亚基地',
    images: ['/feed-3.webp'],
    caption: '新竿开光，第一尾就是鳜鱼！这竿腰力绝了 #路亚 #鳜鱼',
    likes: 1507,
    commentCount: 112,
    comments: [
      { id: 'c31', name: '钓具评测老王', avatar: '/avatar-6.webp', text: '这支竿子我测过，腰力同价位没对手', likes: 67, time: '4 小时前' },
      { id: 'c32', name: '阿杰', avatar: '/avatar-7.webp', text: '鳜鱼这花纹，看着就贵气', likes: 23, time: '3 小时前' },
      { id: 'c33', name: '浮漂小王子', avatar: '/avatar-2.webp', text: '开光大吉！下次带带我', likes: 15, time: '3 小时前' },
    ],
  },
  {
    id: 'p4',
    author: '趣渔小助手',
    avatar: '/logo.svg',
    official: true,
    time: '6 小时前',
    location: '武汉 · 江夏',
    images: ['/feed-4.webp'],
    caption: '本周钓点推荐：青龙湾生态钓场。今早 6 点放鲫鱼 800 斤，开口好，速来！黄昏的青龙湾，随手一拍都是大片。',
    likes: 3204,
    commentCount: 238,
    spot: { id: 'qinglong', name: '青龙湾生态钓场', price: 68 },
    comments: [
      { id: 'c41', name: '夜钓联盟', avatar: '/feed-5.webp', text: '已订明晚夜钓票，冲！', likes: 88, time: '5 小时前' },
      { id: 'c42', name: '周大爷', avatar: '/avatar-4.webp', text: '上周去过，水质好，鱼也干净', likes: 41, time: '5 小时前' },
      { id: 'c43', name: '路亚小辣椒', avatar: '/avatar-3.webp', text: 'VIP 钓位含遮阳棚，夏天太友好了', likes: 26, time: '4 小时前' },
      { id: 'c44', name: '江边老陈', avatar: '/avatar-1.png', text: '800 斤鲫鱼…这密度要爆护的节奏', likes: 19, time: '4 小时前' },
    ],
  },
  {
    id: 'p5',
    author: '夜钓联盟',
    avatar: '/feed-5.webp',
    time: '8 小时前',
    location: '老周家斤塘',
    images: ['/feed-5.webp'],
    caption: '夜钓的魅力：全世界只剩下你和那一目红 #夜钓 #浮漂',
    likes: 976,
    commentCount: 67,
    comments: [
      { id: 'c51', name: '江边老陈', avatar: '/avatar-1.png', text: '蓝光灯一打，氛围感直接拉满', likes: 34, time: '7 小时前' },
      { id: 'c52', name: '阿杰', avatar: '/avatar-7.webp', text: '昨晚我也去了，钓到十一点才收竿', likes: 12, time: '6 小时前' },
    ],
  },
  {
    id: 'p6',
    author: '阿杰爱钓鱼',
    avatar: '/avatar-7.webp',
    time: '12 小时前',
    location: '云溪谷休闲钓园',
    images: ['/feed-6.webp'],
    caption: '草鱼入护瞬间，这水花我能看一百遍 #草鱼 #大物',
    likes: 2118,
    commentCount: 143,
    comments: [
      { id: 'c61', name: '路亚小辣椒', avatar: '/avatar-3.webp', text: '这连拍抓得太准了，水花炸开的瞬间！', likes: 56, time: '11 小时前' },
      { id: 'c62', name: '浮漂小王子', avatar: '/avatar-2.webp', text: '云溪谷的草鱼劲儿就是大', likes: 28, time: '10 小时前' },
      { id: 'c63', name: '钓具评测老王', avatar: '/avatar-6.webp', text: '竿子没事吧？这冲击力不小', likes: 14, time: '9 小时前' },
    ],
  },
  {
    id: 'p7',
    author: '周大爷',
    avatar: '/avatar-4.webp',
    time: '昨天',
    location: '老周家斤塘',
    images: ['/feed-7.webp'],
    caption: '带孙子来体验，小家伙比我有耐心 #亲子 #传承',
    likes: 1764,
    commentCount: 95,
    comments: [
      { id: 'c71', name: '趣渔小助手', avatar: '/logo.svg', text: '钓鱼从娃娃抓起，太有爱了', likes: 73, time: '昨天' },
      { id: 'c72', name: '江边老陈', avatar: '/avatar-1.png', text: '这一幕真暖，想起我爷爷了', likes: 49, time: '昨天' },
    ],
  },
]
