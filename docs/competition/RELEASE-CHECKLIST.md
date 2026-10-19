# 发布与复核清单：把本地历史发布为比赛仓库

这份清单只处理一件事：把 `v14-post-interaction` 分支的真实历史发布到 `origin/main`，并把仓库变成评审可访问。它不会改写、拆分或补造任何提交。

> 现状（2026-10-19 编写时）
>
> - 本地分支：`v14-post-interaction`，105 条功能提交 + 3 条比赛文档提交 = 108 条。
> - 远端：`https://github.com/aadmur/quyu-app.git`，**私有**。
> - `origin/main`：`1d9054d42326f86cde73535a0a0045cdf0729af2`，46 条提交，与本地历史**无共同祖先**（`git merge-base` 为空）。这是另一套按批次打包的历史，不是本项目的权威演进记录。
> - 因此必须用 `--force-with-lease` 覆盖 `main`，然后二选一：把仓库设为 Public，或给评审账号 Read 权限。

执行前先读完全文。所有命令都在 `app/` 目录执行。

---

## 0. 冻结与备份（必须先做）

```bash
cd "E:/趣渔项目APP开发/app"
git status --short
git rev-parse HEAD
git fetch origin
git rev-parse origin/main
```

`origin/main` 应为 `1d9054d42326f86cde73535a0a0045cdf0729af2`。如果不是，说明远端已变化，**停下**，先确认变化来源，再决定是否继续。

在仓库外保存两份 bundle：

```bash
mkdir -p E:/backup/quyu-competition
git bundle create E:/backup/quyu-competition/origin-main-before-rewrite.bundle origin/main
git bundle create E:/backup/quyu-competition/local-all-refs.bundle --all
git bundle verify E:/backup/quyu-competition/origin-main-before-rewrite.bundle
git bundle verify E:/backup/quyu-competition/local-all-refs.bundle
```

第一份是旧远端历史的回滚点，第二份是本地全部分支与标签的离线快照。两份都要保留到比赛评审结束。

---

## 1. 发布前门禁

```bash
git rev-list --count HEAD          # 预期 108
git log --oneline --reverse | head -3
git log --oneline -5
```

预期首条是 `b186c7d 趣渔 v8.1.0 修复版全量源码`（253 文件基线），随后是按功能/修复推进的提交。首条提交的披露见 `docs/competition/README.md` §2.2。

机械检查（本机没有 npm，用仓库内二进制；有 npm 的机器可换成 `npm run ...`）：

```bash
node node_modules/typescript/bin/tsc -b
node node_modules/vitest/vitest.mjs run
node scripts/check-doc-pointers.mjs
node scripts/check-run-sql.mjs
```

四条都应退出 0。`check-doc-pointers` 会打印解析到的指针数量；数量为 0 也按失败处理。

再确认待发布内容里没有密钥：

```bash
git grep -nE "(LTAI[0-9A-Za-z]{12,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})" HEAD -- . ':!package-lock.json'
```

无输出为正常。真实密钥只存在于服务器 `.env`，不在仓库。若发现疑似值，先轮换密钥，再继续。

---

## 2. 覆盖远端 main

```bash
git push \
  --force-with-lease=refs/heads/main:1d9054d42326f86cde73535a0a0045cdf0729af2 \
  origin v14-post-interaction:main
```

这条命令只在远端 `main` 仍等于记录值时成功；若别人在此期间推送过，它会拒绝，不会盲覆盖。

如果 GitHub 返回 `protected branch` 或 `GH006`，说明 `main` 开了分支保护：

1. 打开 `Settings → Branches → Branch protection rules`；
2. 临时允许 force push（或临时删除该规则）；
3. 重跑上面的命令；
4. 发布完成后按需要恢复保护，至少保留“禁止删除”。

成功后记录新的远端 tip：

```bash
git ls-remote origin refs/heads/main
git rev-parse HEAD
test "$(git ls-remote origin refs/heads/main | cut -f1)" = "$(git rev-parse HEAD)" && echo TIP_MATCH
```

最后一行应输出 `TIP_MATCH`。

---

## 3. 让评审可访问（二选一）

### 方案 A：公开仓库（推荐）

网页操作：

1. 打开 `https://github.com/aadmur/quyu-app/settings`；
2. 拉到 `Danger Zone`；
3. `Change repository visibility` → `Change to public`；
4. 按提示输入仓库名 `aadmur/quyu-app` 确认。

