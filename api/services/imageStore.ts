/**
 * @layer Application Layer —— ImageStore（帖子/评论图片落盘，v14 ADR-0003）
 * @file api/services/imageStore.ts
 *
 * 这颗雷的爆法（为什么必须有本模块）：
 * 改动前 pickImages() 压缩出的 dataURL 被原样写进 posts.images 的 JSON 列，
 * 一条 9 图帖 ≈ 2–4MB base64 挤在同一行；而 recommendService.recallCandidates() 是
 * `db.select().from(posts)` 全列查询（含 images），一次拉 RECALL_LIMIT=200 条进**进程内 60s 共享缓存**，
 * src/lib/live.ts 的 mapFeedPost 再把 images 全量透传给前端——
 * 等于用 MySQL 当对象存储、用推荐缓存当图床带宽，行数一涨就是 OOM 与首屏流量双杀。
 * 现在链路改成：dataURL 解码 → 写磁盘 uploads/<slot>/ → 机审（imageModeration，按 /uploads 公网 URL）→
 * 库里只存 `/uploads/...` URL 字符串数组。审核与写盘的这个先后次序不是偏好，而是被外部约束定死的：
 * 内容安全的图片接口只接受可被服务端拉取的 URL，不支持 base64（详见 imageModeration 文件头）。
 *
 * 实现风格沿用 profileService.saveDataImage（头像/封面已在线上验证过的模式）：
 * `path.resolve(process.cwd(), 'uploads/<sub>')` + `fs.writeFileSync`，返回 `/uploads/<sub>/<fname>`，
 * 由 boot.ts 的 `/uploads/*` serveStatic 伺服；目录刻意独立于 dist（vite build 的 emptyOutDir 会清空 dist）。
 * 同步写盘会阻塞事件循环，但单文件已被体积上限约束在 MB 级（SSD 上毫秒级），
 * 与 profileService 保持一致优先于微优化；若日后要异步化，只改 writeImage 一处。
 *
 * 信任边界（防路径穿越）：
 * 文件名 100% 服务端生成（slot 前缀 + userId + 毫秒 + 4 字节随机 + 原数组下标 + 白名单扩展名），
 * 不接受任何来自客户端的文件名/MIME/扩展名，扩展名只从 dataURL 的 image/<白名单> 段推导，
 * 所以穿越输入面不存在。透传的既有 URL 字符串（编辑帖子时前端会原样带回旧图地址）
 * 只允许同源相对路径，并显式拒绝 `//`（协议相对，会跳出同源）与 `..`/`\`。
 *
 * 已知遗留（不在本期收拾）：磁盘文件可能比库里的引用多——
 * 机审通过、写盘成功，但随后的 INSERT 失败，这批文件就成了没人引用的孤儿。
 * （多图提交里某张被判违规的情形**已经不漏了**：reject 抛错前会把本次新写的文件全部 rm 掉，
 * 所以"违规图公网可达但库里没有"不会发生；代价是写路径上多了一次 unlink，只在拒绝时走。）
 * 目前不引入对账清理任务（低频 + 单实例磁盘余量大）。
 * 若要治理：离线按 uploads/{posts,comments} 目录 vs 库内 URL 做一次对账即可，无需改在线链路。
 *
 * ⚠️ 部署约束（落盘方案的前提，换部署方式时必须复核）：`uploads/` 是**运行时数据目录**，
 * 必须在多次发布之间持久存在——它不在 dist 里（vite 的 emptyOutDir 会清空 dist），
 * 也不在 Dockerfile runner 阶段的 COPY 列表里（见 Dockerfile：只拷 node_modules/.env/dist）。
 * 因此：rsync 部署绝不能带 --delete 删它；容器化部署必须为 /app/uploads 挂 volume，
 * 否则每次发版会把用户历史图片整体清空（库里的 URL 全部 404）。
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { log } from "../infra";
import { moderateImages, queuePendingReview, type ModerateOutcome } from "./imageModeration";

/** 落盘槽位：同时是 uploads/ 下的子目录名，与 boot.ts 的静态路由前缀一一对应 */
export type ImageSlot = "posts" | "comments";

