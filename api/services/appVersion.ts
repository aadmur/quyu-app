/**
 * @layer Application Layer —— AppVersion（APK 版本检查，QY-G-003）
 * @file api/services/appVersion.ts
 *
 * 背景：联网版 APK 通过 server.url 实时加载最新 Web 代码，但 APK 壳本身
 * （原生配置、插件、server.url）无法触达存量用户，需要「版本检查 + 更新提示」通道。
 *
 * 数据源优先级：
 * 1. 服务器 JSON 文件（env APP_VERSION_FILE 指定路径，如 /opt/quyu/app-version.json）：
 *    {"latestApkVersion":"11","apkUrl":"http://.../趣渔-v11.apk","notes":"...","force":false}
 *    热更方式与 contentFilter 同口径：每次查询 fs.stat 比对 mtime，变化则重读；
 *    文件损坏保留旧值，文件缺失回退 env。
 * 2. env 变量兜底：APP_LATEST_APK_VERSION / APP_APK_URL / APP_UPDATE_NOTES / APP_UPDATE_FORCE
 * 3. 全部缺失返回 latestApkVersion: null（前端据此不打扰用户）。
 *
 * 可靠性口径：读取/解析任何异常一律 fail-open（回退 env 或 null）+ 记日志，
 * 绝不影响其他接口；本接口不依赖数据库。
 */
import fs from "node:fs";
import { log } from "../infra";

export interface VersionInfo {
  /** 最新 APK 壳版本号（纯数字字符串，与原生 versionName 对应）；未配置为 null */
  latestApkVersion: string | null;
  /** APK 下载地址；未配置为 null */
  apkUrl: string | null;
  /** 更新说明（可多行）；缺省空串 */
  notes: string;
  /** 是否强制更新（true 时前端不给「暂不」） */
  force: boolean;
}

interface FileState extends VersionInfo {
  /** 来源文件 mtime，用于热更比对 */
  mtimeMs: number;
}

let fileState: FileState | null = null;

/** 文件读取失败日志节流（每分钟最多一条，避免每请求刷日志） */
let lastFileErrLogAt = 0;

function parseVersionFile(raw: string): VersionInfo | null {
  const data = JSON.parse(raw) as Record<string, unknown>;
  const v = data.latestApkVersion;
  // 缺版本号视为损坏配置，拒绝生效（避免误触发全量更新提示或全量静默）
  if (typeof v !== "string" || !v.trim()) return null;
  return {
    latestApkVersion: v.trim(),
    apkUrl: typeof data.apkUrl === "string" && data.apkUrl.trim() ? data.apkUrl.trim() : null,
    notes: typeof data.notes === "string" ? data.notes : "",
    force: data.force === true,
  };
}

/** 热更入口：stat 比对 mtime，变化则重读；读/解析失败保留旧值（可用性优先） */
function reloadIfChanged(): void {
  const file = process.env.APP_VERSION_FILE;
  if (!file) return; // 未配置文件：始终走 env 兜底
  try {
    const st = fs.statSync(file);
    if (fileState?.mtimeMs === st.mtimeMs) return;
    const parsed = parseVersionFile(fs.readFileSync(file, "utf8"));
    if (!parsed) {
      log("error", "app version: file parsed invalid, keep old value", { file });
      // 记住 mtime，避免每请求重复报错刷屏；无旧值时置空态（后续走 env 兜底）
      fileState = fileState
        ? { ...fileState, mtimeMs: st.mtimeMs }
        : { latestApkVersion: null, apkUrl: null, notes: "", force: false, mtimeMs: st.mtimeMs };
      return;
    }
    fileState = { ...parsed, mtimeMs: st.mtimeMs };
    log("info", "app version: config reloaded", { file, latestApkVersion: parsed.latestApkVersion, force: parsed.force });
  } catch (err) {
    // 文件不存在/读失败：有旧文件值则保留；否则回退 env（由调用方处理）
    const now = Date.now();
    if (now - lastFileErrLogAt >= 60_000) {
      lastFileErrLogAt = now;
      if (fileState?.latestApkVersion) {
        log("error", "app version: file reload failed, keep old value", { file, err: String(err) });
      } else {
        log("warn", "app version: file unreadable, fallback to env", { file, err: String(err) });
      }
    }
  }
}

/** env 兜底：APP_LATEST_APK_VERSION / APP_APK_URL / APP_UPDATE_NOTES / APP_UPDATE_FORCE */
function envFallback(): VersionInfo {
  const v = process.env.APP_LATEST_APK_VERSION?.trim();
  const forceRaw = process.env.APP_UPDATE_FORCE?.trim().toLowerCase();
  return {
    latestApkVersion: v || null,
    apkUrl: process.env.APP_APK_URL?.trim() || null,
    notes: process.env.APP_UPDATE_NOTES ?? "",
    force: forceRaw === "true" || forceRaw === "1",
  };
}

/**
 * 公共查询 app.versionInfo 的实现。
 * 全链路 try/catch fail-open：最坏情况返回 latestApkVersion: null，前端不打扰。
 */
export function getVersionInfo(): VersionInfo {
  try {
    reloadIfChanged();
    if (fileState?.latestApkVersion) {
      const { latestApkVersion, apkUrl, notes, force } = fileState;
      return { latestApkVersion, apkUrl, notes, force };
    }
    return envFallback();
  } catch (err) {
    log("error", "app version: getVersionInfo failed, fail-open null", { err: String(err) });
    return { latestApkVersion: null, apkUrl: null, notes: "", force: false };
  }
}
