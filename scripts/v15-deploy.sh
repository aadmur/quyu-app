#!/usr/bin/env bash
# 趣渔 v8.13.0（迭代计划 v15「识鱼」）生产部署脚本
#
# 与 v14-deploy.sh 的三点区别（每一条都是上一轮真实踩出来的）：
#  1) **本文件在仓库里**。v14 那份只躺在 /root：无版本、无测试、无人可审，改错了也没人看得见。
#  2) 结构核对改成**逐条数值比较**，不再 grep 一整串 CONCAT 字面量。v14 那种写法差一个空格就会
#     「永远拒绝部署」，而它当时是靠隔离沙箱逐字节核对才敢钉；本轮本机没有可用 DB 层
#     （3306 是这台机器自己的 MySQL 8.4、root 口令不可用；起隔离 mysqld 被策略拦），
#     所以这里**不引入任何我无法当场验证的字符串等式**——数值比较不需要猜空格。
#  3) 第⑥步修掉了 v14 的坏仪表：v14 用 POST 调 query 过程，tRPC 按协议恒回 405
#     METHOD_NOT_SUPPORTED，于是**每次成功部署都会显红**。这里 query 走批量 GET、mutation 走 POST，
#     并且把"路由没注册(404/405)"与"运行期故障(5xx)"分成两种红。
#
# 为什么迁移与切码不能拆：v15 新代码硬依赖
#   user_balance.fish_id_free_used、fish_id_calls、fish_id_samples
# 缺任一 → 识鱼入口每次调用直接 500（台账写入与余额 CAS 都落在 SQL 层）。
#
# 用法：
#   bash v15-deploy.sh              # 全流程
#   bash v15-deploy.sh gates        # 只跑产物闸门：不碰库、不碰服务、不切 dist（本机唯一可演练的部分）
#   bash v15-deploy.sh --rollback <备份.tar.gz>   # 只回滚 dist（不回滚库）；必须显式给路径
#
# 演练可覆盖的路径（生产用默认值）：
#   QY_APP=/opt/quyu  QY_TAR=/root/dist-v8.13.0.tar.gz  QY_SQL=/root/v15-sql  QY_SHA=<期望 sha>
set -euo pipefail

MODE="${1:-full}"
APP="${QY_APP:-/opt/quyu}"
TAR="${QY_TAR:-/root/dist-v8.13.0.tar.gz}"
SQL="${QY_SQL:-/root/v15-sql}"
SHA_EXPECTED="${QY_SHA:-SHA_EXPECTED_PLACEHOLDER}"
BR_MIN=30

die() { echo "  ✗ $*" >&2; exit 1; }
ok()  { echo "  ✓ $*"; }

# ── 应急路径最先处理：它不能依赖"新产物已就位且校验通过" ──────────
if [ "$MODE" = "--rollback" ]; then
  BK="${2:-}"
  [ -n "$BK" ] || die "--rollback 必须显式给备份包路径（「自动挑最近那份」的改动已被 B-36 回退，别指望它）"
  [ -f "$BK" ] || die "备份包不存在：$BK"
  T=$(mktemp -d)
  trap 'rm -rf "$T"' EXIT
  tar xzf "$BK" -C "$T" || die "备份包解压失败（可能已损坏，别拿它回滚）"
  BOOT=$(find "$T" -type f -name boot.js | head -1)
  [ -n "$BOOT" ] || die "备份里没有 boot.js——这份包不能当回滚目标，当前 dist 未改动"
  ROOT=$(dirname "$BOOT")
  [ -f "$ROOT/public/index.html" ] || die "备份货根缺 public/index.html（顶层结构与部署判据不符），当前 dist 未改动"
  BR=$(find "$ROOT" -name '*.br' | wc -l | tr -d ' ')
  [ "$BR" -ge "$BR_MIN" ] || die "备份里 .br 只有 $BR 个（<$BR_MIN），回滚过去首屏会退化到未压缩，当前 dist 未改动"
  mv "$APP/dist" "$APP/dist.before-rollback-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
  mv "$ROOT" "$APP/dist" || die "回滚落位失败，请人工检查 $APP/dist"
  echo "dist 已回滚到 boot.js=$(sha256sum "$APP/dist/boot.js" | cut -c1-16)…"
  echo "下一步：systemctl restart quyu && curl -sf -o /dev/null http://127.0.0.1:3000/ && echo LIVE"
  echo "数据库不用回滚：0015 只加带默认值的列和两张新表，旧代码不读它们。"
  exit 0
