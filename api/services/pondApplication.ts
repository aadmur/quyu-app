/**
 * @layer Application Layer —— PondApplicationService（塘主入驻申请，QY-D-002）
 * @file api/services/pondApplication.ts
 *
 * 数据主权：pond_applications 表唯一写方；审批通过时同事务创建 ponds 行并生成认领码。
 * - 提交幂等：同一用户存在 pending 申请 → CONFLICT「已有申请在审核中」；rejected 可重新提交（新行）
 * - 审批幂等：CAS UPDATE status='pending' 占位，并发/重复操作仅一方生效，其余返回当前状态
 * - 通过：事务内建塘（slug=pond-<申请id> 天然唯一）+ 认领码（2-4 位大写字母+'-'+年份，碰撞重试）+ 通知
 * - 照片：dataURL 落盘 uploads/applications（与 profileService 头像/封面同管线，/uploads/* 由 boot.ts 伺服）
 * - 文本过滤：全部文本字段过 contentFilter（违禁档直接拒提交；广告档无 postId 可挂系统举报，仅放行落库由人工审）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { pondApplications, ponds, users } from "@db/schema";
import { getDataSource, timedRead, type Db } from "../infra";
import { assertContentAllowed } from "./contentFilter";
import { pushNotification } from "./notify";

// ============ 入参/出参模型 ============

export interface PondApplicationInput {
  pondName: string;
  region: string;
  address: string;
  contactPhone: string;
  ticketDesc: string;
  note?: string;
  /** 相册上传压缩后的 JPEG dataURL（≤4 张） */
  photoData: string[];
}

export interface ApplicationStatusView {
  id: number;
  pondName: string;
  region: string;
  address: string;
  contactPhone: string;
  ticketDesc: string;
  photos: string[];
  note: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  /** 已通过时回填：新生成钓场的 slug 与认领码（供申请人直接去塘主看板认领） */
  pondSlug: string | null;
  claimCode: string | null;
}

export interface ApplicationQueueItem extends ApplicationStatusView {
  userId: number;
  applicantName: string | null;
}

function affectedRows(res: unknown): number {
  const r = res as [{ affectedRows?: number }] | undefined;
  return r?.[0]?.affectedRows ?? 0;
}

// ============ 照片落盘（复用 profileService 的 dataURL → uploads/ 模式） ============

const PHOTO_MAX_BYTES = 1.5 * 1024 * 1024; // 前端已压缩到 ≤1024px JPEG，服务端兜底防爆库

function saveApplicationPhoto(dataUrl: string, userId: number, seq: number): string | undefined {
  if (!dataUrl.startsWith("data:image/")) return undefined;
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) return undefined;
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > PHOTO_MAX_BYTES) return undefined;
  const dir = path.resolve(process.cwd(), "uploads/applications");
  fs.mkdirSync(dir, { recursive: true });
  const fname = `u${userId}-${Date.now()}-${seq}.${ext}`;
  fs.writeFileSync(path.join(dir, fname), buf);
  return `/uploads/applications/${fname}`;
}

// ============ 用户侧：提交 / 我的申请 ============

/**
 * 提交入驻申请：
 * - 全部文本字段拼接过 contentFilter（违禁档抛 BAD_REQUEST 拒提交）
 * - 幂等：已有 pending 申请 → CONFLICT；rejected/无记录 → 插新行
 */
export async function submitApplication(userId: number, input: PondApplicationInput): Promise<{ id: number }> {
  const db = getDataSource().write();

  // 敏感词过滤：任一字段命中违禁档即整单拒提交（kind 复用 "post"，不改动 contentFilter 词表代码）
  const texts = [input.pondName, input.region, input.address, input.contactPhone, input.ticketDesc, input.note ?? ""];
  assertContentAllowed(texts.join(" "), "post", userId);

  const [pending] = await db
    .select({ id: pondApplications.id })
    .from(pondApplications)
    .where(and(eq(pondApplications.userId, userId), eq(pondApplications.status, "pending")))
    .limit(1);
  if (pending) {
    throw new TRPCError({ code: "CONFLICT", message: "已有申请在审核中，请等待审核结果" });
  }

  const photos = input.photoData
    .slice(0, 4)
    .map((d, i) => saveApplicationPhoto(d, userId, i))
    .filter((u): u is string => !!u);

  const [{ id }] = await db
    .insert(pondApplications)
    .values({
      userId,
      pondName: input.pondName.slice(0, 128),
      region: input.region.slice(0, 128),
      address: input.address.slice(0, 255),
      contactPhone: input.contactPhone.slice(0, 32),
      ticketDesc: input.ticketDesc.slice(0, 255),
      photos,
      note: input.note?.trim() ? input.note.slice(0, 500) : null,
    })
    .$returningId();
  return { id: Number(id) };
}

