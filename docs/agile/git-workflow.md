# Git 工作流规范

## 1. 分支模型（Git Flow 简化版）

```
master      发布线：只接受 release/hotfix 合并，每个合并打 tag
develop     开发线：日常集成分支，Sprint 结束合并回 master
feature/*   功能分支：从 develop 切出，完成后合并回 develop
release/*   发布分支：Sprint 评审前从 develop 切出，验收后合 master + develop
hotfix/*    热修分支：线上紧急问题从 master 切出，修复后合 master + develop
```

### 当前分支映射

| 分支 | 用途 | 状态 |
|---|---|---|
| master | 发布线 | 活跃，tag v5.0.0 |
| develop | 开发线 | 活跃，Sprint 6 在此开发 |
| scaffold / spots-flow / trade-flow / community / shop-owner | Sprint 1 历史功能分支 | 已合并，保留归档 |
| backend / frontend-live | Sprint 2 历史分支 | 已合并，保留归档 |
| apk | APK 打包分支 | 需要时从 master 切出 |

## 2. 提交信息规范（Conventional Commits）

```
<type>(<scope>): <subject>

<body>
```

| type | 用途 | 示例 |
|---|---|---|
| feat | 新功能 | feat(trade): 核销码升级为 10 位字母数字 |
| fix | 缺陷修复 | fix(search): 补 ORDER BY 前缀修复关键词搜索 500 |
| perf | 性能优化 | perf(queue): 消费者改批量聚合，速率 1.2→714 条/s |
| refactor | 重构 | refactor(api): tRPC router 降为薄壳，业务下沉 services |
| docs | 文档 | docs(agile): 新增 Sprint 6 计划 |
| chore | 构建/工具 | chore(deps): 新增 autocannon 压测工具 |
| test | 测试 | test(smoke): 补充关键词搜索断言 |

**规则**：subject ≤ 50 字，用祈使句；body 说明"为什么"而非"是什么"；涉及接口契约变更必须标注 `BREAKING CHANGE:`。

## 3. 版本号规则（语义化版本）

- **MAJOR（x.0.0）**：契约不兼容变更（如 tRPC 接口路径/出入参破坏性修改）
- **MINOR（0.x.0）**：向后兼容的新功能（如新增接口、新增表）
- **PATCH（0.0.x）**：向后兼容的修复（如并发 bug、索引优化）

当前：v5.0.0 → Sprint 6 修复完成后发布 **v5.1.0**（新增功能 + 兼容修复）。

## 4. 合并规则

1. **禁止直接推 master**：所有变更经 feature/release 分支合并
2. **合并前必须通过**：
   - `npm run check`（tsc）零错误
   - `npm run build` 通过
   - `scripts/smoke.ts` 全绿
   - 涉及性能的改动需附压测对比数据
3. **代码审查**：至少 1 名 reviewer 通过（AI 场景：独立审查子代理出具审查报告）
4. **合并方式**：功能分支用 `--no-ff` 保留历史；热修分支合并后立即打 tag

## 5. 标签与发布

| 操作 | 命令 | 时机 |
|---|---|---|
| 打版本标签 | `git tag -a v5.1.0 -m '...'` | master 合并后 |
| 查看版本差异 | `git log v5.0.0..v5.1.0 --oneline` | 发布说明撰写 |
| 回滚 | `git revert <commit>` 或 website_version_manager rollback | 线上故障 |

每次发布必须同步更新 `CHANGELOG.md`（Keep a Changelog 格式）。

## 6. 冲突处理

- 冲突解决后必须重新运行 `npm run check && npm run build`，禁止"解完就提"
- 跨 Sprint 的长周期分支（如 APK 打包）定期 rebase 到最新 master，避免大规模冲突
