# 游戏素材(裁切后入库)

运行时只加载本目录的裁切产物;原始素材包不入库,仅保留授权文件与本说明。

## tiles/tiles.png

- 来源:Kenney「Roguelike/RPG pack」(https://kenney.nl/assets/roguelike-rpg-pack)
- 授权:CC0(见 tiles/LICENSE.txt)
- 裁切:原表 `Spritesheet/roguelikeSheet_transparent.png`(968x526,16px tile / 17px pitch),
  选中的 13 个 tile 以 1px 间距横排;索引见 `src/game/assets.ts` 的 `TILE_FRAME`

## character/char-*.png(6 套配色变体)

- 来源:LPC 通用角色生成器素材仓库(https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator)
- 图层:body(肤色)+ hair/bob(发型)+ legs/pants(长裤)+ torso/aprons/overalls(背带工装)+ feet/shoes2(便鞋),
  变体间替换发色/裤色/工装色/鞋色/肤色
- 授权:OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 / CC0(逐层明细见 character/credits.txt)
- 裁切:各层 64px 帧按 (0,0) 叠加到 832x2944 通用表,取 rows 8-11(行走 9 帧)/ rows 22-25(待机,
  运行时取前 2 帧呼吸循环)/ rows 30-33(坐姿,取前 2 帧),方向序 up/left/down/right,
  BOX 50% 缩至 32px,得 288x384(9 列 × 12 行);帧配置见 `src/game/assets.ts` 的 `CHARACTER`
