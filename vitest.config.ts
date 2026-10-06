import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
      // api/services/* 里按 `@db/schema` 引表结构；与 vite.config.ts / tsconfig.server.json 同口径，
      // 否则服务端单测在解析阶段就挂掉
      "@db": path.resolve(templateRoot, "db"),
    },
  },
  test: {
    environment: "node",
    include: ["api/**/*.test.ts", "api/**/*.spec.ts", "src/lib/**/*.test.ts", "src/lib/**/*.spec.ts"],
  },
});
