#!/usr/bin/env python3
"""
静态图片瘦身脚本（QY-PERF-004）
================================

把 public/ 下的位图（jpg/png）按**实际显示尺寸**重采样并转成 WebP。
原图多为 900~1440px 宽，而 App 是 max-w-420px 的移动端壳层，等于把
3~6 倍于所需的像素传给用户；其中头像更极端——显示 32~56px、源图却
宽达 900px（单张 277 KB）。

缩放上限按「显示尺寸 × 2（DPR 2x）」并留少量余量确定：

  avatar-*       160px  显示 32~64px（StoryBar 56 / 评论 36 / 头像选择器）
  feed-*         880px  信息流整宽 ~420px
  pond-*         900px  钓场头图 h-300 整宽 + 详情页画廊
  prod-*         720px  商品 aspect-square，网格卡与详情弹层
  shop-banner    800px  商城横幅 h-140 整宽
  review-*       720px  评价配图
  profile-cover  900px  个人主页封面

SVG 不动（矢量，本身已最优）。字体不动。

依赖：Pillow（一次性资产处理，不引入 npm 依赖）
  python -m venv <venv> && <venv>/bin/pip install Pillow
  <venv>/bin/python scripts/optimize-images.py            # 执行转换
  <venv>/bin/python scripts/optimize-images.py --dry-run  # 只预览
  <venv>/bin/python scripts/optimize-images.py --keep-originals  # 保留原图

转换后用 `scripts/check-images.mjs` 校验体积预算。
"""
import argparse
import os
import sys
from PIL import Image

PUBLIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")

# (文件名前缀匹配, 最大长边 px, WebP 质量)
#
# 缩放基准取「显示尺寸 × 1.5」而非 ×2：App 是 max-w-420px 的移动端壳层，
# 整宽图实际显示约 388~420 CSS px；1.5x（≈630px）在手机上已难分辨与 2x
# 的差异，而不缩放则等于把 2~3 倍冗余像素传给用户。头像是例外，显示
# 32~64px 却源图宽达 900px，按 ×2 收到 128px 收益极大且无观感损失。
RULES = [
    ("avatar-", 128, 78),
    ("feed-", 640, 76),
    ("pond-", 720, 76),
    ("prod-", 560, 76),
    ("shop-banner", 720, 76),
    ("review-", 560, 76),
    ("profile-cover", 720, 76),
]
DEFAULT_RULE = (720, 76)

# 必须**保留原文件名与原格式**的图片（只做原地降采样 + 重编码）。
#
# 原因：这两个路径已被服务端与数据库固化，改名会造成历史数据 404：
#   /avatar-1.png       db/schema.ts 的 posts.author_avatar 列默认值，
#                       并被 api/auth-router、feature-router、queries/users、
#                       services/social 作为兜底头像引用
#   /pond-yunxi-1.jpg   api/services/pondApplication 的默认封面，返回值会
#                       落库为钓场 cover
# 因此它们不转 WebP，只在原格式内降采样重编码。
PRESERVE_NAMES = {"avatar-1.png", "pond-yunxi-1.jpg"}

SOURCE_EXT = (".jpg", ".jpeg", ".png")


def rule_for(name: str):
    for prefix, side, quality in RULES:
        if name.startswith(prefix):
            return side, quality
    return DEFAULT_RULE


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不写文件")
    ap.add_argument("--keep-originals", action="store_true", help="保留原图（默认删除）")
    args = ap.parse_args()

    targets = []
    for root, _dirs, files in os.walk(PUBLIC):
        for f in sorted(files):
            if f.lower().endswith(SOURCE_EXT):
                targets.append(os.path.join(root, f))
    targets.sort()

    before_total = sum(os.path.getsize(p) for p in targets)
    after_total = 0
    removed_total = 0

    print(f"{'原体积':>9} {'新体积':>9} {'降幅':>7} {'原尺寸':>11} {'新尺寸':>11}  文件")
    print("-" * 78)

    for src in targets:
        name = os.path.basename(src)
        base, ext = os.path.splitext(src)
        preserve = name in PRESERVE_NAMES
        dst = src if preserve else base + ".webp"
        max_side, quality = rule_for(name)

        src_size = os.path.getsize(src)
        with Image.open(src) as im:
            w, h = im.size
            has_alpha = im.mode in ("RGBA", "LA", "P")
            im = im.convert("RGBA") if has_alpha else im.convert("RGB")
            scale = min(1.0, max_side / max(w, h))
            nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
            if scale < 1.0:
                im = im.resize((nw, nh), Image.LANCZOS)

            if args.dry_run:
                # 干跑时不编码，仅按经验系数估算
                dst_size = int(src_size * (0.30 if ext.lower() in (".jpg", ".jpeg") else 0.22) * (scale ** 1.6))
            else:
                tmp = dst + ".tmp"
                if preserve:
                    # 原地重编码：保留扩展名与格式，MIME 语义不变
                    if ext.lower() in (".jpg", ".jpeg"):
                        im.convert("RGB").save(tmp, "JPEG", quality=quality, optimize=True, progressive=True)
                    else:
                        im.save(tmp, "PNG", optimize=True)
                else:
                    im.save(tmp, "WEBP", quality=quality, method=6)
                os.replace(tmp, dst)
                dst_size = os.path.getsize(dst)
                if not preserve and not args.keep_originals:
                    os.remove(src)
                    removed_total += src_size

        after_total += dst_size
        pct = (1 - dst_size / src_size) * 100 if src_size else 0
        rel = os.path.relpath(dst, PUBLIC).replace("\\", "/")
        tag = "  ⟨保留名⟩" if preserve else ""
        print(f"{src_size:>9} {dst_size:>9} {pct:>6.0f}% {w:>5}x{h:<5} {nw:>5}x{nh:<5}  {rel}{tag}")

    print("-" * 78)
    print(f"处理 {len(targets)} 张")
    print(f"原合计 {before_total // 1024} KB → WebP 合计 {after_total // 1024} KB "
          f"（降 {(1 - after_total / before_total) * 100:.0f}%）")
    if removed_total:
        print(f"已删除原图 {removed_total // 1024} KB")
    if args.dry_run:
        print("（--dry-run：未写入任何文件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
