# 游戏模式封装性重构计划(GameModeProfile)

> 创建日期: 2026-10-07
> 依据: M-S/S1.5 收尾后的封装性评估(2026-10-07 会话;对应 CLAUDE.md §3 CodeReview「封装性」条目)
> 定位: **M-S/S2(建造)与 S3(僵尸波次)开工前的技术债闸门**——S3 的波次调度挂接点直接受益
> 规模: M(约 2 个工作日,六提交)

## 1. 背景与问题

数据驱动的注册表体系(GATHER_TASKS/NODE_MAX_CHARGES/配额表/DECOR_POOLS/SYS_CONFIG_FIELDS)是既有封装强项——加内容零逻辑改动。但**模式差异以 `gameType === 'survival'` 裸字面量分支散布 7 个文件 21 处**:

| 位置 | 处数 | 差异内容 |
|---|---|---|
| worldgen/generate.ts | 13 | 配额切换/镇内核心/镇界围栏/野簇/资源落点/装饰 pass |
| world/simulation.ts | 4 | 健康 tick(simulation.ts:411)/重伤判定(554/559)/苏醒语义(586) |
| world/character.ts | 1 | applyHealthTick/injuryWake(character.ts:123) |
| 协议透传(admin-api/worlds.ts、api/debug.ts、snapshot.ts) | 3 | gameType 注入/校验/快照(合法保留) |

**后果**: 新增第三种模式(僵尸围城/和平花园等)= 逐处理解并修改全部分支;S3 只能继续往 `_stepCharacters` 塞 if,分支继续发散。

## 2. 目标与非目标

**目标**:
1. 模式差异收敛为**注册一个 profile 即新增模式**——worldgen/simulation/character 主干零 gameType 字面量
2. worldgen 管线化: generate() 的 pass 序列由 profile 声明(现有 18 个函数即天然 pass 边界)
3. growth/survival 同种子地图**逐字节不变**(rng 流零变化)

**非目标**:
- 不新增任何玩法/数值(纯等价重构)
- 不做 BALANCE 实例化(R5,见 §6 搁置条件)
- 不扩 GAME_TYPES 协议枚举

## 3. 方案总览

新增 `apps/server/src/world/game-mode.ts`(profile 类型+注册表;web 无消费需求,不进 shared):

```ts
export interface GameModeProfile {
  id: GameType;
  /** worldgen 差异 */
  worldgen: {
    quota: ReadonlyArray<QuotaRow>;
    townCore: boolean;      // 镇内核心+镇界围栏(survival on)
    wildClusters: boolean;  // 森林/岩石簇 pass(survival on)
    wreckDecor: boolean;    // 废土装饰 pass(survival on)
  };
  /** 资源落点: kind → 目标区域解析(forests/rocks/ruins/parks/streets),含计数档 */
  resourcePlacement: Record<ResourceNode['kind'], PlacementRule>;
  /** 模拟层规则 */
  sim: {
    healthTick: boolean;            // 生存健康数值(growth off)
    healthZeroToInjury: boolean;    // 健康归零→重伤休整而非死亡
    injuryWakeToRecoverLine: boolean;
  };
}
export const GAME_MODE_PROFILES: Record<GameType, GameModeProfile>;
```

- 既有 SURVIVAL_QUOTA/GROWTH_QUOTA、buildTownCore/townFences/buildWildClusters 等函数**原样复用**,只是改由 profile 编排
- Simulation 持有 profile(setMap 同期注入,reset 回 growth profile);gameType 字段保留(协议/快照需要),但分支判定一律查 profile
- 完整性测试: 每个 GAME_TYPES 成员必有 profile;演练测试注册 sandbox 假 profile 证明主干零改动即出图

## 4. 提交序列(每提交过门禁)

| # | 类型 | 内容 |
|---|---|---|
| R0 | test | **特征化快照先行**: growth/survival 各取 10 个固定 seed,对 TileMapDefinition 做稳定哈希断言——重构防回归保险 |
| R1 | refactor(server) | GameModeProfile 落地: 注册表+generate/simulation/character 改查 profile;`'survival'` 字面量收敛至 profile 注册处+协议透传 |
| R2 | refactor(server) | worldgen 管线化: generate() 改声明式 pass 列表(profile 提供),逐 pass 等价改造,依赖 R0 快照全绿 |
| R3 | refactor(server) | 装饰池声明归位: DECOR_KINDS 映射+限宽规则从 admin-api/worlds.ts:136-144 挪入 blueprint.ts(与 DECOR_POOLS 同文件),worlds.ts 只读 |
| R4 | refactor(web) | ActionBar.tsx:212-223 硬编码任务清单改注册表遍历(与 InspectCard.tsx:185 同源) |
| — | docs | development-plan 变更记录+本文件状态更新 |

## 5. 验收标准

1. R0 特征化快照全绿(重构前后同 seed 图逐字节一致,growth+survival 双模式)
2. **封装金标准**: 测试内注册 sandbox 第三模式 profile → worldgen/simulation 主干零改动可出图、可跑 tick
3. `grep "'survival'"` 非测试代码 ≤5 处(仅协议透传+profile 注册)
4. 门禁全绿;容器双模式走查(growth 对照+survival 镇内外结构)
5. web 除 R4 外零改动

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| rng 消耗流被管线化破坏 → 同 seed 图变 | R0 快照先行+逐 pass 等价改造;growth pass 列表必须复现现有调用顺序 |
| profile 变新单体(差异全塞进去) | 只收敛**已存在**的两类差异(worldgen 开关+落点、sim 健康规则);新差异出现时再扩字段 |
| 演练模式泄漏到协议 | sandbox 仅测试代码注册,GAME_TYPES 枚举不扩,zod 校验天然拒绝 |

## 7. 搁置项(触发条件再启)

- **R5 BALANCE 实例化**(BalanceState 注入 Simulation 替代进程级单例,`balance.ts:207`): 仅当立项「多世界并存对照不同策略」时启动;单世界语义下现有自洽,现在动是过度设计

## 8. 排期建议

S2 开工前串行插入(规模 M);完成判据=§5 全绿。S3 僵尸波次的波次调度器/夜袭结算以 profile.sim 新增字段挂接,镇界围栏 `fenceTiles()` 已备好防线数据。
