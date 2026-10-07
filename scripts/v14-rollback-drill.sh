#!/usr/bin/env bash
# 回滚演练：真正执行 app/scripts/v14-rollback.sh（不是照抄它的判据），
# 每条分支都要能变红。演练目录用 /tmp/rbdrill，跑完自删。
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RB=/tmp/rbdrill
PORT=3122
fails=0; skipped=0
pass() { echo "  PASS $*"; }
fail() { fails=$((fails+1)); echo "  FAIL $*"; }
skip() { skipped=$((skipped+1)); echo "  SKIP $*"; }

OLD_TAR="${OLD_TAR:-/e/tmp/old-builds/dist-v8.12.0-r2.tar.gz}"
NEW_TAR="${NEW_TAR:-/e/tmp/dist-v8.12.0-r8.tar.gz}"
SCRIPT_UNDER_TEST="${SCRIPT_UNDER_TEST:-$REPO/scripts/v14-rollback.sh}"

[ -f "$SCRIPT_UNDER_TEST" ] || { echo "缺被测脚本 $SCRIPT_UNDER_TEST"; exit 1; }
bash -n "$SCRIPT_UNDER_TEST" || { echo "被测脚本语法不过"; exit 1; }

rm -rf "$RB"; mkdir -p "$RB/opt/quyu/backups" "$RB/mk"

# ---------- 造两种顶层布局的备份包（布局不该影响回滚结果） ----------
mk_payload() { # mk_payload <dir> <标记文本> <br数量>
  local d=$1 mark=$2 n=$3 i
  mkdir -p "$d/public"
  echo "boot marker=$mark" > "$d/boot.js"
  echo "<html>index $mark</html>" > "$d/public/index.html"
  for i in $(seq 1 "$n"); do : > "$d/public/a$i.br"; done
}
cd "$RB/mk"
mk_payload "$RB/mk/A/dist" OLD_A 40; (cd "$RB/mk/A" && tar czf "$RB/opt/quyu/backups/A-top-dist.tar.gz" dist)
mk_payload "$RB/mk/B/dist" OLD_B 40; (cd "$RB/mk/B/dist" && tar czf "$RB/opt/quyu/backups/B-no-top.tar.gz" .)
mk_payload "$RB/mk/N/dist" OLD_N 40; rm "$RB/mk/N/dist/boot.js"
(cd "$RB/mk/N" && tar czf "$RB/opt/quyu/backups/N-no-boot.tar.gz" dist)
mk_payload "$RB/mk/T/dist" OLD_T 12; (cd "$RB/mk/T" && tar czf "$RB/opt/quyu/backups/T-few-br.tar.gz" dist)

# 当前线上态（新代码）
mk_payload "$RB/opt/quyu/dist" NEW_LIVE 40

run_rb() { # run_rb <备份名> -> 输出脚本 stdout+stderr
  bash "$SCRIPT_UNDER_TEST" "$RB/opt/quyu/backups/$1" "$RB/opt/quyu/dist" 2>&1
}
layout_ok() { [ -f "$RB/opt/quyu/dist/boot.js" ] && [ -f "$RB/opt/quyu/dist/public/index.html" ]; }

echo "=== 1) 布局 A（条目以 dist/ 开头）能回滚 ==="
out=$(run_rb A-top-dist.tar.gz); echo "$out" | sed 's/^/    /'
if layout_ok && grep -q 'ROLLBACK OK' <<<"$out" && [ "$(cat "$RB/opt/quyu/dist/boot.js")" = "boot marker=OLD_A" ]; then
  pass "回滚落位正确，boot.js 内容确实是旧版 OLD_A"
else fail "布局 A 回滚后结构/内容不对"; fi
ls "$RB/opt/quyu" | grep -q 'dist.before-rollback-' && pass "被替换的 dist 有留痕（可再退回去）" || fail "旧 dist 没留痕"

echo "=== 2) 布局 B（条目以 ./ 开头，旧文档那条 --strip-components=1 正是为它写的） ==="
rm -rf "$RB/opt/quyu/dist.before-rollback-"*
out=$(run_rb B-no-top.tar.gz); echo "$out" | sed 's/^/    /'
if layout_ok && [ "$(cat "$RB/opt/quyu/dist/boot.js")" = "boot marker=OLD_B" ]; then
  pass "同一脚本对两种布局都落位正确（不靠猜层数）"
else fail "布局 B 回滚失败——说明之前的 --strip-components=1 写法只对一种布局成立"; fi

echo "=== 3) 负向：备份里根本没有 boot.js ==="
before=$(cat "$RB/opt/quyu/dist/boot.js")
out=$(run_rb N-no-boot.tar.gz); st=$?; echo "$out" | sed 's/^/    /'
if [ $st -ne 0 ] && [ "$(cat "$RB/opt/quyu/dist/boot.js")" = "$before" ]; then
  pass "拒绝回滚且当前 dist 一字未动（退出码 $st）"