interface SlotLimits {
  /** 单次上传张数上限（与 feature-router 的 zod .max() 双保险，这里是权威口径） */
  maxCount: number;
  /** 单张解码后字节上限 */
  maxBytesPerImage: number;
  /** 单次上传总字节上限（防止「每张都刚好合规、合起来打爆磁盘」） */
  maxTotalBytes: number;
  /** 文件名前缀：便于在 uploads 里一眼看出来源 */
  prefix: string;
}

const MB = 1024 * 1024;
export const IMAGE_SLOT_LIMITS: Record<ImageSlot, SlotLimits> = {
  // 前端 pickImages(9)、最长边 1600px + JPEG q0.82，单张实测几百 KB；3MB 是宽松护栏不是目标值
  posts: { maxCount: 9, maxBytesPerImage: 3 * MB, maxTotalBytes: 15 * MB, prefix: "p" },
  // 评论配图定位为「补充说明」，张数收紧，避免评论楼中楼变成第二相册（也压低机审次数）
  comments: { maxCount: 4, maxBytesPerImage: 3 * MB, maxTotalBytes: 8 * MB, prefix: "c" },
};

/** 只收这几种：与 profileService 的白名单一致（gif 排除——动图体积不可控且易夹带内容） */
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/;
const EXT_BY_MIME: Record<string, string> = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp" };

export interface IngestedImages {
  /** 写进 posts.images / comments.images 的 URL 数组（保持入参顺序） */
  urls: string[];
  /** 待人工复核的图片张数（机审 review 档 + unavailable 降级），>0 时调用方需在落库后补人工队列 */
  pendingCount: number;
}

/**
 * dataURL/URL 混合数组 → 可落库的 URL 数组。
 * 顺序：解码校验 → 全部落盘 → 按公网 URL 机审 → 有明确 block 则删掉本次新写的文件并抛错。
 * （机审必须在落盘之后，是因为内容安全只接受图片 URL、不支持 base64；详见 imageModeration 文件头。）
 *
 * 抛错口径（调用方无需再包 try）：
 * - BAD_REQUEST：超张数/超体积/格式不支持/地址不合法/**机审明确 block**
 * - INTERNAL_SERVER_ERROR：写盘失败（磁盘问题，用户重试无意义）
 */
export async function ingestImages(
  input: readonly string[] | undefined,
  opts: { slot: ImageSlot; userId: number; kind: "post" | "comment" },
): Promise<IngestedImages> {
  const list = input ?? [];
  const limits = IMAGE_SLOT_LIMITS[opts.slot];
  if (list.length > limits.maxCount) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `最多上传 ${limits.maxCount} 张图片` });
  }
  if (list.length === 0) return { urls: [], pendingCount: 0 };

  // 结果按原下标占位，保证「旧图 + 新图」混排时顺序与用户所选一致
  const slots: (string | undefined)[] = new Array(list.length).fill(undefined);
  interface Decoded { index: number; buf: Buffer; ext: string }
  const decoded: Decoded[] = [];
  let totalBytes = 0;

  list.forEach((raw, index) => {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "图片数据为空，请重新选择图片" });
    }
    if (!raw.startsWith("data:")) {
      // 编辑场景：前端把已有图片地址原样带回，直接透传（不重新下载、不重复机审、不重复计费）
      if (!isSafeStoredUrl(raw)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "图片地址不合法，请重新选择图片" });
      }
      slots[index] = raw;
      return;
    }
    const m = DATA_IMAGE_RE.exec(raw);
    if (!m) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "图片格式不支持，请使用 PNG/JPG/WebP" });
    }
    const buf = Buffer.from(m[2], "base64");
    if (buf.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "图片数据为空，请重新选择图片" });
    }
    if (buf.length > limits.maxBytesPerImage) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `单张图片不得超过 ${Math.floor(limits.maxBytesPerImage / MB)}MB，请重新裁剪`,
      });
    }
    totalBytes += buf.length;
    if (totalBytes > limits.maxTotalBytes) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "图片总体积过大，请减少张数后重试" });
    }
    decoded.push({ index, buf, ext: EXT_BY_MIME[m[1]] });
  });

  let pendingCount = 0;
  if (decoded.length > 0) {
    /**
     * 顺序是「先全部写盘 → 按公网 URL 机审 → 判违规则删掉本次全部新文件并拒绝发布」。
     * 之所以不是审核通过才写盘：内容安全的图片接口只接受可被服务端拉取的 URL，不支持 base64
     * （已由官方文档核实，详见 imageModeration 文件头那段被证伪的记录）。
     * 因此这里刻意做到：只要有一张被判违规，就把这一批刚落盘的图全删干净再抛错，
     * 绝不留「公网可访问但库里没有」的孤儿文件。
     * 未配置机审时 moderateImages 立刻整批返回 unavailable，本段等价于「只写盘、全部待审」，
     * 与改造前的行为一致（不会多发任何请求）。
     */
    const dir = ensureDir(opts.slot);
    const written = decoded.map((d) => ({ d, url: writeImage(dir, opts.slot, d, opts.userId) }));
    const cleanup = () => {
      for (const w of written) {
        try {
          unlinkSync(path.join(dir, path.basename(w.url)));
        } catch (err) {
          // 删不掉只可能是并发/权限问题：记下来交人工，不因清理失败而掩盖原本的审核结论
          log("error", "image store: cleanup after reject failed", { slot: opts.slot, url: w.url, err: String(err) });
        }
      }
    };
    const outcomes = await moderateImages(written.map((w) => w.url), opts.kind);
    for (let i = 0; i < written.length; i++) {
      const w = written[i]!;
      const outcome: ModerateOutcome = outcomes[i] ?? { verdict: "unavailable" };
      if (outcome.verdict === "reject") {
        // 机审已开通却明确 block → fail-closed：这是平台责任边界，不能放行
        log("warn", "image rejected by moderation", {
          userId: opts.userId, slot: opts.slot, index: w.d.index, reason: outcome.reason,
        });
        cleanup();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `第 ${w.d.index + 1} 张图片涉嫌违规，请更换后重试`,
        });
      }
      if (outcome.verdict !== "pass") pendingCount++; // review / unavailable 都进人工复核队列
      slots[w.d.index] = w.url;
    }
  }

  const urls = slots.filter((u): u is string => typeof u === "string" && u.length > 0);
  return { urls, pendingCount };
}

