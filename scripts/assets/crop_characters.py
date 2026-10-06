#!/usr/bin/env python3
"""角色表裁切:LimeZu 源包 → 游戏 288×512 紧凑角色表(25 张,M-G.3 增 sit 组)。

源:
  premade 6 张: {mi}/2_Characters/Character_Generator/0_Premade_Characters/16x16/Premade_Character_{nn}.png
  legacy 19 张: {mi}/2_Characters/Old/Single_Characters_Legacy/32x32/{Name}_32x32.png(全集表)
    + {Name}_sit_32x32.png(独立坐姿文件,Bruce 为 Bruce_sit_2)

源坐标系(16x16 premade 表,896x656;动画按「行对 RP」组织,每 RP 占 2 个 16px 物理行):
  帧 16x27 窗 = (col*16, RP*32+5) .. (+16, +27)——上行的 y+5 起跨到下行底(实证坐标,
  与 Spritesheet_animations_GUIDE.png 的标注行号存在偏移,以本脚本实证坐标为准):
    RP1  walk 四向×6: R c0-5 / up c6-11 / L c12-17 / D c18-23
    RP3  lie c0-1: 正面躺 16x14, 无方向性
    RP7  sit 正面(down)×6: c0-5(c6-11 为持物进食循环,未用)
    RP9  sit 侧/背×6: L c0-5 / R c6-11 / up c12-17(c12-23 均背面,取前 6)
    RP13 idle 四向: R c0-5 / up c6-9 / L c10-17 / D c18-23(呼吸站立, 取 c0,c2)
legacy 32x32 表(帧 32x64,2x 大图): 行对 y0=静态 idle 4f [L,up,R,D]; y64=walk 24f(4组×6f,
  组序 L/up/R/D); 独立 sit 文件 24f(组序 R c0-5 / L c6-11 / up c12-17 / D c18-23,
  与 premade 的 L/R 顺序相反)。witch/zombie 简化族无 sit 源——用 idle-down 帧填充
  (视觉为站立呼吸,聊胜于无,走查时注意)。

游戏契约(apps/server/src/assets/import-plan.ts CHARACTER_ANIM):
  288×512 = 9列×16行; 行0-3 walk[up,left,down,right]×6f; 行4-7 idle×2f;
  行8-11 lie×2f; 行12-15 sit×2f(M-G.3)。

用法:
  python3 crop_characters.py --mi-root /tmp/limezu-full/mi-win --out-dir /tmp/asset-import/character
输出: char-<slug>.png ×25 + preview-sit-<slug>.png(sit 组联览,目检用,不入库)。
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

# premade 6 张: (slug, 源编号)
PREMADE: list[tuple[str, int]] = [
    ("green", 3), ("purple", 5), ("beige", 8), ("red", 12), ("white", 16), ("blue", 19),
]
# legacy 19 张: (源名, slug, 族)  族 std=标准布局 / simple=witch,zombie 简化布局
LEGACY: list[tuple[str, str, str]] = [
    ("Adam", "adam", "std"), ("Alex", "alex", "std"), ("Amelia", "amelia", "std"),
    ("Ash", "ash", "std"), ("Bob", "bob", "std"), ("Bouncer", "bouncer", "std"),
    ("Bruce", "bruce", "std"), ("Butcher", "butcher", "std"), ("Butcher_2", "butcher2", "std"),
    ("Dan", "dan", "std"), ("Edward", "edward", "std"), ("Lucy", "lucy", "std"),
    ("Molly", "molly", "std"), ("Pier", "pier", "std"), ("Rob", "rob", "std"),
    ("Roki", "roki", "std"), ("Samuel", "samuel", "std"),
    ("Witch", "witch", "simple"), ("Zombie", "zombie", "simple"),
]

CELL = 32          # 输出帧格
FRAME_H = 27       # premade 源帧高
SHEET_COLS = 9
SHEET_ROWS = 16    # walk4 + idle4 + lie4 + sit4
# 游戏行序 [up,left,down,right] → 源起始列
#   premade: walk RP1 与 idle RP13 组序 R/up/L/D; sit 侧背 RP9 组序 L/R/up、正面 RP7
WALK_SRC = {"up": 6, "left": 12, "down": 18, "right": 0}    # RP1
IDLE_SRC = {"up": 6, "left": 10, "down": 18, "right": 0}    # RP13(取 c0,c2)
SIT_SIDE_SRC = {"up": 12, "left": 0, "right": 6}            # RP9
SIT_FRONT_COL = 0                                            # RP7(down)
# legacy: 全集表 walk 组序 L/up/R/D;独立 sit 文件组序 R/L/up/D
LEG_WALK_SRC = {"up": 6, "left": 0, "down": 18, "right": 12}      # y64 行对
LEG_SIT_SRC = {"up": 12, "left": 6, "down": 18, "right": 0}       # sit 文件
LEG_STATIC_IDLE_ORDER = {"down": 0, "up": 1, "left": 2, "right": 3}  # y0 静态 idle 帧序


def frame16(src: Image.Image, col: int, rp: int) -> Image.Image:
    return src.crop((col * 16, rp * 32 + 5, col * 16 + 16, rp * 32 + 5 + FRAME_H))


def paste32(sheet: Image.Image, frame: Image.Image, col: int, row: int, y_off: int = 5) -> None:
    sheet.paste(frame, (col * CELL + 8, row * CELL + y_off), frame)


def to_cell(frame32x64: Image.Image) -> Image.Image:
    """legacy 32×64(2x)→ 16×32 最近邻降采样,水平居中贴入 32×32 格。"""
    small = frame32x64.resize((CELL // 2, CELL), Image.NEAREST)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cell.paste(small, (CELL // 4, 0))
    return cell


def synthesize_lie(idle_down_cell: Image.Image) -> Image.Image:
    """legacy 无仰卧帧——由朝下 idle 格内容纵向压扁 50% 合成 lie。"""
    bbox = idle_down_cell.getbbox()
    content = idle_down_cell.crop(bbox)
    w, h = content.size
    squashed = content.resize((w, max(6, h // 2)), Image.NEAREST)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cell.paste(squashed, ((CELL - squashed.width) // 2, CELL - 6 - squashed.height), squashed)
    return cell


def build_premade(src_path: Path) -> Image.Image:
    src = Image.open(src_path).convert("RGBA")
    sheet = Image.new("RGBA", (SHEET_COLS * CELL, SHEET_ROWS * CELL), (0, 0, 0, 0))
    for row, (_, c0) in enumerate(WALK_SRC.items()):        # 行 0-3 walk×6
        for f in range(6):
            paste32(sheet, frame16(src, c0 + f, 1), f, row)
    for i, (_, c0) in enumerate(IDLE_SRC.items()):          # 行 4-7 idle×2
        for f in range(2):
            paste32(sheet, frame16(src, c0 + f * 2, 13), f, 4 + i)
    for i in range(4):                                      # 行 8-11 lie×2(无方向)
        for f in range(2):
            lie = frame16(src, f, 3).crop((0, 0, 16, 14))
            sheet.paste(lie, (f * CELL + 8, (8 + i) * CELL + 12), lie)
    sit_cols: dict[str, tuple[int, int]] = {                # 行 12-15 sit×2
        "up": (SIT_SIDE_SRC["up"], SIT_SIDE_SRC["up"] + 1),
        "left": (SIT_SIDE_SRC["left"], SIT_SIDE_SRC["left"] + 1),
        "down": (SIT_FRONT_COL, SIT_FRONT_COL + 1),
        "right": (SIT_SIDE_SRC["right"], SIT_SIDE_SRC["right"] + 1),
    }
    for row, dir_name in enumerate(("up", "left", "down", "right")):
        c0, c1 = sit_cols[dir_name]
        rp = 9 if dir_name != "down" else 7
        paste32(sheet, frame16(src, c0, rp), 0, 12 + row)
        paste32(sheet, frame16(src, c1, rp), 1, 12 + row)
    return sheet


def build_legacy(src_dir: Path, name: str, family: str) -> tuple[Image.Image, str]:
    full = Image.open(src_dir / f"{name}_32x32.png").convert("RGBA")
    sit_path = src_dir / f"{name}_sit_32x32.png"
    if not sit_path.exists():
        alt = src_dir / f"{name}_sit_2_32x32.png"
        sit_path = alt if alt.exists() else None
    sit_note = "sit源" if sit_path is not None else "sit填充(idle)"
    sheet = Image.new("RGBA", (SHEET_COLS * CELL, SHEET_ROWS * CELL), (0, 0, 0, 0))

    def static_idle(dir_name: str) -> Image.Image:
        return to_cell(full.crop((LEG_STATIC_IDLE_ORDER[dir_name] * CELL, 0,
                                  LEG_STATIC_IDLE_ORDER[dir_name] * CELL + CELL, CELL * 2)))

    if family == "std":
        for row, (dir_name, c0) in enumerate(LEG_WALK_SRC.items()):   # 行 0-3 walk
            for f in range(6):
                paste32(sheet, to_cell(full.crop(((c0 + f) * CELL, 64,
                                                  (c0 + f) * CELL + CELL, 128))), f, row)
        for i, dir_name in enumerate(("up", "left", "down", "right")):  # 行 4-7 idle(静态)
            cell = static_idle(dir_name)
            paste32(sheet, cell, 0, 4 + i)
            paste32(sheet, cell, 1, 4 + i)
        lie = synthesize_lie(static_idle("down"))                      # 行 8-11 lie
        for i in range(4):
            paste32(sheet, lie, 0, 8 + i, y_off=12)
            paste32(sheet, lie, 1, 8 + i, y_off=12)
        if sit_path is not None:                                       # 行 12-15 sit
            sit = Image.open(sit_path).convert("RGBA")
            for row, (dir_name, c0) in enumerate(LEG_SIT_SRC.items()):
                for f in range(2):
                    paste32(sheet, to_cell(sit.crop(((c0 + f) * CELL, 0,
                                                     (c0 + f) * CELL + CELL, CELL * 2))), f, 12 + row)
        else:
            for row, dir_name in enumerate(("up", "left", "down", "right")):
                cell = static_idle(dir_name)
                paste32(sheet, cell, 0, 12 + row)
                paste32(sheet, cell, 1, 12 + row)
    else:  # simple: y0 idle 4f [D,up,L,R] / y64 walk-down 6f(四向复用)
        for row, dir_name in enumerate(("up", "left", "down", "right")):
            cell = static_idle(dir_name)
            for f in range(6):
                paste32(sheet, cell, f, row)
            paste32(sheet, cell, 0, 4 + row)
            paste32(sheet, cell, 1, 4 + row)
        lie = synthesize_lie(static_idle("down"))
        for i in range(4):
            paste32(sheet, lie, 0, 8 + i, y_off=12)
            paste32(sheet, lie, 1, 8 + i, y_off=12)
        for row, dir_name in enumerate(("up", "left", "down", "right")):
            cell = static_idle(dir_name)
            paste32(sheet, cell, 0, 12 + row)
            paste32(sheet, cell, 1, 12 + row)
    return sheet, sit_note


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mi-root", required=True, help="LimeZu Modern Interiors 解压根(mi-win)")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()
    premade_dir = Path(args.mi_root) / "2_Characters/Character_Generator/0_Premade_Characters/16x16"
    legacy_dir = Path(args.mi_root) / "2_Characters/Old/Single_Characters_Legacy/32x32"
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    for slug, num in PREMADE:
        sheet = build_premade(premade_dir / f"Premade_Character_{num:02d}.png")
        sheet.save(out / f"char-{slug}.png")
        sit = sheet.crop((0, 12 * CELL, 2 * CELL, 16 * CELL))
        sit.resize((sit.width * 4, sit.height * 4), Image.NEAREST).save(out / f"preview-sit-{slug}.png")
        print(f"char-{slug}.png 288x512 (premade {num:02d})")

    for name, slug, family in LEGACY:
        sheet, note = build_legacy(legacy_dir, name, family)
        sheet.save(out / f"char-{slug}.png")
        sit = sheet.crop((0, 12 * CELL, 2 * CELL, 16 * CELL))
        sit.resize((sit.width * 4, sit.height * 4), Image.NEAREST).save(out / f"preview-sit-{slug}.png")
        print(f"char-{slug}.png 288x512 (legacy {name}, {note})")

    print(f"完成: {len(PREMADE) + len(LEGACY)} 张 → {out}")


if __name__ == "__main__":
    main()
