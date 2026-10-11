/**
 * 识鱼（v15 · QY-FISH-002/003/006）的**钱路与合规门控**合同测试。
 * @file api/services/fishId.test.ts
 *
 * 这里刻意只桩掉两个协作方：`../infra` 的数据源与 `../kimi/fishId` 的模型调用。
 * 要钉的是"钱的次序"和"磁盘上发生了什么"，不是 drizzle 生成什么 SQL：
 *
 * ⚠️ **本文件不验证 SQL 守卫文本本身**（`fish_id_free_used < limit`、`balance_cents >= price`、
 * 退还用的 `GREATEST(fish_id_free_used - 1, 0)`）。桩里那些 where 片段是 drizzle 的私有结构，
 * 对它做字符串断言会在升级后悄悄退化成"匹配不到任何东西也算通过"——这正是本项目反复挨打的假绿灯形态
 * （见 CHANGELOG 二十节与 B-34）。守卫要真验得连真库跑，而本机不可得（3306 是这台机器自己的
 * MySQL 8.4 服务、root 口令不可用，起隔离 mysqld 被策略拦）。**该缺口登记为 backlog，不当作已覆盖。**
 *
 * 桩的纪律：`user_balance` 上每次 update 都要从预期队列取一个 affectedRows，队列空了就抛错——
 * 否则"多退一次/少退一次"会被无声吞掉（这个桩的第一版就是因为没有这条硬失败而差点白测）。
 *
 * ⚠️ **诚实标注：这 14 条断言没有做过变异验证。** 2026-10-11 曾打算往 `fishId.ts` 注入 4 个变异
 * （付费不退还 / no-key 报 500 / 未授权也沉淀 / features 范围也落盘）逐条证明对应断言会变红，
 * 该操作被本机策略拦下，按规矩**没有换第二条通道重试**。所以本文件的真实状态是：
 * "跑得通、且已证明桩口径错配会整片红"（第一次把 read/write 写成属性时 13/14 立刻红），
 * **不是**"每条断言都已被证明能变红"。这一缺口登记在 `docs/agile/product-backlog.md`，别当已覆盖。
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Op = {
  op: "select" | "insert" | "update";
  table: string;
  values?: Record<string, unknown>[];
  set?: Record<string, unknown>;
  hasWhere: boolean;
  dup?: boolean;
};

type Chain = {
  info: Op;
  set: (v: Record<string, unknown>) => Chain;
  where: () => Chain;
  values: (v: unknown) => Chain;
  onDuplicateKeyUpdate: (v: unknown) => Chain;
  from: (t: unknown) => Chain;
  orderBy: () => Chain;
  limit: () => Chain;
  then: (onOk?: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => Promise<unknown>;
};

const TABLE = {
  userBalance: "user_balance",
  fishIdCalls: "fish_id_calls",
  fishIdSamples: "fish_id_samples",
  fishSpotSampleConsents: "fish_spot_sample_consents",
} as const;

const { identifyFishMock, ops, script, K3ErrorReal } = vi.hoisted(() => ({
  identifyFishMock: vi.fn(),
  ops: [] as unknown[],
  script: {
    /** user_balance 上逐次 update 应返回的 affectedRows（CAS 成败由它表达） */
    balanceUpdates: [] as number[],
    consent: null as null | { scope: string },
    balanceRow: { balanceCents: 100, fishIdFreeUsed: 0 },
    sampleRows: [] as { id: number }[],
  },
  K3ErrorReal: class K3Error extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("../kimi/fishId", async (importOriginal) => {
  const real = await importOriginal<typeof import("../kimi/fishId")>();
  return { ...real, K3Error: K3ErrorReal, identifyFish: identifyFishMock };
});

