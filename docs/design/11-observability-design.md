# agent-sims 观测性设计(Observability Design)

> 本文档是 **agent 决策链观测面**的设计权威:决策 trace 完整化、want 全生命周期追踪、追溯 API 与后台可视化面板。
> 出发点(用户 2026-10-10 定稿): ①后台可视化看到单个 agent 清晰的**决策与执行过程**;②后台提供**完整日志记录**,取代「手写 SQL→拷贝→肉眼看」的排障流程;③做完后重建新世界做验证。
> 关联: 01-agent-design(认知周期)、10-cognition-design(认知分层)、02-goal-design(want 产欲)。

## 1. 设计原则

1. **trace 是观测面,不是控制面**: 任何 trace 落库失败只记技术日志,绝不阻塞认知泵(trace.ts fire-and-forget 既有铁律延续)。
2. **一张 want 从生到死可追踪**: wantId 是贯穿产欲→仲裁→执行→结算的唯一追踪键,任何一环缺失即观测断层。
3. **仲裁必须留痕**: wantSelect 是唯一执行仲裁器,候选集、评分、胜负理由(select/对抗 seize/incumbent/energy)全量落 trace——「为什么做这个而不是那个」是排障第一问。
4. **按世界隔离**: 三张观测表(cognition_trace/world_events/token_usage)均带 world_id,跨世界数据不混淆,旧世界 paused 后数据仍可按 world_id 检索。
5. **零新依赖**: 面板复用 admin chunk 已有的 antd(Timeline 为内置组件),游戏界面不引 antd。

## 2. 决策链六步 × trace 覆盖矩阵

认知周期(agent-design §4.6)六步,每步的 trace 形态与落点:

| 步骤 | layer | trigger | conclusion | 关键字段 | 落点 |
|------|-------|---------|------------|----------|------|
| ① 节拍感知 | — | threshold/eventbus | — | perception.block(当前块) | 采样行随各层带出 |
| ② 事件分级 | triage | eventbus | continue/react | gate(g1_irrelevant 等)/event | assessInterrupt/响应链 |
| ③ 产欲(四源) | rule/plan/jev/triage | 各源 | react | gate=drive_want/event_want/impulse + wantId | driveStep/writeEventWant/writeImpulse(plan 源晨间批量写入无独立行,生成明细以晨间 slow trace 的 perception.generated 留痕,见 §3) |
| ④ 唯一仲裁 | **select** | 随调用方 | react | **candidates[]{id,origin,urgency,score,reject}** | wantDecision(wantSelect debug 出参) |
| ⑤ 执行 | plan/rule | 同上 | react/continue | intent/bubble/rejectReason(执行回执);**continue 行带 reason(15 出口枚举)** | apply 出口/chatWith 分支 |
| ⑥ 结算 | plan | eventbus | continue | want.id+reason(done/abandoned/pending) | settleWant/settleSocialChat |

**采样策略**: react/select 全量(低频高价值),continue 按 RULE_CONTINUE_SAMPLE 采样(summon_wait 等常态等待另行采样 SOCIAL_WAIT_TRACE_SAMPLE)。4 倍速 4 角色 volatile 量级约数千行/游戏日,可控。

**continue reason 枚举**(执行层 15 出口,落 decision.reason,面板映射为中文 Tag): energy_gate(体力闸)/drive_channel_gone(驱力通道消失)/drive_satisfied(驱力已满足)/drive_stuck(驱力受阻废弃)/rescue_gone(救援已消失)/rescue_done(救援已达成)/target_missing(目标不在)/chat_generating(对话生成中)/summon_awaiting(召唤待应答)/chat_cooldown(聊天冷却中)/no_explore_target(无探索目标)/node_depleted(节点已采空)/craft_no_place(无制作台)/backpack_empty(背包空)/no_spot(无处可去)。continue trace 行同步透传 wantId——「哪个 want 连续 continue」是空转识别的钥匙。

## 3. wantId 关联模型

- **want 四态**: pending(想做)→doing(进行中)→done(已完成)/abandoned(放弃);中断/被打断回 pending 重评。
- **freshWantId**: `w{day}-{前缀}{gameMinutes}[-n]`,前缀 f=plan/d=drive/j=impulse/e=event/s=summon(召唤)。**已知偏差**: 晨间计划批量生成的 want 用短格式 `w{day}-{序号}`(非 freshWantId 全形),按 wantId 过滤时两种形态都会出现。
- **晨间产欲留痕**: plan 源 wants 批量写入不逐条落产欲 trace,生成明细(id/activity/urgency/why)记在晨间 slow trace 的 `perception.generated`——LLM 编了什么戏一眼可见,与后续执行失配即产欲质量问题。
- **透传链**: 产欲写入时 trace 带 wantId → select 仲裁 trace 带 wantId → apply 执行 trace 带 wantId(decision.wantId)→ settleWant/settleSocialChat 结算 trace 带 wantId → social-loop 召唤/等待/走散 trace 带 wantId。已知 wantId 的记录点全部补齐;拿不到的(summonDropped 等 continue 行)留空。
- **wantSelect debug 出参**: 第 8 参 `debug?: {candidates}`,incumbent 裁决后一次填充全部候选评分(score 三位小数;reject ∈ seize 分差不足/incumbent_lost/score/energy),不改动 ~20 个 return 点的契约。