/**
 * 落库后补记人工复核（ingest 阶段拿不到 postId，故拆成两步、由调用方在 INSERT 之后触发）。
 * 评论图片的待审记录挂在所属帖子名下，语义见 imageModeration.queuePendingReview。
 */
export async function flagPendingImageReview(
  ingested: Pick<IngestedImages, "pendingCount">,
  target: { postId: number; authorId: number; kind: "post" | "comment" },
): Promise<void> {
  if (ingested.pendingCount <= 0) return;
  await queuePendingReview({ ...target, count: ingested.pendingCount });
}

/** 目录准备（幂等）：与 profileService 同口径写前确保存在 */
function ensureDir(slot: ImageSlot): string {
  const dir = path.resolve(process.cwd(), "uploads", slot);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 写盘并返回访问 URL。
 * 文件名完全服务端生成，含毫秒 + 随机串 + 下标三段去重信息：
 * 同一用户同一毫秒发 9 张也不会互相覆盖（profileService 的头像场景只有一张所以没这个负担）。
 */
function writeImage(dir: string, slot: ImageSlot, d: { buf: Buffer; ext: string; index: number }, userId: number): string {
  const fname = `${IMAGE_SLOT_LIMITS[slot].prefix}${userId}-${Date.now()}-${randomBytes(4).toString("hex")}-${d.index}.${d.ext}`;
  try {
    writeFileSync(path.join(dir, fname), d.buf);
  } catch (err) {
    log("error", "image store: write failed", { slot, userId, err: String(err) });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "图片保存失败，请稍后重试" });
  }
  return `/uploads/${slot}/${fname}`;
}

/**
 * 既有图片地址的透传白名单：只允许同源绝对路径。
 * 拒绝：协议相对 `//host/...`（跳出同源）、含 `..` 或 `\`（穿越）、含查询/fragment 的花式地址、
 * 以及 http(s) 外链（防止把第三方图床当免费 CDN，也防 img 请求携带用户 Cookie 去外部域）。
 */
function isSafeStoredUrl(v: string): boolean {
  if (!v.startsWith("/")) return false;
  if (v.startsWith("//")) return false;
  if (v.includes("..") || v.includes("\\")) return false;
  return /^\/[\w\-/.]+$/u.test(v);
}
