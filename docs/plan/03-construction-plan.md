# 03 建造系统细案(M-S/S2,2026-10-12 立项)

> 上游: plan/01 M-S 生存线;plan/02 GameModeProfile 闸门(已完成,S2/S3 扩展点就绪)。
> 设计依据: design/07-survival §7(S2 合成与制造/庇护所建造)、design/04(数值待补 §5.6)、design/09(M-G.6 生产引擎先例)。
> 用户定稿六决策见 §1;塔防建筑不进 S2(归 S3 与僵尸同批),仅蓝图注册表预留类型位。

## 1. 定稿决策(2026-10-12,用户)

| # | 决策 | 内容 |
|---|------|------|
| 1 | 产物形态 | 基础图 TileMapDefinition 永不改;**建筑类**走声明式建造层(快照/存档持 `built`,运行时合并展开);**结构类**(围栏/塔防/庇护所)同层轻量记录 |
| 2 | 触发 | 建造由 agent 进行:选区域→收集材料→按建造图纸施工,耗原料+工时;图纸内容含现有地图全部建筑及建筑内物品(=18 类 PlaceKind 全目录,分期开放) |
| 3 | 共享仓储 | 镇核心单仓(世界级库存,物理实体落镇核边缘) |
| 4 | 资格门槛 | 建筑后续分级(level),不同级别不同知识门槛;门槛可在世界参数中开/关(方便调试) |
| 5 | 报酬 | 建造按单入账(work_task 式:接单→施工→完成按单发薪) |
| 6 | 范围 | 先开子集(home/cafe/shop/fence)再扩全量;塔防归 S3 |

## 2. 架构总览

```
基础图 config.map(永不改)                    世界运行时(sim 持有)
┌─────────────────────┐   合并(纯函数)   ┌──────────────────────────────┐
│ TileMapDefinition   │ ◄────────────── │ built: BuiltState            │
│ (worldgen/地图库)    │                 │   places: PlaceDefinition[]  │
└─────────────────────┘                 │   fences: FenceRect[]        │
          │                             │ constructionSites: Site[](在建)│
          │ setMap(merged)              │ storage: Record<item,n>(单仓) │
          ▼                             └──────────────────────────────┘
TileMap.fromDefinition(merged)——阻塞层/锚点/围栏格全部按合并图重建
          │
          ├─ sim.map:可行走/活动锚点/家具判定天然含 built 建筑与围栏
          └─ GET /api/world/map 返回合并定义→web terrain 现有路径免费渲染 built
```

- **同源校验**: 建造前 `validateMapDefinition(merged)` + 入口连通 BFS(shared 新助手,双端同源)——AI 改图/编辑器/建造三入口同一门禁。
- **持久化**: SimulationArchive 增 `built/constructionSites/storage` 三字段(旧档缺省回空,兼容);恢复链 reset→attachBase(config.map)→setMap→restoreArchive(重放 built 再合并)。
- **模式中立**: 蓝图带 `gameTypes` 门控,v1 全部 `['survival']`;引擎零 gameType 分支(plan/02 纪律)。

## 3. shared 契约(新建 `packages/shared/src/construction.ts`)

```ts
BuildBlueprint {
  id: string;                    // 'build_home' | 'build_cafe' | 'build_shop' | 'build_fence'
  kind: 'place' | 'fence';       // 塔防未来扩 'tower'
  label: string;
  gameTypes: GameType[];
  level: number;                 // 建筑分级预留,v1 全 1
  requiredKnowledge: number;     // 建造类门槛基线(JOB_CATEGORIES.build=6)
  materials: Record<string, number>;   // itemId→数量(wood/stone/metal)
  durationMinutes: number;       // 工时(fence 按格数推导)
  wage: number;                  // 按单入账(fence 按格数推导)
  placeKind?: PlaceKind;         // place 类:家具/门/入口由 server PLACE_BLUEPRINTS 盖章
  size?: { w; h };               // place 类占地
}
BUILD_BLUEPRINTS: BuildBlueprint[]            // v1 子集四条,均 ['survival']
constructionBlueprints(gameType): BuildBlueprint[]

BuiltState { places: PlaceDefinition[]; fences: FenceRect[]; nextPlaceSeq: number }
ConstructionSite { id; blueprintId; x; y; w; h; createdAtGameMinute }
definitionWithBuilt(base, built): TileMapDefinition   // 纯合并:places/fences 拼接,id 前缀 built-
validateBuildPlacement(base, built, rect): MapIssue[] // 越界/压场所/压路/压阻塞/压资源;入口可达 BFS
entrancesConnected(definition): boolean               // 多源 BFS(自 health.ts 上提共享)
```

- `sync.ts`: WorldSnapshotMessage 增 `constructionSites: ConstructionSite[]`、`storage: Record<string, number>`、`storageSpot: {x,y} | null`(批2)。
- `intents.ts`(批2): 第 15 意图 `build` `{blueprintId, x, y, w?, h?}`;`store_item/take_item` 增可选 `target: 'fridge'|'storage'`(缺省 fridge,向后兼容)。
- `sys-config.ts`(批3): field type 扩 `'boolean'`,新增 `CONSTRUCTION_KNOWLEDGE_GATE`(默认 true)与 `CONSTRUCTION_TIME_SCALE`(工时倍率,默认 1)。

