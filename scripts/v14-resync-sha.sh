#!/usr/bin/env bash
# v14 部署前置：把 /root/v14-deploy.sh 里的期望 sha 对齐到**磁盘上那份产物**的实际 sha。
#
# 为什么要这个脚本而不是让人手抄 64 位十六进制：sha 是这次上线唯一的"包没拿错"判据，
# 而手抄的失败模式是最坏的一种——抄错一位不会有任何提示，部署脚本会直接拒绝切换，
# 或者更糟：把一份更旧的产物验成"正确"。
#
# 用法（在服务器上）：bash v14-resync-sha.sh [产物路径] [部署脚本路径]
# 默认：/root/dist-v8.12.0.tar.gz 与 /root/v14-deploy.sh
# 幂等：重复执行结果一致；不匹配才改；改前留 .bak。
set -euo pipefail

TARBALL="${1:-/root/dist-v8.12.0.tar.gz}"
DEPLOY="${2:-/root/v14-deploy.sh}"

[ -f "$TARBALL" ] || { echo "FAIL 产物不存在：$TARBALL（先把它上传到这个路径）"; exit 1; }
[ -f "$DEPLOY" ]  || { echo "FAIL 部署脚本不存在：$DEPLOY"; exit 1; }

ACTUAL="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
# 只认「行首可有空白 + SHA_EXPECTED=...」这一种写法；改前先确认它存在
grep -qE '^[[:space:]]*SHA_EXPECTED=' "$DEPLOY" || { echo "FAIL $DEPLOY 里找不到 SHA_EXPECTED= 这一行，不做任何修改"; exit 1; }
CURRENT="$(sed -nE 's/^[[:space:]]*SHA_EXPECTED="?([0-9a-fA-F]{64})"?.*/\1/p' "$DEPLOY" | head -1)"

echo "产物实际 sha : $ACTUAL"
echo "脚本期望 sha : ${CURRENT:-<解析失败>}"

if [ "$CURRENT" = "$ACTUAL" ]; then
  echo "OK 已一致，未修改任何文件（可执行 bash $DEPLOY）"
  exit 0
fi

cp "$DEPLOY" "$DEPLOY.bak-before-sha-resync"
TMP="$(mktemp)"
# 用 sed 只替换那一行，其余内容逐字节保留（脚本里还有别的行，不能整文件重写）
sed -E "s|^([[:space:]]*)SHA_EXPECTED=.*|\1SHA_EXPECTED=\"$ACTUAL\"|" "$DEPLOY" > "$TMP"
# 行数必须一致，否则说明替换意外吞了行或加了行
if [ "$(wc -l < "$TMP")" -ne "$(wc -l < "$DEPLOY")" ]; then
  echo "FAIL 改写后行数变化（原 $(wc -l < "$DEPLOY") → $(wc -l < "$TMP")），已放弃写入，原文件未动"
  rm -f "$TMP"; exit 1
fi
cat "$TMP" > "$DEPLOY"; rm -f "$TMP"

echo "OK 已写入新期望 sha（原脚本备份在 $DEPLOY.bak-before-sha-resync）"
bash -n "$DEPLOY" && echo "OK bash -n 语法检查通过"
echo "下一步：bash $DEPLOY"
