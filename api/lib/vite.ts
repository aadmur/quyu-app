/**
 * @layer Infrastructure —— 生产静态资源服务：预压缩直出 + 分级缓存头
 * @file api/lib/vite.ts
 *
 * 背景（v12 实测）：此前静态资源既不压缩也不带缓存头，主 JS 以 921 KB
 * 原始体积裸传、CSS 100 KB 裸传；且因缺少 Cache-Control，浏览器对
 * index.html 走启发式缓存，热更新后可能拿到「旧 HTML + 已删除的旧 hash
 * 资源」而白屏。本模块同时解决传输体积与缓存正确性两个问题。
 *
 * 设计：
 * - 压缩：读取构建期由 scripts/precompress.mjs 生成的 .br / .gz 变体直出，
 *   服务端零 CPU；缺失变体时回退原件。
 * - 缓存：带内容 hash 的产物 immutable 长缓存；index.html 必须 no-cache
 *   （否则发版后用户停留在旧 HTML 上）；/uploads 下是用户可覆盖的文件，
 *   用较短的 max-age + ETag 协商。
 */
import type { Hono } from "hono";
import type { Context } from "hono";
import type { HttpBindings } from "@hono/node-server";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;
type AppContext = Context<{ Bindings: HttpBindings }>;

/** 一年（秒）。Vite 产物文件名含内容 hash，内容变则名变，可安全长缓存。 */
const IMMUTABLE_SECONDS = 31536000;
/** 用户上传目录（头像/封面/钓场照片）：可被同路径覆盖，保守缓存一天。 */
const UPLOAD_SECONDS = 86400;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".apk": "application/vnd.android.package-archive",
  ".mp4": "video/mp4",
};

/** 扩展名 → 可用的预压缩变体，优先级从高到低（brotli 覆盖率高但兼容性略窄） */
const VARIANTS: { ext: string; encoding: string }[] = [
  { ext: ".br", encoding: "br" },
  { ext: ".gz", encoding: "gzip" },
];

/**
 * 解析客户端 Accept-Encoding，按 q 值排序出可接受编码。
 * 刻意忽略 `br;q=0` 这类显式拒绝。
 */
function parseAcceptEncoding(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [name, ...params] = part.trim().split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { name: name.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((e) => e.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((e) => e.name);
}

function etagOf(stat: fs.Stats): string {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

/**
 * 注册生产静态资源中间件。
 * 必须在 API 路由与 notFound 之前调用（serveStaticFiles 由 boot.ts 在
 * production 分支中挂载，此时 /api/* 与 /uploads/* 已先行注册）。
 */
export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");
  const indexPath = path.resolve(distPath, "index.html");

  app.use("/assets/*", async (c) => {
    c.header("Cache-Control", `public, max-age=${IMMUTABLE_SECONDS}, immutable`);
    return serveFromDisk(c, path.join(distPath, c.req.path), true);
  });

  // SPA 入口：显式注册 "/" 与 "/index.html"。
  // 不能用 app.use("*") 兜底——Hono 的 "*" 不匹配根路径 "/"，
  // 会导致首页落到 notFound 分支（表现为 404 / 或走 HTML fallback 多读一次盘）。
  const serveIndex = async (c: AppContext) => {
    c.header("Cache-Control", "no-cache");
    if (!fs.existsSync(indexPath)) return c.text("Not Found", 404);
    return serveFromDisk(c, indexPath, true);
  };
  app.get("/", serveIndex);
  app.get("/index.html", serveIndex);

  // 其余静态文件（含 /uploads/* 与 public/ 下的图片、字体、logo）
  app.use("*", async (c) => {
    const urlPath = decodeURIComponent(c.req.path);
    // 目录穿越防护：规范化后必须仍在 dist 内
    const resolved = path.resolve(distPath, `.${urlPath}`);
    if (!resolved.startsWith(distPath)) {
      return c.json({ error: "Not Found" }, 404);
    }

    const isUpload = urlPath.startsWith("/uploads/");
    c.header(
      "Cache-Control",
      isUpload ? `public, max-age=${UPLOAD_SECONDS}` : "no-cache",
    );
    return serveFromDisk(c, resolved, !isUpload);
  });

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    // SPA history fallback：客户端路由（如 /post/123）刷新时返回入口 HTML。
    // index.html 必须 no-cache，否则发版后用户会一直命中旧 HTML 并引用
    // 已删除的 hash 资源（白屏）。
    c.header("Cache-Control", "no-cache");
    if (!fs.existsSync(indexPath)) {
      return c.text("Not Found", 404);
    }
    return c.html(fs.readFileSync(indexPath, "utf-8"));
  });
}

/**
 * 从磁盘读取并响应；allowVariants=true 时按 Accept-Encoding 选预压缩变体。
 * 用 ETag + If-None-Match 支持 304 协商，减少重复传输。
 */
async function serveFromDisk(
  c: AppContext,
  filePath: string,
  allowVariants: boolean,
) {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return c.notFound();
  }
  if (!stat.isFile()) return c.notFound();

  const ext = path.extname(filePath).toLowerCase();
  const baseType = MIME[ext] ?? "application/octet-stream";

  const clientEncodings = allowVariants ? parseAcceptEncoding(c.req.header("accept-encoding")) : [];
  for (const variant of VARIANTS) {
    if (!clientEncodings.includes(variant.encoding)) continue;
    const variantPath = `${filePath}${variant.ext}`;
    let variantStat: fs.Stats;
    try {
      variantStat = fs.statSync(variantPath);
    } catch {
      continue;
    }
    const etag = etagOf(variantStat);
    c.header("ETag", etag);
    c.header("Vary", "Accept-Encoding");
    if (c.req.header("if-none-match") === etag) {
      return c.body(null, 304);
    }
    c.header("Content-Encoding", variant.encoding);
    c.header("Content-Type", baseType);
    return c.body(fs.readFileSync(variantPath));
  }

  const etag = etagOf(stat);
  c.header("ETag", etag);
  c.header("Vary", "Accept-Encoding");
  if (c.req.header("if-none-match") === etag) {
    return c.body(null, 304);
  }
  c.header("Content-Type", baseType);
  return c.body(fs.readFileSync(filePath));
}
