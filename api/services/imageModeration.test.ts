/**
 * 图片机审客户端的合同测试（不联网、不落库、不需要阿里云账号）。
 *
 * 为什么值得单独锁住这块：这个模块曾经按「官方支持 base64 二进制提交」实现，
 * 而文档核实结果是**两个版本都只接受图片 URL**。那种错不会崩、不会报错，
 * 只会让每次调用静默 4xx → 按降级口径全量刷进人工队列，看起来"机审已接入"，实际一张都没审成。
 * 所以这里把**请求长什么样**钉死成断言，而不只是注释。
 *
 * fetch 被整体替换，因此这些用例同时证明"不可用时绝不外呼"（零请求 = 零成本、零延迟）。
 */
import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-access-key-secret";
const AK = "test-access-key-id";
const ENDPOINT = "https://green.example.test";
const MEDIA_BASE = "http://120.0.0.1:3000";

/**
 * cfg 与 env 都是**模块加载时**定下来的常量，所以每个场景都必须先 resetModules 再动态 import，
 * 否则改 process.env 完全不生效（第一版就是这么错了 3 个用例：环境改了、模块没换）。
 */
async function loadModule(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  return import("./imageModeration");
}

const fullConfig: Record<string, string> = {
  NODE_ENV: "test",
  APP_ID: "test-app",
  APP_SECRET: "test-secret",
  KIMI_AUTH_URL: "https://kimi.example.test",
  KIMI_OPEN_URL: "https://kimi.example.test",
  DATABASE_URL: "mysql://root:root@127.0.0.1:3399/quyu_unused",
  ALICLOUD_ACCESS_KEY_ID: AK,
  ALICLOUD_ACCESS_KEY_SECRET: SECRET,
  ALICLOUD_GREEN_ENDPOINT: ENDPOINT,
  PUBLIC_MEDIA_BASE_URL: MEDIA_BASE,
  IMAGE_MODERATION_ENABLED: "true",
  IMAGE_MODERATION_TIMEOUT_MS: "1500",
  IMAGE_MODERATION_DEADLINE_MS: "3000",
};

/** 记录每次外呼的原始材料，供"请求形状"断言使用 */
interface Capture {
  url: string;
  body: string;
  headers: Record<string, string>;
}
let captures: Capture[] = [];

function stubFetch(handler: () => { status: number; json: unknown }) {
  captures = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const body = init.body ?? "";
      captures.push({ url: String(input), body, headers: init.headers ?? {} });
      const { status, json } = handler();
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(json),
      };
    }),
  );
}

const greenResult = (suggestion: string, label = "porn") => ({
  code: 200,
  msg: "OK",
  data: [{ results: [{ label, suggestion }] }],
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("机审请求形状（按阿里云文档钉死）", () => {
  it("用落盘后的公网 URL 提交，body 是 {scenes, tasks:[{dataId,url}]}", async () => {
    const mod = await loadModule(fullConfig);
    stubFetch(() => ({ status: 200, json: greenResult("pass") }));

    const [outcome] = await mod.moderateImages(["/uploads/posts/p7-1.jpg"], "post");

    expect(outcome?.verdict).toBe("pass");
    expect(captures).toHaveLength(1);
    const c = captures[0]!;
    expect(c.url).toBe(`${ENDPOINT}/green/image/scan`);
    const body = JSON.parse(c.body);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.scenes).toEqual(["porn", "terrorism", "ad"]);
    // base64 通道不存在：提交出去的必须是绝对 URL，且带上了 PUBLIC_MEDIA_BASE_URL 前缀
    expect(body.tasks[0].url).toBe(`${MEDIA_BASE}/uploads/posts/p7-1.jpg`);
    expect(typeof body.tasks[0].dataId).toBe("string");
    expect(body.dataId).toBeUndefined();
    expect(body.images).toBeUndefined();
  });

  it("必发 x-acs-* 四个头，Content-MD5 是标准 base64（不许大写）", async () => {
    const mod = await loadModule(fullConfig);
    stubFetch(() => ({ status: 200, json: greenResult("pass") }));
    await mod.moderateImages(["/uploads/posts/p7-2.jpg"], "post");

    const h = captures[0]!.headers;
    expect(h["x-acs-version"]).toBe("2018-05-09");
    expect(h["x-acs-signature-method"]).toBe("HMAC-SHA1");
    expect(h["x-acs-signature-version"]).toBe("1.0");
    expect(h["x-acs-signature-nonce"]).toMatch(/^[0-9a-f]{16,}$/);
    expect(h["Accept"]).toBe("application/json");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["Date"]).toMatch(/GMT$/);

    const expectedMd5 = createHash("md5").update(captures[0]!.body, "utf8").digest("base64");
    expect(h["Content-MD5"]).toBe(expectedMd5);
    // 旧实现是 .toUpperCase()：base64 大小写敏感，大写串与网关自己算出来的 MD5 不同 → 必判体不符
    expect(h["Content-MD5"]).not.toBe(expectedMd5.toUpperCase());
  });

  it("Authorization 里的签名与「按文档规则重算」的结果一致（含 x-acs 头参与 CanonicalizedHeaders）", async () => {
    const mod = await loadModule(fullConfig);
    stubFetch(() => ({ status: 200, json: greenResult("pass") }));
    await mod.moderateImages(["/uploads/posts/p7-3.jpg"], "post");

    const c = captures[0]!;
    const canonicalHeaders = Object.keys(c.headers)
      .filter((k) => k.startsWith("x-acs-"))
      .sort()
      .map((k) => `${k}:${c.headers[k]}\n`)
      .join("");
    const stringToSign =
      ["POST", c.headers["Accept"], c.headers["Content-MD5"], c.headers["Content-Type"], c.headers["Date"]].join("\n") +
      "\n" +
      `${canonicalHeaders}/green/image/scan`;
    const signature = createHmac("sha1", SECRET).update(stringToSign, "utf8").digest("base64");
    expect(c.headers["Authorization"]).toBe(`acs ${AK}:${signature}`);
  });

  it("同一批多张图 = 多次调用，且每次都换新的 nonce（防重放 nonce 不可复用）", async () => {
    const mod = await loadModule(fullConfig);
    stubFetch(() => ({ status: 200, json: greenResult("pass") }));
    await mod.moderateImages(["/uploads/posts/a.jpg", "/uploads/posts/b.jpg"], "post");

    expect(captures).toHaveLength(2);
    const nonces = captures.map((c) => c.headers["x-acs-signature-nonce"]);
    expect(new Set(nonces).size).toBe(2);
  });
});

