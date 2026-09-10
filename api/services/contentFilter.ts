/**
 * @layer Application Layer —— ContentFilter（内容前置过滤，QY-SAFE-002）
 * @file api/services/contentFilter.ts
 *
 * 两档词表：
 * - banned（违禁档：涉政/涉黄/赌博/毒品类常见词）→ reject：直接拒发，不落库
 * - ad（广告档：加微信/代购/刷单/兼职等营销词）→ flag：内容照常落库，
 *   同时向 reports 表写一条系统自动举报（reason 以 [系统] 前缀开头），进入 /moderation 审核队列
 *
 * 词表加载（热更）：
 * - 优先读 env SENSITIVE_WORDS_FILE 指定的 JSON 文件：{"banned": [...], "ad": [...]}
 * - 每次检查时 fs.stat 比对 mtime，变化则重读；读/解析失败回退旧表并记日志
 * - 文件未配置或不存在时使用下方内置基础词表
 *
 * 可靠性口径：
 * - 词表加载/匹配过程任何异常一律 fail-open 放行 + 记日志（可用性优先）；
 *   但 reject 判定一旦做出即为确定性结果，直接抛 BAD_REQUEST
 * - 匹配前归一化：去空白 / 全角转半角 / 转小写（火星文、拆字等变体对抗不在本期范围）
 *
 * reports 写入约定（reporter_id 非空约束绕不开，不新增迁移）：
 * - reporterId 填「被举报内容的作者本人 id」。语义上作者不会举报自己
 *   （reportPost 禁止自举报），该 (reporterId, postId) 组合天然只被系统占用，
 *   配合 uq_report 唯一索引恰好实现「同一内容只系统举报一次」的幂等；
 * - reason 一律以 [系统] 前缀开头，审核队列中可据此与人工举报区分；
 * - 审核队列 listReports 用 leftJoin users 取举报人昵称，作者 id 可正常解析，
 *   展示为作者名 + [系统] 前缀 reason，语义可辨识。
 */
import fs from "node:fs";
import { TRPCError } from "@trpc/server";
import { reports } from "@db/schema";
import { getDataSource, isDupEntry, log } from "../infra";

// ============ 内置基础词表（保持克制，仅收录常见词；服务器文件可覆盖热更） ============

/** 违禁档（reject）：涉赌/涉黄/涉毒/涉政类常见词 */
const BUILTIN_BANNED: string[] = [
  "赌博", "博彩", "赌球", "百家乐", "六合彩", "时时彩", "北京赛车", "幸运飞艇",
  "色情", "裸聊", "约炮", "援交", "卖淫", "嫖娼",
  "冰毒", "摇头丸", "麻古", "k粉",
  "法轮功", "枪支买卖",
];

/** 广告档（flag）：营销/引流/诈骗类常见词 */
const BUILTIN_AD: string[] = [
  "加微信", "加v信", "微信同号", "加qq", "qq群",
  "代购", "刷单", "刷信誉", "兼职", "打字员", "点赞员", "日结工资",
  "微商", "招代理", "加盟",
  "稳赚不赔", "高额回报", "信用卡套现", "代开发票", "办证",
];

// ============ 词表状态与热更 ============

interface WordTable {
  banned: string[];
  ad: string[];
  /** 来源文件 mtime（内置词表为 null） */
  mtimeMs: number | null;
  source: "builtin" | "file";
}

let current: WordTable = {
  banned: BUILTIN_BANNED.map(normalize),
  ad: BUILTIN_AD.map(normalize),
  mtimeMs: null,
  source: "builtin",
};

