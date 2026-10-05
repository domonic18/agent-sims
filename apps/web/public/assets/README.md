# 游戏素材(素材库发布产物)

**M-L.3 起本目录是素材库「发布」产物**(manifest.json + library/*.png),
经后台素材管理「发布到游戏」幂等重建,不入 git;素材源头在
workspace/asset-library + DB(见 design/05-asset-library-design.md)。
裁切脚本已退役;原始素材包不入库,仅保留授权文件与本说明。

全部素材源自 LimeZu「Modern Interiors」与「Modern Exteriors」(https://limezu.itch.io/,
付费完整版 16x16;同类免费版见 https://limezu.itch.io/moderninteriors 与
https://limezu.itch.io/modernexteriors)。授权条款允许商用与二次修改,
**必须署名**且不得单独转售素材本体(详见 LICENSE.txt)。

## 产物结构

- `manifest.json`: 素材清单(协议见 @sims/shared asset-manifest)
- `library/{slug}.png`: 全部 active 素材(纹理 key=slug)
- 首批 54 件:tile×30/props×4/家具×14/角色表×6(裁切契约与来源细节见 git 历史及 workspace 库内 source 字段)