## 4. server 契约(新建 `apps/server/src/world/construction.ts`)

- Simulation 增字段: `builtPlaces/builtFences/nextPlaceSeq`(BuiltState 展开)、`constructionSites: Map<string, ConstructionSite>`、`storage: Record<string, number>`、`storageSpot: {x,y}|null`(townCore 底边中点派生,批2)、`baseDefinition`(attachBase 注入,与 map.definition 解耦)。
- `applyBuilt(sim)`: `sim.setMap(definitionWithBuilt(base, built))`——建造完成/撤销唯一落地点(fromDefinition 构造即校验,坏图直接抛)。
- serialize/restoreArchive: 三字段入档/回放;`worlds-create.ts` 与 `restoreLatestArchive` 接 `attachBase(config.map)`。
- `requestBuild`(批2,仿 craft.ts): 蓝图解析(gameType 门控)→知识门槛(参数开关)→选区校验(含围栏连通 BFS)→单仓材料预检→扣料建 site(材料锁定)→发 `construction.placed`;施工走 work_task 式(接单/寻路/到位计时/按单入账),中断=退料销单无薪(诚实原则同 craft);完成钩子: site 移除→built 追加→applyBuilt→发薪→`construction.completed` 事件。
- 单仓: `deposit/withdraw`(批2)体积上限 `STORAGE_VOLUME_LIMIT`(默认 200,批3 入参数目录);store_item/take_item 按 target 分流,storage 交互须站实体四邻(同 work_task 站格判定)。
- debug 端点(批1,仅 NODE_ENV=development): `POST /debug/built`(place/fence/remove,走完整校验链)、`POST /debug/storage`(注料,走查用)。

## 5. web 契约(批2)

- ActionBar 加「建造」同级菜单(蓝图子集: 名称/材料/工时/门槛,不合格置灰);Lab 加 build 表单。
- 选区交互(无先例,新写): 建造模式下点选蓝图→画布拖矩形(place 类单击落默认尺寸)→幽灵预览绿/红(validateBuildPlacement 前端同源调用)→确认发 intent;DRAG_THRESHOLD 区分点击/拖拽(WorldScene 先例)。
- 渲染: `construction-view.ts` 仿 maintenance-view(脚手架色块+进度,depth 7);built 建筑= terrain 现有路径(启动拉合并图);`world.map_changed` 事件→前端 refetch `/api/world/map`→terrain 清层重绘;storage 实体 InspectCard 存取 UI。
- worldStore: applySnapshot 全量覆盖,新字段自动携带(零改动);setMap 需同步 registry('map')。

## 6. 批次与验收

| 批 | 内容 | 验收抓手 |
|---|------|----------|
| 批1 建造层地基 | shared construction.ts(BUILD_BLUEPRINTS 子集/合并/选区校验/连通 BFS)+server 状态与存档接线+applyBuilt+debug 端点+`/api/world/map` 合并输出 | 单测: 合并纯度/选区拒绝矩阵/连通 BFS/存档 round-trip;dev 走查: debug 建 home→角色可进门用床(锚点生效),围栏封门被 BFS 拒绝 |
| 批2 建造流程 | build 意图+requestBuild+施工工单+单仓存取+storage 实体+web(建造菜单/选区/施工渲染/存取 UI/Lab) | qa 走查: 采木→入仓→选区建 home→扣料→接单施工→按单入账→建筑落地可进入;材料不足/门槛不足/压物选区全拒绝;中断退料 |
| 批3 数值与收尾 | design/04 §5.6 数值表定稿+世界参数(门槛开关/工时倍率/仓容)+蓝图扩容(分级)+走查清单 docs/qa+design/07 §7 收账+plan/01 入册 | 数值走查+参数开关生效(关门槛后 0 班可建)+蓝图扩容冒烟 |

**数值初稿**(批3 调): build_home 5×4 木12石8金4/480分/60币;build_cafe 4×3 木10石6/360分/48币;build_shop 4×3 木8石8金2/360分/48币;build_fence 每格木1/(15+6×格数)分/2币×格数。

## 7. 边界与非目标

- 塔防(攻击数值/索敌/动画)= S3 与僵尸同批;蓝图注册表仅留 `kind` 扩展位。
- 建筑拆除/升级/耐久损耗 v1 不做(built 记录留 level 字段位)。
- growth 模式 v1 无建造(蓝图 gameTypes 门控);引擎不写 gameType 分支。
- 基础图(地图库/编辑器/AI 改图)与建造层彻底分离:编辑器改的是 draft 蓝图,建造改的是世界运行时,互不越界。
- **部署注记**: 批1~2 为 server/shared 改动,走查一律在 dev(:3100);生产 app 容器承载 E7E8 复验镇运行态,未经用户确认不重启;web 容器随批2 一并重建。