/** 我的最近一次申请（表单页顶部状态卡）；approved 时回填 pondSlug/claimCode 供认领 */
export async function myApplication(userId: number): Promise<ApplicationStatusView | null> {
  const rows = await timedRead("pondApps.mine", (db) =>
    db
      .select()
      .from(pondApplications)
      .where(eq(pondApplications.userId, userId))
      .orderBy(desc(pondApplications.createdAt), desc(pondApplications.id))
      .limit(1),
  );
  const app = rows[0];
  if (!app) return null;
  return toView(app, await approvedPondOf(app));
}

/** 已通过申请对应的钓场（slug 约定 pond-<申请id>，见 approveApplication） */
async function approvedPondOf(app: typeof pondApplications.$inferSelect) {
  if (app.status !== "approved") return null;
  const rows = await timedRead("pondApps.approvedPond", (db) =>
    db
      .select({ slug: ponds.slug, claimCode: ponds.claimCode })
      .from(ponds)
      .where(eq(ponds.slug, applicationSlug(app.id)))
      .limit(1),
  );
  return rows[0] ?? null;
}

function toView(
  app: typeof pondApplications.$inferSelect,
  pond: { slug: string; claimCode: string | null } | null,
): ApplicationStatusView {
  return {
    id: Number(app.id),
    pondName: app.pondName,
    region: app.region,
    address: app.address,
    contactPhone: app.contactPhone,
    ticketDesc: app.ticketDesc,
    photos: Array.isArray(app.photos) ? app.photos : [],
    note: app.note,
    status: app.status,
    reviewNote: app.reviewNote,
    createdAt: app.createdAt,
    reviewedAt: app.reviewedAt,
    pondSlug: pond?.slug ?? null,
    claimCode: pond?.claimCode ?? null,
  };
}

// ============ admin 侧：待审列表 / 审批 ============

/** 待审队列（仅 admin；塘主不可见——路由层把关）：全部字段 + 照片 + 申请人昵称，按提交时间正序 */
export async function listPendingApplications(): Promise<ApplicationQueueItem[]> {
  const rows = await timedRead("pondApps.queue", (db) =>
    db
      .select({ app: pondApplications, applicantName: users.name })
      .from(pondApplications)
      .leftJoin(users, eq(pondApplications.userId, users.id))
      .where(eq(pondApplications.status, "pending"))
      .orderBy(pondApplications.createdAt)
      .limit(50),
  );
  return rows.map((r) => ({
    ...toView(r.app, null),
    userId: Number(r.app.userId),
    applicantName: r.applicantName,
  }));
}

/** 审批结果（幂等）：already=true 表示该申请此前已被审批，本次为重复操作 */
export interface ReviewResult {
  ok: true;
  already: boolean;
  status: string;
  /** 通过时返回（含幂等重放时回查的认领码） */
  claimCode?: string | null;
  pondSlug?: string | null;
}

