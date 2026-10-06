/**
 * @layer Application Layer —— ImageModeration（图片内容机审，v14 ADR-0003）
 * @file api/services/imageModeration.ts
 *
 * ⚠️ 本模块的**提交方式**在 2026-10-06 用官方文档复核后被证伪过一次，教训写在下面，
 * 因为它是这段代码存在理由的核心：
 * 我原先的实现是「base64 二进制提交、审核先于写盘」，并在文件头断言
 * 「官方文档确认内容安全支持 URL 与二进制两种提交方式」。**那句话是错的**——
 * 复核 help.aliyun.com 的 70292（图片同步检测 2018-05-09）与增强版 2022-03-02 ImageModeration 后，
 * 两者**都只接受可被服务端拉取的图片 URL**（`tasks[].url` / `ServiceParameters.imageUrl`），
 * 均不提供 base64 通道。也就是说照旧实现启用后，每一次调用都会 4xx，
 * 再按本模块的降级口径把全部图片刷进人工复核队列——**看起来"机审已接入"，实际一张都没审成**。
 * 现改为：**先落盘 → 用 PUBLIC_MEDIA_BASE_URL 拼出公网 URL 提交 → 明确违规则删文件并拒绝发布**。
 * 代价是一段「违规图短暂公网可达」的窗口（单图超时 3s、整批预算 8s）；
 * 收益是链路真的能跑通，且未配置时行为与改动前完全等价（见下）。
 * 教训：写「官方文档确认……」这种句式前必须真的把文档贴到眼前；断言外部能力时给出可核对的出处。
 *
 * ── 决定性设计点：未配置 Key 时的降级路径 = 放行 + 标记待审（不是拒绝） ──
 * 这是产品决策不是技术决策，理由写在这里：
 * 1. 现状本来就没有任何图片机审。贸然 fail-closed，等于用一次后端改动把「发图」这个核心动作
 *    变成「必须先在阿里云开通内容安全并配好 AK + 公网地址」的硬前置——用户会彻底发不了图。
 * 2. 项目对「外部能力未开通」的既有口径也是这样处理的：MOONSHOT_API_KEY 未配置时，
 *    哪钓识别返回「服务暂未开通」并全额退还（见 fishSpot.ts 的 no-key 分支）——
 *    也就是「功能降级 + 明确记账」，而不是把错误甩成用户不可用。
 * 3. 因此未配置/未启用/未配公网地址/调用失败/超时/签名被拒，一律判为 unavailable：图片照常落盘、
 *    帖子照常发布，同时向 reports 写一条 [系统] 前缀的人工复核记录（与 contentFilter 的
 *    广告词 flag 同一套队列与同一套幂等约定），让「机审缺位」转成「人工兜底」而不是「静默放过」。
 * 4. 反过来，一旦机审明确给出 block 判定，就是 fail-closed 删文件 + 拒绝发布——
 *    已开通服务却仍放行违规图，责任在平台。
 *
 * 可靠性：审核链路自身任何异常都不得阻断发布。每次 HTTP 有独立超时，整个批次再有一个总预算兜底
 * （fetch 不 honor abort 的极端情况下也能脱出），失败只记日志 + 转人工队列。
 *
 * ── 签名：规则已按文档校正，但仍**未经真实网关联调** ──
 * 已按 53413「公共参数」+ ROA 签名规范逐条对齐：Content-MD5 是标准 base64（**不得大写**，
 * 我旧实现 `.toUpperCase()` 是错的）、必发 `x-acs-version: 2018-05-09` /
 * `x-acs-signature-nonce` / `x-acs-signature-version: 1.0` / `x-acs-signature-method: HMAC-SHA1`
 * （旧实现一个都没发，必被拒），且这些头要进 CanonicalizedHeaders 参与签名。
 * 仍未验证的两点：`bizType` 的确切位置（文档示例未覆盖，默认留空不发送），以及真实网关对
 * 同一请求的签名判定。IMAGE_MODERATION_ENABLED 因此**默认 false**，
 * TODO(联调)：拿到 AK 后先用一张正常图 + 一张违规图各跑一次真实调用，确认 signature 通过、
 *   且 block 分支确实回到 reject；公网地址必须让阿里云侧可达（内网/防火墙会表现为拉图失败）。
 * 计费口径：按量付费通用版约 $0.6/千次（一张图一次），成本量级 = 发帖图片总数，可忽略；
 *   真正需要盯的是「审核失败刷人工队列」的人工成本，故失败次数在本模块按分钟节流告警。
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { reports } from "@db/schema";
import { env } from "../lib/env";
import { getDataSource, isDupEntry, log } from "../infra";

/**
 * 单张图的机审判定。
 * - pass：明确通过
 * - reject：明确违规 → 调用方必须拒绝发布（fail-closed）
 * - review：疑似违规（服务给出的 review 档）→ 放行 + 待人工复核
 * - unavailable：未配置/未启用/调用失败/超时 → 放行 + 待人工复核（本模块的核心降级判定）
 */