vi.mock("../infra", async () => {
  const schema = await import("@db/schema");
  const nameOf = (t: unknown): string => {
    for (const key of ["userBalance", "fishIdCalls", "fishIdSamples", "fishSpotSampleConsents"] as const) {
      if (t === (schema as unknown as Record<string, unknown>)[key]) return TABLE[key];
    }
    throw new Error(
      `桩数据源遇到未登记的表对象：${String((t as { constructor?: { name?: string } })?.constructor?.name)} —— 识鱼扩展时要在本测试里登记它`,
    );
  };

  const record = (info: Op): unknown => {
    (ops as Op[]).push(info);
    if (info.op === "select") {
      if (info.table === TABLE.fishSpotSampleConsents) {
        return script.consent ? [{ scope: script.consent.scope, revokedAt: null }] : [];
      }
      if (info.table === TABLE.fishIdSamples) return script.sampleRows;
      return [script.balanceRow];
    }
    if (info.op === "update" && info.table === TABLE.userBalance) {
      const next = script.balanceUpdates.shift();
      if (next === undefined) {
        throw new Error(
          `桩里没有为第 ${(ops as Op[]).filter((o) => o.op === "update" && o.table === TABLE.userBalance).length} 次 user_balance 更新准备 affectedRows —— 计费/退还的**次数**与测试预期不一致`,
        );
      }
      return [{ affectedRows: next }];
    }
    return [{ affectedRows: 1 }];
  };

  const chain = (info: Op): Chain => {
    const c: Chain = {
      info,
      set: (v) => ((info.set = v), c),
      where: () => ((info.hasWhere = true), c),
      values: (v) => ((info.values = Array.isArray(v) ? [...v] : [v]), c),
      onDuplicateKeyUpdate: () => ((info.dup = true), c),
      from: (t) => ((info.table = nameOf(t)), c),
      orderBy: () => c,
      limit: () => c,
      then: (onOk, onErr) => Promise.resolve(record(info)).then(onOk as never, onErr as never),
    };
    return c;
  };

  const db = {
    select: () => chain({ op: "select", table: "?", hasWhere: false }),
    insert: (t: unknown) => chain({ op: "insert", table: nameOf(t), hasWhere: false }),
    update: (t: unknown) => chain({ op: "update", table: nameOf(t), hasWhere: false }),
  };
  // 注意口径：真实 RWDataSource 的 read/write 是**方法**（getDataSource().write()），
  // 把它们写成属性会得到 "write is not a function" —— 13 条一起红的就是这个。
  return { getDataSource: () => ({ read: () => db, write: () => db }), log: () => {} };
});

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const okResult = () => ({
  result: {
    topCandidates: [
      { name: "鲫鱼", confidence: 0.88, keyFeature: "体高而侧扁、无须" },
      { name: "鳊鱼", confidence: 0.42, keyFeature: "菱形体型" },
    ],
    confidence: 0.88,
    isSupported: true,
    fallbackNote: "",
  },
  usage: { promptTokens: 800, completionTokens: 150, totalTokens: 950 },
});

type Svc = typeof import("./fishId");
let svc: Svc;

const spotsDir = path.resolve(process.cwd(), "uploads", "spots");
let baseline: string[] = [];
const newFiles = () => (existsSync(spotsDir) ? readdirSync(spotsDir).filter((f) => !baseline.includes(f)) : []);

const balUpdates = () => (ops as Op[]).filter((o) => o.op === "update" && o.table === TABLE.userBalance).map((o) => Object.keys(o.set ?? {}).join("+"));
const insertsOf = (table: string) => (ops as Op[]).filter((o) => o.op === "insert" && o.table === table);
const ledger = () => insertsOf(TABLE.fishIdCalls).flatMap((o) => o.values ?? []);
/** 台账只许存元数据：出现任何图片/正文字段就是合规越界 */
const ledgerKeys = () => [...new Set(ledger().flatMap((v) => Object.keys(v)))].sort();

beforeAll(async () => {
  for (const [k, v] of Object.entries({
    NODE_ENV: "test",
    APP_ID: "test-app",
    APP_SECRET: "test-secret",
    KIMI_AUTH_URL: "https://kimi.example.test",
    KIMI_OPEN_URL: "https://kimi.example.test",
    DATABASE_URL: "mysql://root:root@127.0.0.1:3399/quyu_unused",
    MOONSHOT_API_KEY: "sk-test-not-used",
    K3_MOCK: "false",
    FISH_ID_PRICE_CENTS: "30",
    FISH_ID_FREE_LIMIT: "3",
    FISH_ID_MIN_CONFIDENCE_X100: "55",
  })) {
    process.env[k] = v as string;
  }
  svc = await import("./fishId");
  baseline = existsSync(spotsDir) ? readdirSync(spotsDir) : [];
});

