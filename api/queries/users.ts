import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

export async function upsertUser(data: InsertUser) {
  const values = { ...data };
  const updateSet: Partial<InsertUser> = {
    lastSignInAt: new Date(),
    ...data,
  };

  // 塘主一次性授权语义：OWNER_UNION_ID 命中的账号在每次登录 upsert 时显式授予 admin
  // （独立显式判断，不依附于"调用方未显式传 role"这一隐含条件）。
  // 不提供回收路径：取消授权需直接改库（本 MVP 阶段刻意不做自助降级，文档注释说明）。
  if (env.ownerUnionId && values.unionId === env.ownerUnionId) {
    values.role = values.role ?? "admin";
    updateSet.role = "admin";
  }

  await getDb()
    .insert(schema.users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}