export type ModerationVerdict = "pass" | "reject" | "review" | "unavailable";

export interface ModerateOutcome {
  verdict: ModerationVerdict;
  /** 判定依据（服务返回的 label / 错误摘要），仅用于日志与人工队列 reason，不返回给前端 */
  reason?: string;
}

// ============ 配置（全部走 env，装配与注释见 api/lib/env.ts 的「图片机审」段） ============

const cfg = {
  accessKeyId: env.aliyunAccessKeyId,
  accessKeySecret: env.aliyunAccessKeySecret,
  /** 内容安全（绿网）区域 endpoint；换区只改这一项 */
  endpoint: env.aliyunGreenEndpoint.replace(/\/$/, ""),
  /** 审核服务端拉图的公网前缀；空串 = 无法用 URL 提交，整链路降级 */
  mediaBaseUrl: env.publicMediaBaseUrl,
  /** 业务线（控制台创建后得到，留空用默认通用业务） */
  bizType: env.aliyunGreenBizType,
  /** 检测场景：涉黄 + 涉政暴恐 + 广告，逗号分隔（取值已按官方文档核对） */
  scenes: env.aliyunGreenScenes.split(",").map((s) => s.trim()).filter(Boolean),
  /**
   * 总开关。**默认 false**——签名规则虽已按文档校正，但还没打过真实网关（见文件头 TODO(联调)）。
   * 未开启（或未配 AK/Secret、或未配公网地址）时行为 = 「放行 + 标记待审」，与本次改动前的现状等价，
   * 只是多了一条人工复核记录；绝不会拒绝发帖。
   */
  enabled: env.imageModerationEnabled,
  /** 单张图片提交超时（并行提交，故批次墙钟时间≈该值） */
  timeoutMs: env.imageModerationTimeoutMs,
  /** 整批总预算：兜底 fetch 不响应 abort 的极端情况，超时未决的图片一律按 unavailable */
  deadlineMs: env.imageModerationDeadlineMs,
};

/** 失效原因（空串=可用）。URL 提交必须有公网前缀，否则连请求都发不出去，这是硬性前提 */
function inactiveReason(): string {
  if (!cfg.enabled) return "IMAGE_MODERATION_ENABLED!=true";
  if (!(cfg.accessKeyId && cfg.accessKeySecret)) return "未配置 ALICLOUD_ACCESS_KEY_ID/SECRET";
  if (!cfg.mediaBaseUrl) return "未配置 PUBLIC_MEDIA_BASE_URL（机审只能按图片 URL 提交）";
  return "";
}

/** AK/Secret 齐备 + 显式启用 + 有公网前缀才算「可用」；否则整条链路走降级（不发 HTTP，零成本零延迟） */
export function isModerationConfigured(): boolean {
  return inactiveReason() === "";
}

/** 运营自查/后台展示用（不参与判定逻辑） */
export function moderationConfigState() {
  const reason = inactiveReason();
  return {
    enabled: cfg.enabled,
    hasKey: Boolean(cfg.accessKeyId && cfg.accessKeySecret),
    active: reason === "",
    endpoint: cfg.endpoint,
    scenes: cfg.scenes,
    /** 未生效的原因文案：便于我在服务器日志里一眼看出该补哪一项 */
    inactiveReason: reason,
  };
}

// ============ 对外入口 ============

/**
 * 批量机审：并行提交（串行会把 9 图预算累加成一个发布请求的分钟级延迟）。
 * 入参是**已落盘图片的同源相对路径**（`/uploads/posts/xxx.jpg`），本模块自己拼公网 URL——
 * 内容安全只接受可被服务端拉取的图片 URL，所以调用方必须"先写盘再来审核"。
 * 返回值与入参一一对应；服务不可用时不抛错，只给 unavailable，由调用方决定后续动作。
 */
export async function moderateImages(relativeUrls: string[], kind: "post" | "comment"): Promise<ModerateOutcome[]> {
  if (relativeUrls.length === 0) return [];
  if (!isModerationConfigured()) {
    // 降级主路径：一条日志说清「为什么没审」，避免上线后误以为机审已生效
    logThrottledWarn("image moderation disabled, passthrough + manual queue", {
      kind,
      count: relativeUrls.length,
      why: inactiveReason(),
    });
    return relativeUrls.map(() => ({ verdict: "unavailable", reason: inactiveReason() || "not-configured" }));
  }

  const settled = Promise.all(relativeUrls.map((url) => moderateOne(url, kind)));
  // 总预算兜底：超时后未决的位补 unavailable（已决的保留原判定，不因慢图丢快图的结论）
  const guarded = await withDeadline(settled, relativeUrls.length, cfg.deadlineMs);
  return guarded;
}