fi

# ── ① 产物闸门（gates 模式到此为止）─────────────────────────────
echo "════ ① 校验产物 ════"
[ -f "$TAR" ] || die "缺产物 $TAR（先把这一版要上线的包传到这个路径，别拿上一版凑数）"
if [ "$SHA_EXPECTED" = "SHA_EXPECTED_PLACEHOLDER" ]; then
  die "期望 sha 还是占位符——先跑 bash /root/v15-resync-sha.sh $TAR <本脚本>，它按磁盘上那份包现算，不让人手抄 64 位"
fi
ACTUAL=$(sha256sum "$TAR" | cut -d' ' -f1)
echo "  期望 $SHA_EXPECTED"
echo "  实际 $ACTUAL"
[ "$ACTUAL" = "$SHA_EXPECTED" ] || die "sha256 不匹配，中止（传输截断，或指错了包——本项目已经在这一道上差点放行过一份错包）"
ok "sha256 一致"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
tar xzf "$TAR" -C "$STAGE" || die "解包失败"
# 条目必须落在 dist/ 之下；但要容忍 `./dist/...` 这种纯写法差异（tar 的两种顶层形式），
# 否则一道"永远拒绝部署"的假红灯会在最需要它的时候把人也一起骗了——v14 的回滚演练就栽过同形问题。
NOT_DIST=$(tar tzf "$TAR" | { sed 's|^\./||' | grep -vc '^dist/' || true; } | tr -d ' ')
[ "$NOT_DIST" = "0" ] || die "有 $NOT_DIST 个条目不在 dist/ 之下（服务器以 root 解包，绝对路径或 .. 会写到目录外）"
[ -f "$STAGE/dist/boot.js" ] || die "解压后缺 dist/boot.js"
[ -f "$STAGE/dist/public/index.html" ] || die "解压后缺 dist/public/index.html"
ENTRIES=$(tar tzf "$TAR" | wc -l | tr -d ' ')
ok "结构核对通过：$ENTRIES 条目全在 dist/ 之下，boot.js / index.html 就位"

BRN=$(find "$STAGE/dist/public" -name '*.br' 2>/dev/null | wc -l | tr -d ' ')
if [ "$BRN" -lt "$BR_MIN" ]; then
  echo "  ✗ 产物里只有 $BRN 个 .br（期望 ≥$BR_MIN）"
  echo "    brotli 缺失会让 JS/CSS 按未压缩传输，首屏从 189 KB 退化到 600 KB+（等于当场清掉 v12 的成果）。"
  echo "    请在打包机跑完整 build 链（链内含 scripts/precompress.mjs）后重新打包上传。"
  exit 1
fi
ok "brotli 变体 $BRN 个就位"

if [ "$MODE" = "gates" ]; then
  echo "════ gates 模式：到此为止，未碰数据库、未碰服务、未切 dist ════"
  LIVE=$(sha256sum "$APP/dist/boot.js" 2>/dev/null | cut -c1-16 || true)
  echo "  现役 dist boot.js：${LIVE:-（$APP/dist 不存在）}…"
  echo "  新包内   boot.js：$(sha256sum "$STAGE/dist/boot.js" | cut -c1-16)…"
  echo "GATES OK"
  exit 0
fi