afterAll(() => {
  for (const f of newFiles()) rmSync(path.join(spotsDir, f), { force: true });
});

beforeEach(() => {
  ops.length = 0;
  script.balanceUpdates = [];
  script.consent = null;
  script.balanceRow = { balanceCents: 100, fishIdFreeUsed: 0 };
  script.sampleRows = [];
  identifyFishMock.mockReset();
});

describe("识鱼计费状态机", () => {
  it("有免费次数时走 free，不碰余额列", async () => {
    script.balanceUpdates = [1]; // 免费 CAS 成功
    identifyFishMock.mockResolvedValue(okResult());

    const out = await svc.identifyFishCall(7, { imageData: PNG_1PX });

    expect(out.billing).toBe("free");
    expect(out.costCents).toBe(0);
    expect(balUpdates()).toEqual(["fishIdFreeUsed"]); // 只有占免费次数这一条 UPDATE
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ status: "ok", billing: "free", costCents: 0, topFishName: "鲫鱼", promptTokens: 800 });
  });

  it("免费用完才预扣余额，且扣的是 FISH_ID_PRICE_CENTS", async () => {
    script.balanceUpdates = [0, 1]; // 免费 CAS 未命中 → 付费 CAS 命中
    identifyFishMock.mockResolvedValue(okResult());

    const out = await svc.identifyFishCall(7, { imageData: PNG_1PX });

    expect(out.billing).toBe("paid");
    expect(out.costCents).toBe(30);
    expect(balUpdates()).toEqual(["fishIdFreeUsed", "balanceCents"]);
    expect(ledger()[0]).toMatchObject({ billing: "paid", costCents: 30, status: "ok" });
  });

  it("余额不足：直接拒，**不调模型、不写台账**", async () => {
    script.balanceUpdates = [0, 0];
    identifyFishMock.mockResolvedValue(okResult());

    await expect(svc.identifyFishCall(7, { imageData: PNG_1PX })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "余额不足，请先充值",
    });
    expect(identifyFishMock).not.toHaveBeenCalled();
    expect(ledger()).toEqual([]); // 没花钱也没调模型，就不该有台账行
  });

  it("入参不是 data:image/ 时先拒——**扣费必须发生在格式校验之后**", async () => {
    identifyFishMock.mockResolvedValue(okResult());

    await expect(svc.identifyFishCall(7, { imageData: "http://x/y.png" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(balUpdates()).toEqual([]); // 一次 UPDATE 都不许有
    expect(identifyFishMock).not.toHaveBeenCalled();
    expect(ledger()).toEqual([]);
  });
});

describe("识别失败必须全额退还", () => {
  it("付费档失败：退回余额列，台账记 error 且 costCents=0", async () => {
    script.balanceUpdates = [0, 1, 1]; // 免费未命中 → 扣费成功 → 退还成功
    identifyFishMock.mockRejectedValue(new Error("k3 http 500"));

    await expect(svc.identifyFishCall(7, { imageData: PNG_1PX })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "识别失败，请换一张更清晰的照片重试",
    });
    expect(balUpdates()).toEqual(["fishIdFreeUsed", "balanceCents", "balanceCents"]);
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ status: "error", billing: "paid", costCents: 0 });
  });

  it("免费档失败：退回的是次数列而不是余额列", async () => {
    script.balanceUpdates = [1, 1]; // 占免费 → 退免费
    identifyFishMock.mockRejectedValue(new Error("k3 timeout"));

    await expect(svc.identifyFishCall(7, { imageData: PNG_1PX })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(balUpdates()).toEqual(["fishIdFreeUsed", "fishIdFreeUsed"]);
    expect(ledger()[0]).toMatchObject({ status: "error", billing: "free" });
  });

  it("服务端没配 Key：退还 + 回 412「暂未开通」，**不能伪装成 500**", async () => {
    script.balanceUpdates = [1, 1];
    identifyFishMock.mockRejectedValue(new K3ErrorReal("no-key", "识别服务未配置 API Key"));

    await expect(svc.identifyFishCall(7, { imageData: PNG_1PX })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "识别服务暂未开通，请稍后再试",
    });
    expect(balUpdates()).toEqual(["fishIdFreeUsed", "fishIdFreeUsed"]);
    expect(ledger()[0]).toMatchObject({ status: "error" });
  });
});

