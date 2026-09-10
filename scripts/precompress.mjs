/**
 * @layer Build —— 静态资源预压缩（brotli + gzip）
 * @file scripts/precompress.mjs
 *
 * 为什么在构建期做而不是运行时：ECS 为 2C2G，运行时压缩会占用事件循环，
 * 而 dist/public 的内容在两次部署之间完全不变。构建期预生成 .br/.gz 后，
 * 服务端只做「按 Accept-Encoding 选文件」的零 CPU 操作。
 *
 * 只压缩文本类资源（HTML/CSS/JS/JSON/SVG/MAP），图片与字体本身已是压缩格式，
 * 再压只会浪费磁盘并可能变大。
 *
 * 用法：node scripts/precompress.mjs [distDir]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const distDir = path.resolve(process.argv[2] ?? "dist/public");

const COMPRESSIBLE = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".map",
  ".txt", ".xml", ".webmanifest",
]);

/** 低于该体积不值得多一次变体协商，收益 < 1 个 TCP 包 */
const MIN_SIZE = 1024;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!fs.existsSync(distDir)) {
  console.error(`[precompress] 目录不存在：${distDir}`);
  process.exit(1);
}

const files = walk(distDir).filter((f) => COMPRESSIBLE.has(path.extname(f).toLowerCase()));

let brCount = 0;
let gzCount = 0;
let rawTotal = 0;
let brTotal = 0;
let gzTotal = 0;

for (const file of files) {
  const buf = fs.readFileSync(file);
  if (buf.length < MIN_SIZE) continue;

  rawTotal += buf.length;

  const brPath = `${file}.br`;
  const br = zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
  fs.writeFileSync(brPath, br);
  brCount += 1;
  brTotal += br.length;

  const gzPath = `${file}.gz`;
  const gz = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(gzPath, gz);
  gzCount += 1;
  gzTotal += gz.length;
}

const pct = (n) => (rawTotal ? `${((1 - n / rawTotal) * 100).toFixed(1)}%` : "0%");
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log(
  `[precompress] ${files.length} 个文本资源，${brCount} 个 brotli + ${gzCount} 个 gzip\n` +
    `              原始 ${kb(rawTotal)} → brotli ${kb(brTotal)} (-${pct(brTotal)}) / gzip ${kb(gzTotal)} (-${pct(gzTotal)})`,
);