# ── ② 备份 ─────────────────────────────────────────────────────
echo "════ ② 备份 ════"
TS=$(date +%Y%m%d-%H%M%S)
[ -d "$APP" ] || die "$APP 不存在"
[ -d "$APP/backups" ] || mkdir -p "$APP/backups"
BKDB="$APP/backups/quyu-before-v8.13.0-$TS.sql.gz"
BKDIST="$APP/backups/dist-before-v8.13.0-$TS.tar.gz"
[ -d "$APP/dist" ] || die "$APP/dist 不存在——没有可归档的现役 dist，别继续"
tar czf "$BKDIST" -C "$APP" dist || die "旧 dist 归档失败"
mysql_pw() { grep -m1 '^DATABASE_URL' "$APP/.env" | sed 's|.*quyu:||; s|@.*||'; }
mysqldump --single-transaction -uquyu -p"$(mysql_pw)" quyu 2>/dev/null | gzip > "$BKDB"
TBLS=$(gunzip -c "$BKDB" | grep -c '^CREATE TABLE')
gunzip -c "$BKDB" | tail -3 | grep -q "Dump completed" || die "备份不完整（缺 Dump completed 结束标记），中止部署"
[ "$TBLS" -ge 29 ] || die "表数异常（期望 ≥29，实际 $TBLS），中止"
ok "全库备份 $BKDB → $TBLS 表；旧 dist 归档 $BKDIST"

q1() { mysql -uquyu -p"$(mysql_pw)" quyu -N -e "$1" 2>/dev/null; }

# ── ③ 迁移 ─────────────────────────────────────────────────────
echo "════ ③ 迁移（0015 各跑两遍验幂等）════"
MIG=0015_fish_id_run.sql
[ -f "$SQL/$MIG" ] || die "缺 $SQL/$MIG（先把 v15 的直跑版迁移传到 $SQL/）"
for round in 1 2; do
  out=$(mysql -uquyu -p"$(mysql_pw)" quyu < "$SQL/$MIG" 2>&1 || true)
  if echo "$out" | grep -qiE "ERROR"; then
    echo "$out" | grep -i error | head -3
    die "$MIG 第 $round 遍报错，部署中止（库可能处于半完成态，用 $BKDB 恢复后重跑）"
  fi
done
ok "$MIG 两遍执行无错（第二遍应全是 skip 行）"

# ── ④ 结构核对（数值比较；迁移没生效就别切代码）──────────────────
echo "════ ④ 结构核对 ════"
NEW_COL=$(q1 "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_balance' AND COLUMN_NAME='fish_id_free_used'")
NEW_TBL=$(q1 "SELECT COUNT(DISTINCT TABLE_NAME) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('fish_id_calls','fish_id_samples')")
NEW_IDX=$(q1 "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('fish_id_calls','fish_id_samples')")
V14_FAV=$(q1 "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='post_favorites'")
V14_LIKE=$(q1 "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='comments' AND COLUMN_NAME='like_count'")
echo "  fish_id_free_used=$NEW_COL / v15 新表=$NEW_TBL / v15 新索引=$NEW_IDX / v14 收藏表=$V14_FAV / v14 评论点赞列=$V14_LIKE"
[ "$NEW_COL" = "1" ] || die "user_balance.fish_id_free_used 没建成（期望 1，实际 $NEW_COL）"
[ "$NEW_TBL" = "2" ] || die "v15 新表应为 2 张（实际 $NEW_TBL）"
[ "$NEW_IDX" -ge 3 ] || die "v15 新索引应 ≥3 个（实际 $NEW_IDX）"
[ "$V14_FAV" = "1" ] || die "v14 的 post_favorites 不在库里（实际 $V14_FAV）——线上代码正依赖它"
[ "$V14_LIKE" = "1" ] || die "v14 的 comments.like_count 不在库里（实际 $V14_LIKE）"
ok "结构完全符合预期（5 项数值全中，且 v14 的结构仍在位）"

# ── ⑤ 原子替换 ─────────────────────────────────────────────────
echo "════ ⑤ 原子替换 + 重启 ════"
mv "$APP/dist" "$APP/dist-replaced-v8.13.0-$TS"
mv "$STAGE/dist" "$APP/dist"
systemctl restart quyu
sleep 5
if ! systemctl is-active quyu >/dev/null; then
  echo "  ✗ 服务未起来。一条命令回滚："
  echo "     rm -rf $APP/dist && mv $APP/dist-replaced-v8.13.0-$TS $APP/dist && systemctl restart quyu"
  exit 1