describe("判定映射与 fail-closed 边界", () => {
  const cases: Array<[string, string]> = [
    ["block", "reject"],
    ["review", "review"],
    ["pass", "pass"],
  ];
  it.each(cases)("suggestion=%s → verdict=%s", async (suggestion, verdict) => {
    const mod = await loadModule(fullConfig);
    stubFetch(() => ({ status: 200, json: greenResult(suggestion) }));
    const [outcome] = await mod.moderateImages(["/uploads/posts/x.jpg"], "post");
    expect(outcome?.verdict).toBe(verdict);
  });

  it("服务返回非 200 code 判为 unavailable，不当成通过也不当成违规", async () => {
    const mod = await loadModule(fullConfig);
    stubFetch(() => ({ status: 200, json: { code: 480, msg: "quota exceeded" } }));
    const [outcome] = await mod.moderateImages(["/uploads/posts/x.jpg"], "post");
    expect(outcome?.verdict).toBe("unavailable");
    expect(outcome?.reason).toContain("480");
  });

  it("HTTP 4xx/5xx 与网络异常一律折叠成 unavailable，绝不把异常抛给发布链路", async () => {
    const mod = await loadModule(fullConfig);
    stubFetch(() => ({ status: 401, json: { code: 401, msg: "SignatureDoesNotMatch" } }));
    await expect(mod.moderateImages(["/uploads/posts/x.jpg"], "post")).resolves.toEqual([
      expect.objectContaining({ verdict: "unavailable" }),
    ]);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ETIMEDOUT"); }));
    const out = await mod.moderateImages(["/uploads/posts/x.jpg"], "post");
    expect(out[0]?.verdict).toBe("unavailable");
  });
});

describe("不可用时零外呼（成本与延迟的硬保证）", () => {
  it("IMAGE_MODERATION_ENABLED!=true → 全部 unavailable 且一次请求都不发", async () => {
    const mod = await loadModule({ ...fullConfig, IMAGE_MODERATION_ENABLED: "false" });
    stubFetch(() => ({ status: 200, json: greenResult("block") }));

    const outcomes = await mod.moderateImages(["/uploads/posts/x.jpg"], "post");
    expect(outcomes[0]?.verdict).toBe("unavailable");
    expect(captures).toHaveLength(0);
  });

  it("缺 PUBLIC_MEDIA_BASE_URL → 判不可用且不发请求（URL 提交没有它必然失败）", async () => {
    const mod = await loadModule({ ...fullConfig, PUBLIC_MEDIA_BASE_URL: "" });
    stubFetch(() => ({ status: 200, json: greenResult("pass") }));

    const outcomes = await mod.moderateImages(["/uploads/posts/x.jpg"], "post");
    expect(outcomes[0]?.verdict).toBe("unavailable");
    expect(outcomes[0]?.reason).toContain("PUBLIC_MEDIA_BASE_URL");
    expect(captures).toHaveLength(0);
    expect(mod.isModerationConfigured()).toBe(false);
  });

  it("缺 AK/Secret → 判不可用且不发请求", async () => {
    const mod = await loadModule({ ...fullConfig, ALICLOUD_ACCESS_KEY_SECRET: "" });
    stubFetch(() => ({ status: 200, json: greenResult("pass") }));
    await mod.moderateImages(["/uploads/posts/x.jpg"], "post");
    expect(captures).toHaveLength(0);
  });

  it("空数组入参直接返回空，不触发任何逻辑", async () => {
    const mod = await loadModule(fullConfig);
    stubFetch(() => ({ status: 200, json: greenResult("pass") }));
    await expect(mod.moderateImages([], "post")).resolves.toEqual([]);
    expect(captures).toHaveLength(0);
  });
});