/** 文本归一化：去全部空白、全角(FF01–FF5E)转半角、转小写 */
function normalize(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

function parseWordFile(raw: string): { banned: string[]; ad: string[] } | null {
  const data = JSON.parse(raw) as { banned?: unknown; ad?: unknown };
  const pick = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((w): w is string => typeof w === "string" && w.trim().length > 0) : [];
  const banned = pick(data.banned);
  const ad = pick(data.ad);
  // 两档皆空视为损坏配置，拒绝生效（避免空文件意外清空词表导致全量放行而不自知）
  if (banned.length === 0 && ad.length === 0) return null;
  return { banned: banned.map(normalize), ad: ad.map(normalize) };
}

/** 词表文件不可读时的 warn 节流（每分钟最多一条，避免发布链路刷日志） */
let lastFileErrLogAt = 0;

/** 热更入口：stat 比对 mtime，变化则重读；任何失败保留旧表（可用性优先） */
function reloadIfChanged(): void {
  const file = process.env.SENSITIVE_WORDS_FILE;
  if (!file) return; // 未配置文件：始终用内置词表
  try {
    const st = fs.statSync(file);
    if (current.mtimeMs === st.mtimeMs) return;
    const parsed = parseWordFile(fs.readFileSync(file, "utf8"));
    if (!parsed) {
      log("error", "content filter: word file parsed empty, keep old table", { file });
      current = { ...current, mtimeMs: st.mtimeMs }; // 记住 mtime，避免每请求重复报错刷屏
      return;
    }
    current = { ...parsed, mtimeMs: st.mtimeMs, source: "file" };
    log("info", "content filter: word table reloaded", {
      file, banned: parsed.banned.length, ad: parsed.ad.length,
    });
  } catch (err) {
    // 文件不存在/读失败：若当前用的是文件表则保留旧表；否则回退内置词表
    const now = Date.now();
    if (now - lastFileErrLogAt >= 60_000) {
      lastFileErrLogAt = now;
      if (current.source !== "file") {
        log("warn", "content filter: word file unreadable, fallback to builtin", {
          file, err: String(err),
        });
      } else {
        log("error", "content filter: word file reload failed, keep old table", {
          file, err: String(err),
        });
      }
    }
  }
}

// ============ 匹配与对外接口 ============

export type ContentKind = "post" | "comment" | "news";

export interface FilterResult {
  action: "pass" | "reject" | "flag";
  tier?: "banned" | "ad";
  hit?: string;
}

/** 纯匹配：违禁档优先于广告档；异常 fail-open 返回 pass */
export function checkContent(text: string): FilterResult {
  try {
    reloadIfChanged();
    const t = normalize(text);
    if (!t) return { action: "pass" };
    for (const w of current.banned) {
      if (w && t.includes(w)) return { action: "reject", tier: "banned", hit: w };
    }
    for (const w of current.ad) {
      if (w && t.includes(w)) return { action: "flag", tier: "ad", hit: w };
    }
    return { action: "pass" };
  } catch (err) {
    // 过滤链路自身异常：fail-open 放行，绝不拖垮发布
    log("error", "content filter: check failed, fail-open pass", { err: String(err) });
    return { action: "pass" };
  }
}

/**
 * 发布前置检查（reject 直接抛错，flag/pass 返回结果由调用方决定后续动作）。
 * 命中即写审计日志：用户 id / 入口 / 档位 / 命中词 / 内容前 20 字（不写全文，避免日志存敏感文本）。
 */
export function assertContentAllowed(text: string, kind: ContentKind, userId: number): FilterResult {
  const result = checkContent(text);
  if (result.action === "pass") return result;
  log("warn", "content filter hit", {
    userId, kind, tier: result.tier, hit: result.hit, excerpt: text.slice(0, 20),
  });
  if (result.action === "reject") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "内容包含违规信息，请修改后重试" });
  }
  return result;
}

/**
 * 广告档命中后的系统举报（best-effort）：
 * - reporterId = 内容作者 id（语义约定见文件头注释），reason 带 [系统] 前缀
 * - 撞 uq_report（同一作者同一帖已有一条举报）→ 幂等跳过
 * - 插入失败只记日志，绝不影响已落库的内容
 */
export async function createSystemReport(input: {
  postId: number;
  authorId: number;
  hit: string;
  kind: ContentKind;
  excerpt?: string;
}): Promise<void> {
  try {
    const kindLabel = input.kind === "comment" ? "评论" : input.kind === "news" ? "鱼讯" : "帖子";
    let reason = `[系统]${kindLabel}命中广告词「${input.hit}」，待人工复核`;
    if (input.excerpt) reason += `：${input.excerpt}`;
    await getDataSource()
      .write()
      .insert(reports)
      .values({ reporterId: input.authorId, postId: input.postId, reason: reason.slice(0, 255) });
    log("info", "content filter: system report created", {
      postId: input.postId, authorId: input.authorId, hit: input.hit, kind: input.kind,
    });
  } catch (err) {
    if (isDupEntry(err)) return; // uq_report：同一（作者, 帖子）已系统举报过
    log("error", "content filter: system report insert failed", {
      postId: input.postId, authorId: input.authorId, err: String(err),
    });
  }
}
