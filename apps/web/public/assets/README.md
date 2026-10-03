# 游戏素材(裁切后入库)

运行时只加载本目录的裁切产物;原始素材包不入库,仅保留授权文件与本说明。

## tiles/tiles.png

- 来源:Kenney「Roguelike/RPG pack」(https://kenney.nl/assets/roguelike-rpg-pack)
- 授权:CC0(见 tiles/LICENSE.txt)
- 裁切:原表 `Spritesheet/roguelikeSheet_transparent.png`(968x526,16px tile / 17px pitch),
  选中的 13 个 tile 以 1px 间距横排;索引见 `src/game/assets.ts` 的 `TILE_FRAME`

## character/walk.png

- 来源:LPC 通用角色生成器(https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator),
  默认 male / light / neutral 配置导出的整表
- 授权:见 character/credits.txt(生成器导出的 credits 原样归档)
- 裁切:原表 rows 8-11(行走循环,方向序 up/left/down/right)× 9 帧 64px,BOX 50% 缩至 32px,
  得 288x128 紧凑表(4 行 × 9 列);帧配置见 `src/game/assets.ts` 的 `CHARACTER`
