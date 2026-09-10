/**
 * @layer Application Layer —— ProfileService（用户画像，推荐算法输入）
 * @file api/services/profileService.ts
 *
 * 数据主权：user_profiles 表唯一写方。画像读走 CacheStore（TTL 60s），
 * 写后失效缓存（写穿透由事件消费者完成，见 recommendService 的 tracking.user_event 消费者）。
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { orders, posts, userProfiles, users } from "@db/schema";
import { getCache, getDataSource, timedRead } from "../infra";

export type Profile = { fishPrefs: Record<string, number>; pondPrefs: Record<string, number> };

const PROFILE_TTL = 60;
const cacheKey = (userId: number) => `profile:${userId}`;

/** 读取用户画像（缓存 60s，miss 回源；空值缓存防穿透） */
export async function getProfile(userId: number): Promise<Profile | null> {
  const cache = getCache();
  const key = cacheKey(userId);
  const cached = await cache.get<Profile | "none">(key);
  if (cached === "none") return null;
  if (cached) return cached;
  const rows = await timedRead("profile.get", (db) =>
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1),
  );
  const profile: Profile | null =
    rows.length === 0 ? null : { fishPrefs: rows[0].fishPrefs ?? {}, pondPrefs: rows[0].pondPrefs ?? {} };
  await cache.set(key, profile ?? "none", PROFILE_TTL);
  return profile;
}

/** 行为权重：点赞 > 评论 > 完播/点击 > 曝光 */
const EVENT_W: Record<string, number> = { like: 3, comment: 2.5, complete: 2, click: 1.5, impression: 0.2 };

export interface ProfileDelta {
  fishSpecies: string | null;
  pondSlug: string | null;
  action: string;
}

/** 在内存中把一组行为增量应用到画像上（权重累加 + L1 归一化） */
function applyDeltas(profile: Profile, deltas: ProfileDelta[]): void {
  for (const d of deltas) {
    const w = EVENT_W[d.action] ?? 0.1;
    if (d.fishSpecies) profile.fishPrefs[d.fishSpecies] = (profile.fishPrefs[d.fishSpecies] ?? 0) + w;
    if (d.pondSlug) profile.pondPrefs[d.pondSlug] = (profile.pondPrefs[d.pondSlug] ?? 0) + w;
  }
  // L1 归一化，防止偏好无限膨胀
  for (const prefs of [profile.fishPrefs, profile.pondPrefs]) {
    const total = Object.values(prefs).reduce((a, b) => a + b, 0);
    if (total > 0) for (const k of Object.keys(prefs)) prefs[k] = +(prefs[k] / total).toFixed(4);
  }
}

/** 实时画像更新：单事件入口（内部走批量实现） */
export async function updateProfile(
  userId: number,
  post: { fishSpecies: string | null; pondSlug: string | null },
  action: string,
): Promise<void> {
  await updateProfileBatch([{ userId, deltas: [{ ...post, action }] }]);
}

/**
 * 批量画像更新（消费端批处理）：同 userId 的多条事件合并后一次读、一次 L1 归一化、一次 upsert 写回。
 * - 读：一条 SELECT ... WHERE user_id IN (...) 取回全部涉及用户（1 次 RT）
 * - 写：各用户 upsert 在连接池上并行（Promise.all），随后批量失效画像缓存
 * 原逐事件实现每事件 2 次串行 RT（读+写），批量后 N 用户 ≈ 2 次 RT（并行摊薄）。
 */
export async function updateProfileBatch(entries: Array<{ userId: number; deltas: ProfileDelta[] }>): Promise<void> {
  if (entries.length === 0) return;
  const db = getDataSource().write();
  const cache = getCache();
  const userIds = entries.map((e) => e.userId);

  // 回源 DB 最新画像（不走缓存，避免并发覆盖丢更新）；一次 IN 查询取回全部
  const rows = await db
    .select()
    .from(userProfiles)
    .where(inArray(userProfiles.userId, userIds));
  const existing = new Map(rows.map((r) => [r.userId, r]));

  const writes = entries.map(async ({ userId, deltas }) => {
    const row = existing.get(userId);
    const profile: Profile = row
      ? { fishPrefs: row.fishPrefs ?? {}, pondPrefs: row.pondPrefs ?? {} }
      : { fishPrefs: {}, pondPrefs: {} };
    applyDeltas(profile, deltas);
    await db
      .insert(userProfiles)
      .values({ userId, fishPrefs: profile.fishPrefs, pondPrefs: profile.pondPrefs })
      .onDuplicateKeyUpdate({ set: { fishPrefs: profile.fishPrefs, pondPrefs: profile.pondPrefs } });
  });
  await Promise.all(writes);
  await Promise.all(userIds.map((id) => cache.del(cacheKey(id)))); // 写后失效
}

/** 注册初始化（v8.6.0）：建新用户的空画像行，避免画像完全依赖首次行为事件兜底。
 *  调用方已完成 users 建档；重复调用安全（onDuplicateKeyUpdate 不写回）。 */