fi
ok "服务 active（替换前的 dist 留档在 $APP/dist-replaced-v8.13.0-$TS）"

# ── ⑥ 线上复核 ─────────────────────────────────────────────────
echo "════ ⑥ 线上复核（query 走批量 GET，mutation 走 POST）════"
BASE="http://127.0.0.1:3000/api/trpc"
FAILS=0
get_probe() { # $1=过程名 $2=input JSON $3=额外许可码模式（如 "401|400"：要求登录或无需入参的过程）
  local code allow="${3:-}"
  code=$(curl -s -o /dev/null -w '%{http_code}' -G "$BASE/$1?batch=1" --data-urlencode "input=$2" || echo 000)
  case "$code" in
    200|$allow) ok "$1 → $code（路由在位）";;
    404|405) echo "  ✗ $1 → $code（路由没注册/方法不符：部署的不是这一版）"; FAILS=$((FAILS + 1));;
    5*)      echo "  ✗ $1 → $code（运行期故障，先怀疑迁移没生效）"; FAILS=$((FAILS + 1));;
    *)       echo "  ·  $1 → $code（非预期，人工看一眼）";;
  esac
}
post_probe() { # $1=过程名 $2=input JSON —— mutation；401/400/412 都算"注册在位且被前置条件拦住"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d "$2" "$BASE/$1?batch=1" || echo 000)
  case "$code" in
    200|400|401|412) ok "$1 → $code（路由在位，被登录/入参/前置条件拦住，属预期）";;
    404|405) echo "  ✗ $1 → $code（路由没注册/方法不符：部署的不是这一版）"; FAILS=$((FAILS + 1));;
    5*)      echo "  ✗ $1 → $code（运行期故障，先怀疑 0015 没生效）"; FAILS=$((FAILS + 1));;
    *)       echo "  ·  $1 → $code（非预期，人工看一眼）";;
  esac
}
curl -s -o /dev/null -w "  首页 HTTP %{http_code}，传输 %{size_download} B\n" http://127.0.0.1:3000/
curl -s -H 'Accept-Encoding: br' -o /dev/null -w "  首页(br 协商) HTTP %{http_code}，传输 %{size_download} B\n" http://127.0.0.1:3000/
get_probe app.feed '{"0":{"json":{"cursor":null,"limit":3}}}'
get_probe app.posts.comments '{"0":{"json":{"postId":1,"sort":"latest","limit":3}}}'
get_probe app.fishId.balance '{"0":{"json":{}}}' 401
# ⚠️ 三个 mutation 一律用**空入参**探：它们一旦拿到合法入参就会真的执行——
#    identify 会占掉一次免费次数（余额不够时还会扣钱）、correct 会改写用户最近一条样本、
#    sampleConsent 会写一条授权行。复核探针必须只读，这是上一轮"探针不带 cookie 也会进 SQL"
#    那次纠正之后剩下的同一族问题：验的是"路由在不在"，不是"功能跑不跑"。
#    zod 校验失败回 400，恰好证明过程已注册且没有副作用。
post_probe app.fishId.identify '{"0":{"json":{}}}'
post_probe app.fishId.correct '{"0":{"json":{}}}'
post_probe app.fishId.sampleConsent '{"0":{"json":{}}}'

if [ "$FAILS" != "0" ]; then
  echo "════ 代码已切上去，但有 $FAILS 条复核判红——先按上面提示排查；要退就一条命令：════"
  echo "  bash /root/v15-deploy.sh --rollback $BKDIST"
  exit 1
fi
echo "════ 完成 ════"
echo "⚠️ 识鱼要真出结果还需要生产 .env 里有 MOONSHOT_API_KEY。没配的话入口照常显示，但每次识别"
echo "   会回「识别服务暂未开通，请稍后再试」（412 是刻意降级，不是崩溃）——这条不是部署能解决的。"
echo "   2026-10-11 实测：生产 .env 里**没有** MOONSHOT_API_KEY 这一行。"
