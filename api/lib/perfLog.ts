/**
 * 冷启动性能采样落盘（QY-PERF-008）
 *
 * 为什么用 JSONL 而不是数据库表：
 * - 采样发生在**登录前**（冷启动即上报），没有用户身份，写进业务表还要为
 *   匿名数据设计外键/可空字段，收益不抵成本。
 * - 这是诊断数据而非业务数据，按天滚动成文件便于直接 grep / awk 算分位数，
 *   且不需要为它跑一次生产 DDL 迁移。
 *
 * 落盘位置 <cwd>/logs/perf-YYYY-MM-DD.jsonl，与 uploads/ 一样在构建产物之外
 * （vite build 的 emptyOutDir 不会碰它）。logs/ 已在 .gitignore 中忽略。
 *
 * 容量控制：单文件超过 MAX_BYTES 后丢弃后续样本（并每 1000 次记一条 warning），
 * 避免异常客户端把磁盘写满 —— 采样数据丢失可接受，磁盘写满不可接受。
 */
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 8 * 1024 * 1024;
let droppedSinceWarn = 0;

/** 允许上报的字段白名单：不接受客户端塞入任意键，避免被当作日志注入面 */
const NUMERIC_FIELDS = [
  "ttfbMs",
  "fcpMs",
  "lcpMs",
  "interactiveMs",
  "domContentLoadedMs",
  "loadMs",
  "transferBytes",
  "decodedBytes",
  "requestCount",
  "dpr",
  "deviceMemoryGb",
  "hardwareConcurrency",
] as const;

const STRING_FIELDS = ["effectiveType", "downlinkMbps", "path", "ua", "sdk", "sessionKind"] as const;

export interface PerfSample {
  [k: string]: unknown;
}

/** 清洗上报体：只保留白名单字段且做类型收敛，其余丢弃 */
export function sanitizeSample(raw: unknown): PerfSample | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const out: PerfSample = {};

  for (const k of NUMERIC_FIELDS) {
    const v = input[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.round(v * 100) / 100;
  }
  for (const k of STRING_FIELDS) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0 && v.length <= 512) out[k] = v;
  }

  // 至少要有一个首屏指标，否则这条样本没有意义
  if (out.fcpMs == null && out.lcpMs == null && out.interactiveMs == null) return null;
  return out;
}

function fileFor(now: Date): string {
  const day = now.toISOString().slice(0, 10);
  // 目录可用 PERF_LOG_DIR 覆盖：一是便于把采样挂到独立数据盘，
  // 二是让冒烟/实验室脚本把测试样本写到别处，避免污染真实用户样本
  // （否则合成探针值会和真机数据混在同一个文件里，分位数直接失真）。
  const dir = process.env.PERF_LOG_DIR || path.resolve(process.cwd(), "logs");
  return path.join(dir, `perf-${day}.jsonl`);
}

/** 追加一条采样；失败只记日志，绝不影响请求本身 */
export function appendPerfSample(sample: PerfSample): boolean {
  const file = fileFor(new Date());
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size >= MAX_BYTES) {
      droppedSinceWarn += 1;
      if (droppedSinceWarn % 1000 === 1) {
        console.warn(`[perf] ${path.basename(file)} 已达 ${MAX_BYTES} 字节上限，丢弃采样`);
      }
      return false;
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), ...sample }) + "\n";
    fs.appendFileSync(file, line, "utf8");
    return true;
  } catch (err) {
    console.warn("[perf] 采样落盘失败：", (err as Error).message);
    return false;
  }
}

export const __perfLogInternals = { MAX_BYTES, fileFor };
