#!/usr/bin/env bash
# v14 回滚：把 dist 换回备份包里的旧产物。
# 不猜备份的顶层目录名，也不依赖 --strip-components 的层数——
# 先解到暂存区，再按 boot.js 的实际位置找出货根。
# 用法: bash v14-rollback.sh <备份.tar.gz> [dist目录，默认 /opt/quyu/dist]
set -uo pipefail

BK="${1:-}"
DIST="${2:-/opt/quyu/dist}"
BR_MIN=30   # 与部署脚本同一道 brotli 闸门

die() { echo "ABORT: $*" >&2; exit 1; }

[ -n "$BK" ] || die "用法: bash $0 <备份.tar.gz> [dist目录]"
[ -f "$BK" ] || die "备份包不存在: $BK"
command -v tar >/dev/null || die "没有 tar"

stage=$(mktemp -d) || die "mktemp 失败"
trap 'rm -rf "$stage"' EXIT

tar xzf "$BK" -C "$stage" 2>/dev/null || die "备份包解压失败（可能已损坏，别拿它回滚）"

boot=$(find "$stage" -type f -name boot.js | head -1)
[ -n "$boot" ] || die "备份里没有 boot.js——这份包不能当回滚目标，已停止，当前 dist 未改动"
root=$(dirname "$boot")

[ -f "$root/public/index.html" ] || die "备份货根缺 public/index.html（顶层结构与部署判据不符），当前 dist 未改动"
br=$(find "$root" -name '*.br' | wc -l | tr -d ' ')
[ "$br" -ge "$BR_MIN" ] || die "备份里 .br 只有 $br 个（<$BR_MIN），回滚过去首屏会退化到未压缩，当前 dist 未改动"

sha=$(sha256sum "$boot" | cut -c1-16)
target_parent=$(dirname "$DIST")
[ -d "$target_parent" ] || die "目标目录的父级不存在: $target_parent"

mv "$DIST" "${DIST}.before-rollback-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || [ ! -e "$DIST" ] || die "无法移开当前 dist"
mv "$root" "$DIST" || die "回滚落位失败，请人工检查 $DIST"

echo "ROLLBACK OK  dist=$DIST  boot.js_sha256=${sha}…  .br=$br"
echo "旧 dist 已移到 ${DIST}.before-rollback-*  （确认无误后再删）"
echo "下一步: systemctl restart quyu && curl -sf -o /dev/null http://127.0.0.1:3000/ && echo LIVE"
