/**
 * @layer Application Layer —— OwnerBindingService（塘主多钓场绑定 + 自助认证）
 * @file api/services/ownerBinding.ts
 *
 * 数据主权：pond_admins 表唯一写方（SSOT 永远 TiDB）。
 * - 自助认领：ponds.claim_code 匹配即绑定，撞唯一索引 = 已绑定（幂等成功）
 * - 权限判定：role='admin' 全局管理员直达；否则查 pond_admins 绑定关系
 */
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { pondAdmins, ponds } from "@db/schema";
import { getDataSource, isDupEntry, timedRead } from "../infra";

/** 塘主身份最小模型（与 ctx.user 结构兼容） */
export interface OwnerUser {
  id: number;
  role: string;
}

/** 钓场摘要（选择器/绑定列表用） */
export interface PondBrief {
  id: number;
  slug: string;
  name: string;
}

/** 自助认领钓场：claim_code 为 NULL 或不匹配 → BAD_REQUEST「认领码错误」；
 *  命中则写入 pond_admins，重复绑定幂等返回成功。 */
export async function claimPond(userId: number, slug: string, code: string): Promise<{ pondName: string }> {
  const db = getDataSource().write();
  const [pond] = await db.select().from(ponds).where(eq(ponds.slug, slug)).limit(1);
  if (!pond || pond.claimCode === null || pond.claimCode !== code) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "认领码错误" });
  }
  try {
    await db.insert(pondAdmins).values({ userId, pondId: pond.id });
  } catch (err) {
    // uq_pond_admin 唯一索引：已绑定过 → 幂等返回成功
    if (!isDupEntry(err)) throw err;
  }
  return { pondName: pond.name };
}

/** 我管理的钓场：role='admin' 全局管理员返回全部钓场；绑定塘主返回绑定集合 */
export async function myPonds(user: OwnerUser): Promise<PondBrief[]> {
  if (user.role === "admin") {
    return timedRead("ponds.all", (db) =>
      db.select({ id: ponds.id, slug: ponds.slug, name: ponds.name }).from(ponds),
    );
  }
  return timedRead("pondAdmins.mine", (db) =>
    db
      .select({ id: ponds.id, slug: ponds.slug, name: ponds.name })
      .from(pondAdmins)
      .innerJoin(ponds, eq(pondAdmins.pondId, ponds.id))
      .where(eq(pondAdmins.userId, user.id)),
  );
}

/** 是否可管理指定钓场：admin 直接 true；否则查 pond_admins 绑定 */
export async function canManagePond(user: OwnerUser, pondId: number): Promise<boolean> {
  if (user.role === "admin") return true;
  const rows = await timedRead("pondAdmins.check", (db) =>
    db
      .select({ id: pondAdmins.id })
      .from(pondAdmins)
      .where(and(eq(pondAdmins.userId, user.id), eq(pondAdmins.pondId, pondId)))
      .limit(1),
  );
  return rows.length > 0;
}
