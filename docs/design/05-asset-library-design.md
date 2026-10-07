# 素材库与素材管理设计

> 创建日期: 2026-10-05 · 对应需求基准 v1.5 §2.8
> 背景: v1.5 前素材经裁切脚本从素材包大表按坐标"盲裁"入库,无可视化校验闭环,床/冰箱/工作站三件因坐标跨在素材拼缝上错位返工(提交 923bef9)。本设计以「管理侧源头治理 + 可视化校验 + 发布链路解耦」根治该问题,并为建筑升级(演进①)与末日生存(演进②)预留素材域扩展。

## 1. 目标与非目标

**目标**
1. 全部游戏素材(户外 tile/家具/建筑件/角色)经素材库统一管理:树形分类、增删改查、放大校验
2. 批量导入为主(LimeZu Theme_Sorter_Singles 单件目录,数千件) + 手动上传为辅
3. 元数据支撑 PCG 整图随机(06-worldgen-design.md 消费)与两演进(tier/domain)
4. 发布链路:库 → 游戏侧 manifest+产物,运行时零解析开销

**非目标**
- 素材编辑/绘图(仅管理既有素材,不自绘——需求 §7)
- 运行时动态从 DB 加载素材(游戏只消费发布产物,保证前端零依赖与加载性能)
- 素材包版权管理自动化(授权文件人工维护,见 public/assets/README.md)

## 2. 数据模型

新增 `asset` 域两张表(schema 入 apps/server/src/db/schema/asset.ts,迁移 forward-only):

### asset_categories(分类树)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial PK | |
| parent_id | int FK→asset_categories | 根为 null;树深固定三层 |
| level | int | 0=domain / 1=theme / 2=kind |
| name | text | 如 户外/卧室/床 |
| slug | text unique | 稳定标识(outdoor/bedroom/bed),PCG 规则引用 |
| sort_order | int | 树内排序 |

层级语义: **domain(域)** outdoor 户外 / indoor 室内 / character 角色 / survival 生存(演进②预留,空) → **theme(主题)** bedroom 卧室 / kitchen 厨房 / gym 健身房 / terrain 地形 / building 建筑件… → **kind(类别)** bed 床 / sofa 沙发 / tree 树…。kind 与现有 FurnitureKind 对齐,新增 kind 需评审占地/锚点语义。

### assets(素材)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial PK | |
| category_id | int FK→asset_categories | 挂在 kind 层(或 theme 层兜底) |
| name | text | 展示名(可重名,如 "床·红被") |
| slug | text unique | 库内稳定标识(bed-red-quilt) |
| file_path | text | 原始文件相对路径(库存储根下) |
| source | text | 来源标注(limezu-mi-singles-0331 / manual-upload),署名溯源 |
| width / height | int | 像素尺寸(导入时自动提取) |
| grid_w / grid_h | int | 占地格数(默认按尺寸/16 取整,人工校准) |
| anchor | text | 渲染锚点(bottom-center 默认 / custom) |
| anim_config | jsonb | 角色表等动画素材的帧配置(列数/行分组/fps),tile 类为 null |
| tier | int default 1 | 等级(演进①:床 lv1→lv3,默认 1) |
| tags | text[] | 自由标签(风格/颜色/材质,PCG 过滤维度) |
| status | text | draft(导入未校验) / active(启用) / retired(下架) |
| checksum | text | 文件 sha256,导入去重 |

**索引**: category_id、status、slug 唯一、checksum。

### 库存储

- 库根目录 `workspace/asset-library/`(bind mount,随 workspace 备份),按 `domain/theme/kind/` 分目录存放原始 PNG
- 批量导入脚本(**导入器**,server scripts/): 扫描素材包单件目录 → checksum 去重 → 自动提取尺寸/来源 → 建分类(已存在则复用) → 落盘+入库(status=draft)
- 手动上传:后台表单(multipart)→ 同一张表,source=manual-upload

## 3. 管理界面(admin /admin/assets)

- **左树右表布局**: antd Tree(三级分类,右键/操作列增删改分类) + Table(素材列表:缩略图/名称/尺寸/占地/tier/状态/标签筛选)
- **放大校验(核心)**:
  - 素材详情抽屉:像素级放大预览(image-rendering: pixelated + 缩放滑杆 1x~16x + 九宫格参考线),**点击表格行即预览**
  - 角色表类素材:按 anim_config 切帧网格**逐帧查看**(复用前端现有帧切分逻辑,做成通用 SpriteInspector 组件)
  - 校验动作:draft → active(启用)/ retired(弃用),支持批量勾选启用