export async function initProfile(userId: number): Promise<void> {
  const db = getDataSource().write();
  await db
    .insert(userProfiles)
    .values({ userId, fishPrefs: {}, pondPrefs: {} })
    .onDuplicateKeyUpdate({ set: { userId } }); // 已存在则不动
  await getCache().del(cacheKey(userId));
}

/** 个人主页总览（v8.6.0）：全部真实库统计，替代前端写死的演示数据。
 *  等级为派生值：LV = 1 + floor((发帖×2 + 获赞) / 10)，封顶 LV10。 */
export interface ProfileOverview {
  postCount: number;
  totalLikes: number;
  pendingTickets: number;
  level: number;
  bio: string | null;
  /** 主页封面（QY-E-004）：users.cover，NULL 时前端用默认封面 */
  cover: string | null;
  wall: Array<{ id: number; image: string; images: string[] }>;
  speciesStats: Array<{ species: string; count: number }>;
}
export async function getProfileOverview(userId: number): Promise<ProfileOverview> {
  const db = getDataSource().read();
  const [agg] = await db
    .select({
      cnt: sql<number>`COUNT(*)`,
      likes: sql<number>`COALESCE(SUM(${posts.likeCount}), 0)`,
    })
    .from(posts)
    .where(eq(posts.authorId, userId));
  const postCount = Number(agg?.cnt ?? 0);
  const totalLikes = Number(agg?.likes ?? 0);

  const wallRows = await db
    .select({ id: posts.id, images: posts.images })
    .from(posts)
    .where(eq(posts.authorId, userId))
    .orderBy(desc(posts.createdAt))
    .limit(12);

  const speciesRows = await db
    .select({ species: posts.fishSpecies, cnt: sql<number>`COUNT(*)` })
    .from(posts)
    .where(and(eq(posts.authorId, userId), sql`${posts.fishSpecies} IS NOT NULL`))
    .groupBy(posts.fishSpecies)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(8);

  const [tk] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.status, "pending")));

  const [u] = await db.select({ bio: users.bio, cover: users.cover }).from(users).where(eq(users.id, userId)).limit(1);

  const level = Math.min(10, 1 + Math.floor((postCount * 2 + totalLikes) / 10));
  return {
    postCount,
    totalLikes,
    pendingTickets: Number(tk?.cnt ?? 0),
    level,
    bio: u?.bio ?? null,
    cover: u?.cover ?? null,
    wall: wallRows
      .filter((r) => r.images.length > 0)
      .map((r) => ({ id: r.id, image: r.images[0], images: r.images })),
    speciesStats: speciesRows.map((r) => ({ species: r.species ?? "其他", count: Number(r.cnt) })),
  };
}

/** dataURL 落盘为静态文件并返回 /uploads 访问路径；格式不符或超限返回 undefined（不落盘）。
 *  目录独立于构建产物（boot.ts 以 /uploads/* 静态路由伺服该目录）；写前确保存在。 */
function saveDataImage(
  dataUrl: string | undefined,
  subDir: "avatars" | "covers",
  makeName: (ext: string) => string,
  maxBytes: number,
): string | undefined {
  if (!dataUrl?.startsWith("data:image/")) return undefined;
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) return undefined;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > maxBytes) return undefined;
  const dir = path.resolve(process.cwd(), `uploads/${subDir}`);
  fs.mkdirSync(dir, { recursive: true });
  const fname = makeName(ext);
  fs.writeFileSync(path.join(dir, fname), buf);
  return `/uploads/${subDir}/${fname}`;
}

/** 更新用户基础资料（昵称/头像/简介/封面）。users 表唯一写方之一（与 OAuth 并列）。
 *  头像：avatar=URL 直存；avatarData=dataURL 落盘 uploads/avatars（上限 2MB，防爆库）。
 *  封面（QY-E-004）：cover=URL 直存；coverData=dataURL 落盘 uploads/covers（上限 3MB）。 */
export async function updateUserProfile(
  userId: number,
  input: { name?: string; avatar?: string; avatarData?: string; bio?: string; cover?: string; coverData?: string },
) {
  const db = getDataSource().write();
  const set: Record<string, string> = {};
  if (input.name != null) set.name = input.name;
  if (input.bio != null) set.bio = input.bio;
  const avatarUrl =
    saveDataImage(input.avatarData, "avatars", (ext) => `u${userId}-${Date.now()}.${ext}`, 2 * 1024 * 1024) ??
    input.avatar;
  if (avatarUrl != null) set.avatar = avatarUrl;
  const coverUrl =
    saveDataImage(input.coverData, "covers", (ext) => `u${userId}-cover-${Date.now()}.${ext}`, 3 * 1024 * 1024) ??
    input.cover;
  if (coverUrl != null) set.cover = coverUrl;
  if (Object.keys(set).length) {
    await db.update(users).set(set).where(eq(users.id, userId));
  }
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return u;
}
