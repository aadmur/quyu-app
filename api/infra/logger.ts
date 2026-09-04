/**
 * @layer Cross-cutting —— 结构化日志与慢查询告警（平台 stdout 采集）
 * @file api/infra/logger.ts
 *
 * JSON line 输出，字段 {ts, level, msg, ...fields}；未来接 pino/OTel 时只改本文件。
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 高 RPS 下的日志写盘优化：console.* 写文件描述符是同步阻塞调用，
 * 每请求 2 次同步写（access log + auth warn）会在事件循环上制造长尾。
 * 这里把行缓冲到内存，setImmediate 合并成单次 write，syscall 次数下降一个数量级。
 */
const buf: string[] = [];
let flushScheduled = false;

function flushLogs(): void {
  flushScheduled = false;
  if (buf.length === 0) return;
  const chunk = buf.splice(0, buf.length).join("\n") + "\n";
  process.stdout.write(chunk);
}

function emit(line: string): void {
  buf.push(line);
  if (!flushScheduled) {
    flushScheduled = true;
    setImmediate(flushLogs);
  }
}

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error") console.error(line); // error 不缓冲，保证崩溃前可见
  else emit(line);
}

export const SLOW_QUERY_MS = 200;

/** DB 慢查询告警：耗时超过阈值自动 warn 并带查询名（digest 由调用方常量传入） */
export function warnSlowQuery(name: string, durationMs: number, extra: Record<string, unknown> = {}): void {
  if (durationMs > SLOW_QUERY_MS) {
    log("warn", "slow query", { digest: name, durationMs: Math.round(durationMs), ...extra });
  }
}