- **元数据编辑**:占地/锚点/tier/tags/动画配置表单;name 可改,slug 不可改(PCG 引用)
- **发布**:工具栏「发布到游戏」按钮 → 调发布 API(见 §4)→ 返回产物 manifest 版本号

## 4. 发布链路(库 → 游戏)

```
asset library (DB + workspace/asset-library)
        │  发布(管理侧动作,全量或按域)
        ▼
apps/web/public/assets/library/        # 拷贝 active 素材文件(带 slug 命名)
apps/web/public/assets/manifest.json   # 元数据清单(分类/尺寸/占地/tier/anim/urls)
        ▲
渲染层 assets.ts 静态 registry 改为消费 manifest 构建
```

- manifest 含 categories 树 + assets 数组(仅 active);发布是**幂等重建**(产物目录整体重新生成,无增量状态)
- 渲染层启动时 fetch manifest 构建 registry(tile 条带仍是裁切产物——**裁切脚本退役**,tile 由发布器从库内 tile 素材拼条带)
- 世界生成(worldgen)在 server 侧同样读 manifest 做布局决策,双端共用(@sims/shared 定义 manifest Zod schema,单一真相源)
- **方向变体(-b 后缀)约定(2026-10-07 家具朝向系统)**: 同 kind 池内 slug 以 `-b` 结尾的件为**背面视角**(如 indoor/sofa 池的 sofa 正面/sofa-b 背面,双份 manifest 均已入池);worldgen 按家具 facing 定向选材——facing=north(贴南墙、镜头看到背面)时 -b 件优先,其余 facing 排除 -b 件,池过滤后为空回退整池。新导入方向变体素材须沿用该命名约定

## 5. 关键决策

| 决策 | 理由 |
|------|------|
| 库存储用文件系统+DB 元数据,不入库 BLOB | PNG 文件大,文件系统天然支持流式预览与 rsync 备份 |
| 发布为幂等重建而非增量 | 避免库与产物状态漂移;产物可再生,库是唯一真相源 |
| slug 不可变 | PCG 规则与 manifest 引用稳定性 |
| status 三态(draft/active/retired) | 批量导入后必须人工校验启用——可视化校验闭环的制度化 |
| tier 默认 1 且本期不消费 | 演进①远期,仅落字段避免后补迁移 |
| manifest 入 @sims/shared Zod | 双端(worldgen/渲染)单一协议,防漂移(项目惯例) |

## 6. 与两演进的衔接

- **演进①(建筑/物品升级)**: kind 内按 tier 组织素材(bed tier1/2/3);升级玩法消费 tier 检索可用素材,渲染层按 tier 换精灵;经济侧花费金币触发升级事件 → world 层替换家具实例
- **演进②(末日生存)**: survival domain 开放后批量导入僵尸/武器/建材/庇护所组件;PCG 生存模式布局(安全区/资源点/刷怪点)从该域取材

## 7. 分阶段落地(对应 development-plan M-L.1~M-L.3)

1. **M-L.1 库与导入器**: asset 域 schema+迁移、库存储、批量导入脚本、manifest 生成器
2. **M-L.2 管理界面**: 树形 CRUD、放大校验(SpriteInspector)、元数据编辑、发布按钮
3. **M-L.3 渲染层对接**: assets.ts registry 改造消费 manifest、tile 条带由发布器生成、现有 30 帧 tile+15 家具+6 角色迁入库并发布验证(等价替换,渲染结果不变)

## 8. 风险

- **LimeZu Singles 无语义文件名**(编号命名): 导入器按目录名建 theme、按尺寸聚类辅助分组,kind 归属靠人工校验归类(放大预览正是为此);首批仅导入游戏在用 15 类家具+户外件,不全量导入数千件,控制校验成本
- **发布产物体积**: manifest 只含 active 素材,首批规模小无虞;后续大库时按域分 manifest
- **角色表导入**: premade 角色表是大表非单件,anim_config 承载行对结构知识(见 public/assets/README.md 备查的行对布局),作为单条素材入库