公开前已经确认：仓库内没有高置信度密钥；工作区里的 `eval-fishid/`、`fishball-preview.html`、`docs/复现指南-10分钟.md` 等未跟踪文件不会被推送。

### 方案 B：保持私有，给评审 Read 权限

1. 打开 `https://github.com/aadmur/quyu-app/settings/access`；
2. `Add people`；
3. 填入评审的 GitHub 用户名，角色选 `Read`；
4. 让对方在通知/邮件里接受邀请。

如果评审没有 GitHub 账号，只能选方案 A。

---

## 4. 匿名复核（换一台无凭证的视角）

公开后，以下命令应在**未登录**状态下成功。`GIT_CONFIG_GLOBAL=/dev/null` 用来屏蔽本机凭证助手，避免“本机登录了所以看起来是公开的”这种假绿。

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.github.com/repos/aadmur/quyu-app
# 预期 200；私有仓库匿名访问是 404

curl -s -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/aadmur/quyu-app/main/README.md
# 预期 200

curl -sL -o /dev/null -w '%{http_code} %{size_download}\n' \
  https://raw.githubusercontent.com/aadmur/quyu-app/main/docs/competition/AI-PROMPT-HISTORY.pdf
# 预期 200，字节数与本地文件一致

tmp=$(mktemp -d)
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 \
  git clone --depth=200 --no-checkout https://github.com/aadmur/quyu-app.git "$tmp/quyu"
git -C "$tmp/quyu" rev-list --count HEAD
git -C "$tmp/quyu" log --oneline -3
rm -rf "$tmp"
```

克隆后的提交数应为 108，最近几条应包含 `docs(competition)`、`docs(readme)` 与本次修正。随后在浏览器无痕窗口打开仓库首页，确认：

- README 正常渲染，首屏能看到“趣渔”和比赛材料入口；
- `docs/competition/AI-PROMPT-HISTORY.pdf` 可直接下载并打开；
- 提交列表首条是 v8.1.0 基线，之后是细粒度提交，不是“initial commit 含全部功能”。

建议留证：仓库首页截图、提交列表截图、匿名 `curl` 输出、无痕窗口打开 PDF 的截图，存入比赛提交材料。

---

## 5. 可选：打提交快照标签

不改历史，只给评审一个稳定坐标：

```bash
git tag -a competition-submission-20261019 -m "比赛提交快照（docs 完成）"
git push origin competition-submission-20261019
```

如果后续还要改文档，重新打标签并推送即可；标签本身不增加提交数。

---

## 6. 回滚与补救

### 6.1 推错了历史

先记下当前远端 tip，再用备份 bundle 恢复：

```bash
git fetch E:/backup/quyu-competition/origin-main-before-rewrite.bundle \
  refs/heads/main:refs/restore/origin-main-1d9054d
git push --force-with-lease=refs/heads/main:<刚记下的新tip> \
  origin refs/restore/origin-main-1d9054d:main
```

恢复后远端回到 46 条旧历史。再检查仓库可见性是否需要同步改回私有。

### 6.2 误公开

`Settings → General → Danger Zone → Change visibility → Private`。注意：公开期间产生的 fork、缓存、搜索引擎快照不会因改回私有而消失；如果公开过密钥，唯一有效的补救是轮换密钥，而不是删提交。

### 6.3 评审看不到内容

按顺序排查：

1. `curl` 仓库 API 是否 200；404 = 仍是私有或名字不对；
2. 评审是否接受了 collaborator 邀请；
3. 默认分支是否为 `main`（`Settings → Branches`）；
4. PDF 链接是否用了 `raw.githubusercontent.com` 的 `main` 路径；
5. 企业网络是否拦截 GitHub，必要时提供仓库 zip 与 PDF 作为离线备份（但 Git 历史必须以仓库为准）。

---

## 7. 不要做的事

- 不要为了“看起来细粒度”而拆分 `b186c7d` 或补造提交时间。历史真实性比好看重要，首条基线已在材料中披露。
- 不要删除远端那 46 条旧历史后假装它从未存在；本清单用 bundle 保留回滚点，并在比赛材料中说明两套历史的关系。
- 不要把 `.env`、`eval-fishid/`、真机截图原图或任何密钥提交进仓库。
- 不要在公开后再次 force push 改写已评审的提交；如需修订，追加新提交。
