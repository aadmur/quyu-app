/**
 * @layer Service —— 账号注销到期匿名化定时任务（QY-E-005）
 * @file api/services/accountDeletion.ts
 *
 * 冷静期 7 天：申请注销后 deletionRequestedAt 非 NULL，期间账号正常可用，
 * 重新登录或主动撤销即取消。到期后由本模块的 hourly interval 扫描并匿名化：
 * 不删行（订单/票券/帖子/评论/举报流水保留，对账与审核不受影响），
 * unionId 改为 deleted:<id>:<ts> 使旧会话/JWT 自然失效。
 *
 * 调度写法对齐 ownerService.scheduleDailyRefresh（模块加载时注册一次）。
 */
import { anonymizeAccount, findUsersPendingDeletion } from "../queries/users";
import { log } from "../infra";

/** 冷静期时长：7 天 */
export const DELETION_COOLING_OFF_MS = 7 * 24 * 3600 * 1000;

const SCAN_INTERVAL_MS = 3600 * 1000; // hourly

/** 单轮扫描：匿名化所有冷静期到期的账号；单账号失败不阻断整轮（下一轮重试） */
export async function runDeletionSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - DELETION_COOLING_OFF_MS);
  const pending = await findUsersPendingDeletion(cutoff);
  if (pending.length === 0) return;
  log("info", "account deletion sweep", { pending: pending.length });
  for (const u of pending) {
    try {
      await anonymizeAccount(u.id);
      log("info", "account anonymized", {
        userId: u.id,
        requestedAt: u.deletionRequestedAt?.toISOString(),
      });
    } catch (e) {
      log("error", "account anonymize failed", { userId: u.id, error: String(e) });
    }
  }
}

let scheduled = false;

/** 服务启动时挂 hourly interval（unref 不阻止进程退出；启动后先跑一轮兜底停机窗口） */
export function scheduleDeletionSweep(): void {
  if (scheduled) return;
  scheduled = true;
  runDeletionSweep().catch((e) => log("error", "account deletion sweep failed", { error: String(e) }));
  const timer = setInterval(() => {
    runDeletionSweep().catch((e) => log("error", "account deletion sweep failed", { error: String(e) }));
  }, SCAN_INTERVAL_MS);
  timer.unref?.();
}
