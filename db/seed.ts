/** 趣渔种子数据：钓场/票种/钓位/鱼讯/帖子/商品/演示订单 */
import { getDb } from "../api/queries/connection";
import {
  ponds, ticketTypes, seats, fishNews, posts, products, orders, reviews,
} from "./schema";

async function main() {
  const db = getDb();

  // 幂等：已有钓场则跳过
  const existing = await db.select().from(ponds).limit(1);
  if (existing.length > 0) {
    console.log("已有数据，跳过 seed");
    return;
  }

  // ---- 钓场 ----
  const pondRows = await db.insert(ponds).values([
    { slug: "qinglong", name: "青龙湾生态钓场", region: "武汉·江夏", distanceKm: "12.5", rating: "4.8", reviewCount: 326, priceFrom: 68, cover: "/pond-qinglong-1.jpg", album: ["/pond-qinglong-1.jpg", "/pond-qinglong-2.jpg", "/pond-qinglong-3.jpg", "/pond-qinglong-4.jpg"], tags: ["夜钓", "放鱼勤", "可停车"], fishSpecies: ["鲫鱼", "鲤鱼", "草鱼", "翘嘴"], intro: "青龙湾生态钓场占地约 80 亩，半月形湖湾环绕绿树，沿岸设有 24 个标准钓位与 6 个 VIP 遮阳棚位。塘内常年投放鲫鱼、鲤鱼、草鱼与翘嘴，水质清澈，配套停车场、简餐与渔具租赁。", openHours: "06:00–24:00" },
    { slug: "ludao", name: "鹭岛湖路亚基地", region: "武汉·东西湖", distanceKm: "18.2", rating: "4.6", reviewCount: 189, priceFrom: 98, cover: "/pond-ludao-1.jpg", album: ["/pond-ludao-1.jpg"], tags: ["路亚", "艇钓"], fishSpecies: ["鲈鱼", "鳜鱼", "翘嘴"], intro: "开阔湖面与路亚艇出船服务，主钓鲈鱼、鳜鱼，是路亚玩家的进阶基地。", openHours: "07:00–20:00" },
    { slug: "laozhou", name: "老周家斤塘", region: "武汉·黄陂", distanceKm: "25.6", rating: "4.5", reviewCount: 98, priceFrom: 50, cover: "/pond-laozhou-1.jpg", album: ["/pond-laozhou-1.jpg"], tags: ["斤塘", "乡村"], fishSpecies: ["鲫鱼", "鲤鱼", "草鱼"], intro: "乡村树荫小池塘，按斤计费，质朴安静，适合休闲野钓。", openHours: "全天" },
    { slug: "yunxi", name: "云溪谷休闲钓园", region: "鄂州", distanceKm: "42.0", rating: "4.7", reviewCount: 156, priceFrom: 128, cover: "/pond-yunxi-1.jpg", album: ["/pond-yunxi-1.jpg"], tags: ["溪流", "度假"], fishSpecies: ["鳜鱼", "翘嘴", "青鱼"], intro: "山谷溪流钓园，木亭石滩，适合家庭周末微度假。", openHours: "08:00–18:00" },
  ]).$returningId();
  const pondIds = pondRows.map((r) => r.id);
  const [qinglongId, ludaoId, laozhouId, yunxiId] = pondIds;

  // ---- 票种 ----
  await db.insert(ticketTypes).values([
    { pondId: qinglongId, name: "半天票", price: 68, durationDesc: "6小时" },
    { pondId: qinglongId, name: "全天票", price: 98, durationDesc: "不限时" },
    { pondId: qinglongId, name: "夜钓票", price: 78, durationDesc: "18:00–24:00", isHot: true },
    { pondId: qinglongId, name: "VIP钓位票", price: 128, durationDesc: "含遮阳棚+茶位" },
    { pondId: ludaoId, name: "岸钓全天", price: 98, durationDesc: "不限时" },
    { pondId: ludaoId, name: "艇钓半日", price: 168, durationDesc: "4小时" },
    { pondId: laozhouId, name: "斤塘门票", price: 50, durationDesc: "渔获另计" },
    { pondId: yunxiId, name: "全天票", price: 128, durationDesc: "不限时" },
  ]);

  // ---- 钓位（青龙湾 24 位，4/8/12/16/20/24 为 VIP，3/9/15 已售演示） ----
  const seatRows = Array.from({ length: 24 }, (_, i) => ({
    pondId: qinglongId,
    seatNo: i + 1,
    isVip: [4, 8, 12, 16, 20, 24].includes(i + 1),
    isSold: [3, 9, 15].includes(i + 1),
  }));
  for (const p of [ludaoId, laozhouId, yunxiId]) {
    for (let i = 1; i <= 12; i++) seatRows.push({ pondId: p, seatNo: i, isVip: i % 6 === 0, isSold: false });
  }
  await db.insert(seats).values(seatRows);

  // ---- 鱼讯 ----
  await db.insert(fishNews).values([
    { pondId: qinglongId, content: "今早6点放鲫鱼800斤，开口好，速来！" },
    { pondId: qinglongId, content: "明晚8点补草鱼300斤，夜钓票提前订" },
    { pondId: ludaoId, content: "周末路亚挑战赛报名中，鲈鱼活性高" },
    { pondId: laozhouId, content: "新到一批大板鲫，半斤起步" },
  ]);

  // ---- 帖子（7 条社区流 + 附加内容池，与前端 feed 图对应） ----
  await db.insert(posts).values([
    { authorName: "江边老陈", authorAvatar: "/avatar-1.png", content: "凌晨四点半的翘嘴，6.8斤，值了！#早口 #翘嘴", images: ["/feed-1.jpg"], pondId: qinglongId, pondSlug: "qinglong", fishSpecies: "翘嘴", weightJin: "6.8", likeCount: 328, commentCount: 46 },
    { authorName: "浮漂小王子", authorAvatar: "/avatar-2.png", content: "青龙湾12号位，一下午23尾鲫鱼，鱼情是真的顶", images: ["/feed-2.jpg"], pondId: qinglongId, pondSlug: "qinglong", fishSpecies: "鲫鱼", likeCount: 215, commentCount: 33 },
    { authorName: "路亚小辣椒", authorAvatar: "/avatar-3.png", content: "新竿开光，第一尾就是鳜鱼，这手感绝了", images: ["/feed-3.jpg"], pondId: ludaoId, pondSlug: "ludao", fishSpecies: "鳜鱼", likeCount: 486, commentCount: 72 },
    { authorName: "江边老陈", authorAvatar: "/avatar-1.png", content: "青龙湾黄昏机位分享：4号位朝西，伞都不用撑。附完整攻略，钓点挂载在下方", images: ["/feed-4.jpg"], pondId: qinglongId, pondSlug: "qinglong", likeCount: 512, commentCount: 88 },
    { authorName: "夜猫子阿豪", authorAvatar: "/avatar-7.png", content: "夜钓票实测：蓝光头灯下浮漂一点红，十一点连杆", images: ["/feed-5.jpg"], pondId: qinglongId, pondSlug: "qinglong", fishSpecies: "鲫鱼", likeCount: 167, commentCount: 21 },
    { authorName: "大鱼杀手", authorAvatar: "/avatar-6.png", content: "草鱼入护瞬间，水花比鱼还激动", images: ["/feed-6.jpg"], pondId: laozhouId, pondSlug: "laozhou", fishSpecies: "草鱼", weightJin: "9.2", likeCount: 603, commentCount: 95 },
    { authorName: "蓑笠翁", authorAvatar: "/avatar-4.png", content: "带孙子出来钓鱼，他钓的不是鱼，是耐心", images: ["/feed-7.jpg"], pondId: yunxiId, pondSlug: "yunxi", likeCount: 892, commentCount: 134 },
  ]);

  // ---- 商品 ----
  await db.insert(products).values([
    { name: "「轻鸿」28调鲫竿 3.6m", category: "鱼竿", price: 299, image: "/prod-rod.jpg", desc: "高碳素竿身，仅 78g，鲫鱼利器", sales: 1286 },
    { name: "纳米浮漂三支装", category: "浮漂", price: 59, image: "/prod-float.jpg", desc: "吃铅清晰，阴天也醒目", sales: 854 },
    { name: "夜钓蓝光头灯", category: "灯具", price: 89, image: "/prod-light.jpg", desc: "三档调光，续航 12 小时", sales: 642 },
    { name: "折叠钓椅", category: "座椅", price: 139, image: "/prod-chair.jpg", desc: "墨绿牛津布，承重 150kg", sales: 433 },
    { name: "鱼护 2.5m", category: "鱼护", price: 45, image: "/prod-net.jpg", desc: "涂胶防挂速干网布", sales: 967 },
    { name: "饵料全家福", category: "饵料", price: 66, image: "/prod-bait.jpg", desc: "鲫鲤草鳊四季通杀组合", sales: 2103 },
  ]);

  // ---- 演示订单 + 评价（userId=1 为演示用户） ----
  const [tt1] = await db.select().from(ticketTypes).limit(1);
  const insertedOrders = await db.insert(orders).values([
    { userId: 1, pondId: qinglongId, ticketTypeId: tt1.id, visitDate: "2026-09-03", quantity: 1, seatNos: [12], totalAmount: 98, verifyCode: "836219", status: "pending" },
    { userId: 1, pondId: qinglongId, ticketTypeId: tt1.id, visitDate: "2026-08-20", quantity: 2, seatNos: [7, 8], totalAmount: 136, verifyCode: "452807", status: "used" },
    { userId: 1, pondId: laozhouId, ticketTypeId: tt1.id, visitDate: "2026-08-02", quantity: 1, seatNos: [], totalAmount: 50, verifyCode: "109664", status: "completed" },
  ]).$returningId();
  await db.insert(reviews).values([
    { orderId: insertedOrders[2].id, pondId: laozhouId, userId: 1, authorName: "我", rating: 5, content: "斤塘环境安静，老板实在，鲫鱼个体普遍半斤以上。", tags: ["鱼情好", "老板热情"], images: ["/review-1.jpg"] },
  ]);

  console.log("seed 完成：4 钓场、8 票种、72 钓位、4 鱼讯、7 帖子、6 商品、3 订单");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