else fail "坏包被当成回滚目标，或线上 dist 已被破坏"; fi

echo "=== 4) 负向：备份里 .br 只有 12 个（首屏会退化成未压缩） ==="
out=$(run_rb T-few-br.tar.gz); st=$?; echo "$out" | sed 's/^/    /'
if [ $st -ne 0 ] && [ "$(cat "$RB/opt/quyu/dist/boot.js")" = "$before" ]; then
  pass "brotli 闸门在回滚路径上也生效（退出码 $st）"
else fail "缺 .br 的包回了滚（闸门有洞）"; fi

echo "=== 5) 负向：参数缺失 / 备份不存在 ==="
bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 && fail "无参数竟然退出 0" || pass "无参数被拒"
bash "$SCRIPT_UNDER_TEST" /tmp/definitely-not-here.tar.gz >/dev/null 2>&1 && fail "不存在的备份竟然退出 0" || pass "备份不存在被拒"

echo "=== 6) 端到端：r8 上线态 → 回滚到 r2 → 服务还能起来，且换的真是 r2 那份 boot.js ==="
if [ ! -f "$OLD_TAR" ] || [ ! -f "$NEW_TAR" ]; then
  skip "第6项：本机没有 r2/r8 两个真实产物"
else
  rm -rf "$RB/opt/quyu"; mkdir -p "$RB/opt/quyu/backups"
  # ① 上线前：机器上跑的是 r2，部署脚本先把它归档成 backups/
  tar xzf "$OLD_TAR" -C "$RB/opt/quyu" || fail "r2 解包失败"
  old_sha=$(sha256sum "$RB/opt/quyu/dist/boot.js" | cut -d' ' -f1)
  (cd "$RB/opt/quyu" && tar czf backups/dist-before-drill.tar.gz dist)
  # ② 部署：换成 r8
  rm -rf "$RB/opt/quyu/dist"
  tar xzf "$NEW_TAR" -C "$RB/opt/quyu" || fail "r8 解包失败"
  new_sha=$(sha256sum "$RB/opt/quyu/dist/boot.js" | cut -d' ' -f1)
  if [ -z "$new_sha" ] || [ -z "$old_sha" ]; then fail "拿不到 boot.js sha（判据没建立，后面的结论无效）"
  elif [ "$new_sha" = "$old_sha" ]; then fail "r2 与 r8 的 boot.js sha 相同，演练无意义"
  else pass "两包可区分：old=${old_sha:0:16} new=${new_sha:0:16}"; fi

  srv() { # srv <tag>
    NODE_ENV=production PORT=$PORT APP_ID=v APP_SECRET=s \
    KIMI_AUTH_URL=http://127.0.0.1:9 KIMI_OPEN_URL=http://127.0.0.1:9 \
    DATABASE_URL="mysql://root@127.0.0.1:3399/none" \
      node "$1/dist/boot.js" > "/tmp/rbdrill-$2.log" 2>&1 &
    echo $! > /tmp/rbdrill.pid
    for _ in 1 2 3 4 5 6 7 8 9 10; do sleep 1
      curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && return 0; done
    return 1
  }
  stop() { [ -f /tmp/rbdrill.pid ] && kill "$(cat /tmp/rbdrill.pid)" 2>/dev/null; sleep 1; }

  if srv "$RB/opt/quyu" new; then pass "部署态 r8 服务 200"; else fail "r8 起不来（见 /tmp/rbdrill-new.log）"; fi
  stop
  out=$(bash "$SCRIPT_UNDER_TEST" "$RB/opt/quyu/backups/dist-before-drill.tar.gz" "$RB/opt/quyu/dist" 2>&1)
  echo "$out" | sed 's/^/    /'
  got_sha=$(sha256sum "$RB/opt/quyu/dist/boot.js" | cut -d' ' -f1)
  if [ "$got_sha" = "$old_sha" ]; then pass "回滚后 boot.js sha == r2（${got_sha:0:16}），确实换回了旧码"
  elif [ "$got_sha" = "$new_sha" ]; then fail "回滚后 boot.js 仍是 r8——回滚是空操作"
  else fail "回滚后 boot.js sha 既不是 r2 也不是 r8（${got_sha:0:16}），包内容对不上"; fi
  if srv "$RB/opt/quyu" old; then
    pass "回滚态服务能起来并响应 200"
    enc=$(curl -s -H 'Accept-Encoding: br' -o /dev/null -D - "http://127.0.0.1:$PORT/" | grep -ci 'content-encoding: br')
    [ "$enc" = "1" ] && pass "回滚态仍走 brotli" || fail "回滚态没走 brotli"
  else fail "回滚态服务起不来（见 /tmp/rbdrill-old.log）"
  fi
  stop
fi

rm -rf "$RB"
echo
echo "fails=$fails skipped=$skipped"
[ "$fails" -eq 0 ] && echo "ROLLBACK DRILL PASSED" || echo "ROLLBACK DRILL FAILED：$fails 项"
exit "$fails"
