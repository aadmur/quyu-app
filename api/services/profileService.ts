/**
 * @layer Application Layer —— ProfileService（用户画像，推荐算法输入）
 * @file api/services/profileService.ts
 *
 * 数据主权：user_profiles 表唯一写方。画像读走 CacheStore（TTL 60s），
 * 写后失效缓存（写穿透由事件消费者完成，见 recommendService 的 tracking.user_event 消费者）。
 */
import { eq, inArray } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import { userProfiles, users } from "@db/schema";
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

/** 更新用户基础资料（昵称/头像）。users 表唯一写方之一（与 OAuth 并列）。
 *  头像支持两种：avatar=URL 直存；avatarData=dataURL 时落盘到 <cwd>/uploads/avatars 后存 URL
 *  （不能写 dist/public：vite build 的 emptyOutDir 会清空整个 dist，头像全丢）。 */
export async function updateUserProfile(
  userId: number,
  input: { name?: string; avatar?: string; avatarData?: string },
) {
  const db = getDataSource().write();
  const set: Record<string, string> = {};
  if (input.name != null) set.name = input.name;
  let avatarUrl = input.avatar;
  if (input.avatarData?.startsWith("data:image/")) {
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(input.avatarData);
    if (m) {
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const buf = Buffer.from(m[2], "base64");
      // 头像上限 2MB，防爆库
      if (buf.length <= 2 * 1024 * 1024) {
        // 目录独立于构建产物（boot.ts 以 /uploads/* 静态路由伺服该目录）；写前确保存在
        const dir = path.resolve(process.cwd(), "uploads/avatars");
        fs.mkdirSync(dir, { recursive: true });
        const fname = `u${userId}-${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(dir, fname), buf);
        avatarUrl = `/uploads/avatars/${fname}`;
      }
    }
  }
  if (avatarUrl != null) set.avatar = avatarUrl;
  if (Object.keys(set).length) {
    await db.update(users).set(set).where(eq(users.id, userId));
  }
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return u;
}