/** 认领码：2-4 位大写字母 + '-' + 年份（对齐现有 QLW-2026 手工预置格式） */
function genClaimCode(): string {
  const len = 2 + Math.floor(Math.random() * 3); // 2-4
  let letters = "";
  for (let i = 0; i < len; i++) letters += String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${letters}-${new Date().getFullYear()}`;
}

/** 新塘 slug 约定：pond-<申请id>，由 serial 主键保证唯一，无需碰撞重试 */
function applicationSlug(applicationId: number | bigint): string {
  return `pond-${applicationId}`;
}

/** 从票种意向文本解析首个价格数字作为 ponds.price_from（解析不出 → 0，待塘主后续补票种） */
function parsePriceFrom(ticketDesc: string): number {
  const m = /(\d{1,4})\s*(元|块|\/|￥|¥)?/.exec(ticketDesc);
  return m ? Number(m[1]) : 0;
}

/**
 * 审批（QY-D-002）：
 * - 权限：仅全局 admin（路由层校验，塘主 FORBIDDEN）
 * - CAS：UPDATE ... WHERE id AND status='pending'，0 行 = 已审批 → 幂等返回当前状态（不重复建塘）
 * - approve：同一事务内建 ponds 行（最小字段集：slug/name/region/cover/album/tags/fishSpecies/intro/priceFrom/claimCode，
 *   其余列走表默认值）+ 通知申请人（含认领码）
 * - reject：reviewNote 必填 + 通知申请人（含备注）
 */
export async function reviewApplication(
  admin: { id: number },
  applicationId: number,
  action: "approve" | "reject",
  reviewNote?: string,
): Promise<ReviewResult> {
  if (action === "reject" && !reviewNote?.trim()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "拒绝时必须填写审批备注" });
  }
  const ds = getDataSource();

  return ds.withTx(async (tx) => {
    const [app] = await tx
      .select()
      .from(pondApplications)
      .where(eq(pondApplications.id, applicationId))
      .limit(1);
    if (!app) {
      throw new TRPCError({ code: "NOT_FOUND", message: "申请不存在" });
    }

    // CAS 占位：仅 pending 可被审批，并发下只有一方成功
    const now = new Date();
    const res = await tx
      .update(pondApplications)
      .set({
        status: action === "approve" ? "approved" : "rejected",
        reviewNote: reviewNote?.trim() ? reviewNote.slice(0, 255) : null,
        reviewedBy: admin.id,
        reviewedAt: now,
      })
      .where(and(eq(pondApplications.id, applicationId), eq(pondApplications.status, "pending")));
    if (affectedRows(res) !== 1) {
      // 幂等重放：返回当前状态；已通过则回查认领码一并返回
      const pond = app.status === "approved" ? await approvedPondOfTx(tx, applicationSlug(applicationId)) : null;
      return { ok: true as const, already: true, status: app.status, claimCode: pond?.claimCode ?? null, pondSlug: pond?.slug ?? null };
    }

    if (action === "reject") {
      await pushNotification(
        {
          userId: Number(app.userId),
          type: "apply",
          actorName: "平台",
          refId: applicationId,
          preview: `入驻申请未通过：${reviewNote!.trim()}`,
        },
        tx,
      );
      return { ok: true as const, already: false, status: "rejected" };
    }

    // approve：生成认领码（碰撞重试 ≤8 次）+ 建塘
    const slug = applicationSlug(applicationId);
    let claimCode = "";
    for (let i = 0; i < 8; i++) {
      const candidate = genClaimCode();
      const [hit] = await tx
        .select({ id: ponds.id })
        .from(ponds)
        .where(eq(ponds.claimCode, candidate))
        .limit(1);
      if (!hit) {
        claimCode = candidate;
        break;
      }
    }
    if (!claimCode) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "认领码生成失败，请重试" });
    }

    const photos = Array.isArray(app.photos) ? app.photos : [];
    const cover = photos[0] ?? "/pond-yunxi-1.jpg"; // 默认封面：申请人首图，无图用内置风景图
    await tx.insert(ponds).values({
      slug,
      name: app.pondName,
      region: app.region,
      priceFrom: parsePriceFrom(app.ticketDesc),
      cover,
      album: photos.length > 0 ? photos : [cover],
      tags: [],
      fishSpecies: [],
      intro: app.note ?? `票种意向：${app.ticketDesc}`,
      claimCode,
    });

    await pushNotification(
      {
        userId: Number(app.userId),
        type: "apply",
        actorName: "平台",
        refId: applicationId,
        preview: `入驻申请已通过，认领码：${claimCode}，请到塘主看板页输入认领`,
      },
      tx,
    );
    return { ok: true as const, already: false, status: "approved", claimCode, pondSlug: slug };
  });
}

/** 事务内回查已建钓场（幂等重放路径） */
async function approvedPondOfTx(tx: Db, slug: string) {
  const rows = await tx
    .select({ slug: ponds.slug, claimCode: ponds.claimCode })
    .from(ponds)
    .where(eq(ponds.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

/** 待审申请数（admin 角标用） */
export async function pendingApplicationCount(): Promise<{ count: number }> {
  const rows = await timedRead("pondApps.pendingCount", (db) =>
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(pondApplications)
      .where(eq(pondApplications.status, "pending")),
  );
  return { count: Number(rows[0]?.count ?? 0) };
}