## 4. 数据面

- **迁移 0019**(全列 nullable 向后兼容): cognition_trace +world_id(uuid FK set null)+want_id(text)+索引 `(world_id,character_id)`/`(want_id)`;world_events/token_usage 各 +world_id+索引;存量行按 characterId JOIN characters 回填 world_id(无 characterId 的系统级行留 null)。
- **world-id 持有器**(world-id.ts): Simulation 是进程单例但不持有 worlds 表 UUID——模块级 `setWorldId()/getWorldId()`,建世界/恢复读档时 set;trace/event-log/token-usage 三写入点各取。旧世界 closed 后新世界建立即切换,旧数据按 world_id 仍可查。
- **schedule 端点扩展**: CharacterWantView +origin/expiresAtMin/targetCharacterId(此刻 want 池的来源与半衰可视化)。

## 5. 追溯 API(admin 鉴权,登记于 admin-api/traces.ts)

| 端点 | 用途 | 参数 |
|------|------|------|
| `GET /api/admin/characters` | 当前活跃世界角色清单(面板角色选择器) | — |
| `GET /api/admin/logs/cognition-traces` | 认知 trace 分页(createdAt 倒序;uuid 主键非时序,不按 id 排) | characterId/wantId/layer/conclusion/page/pageSize |
| `GET /api/admin/traces/wants/:characterId/:wantId` | want 全生命周期聚合 | — |

生命周期聚合返回三段: `want`(脑内在途快照,跨日已清则 null 靠 trace 还原)+`traces`(按 wantId 全程,gameMinutes 升序)+`events`(角色同时段 world_events,终态窗收口在半衰期/在途追到当前时刻,上限 200 条)。

## 6. 后台「决策追踪」面板(AdminTracePanel+WantLifecycleDrawer)

- **上区·此刻决策(want 池)**: 角色 Select(GET /api/admin/characters)+want 池卡片 5s 轮询;卡区头部**运行态快照行**(位置/coins/energy/当前活动+elapsed/背包摘要——schedule 端点 snapshot 字段,仲裁-执行失配排查的第一事实源:仲裁说在卖货、快照却显示背包空,一眼见底);doing/在途分组,origin Tag(规划/驱力/直觉/事件)+状态 Tag+紧迫度+第一人称理由+半衰;点击开抽屉。
- **下区·决策时间线(认知 trace)**: antd Timeline(最新在上,颜色随 layer);layer/conclusion/wantId 三过滤+手动刷新+可选 10s 轮询;每项=时刻+gm+layer Tag+conclusion+trigger+intent+bubble+rejectReason;select 层行内展开候选评分(胜出/落选:score/seize);perception/retrieval/calls 折叠 details;分页 30/页。
- **want 生命周期抽屉**: 此刻快照(Descriptions)+决策 trace 时间线+同时段事件流(payload 折叠)——一张 want 从「生」到「结算」全链一屏看完。

## 7. 典型排障动线(取代手写 SQL)

1. 「TA 为什么在做这件事?」→ 选角色看 want 池 doing 行的 origin+why → 点开抽屉看仲裁 trace:谁胜出、谁以什么理由落选。
2. 「TA 为什么不动/原地空转?」→ want 池卡看运行态快照(位置/活动/背包)对拍 doing want 的预期;时间线 wantId 过滤看连续 continue 行的 reason(中文 Tag):背包空=backpack_empty、体力闸=energy_gate、目标不在=target_missing……「同一 want 反复 continue」即空转特征。
3. 「社交为什么没聊起来?」→ wantId 过滤 socialize want:召唤→等待(summonWait 采样)→生成/走散/超时废弃,每步有行。
4. 「跨世界旧数据」→ 旧世界 closed 不碍事,按 world_id/角色检索历史 trace。

**典型案例(2026-10-10 决策观测镇「只有苏晚在动」)**: 晨间 LLM 为 3 角色生成 sell_goods want(编了「卖浆果」戏),但 gather_berry 走 work_task 通道果实归雇主不进背包——执行层 backpack_empty continue(want 保留),仲裁器只看评分每拍仍让它胜出,无限循环锁死决策槽,其他 want 饿死。当时 trace 无 reason/wantId 只能手写 SQL 硬挖;本节补全后此类问题在面板上 1 分钟定位:want 池 doing 全是卖货+快照背包空+时间线连续「背包空」Tag。行为修复(产欲加背包前置/空转护栏)另行立项。
