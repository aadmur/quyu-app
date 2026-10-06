/**
 * 落盘与机审的**顺序**合同测试（CHANGELOG 第十节返工的核心风险面）。
 *
 * 只 mock `imageModeration`（它自己的请求形状由 imageModeration.test.ts 钉住），
 * 这里要验的是调用方拿到四态判定时**磁盘上到底发生了什么**——尤其 reject 分支：
 * 内容安全只接受图片 URL，所以违规图必然已经落盘过一次；"删干净"这一步没做到的话，
 * 生产上就会留下"公网能访问、库里没有引用"的违规孤儿文件。这条是本模块唯一真正的安全边界。
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** vi.mock 会被提升到 import 之前，共享的 spy 必须用 vi.hoisted 创建 */
const { moderateImagesMock } = vi.hoisted(() => ({ moderateImagesMock: vi.fn() }));
vi.mock("./imageModeration", () => ({
  moderateImages: moderateImagesMock,
  queuePendingReview: vi.fn(),
}));

/** 1x1 PNG（与浏览器实测用的同一张） */
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

type Ingest = (
  input: readonly string[] | undefined,
  opts: { slot: "posts" | "comments"; userId: number; kind: "post" | "comment" },
) => Promise<{ urls: string[]; pendingCount: number }>;
let ingestImages: Ingest;

const postsDir = path.resolve(process.cwd(), "uploads", "posts");
let baseline: string[] = [];

/** 只清理本测试新建的文件，不动目录里可能已存在的真实图片 */
const newFiles = () => readdirSync(postsDir).filter((f) => !baseline.includes(f));
const snapshot = () => readdirSync(postsDir);

beforeAll(async () => {
  for (const [k, v] of Object.entries({
    NODE_ENV: "test",
    APP_ID: "test-app",
    APP_SECRET: "test-secret",
    KIMI_AUTH_URL: "https://kimi.example.test",
    KIMI_OPEN_URL: "https://kimi.example.test",
    DATABASE_URL: "mysql://root:root@127.0.0.1:3399/quyu_unused",
    IMAGE_MODERATION_ENABLED: "false",
  })) {
    process.env[k] = v;
  }
  mkdirSync(postsDir, { recursive: true }); // 先建目录，才能拿到干净的基线列表
  vi.resetModules();
  ingestImages = (await import("./imageStore")).ingestImages;
  baseline = snapshot();
});

afterEach(() => {
  for (const f of newFiles()) rmSync(path.join(postsDir, f), { force: true });
  moderateImagesMock.mockReset();
});

const verdicts = (...vs: Array<"pass" | "reject" | "review" | "unavailable">) =>
  vs.map((v) => (v === "reject" ? { verdict: v, reason: "label=porn" } : { verdict: v }));

describe("机审四态对磁盘的影响", () => {
  it("全部 pass：文件保留、送审的就是已落盘的地址、pendingCount=0", async () => {
    moderateImagesMock.mockResolvedValue(verdicts("pass", "pass"));
    const r = await ingestImages([PNG_1PX, PNG_1PX], { slot: "posts", userId: 4001, kind: "post" });

    expect(r.urls).toHaveLength(2);
    expect(r.pendingCount).toBe(0);
    expect(newFiles()).toHaveLength(2);
    // URL 提交方式的前提：送审时那张图必须已经在磁盘上，否则审核服务端根本拉不到
    expect(moderateImagesMock.mock.lastCall?.[0]).toEqual(r.urls);
    // 注意别写 path.resolve(cwd, "/uploads/...")：Windows 下绝对路径会直接跳到盘根（E:\uploads\...）
    for (const u of r.urls) expect(existsSync(path.join(postsDir, path.basename(u)))).toBe(true);
  });

  it("明确 reject：抛 BAD_REQUEST，且本次新写的文件一张都不留（含先 pass 的那张）", async () => {
    moderateImagesMock.mockResolvedValue(verdicts("pass", "reject"));
    const before = snapshot();

    await expect(
      ingestImages([PNG_1PX, PNG_1PX], { slot: "posts", userId: 4002, kind: "post" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("第 2 张图片涉嫌违规") });

    expect(snapshot()).toEqual(before);
  });

  it("review / unavailable 都计入待人工复核，文件保留", async () => {
    moderateImagesMock.mockResolvedValue(verdicts("review", "unavailable", "pass"));
    const r = await ingestImages([PNG_1PX, PNG_1PX, PNG_1PX], { slot: "posts", userId: 4003, kind: "post" });
    expect(r.urls).toHaveLength(3);
    expect(r.pendingCount).toBe(2);
    expect(newFiles()).toHaveLength(3);
  });

  it("结果条数少于图片数（审核服务半路挂了）也不能漏文件：缺的位按待审计", async () => {
    moderateImagesMock.mockResolvedValue(verdicts("pass"));
    const r = await ingestImages([PNG_1PX, PNG_1PX], { slot: "posts", userId: 4004, kind: "post" });
    expect(r.urls).toHaveLength(2);
    expect(r.pendingCount).toBe(1);
    expect(newFiles()).toHaveLength(2);
  });
});

describe("编辑与非法输入的既有口径未被顺序改动破坏", () => {
  it("旧图 URL 原样透传、只有新图送审，顺序仍按用户所选", async () => {
    moderateImagesMock.mockResolvedValue(verdicts("pass"));
    const r = await ingestImages(["/uploads/posts/old-9.jpg", PNG_1PX], { slot: "posts", userId: 4005, kind: "post" });

    expect(r.urls[0]).toBe("/uploads/posts/old-9.jpg"); // 透传位在前，且没被重新落盘
    expect(r.urls).toHaveLength(2);
    expect(moderateImagesMock.mock.lastCall?.[0]).toEqual([r.urls[1]]); // 只送新图那一张
    expect(newFiles()).toHaveLength(1);
    expect(r.pendingCount).toBe(0);
  });

  it("外链/协议相对/穿越地址在写盘之前就被拒，不产生文件也不送审", async () => {
    moderateImagesMock.mockResolvedValue(verdicts("pass"));
    const before = snapshot();
    for (const bad of ["https://img.example.com/x.jpg", "//img.example.com/x.jpg", "/uploads/../etc/passwd"]) {
      await expect(ingestImages([bad], { slot: "posts", userId: 4006, kind: "post" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect(snapshot()).toEqual(before);
    expect(moderateImagesMock).not.toHaveBeenCalled();
  });

  it("超过张数上限直接拒，且不送审", async () => {
    const before = snapshot();
    const ten = Array.from({ length: 10 }, () => PNG_1PX);
    await expect(ingestImages(ten, { slot: "posts", userId: 4007, kind: "post" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(snapshot()).toEqual(before);
    expect(moderateImagesMock).not.toHaveBeenCalled();
  });
});
