# 像素素材选型调研(Spike②)

> 调研日期: 2026-10-03
> 状态: **已被取代(2026-10-05)**——初版选型 Kenney+LPC 已于 M3.7 全套替换为 LimeZu 完整版(已购,可商用需署名),现状与裁切契约见 public/assets/README.md;本文保留作调研过程记录
> 原结论(时点快照): 地图 tile 用 Kenney(CC0),角色 sprite 用 Universal LPC Spritesheet Generator
> 关联: development-plan M1 Spike② / M2.6 前端渲染+素材

## 1. 需求回顾

- 像素风模拟人生: 需要城镇地图 tile(地形/道路/建筑)+ 角色四方向行走动画
- 约束: 开源免费可商用(M2.6 要真实渲染入库,素材许可必须干净)
- 规模: M2.2 约 6~8 场所;角色数个(player + NPC),M6 后 NPC 增至 10+

## 2. 调研范围

主阵地为 itch.io / OpenGameArt / Kenney 官网。筛选标准: 许可明确(CC0 优先)、风格统一、tile 尺寸规整(16×16 或 32×32)、含角色行走帧。

## 3. 结论

### 3.1 地图 tile: Kenney(CC0)✅

- **首选: Roguelike/RPG Pack** — 约 1700 个 16×16 tile,含 overworld 地形、道路、城镇建筑/室内家具,风格统一,完全 CC0
- 备选: RPG Urban Pack(城市主题,亦 CC0)
- Kenney 全站素材均 CC0(无需署名),许可零风险;后续加素材可继续在同系列内取,风格不跳

### 3.2 角色 sprite: Universal LPC Spritesheet Generator ✅

- 在线工具(liberatedpixelcup.github.io),拼装身体/发型/服装等图层后导出整张 spritesheet
- 导出规格: 32×32 / 64×64,四方向(down/left/right/up)walk 循环 4~9 帧——直接满足 M2.3 路径插值渲染与 M2.6 行走动画
- **许可注意(逐层)**: 工具本身 GPL3(不影响产出素材);美术图层许可不一,含 CC0 / CC-BY / CC-BY-SA 3.0 / OGA-BY
  - 选图层时优先 CC0/CC-BY 图层,规避 CC-BY-SA 的 ShareAlike 传染
  - 导出时自带 `credits.txt`,**必须随素材一起入库归档**(放 `apps/web/public/assets/credits/`)
- 多角色方案: 不同角色换发型/服装/发色图层组合生成,天然区分 NPC

### 3.3 落地约定(M2.6 执行)

1. 素材入 `apps/web/public/assets/`(tile 与 spritesheet 分目录),原始 zip 不入库、只入库表图与裁切后文件
2. LPC `credits.txt` 原样归档,Kenney 素材在 README 注明来源与许可
3. 帧配置(帧数/帧序/锚点)写进前端 assets 清单常量,不硬编码散落各处
4. 尺寸: 角色用 32×32(16×16 tile 下视觉比例合适),如实测偏大再降采样

## 4. 对计划的影响

- M2.6 的"接入 Spike② 素材"可直接执行,无需再调研;todo 中"favicon/缺图占位"可顺手用 Kenney tile 解决
- 无新增里程碑或依赖变更

## 5. 参考

- Kenney: https://kenney.nl (Roguelike/RPG Pack、RPG Urban Pack,均 CC0)
- OpenGameArt(备选池): https://opengameart.org
- itch.io 免费像素资产(备选池): https://itch.io/game-assets/free/pixel-art
- Universal LPC Spritesheet Generator: https://liberatedpixelcup.github.io/Universal-LPC-spritesheet-character-generator/
