# 趣渔

面向钓鱼人的社区与本地服务应用：帖子/评论、钓点识别（哪钓）、鱼种识别（识鱼）、塘主入驻、票务、商城与充值。前端为 React 19 单页应用，后端是同仓库的 Hono + tRPC 服务，最终由 Capacitor WebView 壳加载线上地址。

这个仓库同时是比赛作品仓库。评审请先看 **[docs/competition/README.md](docs/competition/README.md)**：其中有一页式要求对照、Git 演进说明、四个核心迭代的 Prompt 链索引，以及已核实/未核实边界。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19、Vite 7、react-router 7、TanStack Query 5、Tailwind 3、framer-motion（LazyMotion） |
| API | Hono 4、tRPC 11、Zod、jose（JWT） |
| 数据 | MySQL 8、Drizzle ORM、SQL 迁移（`db/migrations`，0001–0015） |
| 端 | Capacitor 7 WebView 壳加载远端 `server.url` |
| 质量 | TypeScript 5.9、Vitest 4、ESLint 9、自建脚本门禁 |

## 目录

```
api/            Hono 入口、tRPC 路由、领域服务（社区/塘主/识鱼/机审/交易）
src/            页面、组件、hooks、客户端状态
db/             Drizzle schema、迁移 SQL 与 journal
contracts/      前后端共享的路径与类型
scripts/        构建前置检查、部署/回滚演练、验收探针
docs/           敏捷计划、验证证据、比赛材料
```

## 快速开始

要求 Node.js 20+、MySQL 8。

```bash
npm ci
cp .env.example .env      # 至少填 DATABASE_URL、APP_ID、APP_SECRET、KIMI_*
npm run db:migrate
npm run dev               # http://localhost:3000，Vite 中间件挂载 api/boot.ts
```

`.env.example` 里对每个开关都有注释，包括哪些值缺失时功能会降级。不要把真实密钥提交进仓库。

生产构建与启动：

```bash
npm run check             # tsc -b
npm test                  # vitest
npm run build             # 构建前端 + 打包 dist/boot.js
NODE_ENV=production npm start
```

`npm run build` 本身已串联字体/图片/性能接线检查、单测、计划覆盖、SQL 配对、Vite 构建、动画边界与预压缩，失败即中断。

## 质量门禁

| 命令 | 作用 |
|---|---|
| `npm run check` | TypeScript 全量类型检查 |
| `npm test` | Vitest 单测（当前 49 条，5 个文件） |
| `npm run check:docs` | 文档里的路径/行号/脚本名指针是否仍存在 |
| `npm run check:sql` | 迁移 SQL 与 `_run.sql` 配对检查 |
| `npm run verify:handoff` | 交付包完整性交接检查（需要 tar） |
| `npm run verify:deploy` | 部署后 10 项线上探针 |
| `npm run verify:v15-deploy` | v15 部署/回滚演练 |
| `npm run verify` | 汇总验收入口 |

门禁只证明它们各自检查的那件事。“测试通过”不等于“线上可用”，两者的差额写在比赛材料的「未验证边界」里。

## 版本与生产状态

源码版本与生产版本不一定相同，这是本项目当前最重要的事实：

- 源码 HEAD（分支 `v14-post-interaction`）对应 **v8.13.0**，包含识鱼与图片落盘/机审链路。
- 生产当前运行 **v8.12.0**。v8.13.0 于 2026-10-11 19:55 上线，22:44 因悬浮球入口手势变更（B-45）回滚；回滚原因是入口回归，不是识鱼崩溃。
- 数据库迁移 `0015` 留在生产库中（回滚代码不回库）。
- 构建产物里没有版本字符串；线上身份用 `dist/boot.js` 的 SHA256 识别。

完整时间线、证据与回滚点见 [CHANGELOG.md](CHANGELOG.md)。

## 已知边界

- **识鱼**：生产未配置 `MOONSHOT_API_KEY`，点击入口会得到“识别服务暂未开通”，不是崩溃。仓库内没有准确率评测证据；`eval-fishid/` 是未纳入版本管理的本地评测素材。
- **图片机审**：`IMAGE_MODERATION_ENABLED=false`。当前行为是“放行 + 写一条待人工复核记录”，不是拒绝发布；阿里云网关未做过真实联调。存量 base64 图片的回填脚本已就绪，但生产未执行 `--apply`。
- **真机 UI**：举报弹层重开、关注列表关注态、退出登录后登录态清空这三条只有代码与单测，没有真机记录。
- **首条提交**：`b186c7d` 是 253 文件的 v8.1.0 全量源码基线。它无法诚实拆分，比赛材料中已明确披露；其后 104 条提交按功能/修复粒度推进。

## 比赛材料

| 文件 | 内容 |
|---|---|
| [docs/competition/README.md](docs/competition/README.md) | 评审入口：要求对照、Git 历史、四个案例索引、产品事实 |
| [docs/competition/AI-PROMPT-HISTORY.pdf](docs/competition/AI-PROMPT-HISTORY.pdf) | Prompt 历史快照合订本（26 页，含原话、决策、Bug 修复链、截图） |
| [docs/competition/AI-PROMPT-HISTORY.md](docs/competition/AI-PROMPT-HISTORY.md) | 合订本 Markdown 源 |
| [docs/competition/01-v14-post-interaction.md](docs/competition/01-v14-post-interaction.md) | 案例一：帖子交互重构，13 次裁定 |
| [docs/competition/02-v14-image-pipeline.md](docs/competition/02-v14-image-pipeline.md) | 案例二：图片落盘与机审返工 |
| [docs/competition/03-v15-fish-id.md](docs/competition/03-v15-fish-id.md) | 案例三：识鱼上线前审计与回滚 |
| [docs/competition/04-b45-fishball-incident.md](docs/competition/04-b45-fishball-incident.md) | 案例四：B-45 悬浮球事故 |
| [docs/competition/RELEASE-CHECKLIST.md](docs/competition/RELEASE-CHECKLIST.md) | 仓库公开/评审访问的执行与复核命令 |
| [docs/competition/manifest.sha256](docs/competition/manifest.sha256) | 材料与原始会话日志的校验和 |

## 文档

- [CHANGELOG.md](CHANGELOG.md)：版本记录、部署与回滚证据、未完成项
- [docs/agile/](docs/agile/)：迭代计划、DoD、Git 工作流与 backlog
- [docs/verification/](docs/verification/)：历次验收证据索引
- [docs/perf/](docs/perf/)：真机冷启动测量 SOP

## 许可

本仓库暂未附开源许可证。比赛评审可阅读代码与材料；其他用途请先联系仓库所有者。
