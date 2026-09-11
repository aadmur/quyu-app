#!/usr/bin/env python3
"""
旧文件名兼容副本生成（QY-PERF-004 修复 / 现已转为「仅回滚用」）
============================================================

> 状态：生产库图片路径已于 2026-09-12 迁移到 .webp（见
>       _archive/migrate-images-to-webp.sql），public/ 下不再保留兼容副本。
>       本脚本仅用于**回滚场景**——若恢复迁移前的 DB 备份（历史路径回到 .jpg/.png），
>       运行本脚本可重新生成旧名兼容副本让图片恢复可达。
>       日常不要运行：生成的 jpg/png 会被 check-images.mjs 判为「未瘦身」而让构建失败。

背景（线上事故根因）
--------------------
QY-PERF-004 把 public/ 下的位图改名为 .webp，但**文件名同时被两层固化**：

  1. 代码层：src/data/*.ts（StoryBar 故事流、首页/钓场详情兜底数据）
  2. 数据层：**数据库里已存储的历史路径**
       posts.images          ["/feed-1.jpg", ...]        （JSON，13 行）
       posts.author_avatar   /avatar-2.png ... /avatar-7.png（15 行）
       products.image        /prod-rod.jpg ...
       ponds.cover           /pond-qinglong-1.jpg ...
       reviews.images        ["/review-1.jpg"]

改名后数据层仍指向旧文件名 → 全部 404 → 前端从接口取到的图片一律加载不出来。
构建期不会报错：public/ 是原样拷贝，Vite 不解析其中的字符串引用，
而 `check-images.mjs` 当时只扫了 src/ 与 api/，没有覆盖 db/ 与已落库数据。

修复方式
--------
**不回滚、不改库**：把旧文件名以「内容为优化后的小图」的形式补回来，
与原 .webp 并存。于是旧路径（数据层）与新路径（代码层）同时可达，
历史数据、旧分享链接、缓存都不受影响。

本脚本从 git 基线提交里取原图，按**同名 .webp 的实际像素尺寸**重新编码，
保证新旧两个变体像素完全一致（避免视觉或布局差异），只是格式不同。

用法：
  <venv>/bin/python scripts/restore-legacy-images.py                 # 生成
  <venv>/bin/python scripts/restore-legacy-images.py --dry-run       # 预览
  <venv>/bin/python scripts/restore-legacy-images.py --ref 3e59500   # 指定基线

产物清单写入 scripts/image-legacy-compat.json，供 check-images.mjs 门禁校验
（删除任一兼容副本都会让构建失败）。
"""
import argparse
import json
import os
import subprocess
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
PUBLIC = os.path.join(ROOT, "public")
MANIFEST = os.path.join(HERE, "image-legacy-compat.json")

DEFAULT_REF = "3e59500"  # v8.9.0 动工前基线（QY-PERF-004 之前）
RASTER = (".jpg", ".jpeg", ".png")

# 与 optimize-images.py 的 RULES 保持一致
RULES = [
    ("avatar-", 128, 80),
    ("feed-", 640, 80),
    ("pond-", 720, 80),
    ("prod-", 560, 80),
    ("shop-banner", 720, 80),
    ("review-", 560, 80),
    ("profile-cover", 720, 80),
]
DEFAULT_RULE = (720, 80)


def rule_for(name: str):
    for prefix, side, quality in RULES:
        if name.startswith(prefix):
            return side, quality
    return DEFAULT_RULE


def git(*args: str) -> bytes:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE
    ).stdout


