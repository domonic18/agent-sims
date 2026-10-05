# 游戏素材(裁切后入库)

运行时只加载本目录的裁切产物;原始素材包不入库,仅保留授权文件与本说明。

全部素材裁切自 LimeZu「Modern Interiors」与「Modern Exteriors」(https://limezu.itch.io/,
付费完整版 16x16;同类免费版见 https://limezu.itch.io/moderninteriors 与
https://limezu.itch.io/modernexteriors)。授权条款允许商用与二次修改,
**必须署名**且不得单独转售素材本体(详见 tiles/LICENSE.txt)。

## tiles/tiles.png(30 帧,510x16)

- 来源:Modern Exteriors `1_Terrains_and_Fences / 3_City_Props`(草地/路径/水岸/栅栏)
  + Modern Interiors `Room_Builder`(地板 ×6 / 墙 ×6)
- 裁切:16px tile 以 1px 间距横排(防止 NEAREST 采样渗色);
  索引见 `src/game/assets.ts` 的 `TILE_FRAME`

## props/*.png(树/灯 4 张)

- 来源:Modern Exteriors `3_City_Props_16x16.png`,按内容 alpha 收边;
  渲染时底边中心锚定格底(竖高精灵向上延伸)

## furniture/*.png(家具 15 张)

- 来源:Modern Interiors `Theme_Sorter`(Bedroom/LivingRoom/Classroom/
  Gym/Kitchen)与 Exteriors 城市件,按 alpha 收边;
  与 `@sims/shared` 的 `FurnitureKind` 一一对应,底边中心锚定占地底边

## character/char-*.png(6 套配色变体,288x384)

- 来源:Modern Interiors `2_Characters/Character_Generator/0_Premade_Characters/16x16`
  (premade 03/05/08/12/16/19 → green/purple/beige/red/white/blue)
- 源表 896x656(56 列 × 41 行),动画按"行对"组织(发顶行+身体行),
  裁切窗口 16x27(`(col*16, T*16+5)` 起),贴入 32px 帧 (8,5):
  - rows 0-3 行走 ×6 帧(T2:up/left/down/right)
  - rows 4-7 待机 ×2 帧呼吸(T26)
  - rows 8-11 躺卧 ×2 帧(T6,无方向;源表无坐姿,rest 以躺卧帧呈现)
- 帧配置见 `src/game/assets.ts` 的 `CHARACTER`