/** 单张：把 HTTP 异常/超时/非 2xx 全部折叠成 unavailable，判定异常绝不外抛给发布链路 */
async function moderateOne(relativeUrl: string, kind: "post" | "comment"): Promise<ModerateOutcome> {
  try {
    return await callGreenScan(`${cfg.mediaBaseUrl}${relativeUrl}`, kind);
  } catch (err) {
    logThrottledWarn("image moderation call failed, degrade to manual review", { kind, err: String(err) });
    return { verdict: "unavailable", reason: String(err).slice(0, 200) };
  }
}

/**
 * 总预算兜底：Promise.race + 占位补齐。
 * 不用 AbortSignal.any 之类新 API，避免在 esbuild bundle 的目标环境上有兼容性变量。
 */
async function withDeadline(settled: Promise<ModerateOutcome[]>, count: number, ms: number): Promise<ModerateOutcome[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    const raced = await Promise.race([settled, timeout]);
    if (raced === "timeout") {
      logThrottledWarn("image moderation batch exceeded deadline, unresolved -> manual review", { ms, count });
      return Array.from({ length: count }, () => ({ verdict: "unavailable" as const, reason: "deadline" }));
    }
    return raced;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ============ 阿里云内容安全调用（HTTP 调用集中在这一个函数） ============

/** 服务响应：只声明我们真正会读的字段，其余按 unknown 处理，避免与文档细节强耦合 */
interface GreenScanResponse {
  code?: number;
  msg?: string;
  data?: Array<{ results?: Array<{ label?: string; suggestion?: string; rate?: number }> }>;
}

/**
 * POST {endpoint}/green/image/scan —— 按图片 URL 提交单图。
 * 请求体形态 `{"scenes":[...],"tasks":[{"dataId","url"}]}` 与 scenes 取值
 * 均已按官方 70292 文档核对；`bizType` 的位置文档示例未覆盖，故仅在显式配置时发送（默认不发）。
 */
async function callGreenScan(absoluteImageUrl: string, kind: "post" | "comment"): Promise<ModerateOutcome> {
  const path = "/green/image/scan";
  const body = buildRequestBody(absoluteImageUrl, kind);
  const payload = JSON.stringify(body);
  const headers = signedHeaders("POST", path, payload);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const resp = await fetch(`${cfg.endpoint}${path}`, {
      method: "POST",
      headers,
      body: payload,
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      // 4xx 常见于签名/配额/参数问题：不重试（重试只会放大延迟），直接交降级路径
      throw new Error(`green HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    return mapVerdict(JSON.parse(text) as GreenScanResponse);
  } finally {
    clearTimeout(timer);
  }
}

/** 请求体：URL 提交（内容安全不提供 base64 通道，见文件头那段被证伪的记录） */
function buildRequestBody(absoluteImageUrl: string, kind: "post" | "comment"): Record<string, unknown> {
  const task: Record<string, unknown> = {
    // dataId 不参与审核逻辑，只为在人工复核队列/控制台日志里认出这张图的来源
    dataId: `${kind}-${Date.now()}-${randomBytes(4).toString("hex")}`,
    url: absoluteImageUrl,
  };
  if (cfg.bizType) task.bizType = cfg.bizType;
  return { scenes: cfg.scenes, tasks: [task] };
}

/**
 * ROA v1 签名头集合。必发头与取值按 53413「公共参数」核对：
 * Accept / Content-Type / Date / x-acs-version / x-acs-signature-nonce /
 * x-acs-signature-version / x-acs-signature-method / Authorization，Content-MD5 用 HMAC-SHA1 时必发。
 */
function signedHeaders(method: string, path: string, payload: string): Record<string, string> {
  const accept = "application/json";
  const contentType = "application/json";
  /** 标准 base64，**不能大写**：大写后的串与网关自己算出的 MD5 不同，会直接判体不符 */
  const contentMd5 = createHash("md5").update(payload, "utf8").digest("base64");
  const date = new Date().toUTCString();
  const acsHeaders: Record<string, string> = {
    "x-acs-signature-method": "HMAC-SHA1",
    "x-acs-signature-nonce": randomBytes(16).toString("hex"),
    "x-acs-signature-version": "1.0",
    "x-acs-version": "2018-05-09",
  };
  const stringToSign = buildStringToSign(method, accept, contentMd5, contentType, date, acsHeaders, path);
  const signature = createHmac("sha1", cfg.accessKeySecret).update(stringToSign, "utf8").digest("base64");
  return {
    Accept: accept,
    "Content-Type": contentType,
    "Content-MD5": contentMd5,
    Date: date,
    ...acsHeaders,
    Authorization: `acs ${cfg.accessKeyId}:${signature}`,
  };
}

/**
 * ROA 待签字符串：METHOD\nAccept\nContent-MD5\nContent-Type\nDate\n
 * 然后是按头名升序排列的 CanonicalizedHeaders（每行 `name:value\n`，name 全小写），
 * 最后接 CanonicalizedResource（本接口无查询参数，即路径本身）。
 */
function buildStringToSign(
  method: string,
  accept: string,
  contentMd5: string,
  contentType: string,
  date: string,
  acsHeaders: Record<string, string>,
  resource: string,
): string {
  const canonicalHeaders = Object.entries(acsHeaders)
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");
  return `${method.toUpperCase()}\n${accept}\n${contentMd5}\n${contentType}\n${date}\n${canonicalHeaders}${resource}`;
}

/**
 * 结果映射：任一场景 suggestion=block → reject；否则存在 review → review；否则 pass。
 * 服务返回非 200 code 视为「没审成」= unavailable（不当成通过，也不当成违规）。
 */
function mapVerdict(res: GreenScanResponse): ModerateOutcome {
  if (res.code !== undefined && res.code !== 200) {
    return { verdict: "unavailable", reason: `code=${res.code} ${res.msg ?? ""}`.trim() };
  }
  const results = (res.data ?? []).flatMap((d) => d.results ?? []);
  if (results.length === 0) return { verdict: "unavailable", reason: "empty-results" };
  const block = results.find((r) => r.suggestion === "block");
  if (block) return { verdict: "reject", reason: `label=${block.label}` };
  const review = results.find((r) => r.suggestion === "review");
  if (review) return { verdict: "review", reason: `label=${review.label}` };
  return { verdict: "pass" };
}

// ============ 人工复核队列（降级路径的兜底落点） ============

/**
 * 「放行但标记待审」的落库：写一条 [系统] 前缀举报进 /moderation 队列。
 *
 * 沿用 contentFilter.createSystemReport 的既有约定，而不是新增表/新增列（本期不为此加迁移）：
 * - reporterId = 内容作者 id（作者不会举报自己，该 (reporterId, postId) 组合天然被系统占用，
 *   配合 uq_report 实现「同一帖子只系统举报一次」的幂等）；
 * - 代价：一张图只有一条举报额度（uq_report），9 图帖里有 3 张待审也只留一条记录，
 *   所以 reason 里带张数、具体是哪几张只能靠日志回溯——这是刻意的取舍，不为此改 reports 结构；
 * - 评论图片同样挂在所属帖子名下（reports.post_id 非空且 listReports innerJoin posts），
 *   reason 用「评论」字样区分来源，审核员看帖子正文/图片即可判断。
 *
 * best-effort：写队列失败只记日志，绝不反过来阻断已决定放行的发布。
 */
export async function queuePendingReview(input: {
  postId: number;
  authorId: number;
  kind: "post" | "comment";
  count: number;
  /** 机审给出的原因摘要（未配置时为「未开启」），进 reason 便于审核员理解为何待审 */
  reason?: string;
}): Promise<void> {
  if (input.count <= 0) return;
  try {
    const state = moderationConfigState();
    const cause = state.active ? "机审不可用/超时" : `机审未启用（${state.inactiveReason || "未配置"}）`;
    const reason = `[系统]${input.kind === "comment" ? "评论" : "帖子"}图片待人工复核：${input.count} 张，原因：${
      input.reason ? input.reason.slice(0, 60) : cause
    }`;
    await getDataSource()
      .write()
      .insert(reports)
      .values({ reporterId: input.authorId, postId: input.postId, reason: reason.slice(0, 255) });
    log("info", "image moderation: manual review queued", {
      postId: input.postId, authorId: input.authorId, kind: input.kind, count: input.count,
    });
  } catch (err) {
    if (isDupEntry(err)) return; // uq_report：该帖已有一条系统待审记录
    log("error", "image moderation: manual review enqueue failed", {
      postId: input.postId, authorId: input.authorId, err: String(err),
    });
  }
}

// ============ 告警节流（审核服务全挂时每次发布都会失败，不能刷屏） ============

let lastWarnAt = 0;
function logThrottledWarn(message: string, fields: Record<string, unknown>): void {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  log("warn", message, fields);
}
