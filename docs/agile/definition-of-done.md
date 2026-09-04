# 完成定义（Definition of Done）

一个故事只有同时满足以下全部条件，才能标记为 **Done** 并合入 develop。

## 代码质量

- [ ] `npm run check`（tsc -b）零错误
- [ ] `npm run build` 通过（vite + esbuild）
- [ ] ESLint 零告警（`npm run lint`）
- [ ] 新增代码遵循分层约定：router 薄壳 → services 领域逻辑 → infra 抽象层
- [ ] 禁止改 `api/kimi/`、`api/lib/`、`contracts/`（除非确有必要并在评审中说明）

## 接口契约

- [ ] tRPC 对外路径/入参/出参向后兼容（前端零改动），或已标注 `BREAKING CHANGE` 并同步前端
- [ ] 新增接口必须有 Zod 入参校验
- [ ] Date/decimal/JSON 字段按 superjson 约定序列化

## 测试验证

- [ ] `scripts/smoke.ts` 全绿（含新增断言）
- [ ] 涉及写操作的改动必须验证幂等性（重复提交不产生重复数据）
- [ ] 涉及并发路径的改动必须验证竞态安全（多并发下结果一致）

## 性能

- [ ] 不引入新的 N+1 查询（EXPLAIN 确认走索引）
- [ ] 高频读路径必须有缓存（CacheStore），并验证命中率
- [ ] 事件类操作必须异步化（EventQueue），接口不同步落库
- [ ] 若改动影响已压测接口，需附复测数据（不低于既有基线）

## 安全

- [ ] 资金/核销类接口必须鉴权（authedQuery）
- [ ] 限流 key 用可信来源（ctx.ip 或用户 ID），禁止用客户端可伪造的 header
- [ ] 演示用户兜底（DEMO_USER）仅开发环境开启

## 文档与流程

- [ ] CHANGELOG.md 更新（类型归类：新增/修复/性能/变更）
- [ ] 提交信息遵循 Conventional Commits
- [ ] 代码经独立审查（reviewer 子代理）通过
- [ ] 若引入新抽象端口或改架构，同步更新 `design/arch-v5.md`

## 发布就绪

- [ ] 合入 master 后打语义化 tag
- [ ] website_version_manager 保存动态版本
- [ ] 涉及 APK 的改动重新构建并校验（包名/图标/启动页/完整性）
