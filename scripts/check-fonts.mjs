/**
 * 校验自托管 woff2 字体：结构合法性与体积预算。
 * 用法：node scripts/check-fonts.mjs
 *
 * woff2 的字体数据经表目录变换后整体 brotli 压缩，完整还原需要实现
 * WOFF2 规范的变长整数解码与 glyf/loca 重建。本脚本只做构建链路上
 * 真正需要守卫的两件事：文件结构可被浏览器识别，以及体积不超预算。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const dir = path.resolve("public/fonts");
const BUDGET_KB = 40;

/** 期望清单：文件名 → 用途说明。缺失即视为构建失败。 */
const EXPECTED = {
  "bebas-neue-400.woff2": "Bebas Neue 400（标题数字）",
  "oswald-latin.woff2": "Oswald 400~600 可变（计数/价格/时间）",
};

let failures = 0;

if (!fs.existsSync(dir)) {
  console.error(`FAIL  字体目录不存在：${dir}`);
  process.exit(1);
}

const present = fs.readdirSync(dir).filter((f) => f.endsWith(".woff2"));

for (const [file, purpose] of Object.entries(EXPECTED)) {
  if (!present.includes(file)) {
    failures += 1;
    console.log(`FAIL  ${file}  缺失（${purpose}）`);
  }
}

let total = 0;
for (const file of present) {
  const full = path.join(dir, file);
  const buf = fs.readFileSync(full);
  total += buf.length;
  const sizeKb = buf.length / 1024;

  const magic = buf.subarray(0, 4).toString("ascii");
  if (magic !== "wOF2") {
    failures += 1;
    console.log(`FAIL  ${file}  magic=${magic}，不是 woff2`);
    continue;
  }

  const numTables = buf.readUInt16BE(12);
  const totalSfntSize = buf.readUInt32BE(16);
  const compressedLength = buf.readUInt32BE(20);

  // brotli 负载必须能被解压器接受（流完整性），否则浏览器会静默回退系统字体
  let payloadOk = true;
  try {
    // brotli 流可能以尾部对齐补零结束，取压缩段长度即可
    zlib.brotliDecompressSync(buf.subarray(48, 48 + compressedLength));
  } catch {
    payloadOk = false;
  }

  const flags = [payloadOk ? null : "brotli 负载异常", numTables > 0 ? null : "表数为 0"]
    .filter(Boolean);
  if (flags.length) {
    failures += 1;
    console.log(`FAIL  ${file}  ${sizeKb.toFixed(1)} KB  ${flags.join("；")}`);
  } else {
    console.log(
      `PASS  ${file}  ${sizeKb.toFixed(1)} KB  woff2 合法 / 表数 ${numTables} / 未压缩 ${(totalSfntSize / 1024).toFixed(1)} KB`,
    );
  }
}

const totalKb = total / 1024;
console.log(`\n合计 ${present.length} 个字体文件 ${totalKb.toFixed(1)} KB（预算 ≤ ${BUDGET_KB} KB）`);
if (totalKb > BUDGET_KB) {
  failures += 1;
  console.log("FAIL  超出体积预算");
}
console.log("额外校验：index.html 不得再引用 fonts.googleapis.com");
const html = fs.readFileSync(path.resolve("index.html"), "utf-8");
if (/fonts\.(googleapis|gstatic)\.com/.test(html)) {
  failures += 1;
  console.log("FAIL  index.html 仍存在 Google Fonts 外链");
} else {
  console.log("PASS  index.html 无 Google Fonts 外链");
}

process.exit(failures === 0 ? 0 : 1);