def baseline_names(ref: str):
    out = git("ls-tree", "-r", "--name-only", ref, "--", "public").decode("utf-8")
    names = []
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("public/"):
            continue
        name = line[len("public/"):]
        if "/" in name:
            continue
        if name.lower().endswith(RASTER):
            names.append(name)
    return sorted(names)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default=DEFAULT_REF, help="基线提交（默认 3e59500）")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不写文件")
    args = ap.parse_args()

    names = baseline_names(args.ref)
    if not names:
        print(f"FAIL 基线 {args.ref} 的 public/ 下没有位图", file=sys.stderr)
        return 2

    # 从现有 .webp 读尺寸，保证新旧变体像素一致
    webp_dims = {}
    for f in os.listdir(PUBLIC):
        if f.lower().endswith(".webp"):
            with Image.open(os.path.join(PUBLIC, f)) as im:
                webp_dims[f] = im.size

    # 兼容集 = 基线里被改名成 .webp 的那些（与本次是否新建无关）：
    # 清单必须全量且幂等，否则重复执行会把清单截断成「只剩新增项」，
    # 门禁就会漏掉已存在的副本。
    compat = []
    todo = []
    for name in names:
        base = os.path.splitext(name)[0]
        sibling = base + ".webp"
        if sibling not in webp_dims:
            continue  # 未改名（PRESERVE_NAMES），无兼容副本
        compat.append(name)
        if not os.path.exists(os.path.join(PUBLIC, name)):
            todo.append((name, sibling))

    if not compat:
        print("无需兼容副本：基线位图都保留了原名")
        return 0

    if not todo:
        print(f"兼容副本已齐全（{len(compat)} 个），仅重写清单")
    else:
        print(f"待生成 {len(todo)} / {len(compat)} 个")

    print(f"{'原体积':>9} {'新体积':>9} {'尺寸':>11}  文件")
    print("-" * 70)
    total = 0
    for name, sibling in todo:
        raw = git("show", f"{args.ref}:public/{name}")
        src_size = len(raw)
        ext = os.path.splitext(name)[1].lower()

        tmp_src = os.path.join(ROOT, ".legacy-src.tmp")
        with open(tmp_src, "wb") as fh:
            fh.write(raw)
        try:
            with Image.open(tmp_src) as im:
                if sibling in webp_dims:
                    nw, nh = webp_dims[sibling]
                else:
                    w, h = im.size
                    side, _ = rule_for(name)
                    scale = min(1.0, side / max(w, h))
                    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
                has_alpha = im.mode in ("RGBA", "LA", "P")
                im = im.convert("RGBA") if has_alpha else im.convert("RGB")
                if (nw, nh) != im.size:
                    im = im.resize((nw, nh), Image.LANCZOS)
                _, quality = rule_for(name)
                dst = os.path.join(PUBLIC, name)
                if not args.dry_run:
                    tmp = dst + ".tmp"
                    if ext in (".jpg", ".jpeg"):
                        im.convert("RGB").save(
                            tmp, "JPEG", quality=quality, optimize=True, progressive=True
                        )
                    else:
                        im.save(tmp, "PNG", optimize=True)
                    os.replace(tmp, dst)
                    new_size = os.path.getsize(dst)
                else:
                    new_size = int(src_size * 0.32)
        finally:
            if os.path.exists(tmp_src):
                os.remove(tmp_src)

        total += new_size
        print(f"{src_size:>9} {new_size:>9} {nw:>5}x{nh:<5}  {name}")

    print("-" * 70)
    print(f"本次生成 {len(todo)} 个，合计 {total // 1024} KB；兼容集共 {len(compat)} 个")

    if args.dry_run:
        print("（--dry-run：未写入任何文件）")
        return 0

    payload = {
        "purpose": "旧文件名兼容副本清单（数据库/历史数据固化的路径）",
        "why": "QY-PERF-004 把位图改名为 .webp 后，数据库里存的历史路径仍指向旧名，"
               "导致图片 404。这些副本保证旧路径继续可达，不得删除；"
               "仅当生产库路径已迁移到 .webp 后才可整体下线。",
        "baselineRef": args.ref,
        "generator": "scripts/restore-legacy-images.py",
        "paths": sorted("/" + n for n in compat),
    }
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"清单已写入 {os.path.relpath(MANIFEST, ROOT).replace(os.sep, '/')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
