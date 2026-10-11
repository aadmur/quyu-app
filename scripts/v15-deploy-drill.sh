#!/usr/bin/env bash
# v15-deploy.sh 的**产物闸门演练**：在临时目录里造夹具，逐条证明这些闸门能变红，
# 并证明它们拒绝时**一个字节都没动**现役 dist。
#
# 为什么只演这一段：备份/迁移/结构核对要真库，而本机没有可用 DB 层（3306 是这台机器自己的
# MySQL 8.4 且 root 口令不可用；起隔离 mysqld 被策略拦）。所以本演练的覆盖面明确到此为止，
# 数据库那半留在待办里（同 B-34 那一类），**不算已验证**。
#
# 用法：bash scripts/v15-deploy-drill.sh      （退出码=失败项数）
set -uo pipefail
cd "$(dirname "$0")/.."
SRC=scripts/v15-deploy.sh
[ -f "$SRC" ] || { echo "ABORT 找不到 $SRC"; exit 1; }

W=$(mktemp -d 2>/dev/null) || W="/tmp/v15-drill-$$"
rm -rf "$W"; mkdir -p "$W"
P=0; FA=0
ok()  { echo "  PASS  $*"; P=$((P + 1)); }
bad() { echo "  FAIL  $*"; FA=$((FA + 1)); }

# expect_run <用例名> <期望:OK|RED> <tar> <sha>
expect_run() {
  local name="$1" want="$2" tar="$3" sha="$4" out rc
  out=$(QY_APP="$APP" QY_TAR="$tar" QY_SHA="$sha" bash "$SRC" gates 2>&1); rc=$?
  if [ "$want" = "OK" ]; then
    if [ "$rc" = 0 ] && echo "$out" | grep -q 'GATES OK'; then ok "$name"; return; fi
    bad "$name（期望放行，实际 rc=$rc）"; echo "$out" | tail -2 | sed 's/^/        /'
  else
    if [ "$rc" != 0 ] && ! echo "$out" | grep -q 'GATES OK'; then ok "$name（rc=$rc，已拒绝）"; return; fi
    bad "$name（期望拒绝，实际 rc=$rc 且过了闸门）——这条闸门没有牙齿"
  fi
}

# ── 夹具 ──
mk_tree() { # <目录> <br 数量> <顶层名>
  local d="$1" n="$2" top="$3" i
  rm -rf "$d"; mkdir -p "$d"
  if [ "$top" = "dist" ]; then
    mkdir -p "$d/dist/public/assets"
    echo BOOT > "$d/dist/boot.js"
    echo '<div id="root"></div>' > "$d/dist/public/index.html"
    for i in $(seq 1 "$n"); do echo br > "$d/dist/public/assets/a$i.js.br"; done
  else
    mkdir -p "$d/public/assets"          # 条目直接以 boot.js 开头（顶层不是 dist/）
    echo BOOT > "$d/boot.js"
    echo '<div id="root"></div>' > "$d/public/index.html"
    for i in $(seq 1 "$n"); do echo br > "$d/public/assets/a$i.js.br"; done
  fi
}
pack() { # <夹具目录> <输出 tar> <要打包的成员，空格分隔>
  # 上一版在这里用了 basename(夹具目录)，于是条目变成 good/dist/... ——闸门判"不在 dist/ 之下"是**对的**，
  # 错的是夹具。真实交付包的条目是 dist/... （verify-handoff 也按这个判据核过）。
  local src="$1" out="$2"; shift 2
  ( cd "$src" && tar czf "$out" "$@" )
}

# 现役 app（用来证明拒绝时没被碰）
APP="$W/app"; mkdir -p "$APP/dist/public/assets" "$APP/backups"
echo LIVE-BOOT > "$APP/dist/boot.js"; echo x > "$APP/dist/public/assets/z.js.br"
LIVE_SHA=$(sha256sum "$APP/dist/boot.js" | cut -d' ' -f1)

mk_tree "$W/good" 41 dist;            pack "$W/good" "$W/good.tgz" dist
GOOD_SHA=$(sha256sum "$W/good.tgz" | cut -d' ' -f1)
mk_tree "$W/nobr" 0 dist;             pack "$W/nobr" "$W/nobr.tgz" dist
NOBR_SHA=$(sha256sum "$W/nobr.tgz" | cut -d' ' -f1)
# 顶层不是 dist/ 的包：条目是 boot.js / public/…，服务器以 root 解包会写到目标目录之外
mk_tree "$W/wrongtop" 41 other;       pack "$W/wrongtop" "$W/wrongtop.tgz" boot.js public
WT_SHA=$(sha256sum "$W/wrongtop.tgz" | cut -d' ' -f1)
# 顶层是 ./ 形式的包（另一种常见打包写法），闸门不应因此误杀
mk_tree "$W/dotslash" 41 dist; ( cd "$W/dotslash" && tar czf "$W/dotslash.tgz" ./dist )
DS_SHA=$(sha256sum "$W/dotslash.tgz" | cut -d' ' -f1)

echo "── A. 该放行的必须放行（否则演练本身是假绿灯）──"
expect_run "A1 合格包 + sha 一致" OK "$W/good.tgz" "$GOOD_SHA"
expect_run "A2 重跑幂等（第二次也得是 OK，不能因残留而变红）" OK "$W/good.tgz" "$GOOD_SHA"
expect_run "A3 ./dist 写法（纯打包习惯差异，闸门不得误杀）" OK "$W/dotslash.tgz" "$DS_SHA"

echo "── B. 该拒绝的必须拒绝 ──"
expect_run "B1 sha 不符（拿错包）" RED "$W/good.tgz" "0000000000000000000000000000000000000000000000000000000000000000"
expect_run "B2 期望 sha 仍是占位符（没跑 resync）" RED "$W/good.tgz" ""
expect_run "B3 产物不存在" RED "$W/nope.tgz" "$GOOD_SHA"
expect_run "B4 .br 数量为 0（漏跑 precompress）" RED "$W/nobr.tgz" "$NOBR_SHA"
expect_run "B5 条目不在 dist/ 之下" RED "$W/wrongtop.tgz" "$WT_SHA"

echo "── C. 拒绝时必须什么都没动 ──"
NOW=$(sha256sum "$APP/dist/boot.js" | cut -d' ' -f1)
if [ "$NOW" = "$LIVE_SHA" ]; then ok "C1 现役 dist 的 boot.js 未被改动"; else bad "C1 现役 dist 被改了！"; fi
if [ -z "$(ls -A "$APP/backups")" ]; then ok "C2 gates 模式没往 backups/ 写东西"; else bad "C2 gates 模式在 backups/ 留了文件：$(ls "$APP/backups")"; fi
if ls "$APP" | grep -q 'dist-replaced\|dist.before-rollback'; then bad "C3 gates 模式做了 dist 替换/改名"; else ok "C3 gates 模式没有替换 dist"; fi
if [ ! -e "$APP/.env" ]; then ok "C4 演练没有伪造 .env（真库分支根本没进）"; else bad "C4 演练走到了需要 .env 的分支，覆盖面被夸大"; fi

echo
echo "演练结果：PASS $P / FAIL $FA"
rm -rf "$W"
[ "$FA" = 0 ] || exit 1