describe("样本沉淀的授权门控（QY-FISH-006 合规边界）", () => {
  it("未授权：不写样本表，**也一个字节都不落盘**", async () => {
    script.balanceUpdates = [1];
    script.consent = null;
    identifyFishMock.mockResolvedValue(okResult());

    const out = await svc.identifyFishCall(7, { imageData: PNG_1PX });

    expect(out.sampleSaved).toBe(false);
    expect(insertsOf(TABLE.fishIdSamples)).toEqual([]);
    expect(newFiles()).toEqual([]);
  });

  it("授权范围 features：写样本但 imagePath 必须是 null", async () => {
    script.balanceUpdates = [1];
    script.consent = { scope: "features" };
    identifyFishMock.mockResolvedValue(okResult());

    const out = await svc.identifyFishCall(7, { imageData: PNG_1PX });

    expect(out.sampleSaved).toBe(true);
    const rows = insertsOf(TABLE.fishIdSamples).flatMap((o) => o.values ?? []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ imagePath: null, topFishName: "鲫鱼" });
    expect(newFiles()).toEqual([]);
  });

  it("授权范围 image：落盘且记 /uploads/spots/ 路径；测完自清", async () => {
    script.balanceUpdates = [1];
    script.consent = { scope: "image" };
    identifyFishMock.mockResolvedValue(okResult());

    const out = await svc.identifyFishCall(7, { imageData: PNG_1PX });

    expect(out.sampleSaved).toBe(true);
    const rows = insertsOf(TABLE.fishIdSamples).flatMap((o) => o.values ?? []);
    expect(String(rows[0].imagePath)).toMatch(/^\/uploads\/spots\//);
    expect(newFiles()).toHaveLength(1); // 真的写到了磁盘上
    cleanupAll();
  });

  it("台账只存元数据：出现 image/content/base64 这类字段即为越界", async () => {
    script.balanceUpdates = [1];
    identifyFishMock.mockResolvedValue(okResult());
    await svc.identifyFishCall(7, { imageData: PNG_1PX });

    const forbidden = ledgerKeys().filter((k) => /image|content|base64|dataUrl/i.test(k));
    expect(forbidden).toEqual([]);
  });
});

describe("余额查询与纠正反馈", () => {
  it("首次查询会补齐余额行（insert … on duplicate key），并回带额度口径", async () => {
    const info = await svc.getFishIdBalance(7);
    const row = insertsOf(TABLE.userBalance).flatMap((o) => o.values ?? [])[0] as Record<string, unknown>;
    expect(row).toMatchObject({ userId: 7, balanceCents: 0, fishIdFreeUsed: 0 });
    expect(insertsOf(TABLE.userBalance)[0]?.dup).toBe(true); // 已存在则不动，靠 onDuplicateKeyUpdate
    expect(info).toMatchObject({ fishIdFreeLimit: 3, fishIdPriceCents: 30, balanceCents: 100 });
  });

  it("纠正反馈打到该用户最近一条样本上，超 32 字要截断", async () => {
    script.sampleRows = [{ id: 42 }];
    const out = await svc.correctFish(7, { correctedFish: "鳡鱼".repeat(20) });
    expect(out).toEqual({ ok: true });
    const upd = (ops as Op[]).find((o) => o.op === "update" && o.table === TABLE.fishIdSamples);
    expect(Object.keys(upd?.set ?? {})).toEqual(["correctedFish"]);
    expect(String(upd?.set?.correctedFish)).toHaveLength(32);
  });

  it("没有样本行时纠正不报错，也不许凭空 UPDATE", async () => {
    script.sampleRows = [];
    await expect(svc.correctFish(7, { correctedFish: "鳜鱼" })).resolves.toEqual({ ok: true });
    expect((ops as Op[]).some((o) => o.op === "update" && o.table === TABLE.fishIdSamples)).toBe(false);
  });
});

/** 供 image 分支自清：只删本测试新建的文件，不动目录里可能已存在的真实样本 */
function cleanupAll() {
  for (const f of newFiles()) rmSync(path.join(spotsDir, f), { force: true });
  baseline = existsSync(spotsDir) ? readdirSync(spotsDir) : baseline;
}
