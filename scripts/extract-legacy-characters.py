#!/usr/bin/env python3
"""LimeZu Legacy 单角色表 → 游戏 288×384 紧凑角色表(裁切重排,一次性工具)。

源: moderninteriors-win.zip → 2_Characters/Old/Single_Characters_Legacy/32x32/
    将 {Name}_32x32.png(全集表)与 {Name}_idle_anim_32x32.png(idle 呼吸)解压到 --src-dir。

源布局(32×64 帧盒横向排布,角色为 2x 大图):
  标准族 全集表行对: y0=静态idle 4f [left,up,right,down]; y64=walk 24f(4组×6f 同序);
    y128=run; y192+=姿态(sit/phone/reading/cart,本工具不用)。Bouncer(1536×512,少尾行)、
    Butcher(_2)(768×288,尾部为切肉台)前三行对同构。
  witch/zombie 简化族: y0=静态idle 4f [down,up,left,right]; y64=walk-down 6f(仅朝下,四向复用)。
  idle 呼吸文件: 标准族 24f(4组×6f);简化族 6f 仅朝下(不用,改静态 idle 复制)。

游戏契约(apps/server/src/assets/import-plan.ts CHARACTER_ANIM):
  288×384=9列×12行; 行0-3=walk[up,left,down,right]×6f; 行4-7=idle×2f; 行8-11=lie×2f。

变换: 帧 32×64 → 最近邻缩至 (16,32)(2x→1x,与现有 char-* 精灵 16×23 对齐)→ 水平居中贴入 32×32(x=8)。
lie: 源无仰卧帧——由 idle-down 帧内容纵向压扁 50% 合成(底部留白 6,对齐现有 lie bbox y12-26)。

用法:
  python3 extract-legacy-characters.py --src-dir <解压目录> --out-dir /tmp/asset-import/character
输出: char-<slug>.png ×19 + preview-char-<slug>.png(4x 联览,目检用,不入库)。
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

# (源名, slug, 中文名, 族)  族: std=标准 9 行对布局 / simple=witch,zombie 简化布局
CHARACTERS: list[tuple[str, str, str, str]] = [
    ("Adam", "adam", "居民·亚当", "std"),
    ("Alex", "alex", "居民·亚历克斯", "std"),
    ("Amelia", "amelia", "居民·艾米莉亚", "std"),
    ("Ash", "ash", "居民·艾什", "std"),
    ("Bob", "bob", "居民·鲍勃", "std"),
    ("Bouncer", "bouncer", "保镖", "std"),
    ("Bruce", "bruce", "居民·布鲁斯", "std"),
    ("Butcher", "butcher", "屠夫", "std"),
    ("Butcher_2", "butcher2", "屠夫·二号", "std"),
    ("Dan", "dan", "居民·丹", "std"),
    ("Edward", "edward", "居民·爱德华", "std"),
    ("Lucy", "lucy", "居民·露西", "std"),
    ("Molly", "molly", "居民·莫莉", "std"),
    ("Pier", "pier", "居民·皮尔", "std"),
    ("Rob", "rob", "居民·罗布", "std"),
    ("Roki", "roki", "居民·罗基", "std"),
    ("Samuel", "samuel", "居民·塞缪尔", "std"),
    ("Witch", "witch", "女巫", "simple"),
    ("Zombie", "zombie", "僵尸", "simple"),
]

CELL = 32
# 源全集表 walk 组序与静态 idle 序 → 游戏行序 [up,left,down,right]
STD_DIR_FRAMES = {"up": (6, 12), "left": (0, 6), "down": (18, 24), "right": (12, 18)}
SIMPLE_IDLE_ORDER = {"down": 0, "up": 1, "left": 2, "right": 3}  # 静态 idle 帧序
LIE_BOTTOM_MARGIN = 6


def load_frame(img: Image.Image, col: int, y: int) -> Image.Image:
    return img.crop((col * CELL, y, (col + 1) * CELL, y + 2 * CELL))


def to_cell(frame: Image.Image) -> Image.Image:
    """32×64(2x)→ 16×32 最近邻降采样,水平居中贴入 32×32 格。"""
    small = frame.resize((CELL // 2, CELL), Image.NEAREST)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cell.paste(small, (CELL // 4, 0))
    return cell


def synthesize_lie(idle_down: Image.Image) -> Image.Image:
    """由朝下 idle 格合成仰卧 lie 帧:内容 bbox 纵向压扁 50%,底部对齐现有 lie 约定。"""
    bbox = idle_down.getbbox()
    content = idle_down.crop(bbox)
    w, h = content.size
    squashed = content.resize((w, max(6, h // 2)), Image.NEAREST)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    sw, sh = squashed.size
    cell.paste(squashed, ((CELL - sw) // 2, CELL - LIE_BOTTOM_MARGIN - sh))
    return cell


def extract_std(src_dir: Path, name: str) -> Image.Image:
    sheet = Image.open(src_dir / f"{name}_32x32.png").convert("RGBA")
    idle_anim = Image.open(src_dir / f"{name}_idle_anim_32x32.png").convert("RGBA")

    out = Image.new("RGBA", (9 * CELL, 12 * CELL), (0, 0, 0, 0))
    # 行0-3 walk:全集 y64 行对,4 组×6f,序 [up,left,down,right]
    for row, key in enumerate(["up", "left", "down", "right"]):
        s, e = STD_DIR_FRAMES[key]
        for i, col in enumerate(range(s, e)):
            out.paste(to_cell(load_frame(sheet, col, 64)), (i * CELL, row * CELL))
    # 行4-7 idle:idle_anim 4 组×6f 取 f0/f3
    for row, key in enumerate(["up", "left", "down", "right"]):
        s, e = STD_DIR_FRAMES[key]
        for i, col in enumerate((s, s + 3)):
            out.paste(to_cell(load_frame(idle_anim, col, 0)), (i * CELL, (4 + row) * CELL))
    # 行8-11 lie:合成(idle 静态朝下帧=全集 y0 f3)
    lie = synthesize_lie(to_cell(load_frame(sheet, 3, 0)))
    for row in range(8, 12):
        for i in (0, 1):
            out.paste(lie, (i * CELL, row * CELL))
    return out


def extract_simple(src_dir: Path, name: str) -> Image.Image:
    sheet = Image.open(src_dir / f"{name}_32x32.png").convert("RGBA")
    idle = Image.open(src_dir / f"{name}_idle_32x32.png").convert("RGBA")

    out = Image.new("RGBA", (9 * CELL, 12 * CELL), (0, 0, 0, 0))
    # 行0-3 walk:仅朝下 6f,四向复用
    for row in range(4):
        for i in range(6):
            out.paste(to_cell(load_frame(sheet, i, 64)), (i * CELL, row * CELL))
    # 行4-7 idle:静态 4f(序 down,up,left,right)各复制 2 帧
    idle_cells = {d: to_cell(load_frame(idle, col, 0)) for d, col in SIMPLE_IDLE_ORDER.items()}
    for row, key in enumerate(["up", "left", "down", "right"]):
        for i in (0, 1):
            out.paste(idle_cells[key], (i * CELL, (4 + row) * CELL))
    # 行8-11 lie:合成
    lie = synthesize_lie(idle_cells["down"])
    for row in range(8, 12):
        for i in (0, 1):
            out.paste(lie, (i * CELL, row * CELL))
    return out


def preview(slug: str, sheet: Image.Image, scale: int = 4) -> None:
    sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST).save(
        out_dir / f"preview-char-{slug}.png"
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src-dir", required=True, help="Legacy 32x32 解压目录")
    ap.add_argument("--out-dir", required=True, help="输出目录(char-*.png + preview)")
    args = ap.parse_args()
    src_dir, out_dir = Path(args.src_dir), Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for name, slug, cn, family in CHARACTERS:
        sheet = extract_std(src_dir, name) if family == "std" else extract_simple(src_dir, name)
        assert sheet.size == (288, 384), slug
        sheet.save(out_dir / f"char-{slug}.png")
        preview(slug, sheet)
        print(f"char-{slug}.png  {cn}")
    print(f"完成 {len(CHARACTERS)} 张 → {out_dir}")
