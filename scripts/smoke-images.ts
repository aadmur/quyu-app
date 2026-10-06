/**
 * @layer Ops 脚本 —— 图片发布链路冒烟（连真实库，自清理）
 * @file scripts/smoke-images.ts
 *
 * 覆盖 v14 ADR-0003 的**调用方接线**（ingestImages 本身由 api/services/imageStore.test.ts 覆盖）：
 * 1. createPost 带图 → 库里只存 /uploads URL（绝不能有 base64 进 JSON 列）、文件真的落盘、URL 与文件一一对应；
 * 2. addComment 带图 → 同上，且评论头像取自 users.avatar（不是占位值）；
 * 3. 机审未配置时 → 写一条 [系统] 待人工复核记录（降级口径的证据，不是"静默放过"）。
 * 顺序是「先落盘 → 按 URL 送审」，所以断言"送审时文件已在磁盘上"这条链路的因果前提也在这里。
 *
 * 用法：node --env-file=.env.smoke --import tsx scripts/smoke-images.ts
 * 为什么单独立一个入口而不是加进 scripts/smoke.ts：smoke.ts 的第 2 节要先下单，
 * 在"按座位售票"的库上会以「钓位数量必须与购票数量一致」失败退出，后面加什么都跑不到；
 * 未跑到的测试比没有测试更糟（它会让下一个人以为这条口径已被覆盖）。
 */
import assert from "node:assert";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { and, eq, like } from "drizzle-orm";
import { comments, posts, reports, users } from "../db/schema";
import { getDataSource } from "../api/infra";
import { addComment, createPost } from "../api/services/community";

/** 1x1 PNG：与 api/services/*.test.ts 用的是同一张 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const MARK = "smoke-images";
const dirs = {
  posts: path.resolve(process.cwd(), "uploads", "posts"),
  comments: path.resolve(process.cwd(), "uploads", "comments"),
};

async function main() {
  const db = getDataSource().write();
  const snap = (d: string) => (existsSync(d) ? readdirSync(d) : []);
  const base = { posts: snap(dirs.posts), comments: snap(dirs.comments) };
  const created: { posts: string[]; comments: string[] } = { posts: [], comments: [] };
  let postId = 0;
  let commentId = 0;

  try {
    // 注意：drizzle 的 select() await 后**直接就是行数组**（不是 mysql2 的 [rows, fields]），
    // 再解构一次拿到的是「第一行对象」，取 [0] 就成了 undefined——我自己踩过的假阴性。
    const userRows = await db.select({ id: users.id, name: users.name, avatar: users.avatar }).from(users).limit(1);
    const u = userRows[0];
    assert(u?.id, "库里至少有一个用户行（请先 db/seed.ts）");

    // ---- 1. 发帖带两张图 ----
    const post = await createPost(
      { id: Number(u.id), name: String(u.name ?? MARK), avatar: String(u.avatar ?? "/avatar-1.png") },
      { content: `${MARK} 图片发布链路冒烟`, images: [PNG, PNG] },
    );
    postId = Number((post as { id: number | string }).id);
    const postRows = await db.select({ images: posts.images }).from(posts).where(eq(posts.id, postId));
    const raw = postRows[0]?.images;
    const images: string[] = typeof raw === "string" ? JSON.parse(raw) : ((raw as string[] | undefined) ?? []);
    created.posts = snap(dirs.posts).filter((f) => !base.posts.includes(f));

    assert(images.length === 2, `库里 images 应为 2 项，实际 ${images.length}`);
    assert(
      images.every((s) => s.startsWith("/uploads/posts/") && s.length < 512),
      `images 必须是 /uploads URL 且无 base64 长串：${JSON.stringify(images.map((s) => s.length))}`,
    );
    assert(
      created.posts.length === 2 && created.posts.every((f) => existsSync(path.join(dirs.posts, f))),
      "两张图应真的落盘",
    );
    assert(
      images.every((s) => created.posts.includes(path.basename(s))),
      "库内 URL 应与磁盘文件一一对应",
    );
    console.log(`[ok] createPost: ${images.join(", ")}`);

    // ---- 2. 评论带一张图 ----
    const comment = await addComment({
      userId: Number(u.id),
      postId,
      content: `${MARK} 评论配图`,
      authorName: String(u.name ?? MARK),
      images: [PNG],
    });
    commentId = Number((comment as { id: number }).id);
    const cRows = await db
      .select({ images: comments.images, authorAvatar: comments.authorAvatar })
      .from(comments)
      .where(eq(comments.id, commentId));
    const craw = cRows[0]?.images;
    const cImages: string[] = typeof craw === "string" ? JSON.parse(craw) : ((craw as string[] | undefined) ?? []);
    created.comments = snap(dirs.comments).filter((f) => !base.comments.includes(f));

    assert(cImages.length === 1 && (cImages[0] ?? "").startsWith("/uploads/comments/"), "评论 images 应是 URL");
    assert(
      created.comments.length === 1 && existsSync(path.join(dirs.comments, created.comments[0] ?? "")),
      "评论图应真的落盘",
    );
    assert(cRows[0]?.authorAvatar === u.avatar, "评论头像应取自 users.avatar 而非占位值");
    console.log(`[ok] addComment: ${cImages[0]}, avatar=${cRows[0]?.authorAvatar}`);

    // ---- 3. 机审未配置时的降级记账 ----
    const sysRows = await db
      .select({ reason: reports.reason })
      .from(reports)
      .where(and(eq(reports.postId, postId), like(reports.reason, "[系统]%")));
    assert(sysRows.length >= 1, "未配置机审时应写入 [系统] 待人工复核记录");
    console.log(`[ok] 降级记账: ${(sysRows[0]?.reason ?? "").slice(0, 60)}`);
  } finally {
    // 自清理：删行 + 删本次文件，重复跑不留脏数据，也不掩盖"这次到底跑没跑到"的结论
    if (commentId) await db.delete(comments).where(eq(comments.id, commentId));
    if (postId) await db.delete(reports).where(eq(reports.postId, postId));
    if (postId) await db.delete(posts).where(eq(posts.id, postId));
    for (const f of created.posts) rmSync(path.join(dirs.posts, f), { force: true });
    for (const f of created.comments) rmSync(path.join(dirs.comments, f), { force: true });
    const residue =
      snap(dirs.posts).filter((f) => created.posts.includes(f)).length +
      snap(dirs.comments).filter((f) => created.comments.includes(f)).length;
    assert(residue === 0, "清理后不应残留图片文件");
    if (postId) {
      const [left] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId));
      assert(!left, "清理后不应残留帖子行");
    }
  }

  console.log("\nSMOKE-IMAGES PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error("SMOKE-IMAGES FAILED:", e);
  process.exit(1);
});
