/**
 * 一次性迁移脚本（QY-PERF-005）
 * 把 framer-motion 的 `motion.*` 组件替换为 `m.*`，配合 LazyMotion 按需加载能力。
 * 用法：node scripts/migrate-to-m.mjs
 *
 * 幂等：已替换过的文件不再变更。执行后需人工检查导入语句是否仍有未使用的 motion。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const files = execSync(
  `grep -rl framer-motion --include=*.tsx --include=*.ts ${JSON.stringify(path.join(root, "src"))}`,
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .map((f) => path.relative(root, f));

let migrated = 0;
let unchanged = 0;
const report = [];

for (const f of files) {
  const full = path.join(root, f);
  const before = fs.readFileSync(full, "utf8");

  let after = before.replace(
    /import\s*\{([^}]*)\}\s*from\s*(["'])framer-motion\2/g,
    (_match, names, q) => {
      const list = names
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((n) => (n === "motion" ? "m" : n));
      return `import { ${list.join(", ")} } from ${q}framer-motion${q}`;
    },
  );

  const motionUses = (after.match(/\bmotion\.[A-Za-z]+/g) ?? []).length;
  after = after.replace(/\bmotion\.([A-Za-z]+)/g, "m.$1");

  if (after !== before) {
    fs.writeFileSync(full, after);
    migrated += 1;
    report.push(`MIGRATED  ${f}  (${motionUses} 处)`);
  } else {
    unchanged += 1;
  }
}

console.log(report.join("\n"));
console.log(`\n迁移 ${migrated} 个文件，未变更 ${unchanged} 个，共扫描 ${files.length} 个`);

const leftovers = execSync(
  `grep -rn "\\bmotion\\.\\|\\bmotion," --include=*.tsx --include=*.ts ${JSON.stringify(path.join(root, "src"))} || true`,
  { encoding: "utf8" },
).trim();
console.log("\n残留的 motion 用法检查：");
console.log(leftovers || "（无残留，全部迁移完成）");
