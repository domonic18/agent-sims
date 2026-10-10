# agent-sims Agent 设计(Agent Design)

> 本文档是**世界运行机制+Agent 运行机制**的设计权威(single source of truth):M4 起各子阶段(agents/ 认知域、记忆流、观测面板等)以本文为设计基准。数值类见 04-numerical-design.md,社交数值见 03-social-design.md。**实现与本文冲突时,先改本文再改代码**,并在文末变更记录追加一行。
> 定稿: M4 设计讨论(2026-10-05),吸收 M4a 后架构三连问答与用户两条补充需求(记忆人可见性 / Agent 可观测性)。

## 1. 设计总则

1. **世界与 Agent 分离**: 世界是确定性模拟(`apps/server/src/world/` 零 I/O),Agent 是挂在世界之上的**外部大脑**(`apps/server/src/agents/`)。世界不感知 Agent 存在——它只看到"某个 characterId 发来了一条意图";Agent 只能经意图影响世界,无任何旁路写状态。
2. **意图唯一状态变更入口**: 玩家与 Agent 共用同一 Zod 意图协议(11 意图,§2.2),双来源同构。托管切换(<1s)只是"意图从哪条连接来"的变化,世界侧零感知。
3. **成本分级**: 高频决策(每 tick/每分钟)零 LLM 或廉价模型;慢思考(日计划/反思)每日个位数次数。不存在"每 tick 调一次大模型"的路径。
4. **一切可观测**: Agent 的每个认知周期产生完整 trace——触发原因/检索证据/判定层级/模型调用明细(§7)。人能回答"它为什么这么做",而不只看到结果。

## 2. 世界运行机制(确定性地板)

### 2.1 时间与 tick

| 概念 | 值 | 说明 |
|---|---|---|
| tick 周期 | 100ms | TickDriver 单泵,`Simulation.tick()` 每拍一步 |
| 1 tick | = 1 游戏分钟 | 世界时间自 00:00 起累计 |
| 倍率 | 1x / 4x / 16x | 16x 下一天(1440 分钟)≈ 90 秒真实时间 |
| 日翻转 | 00:00 | 租期/社交日计数翻转,日计划触发点 |

### 2.2 意图协议(= Agent 动作空间)

11 意图(`@sims/shared` intents.ts 单源,`INTENT_TYPES` 派生):

| 类别 | 意图 | 参数 |
|---|---|---|
| 移动 | move_to / stop_move | x,y / — |
| 活动 | start_activity / stop_activity | activityId / — |
| 物品 | buy_item / eat_item / store_item / take_item | itemId(,count) |
| 资产 | rent_property / buy_property | propertyId |
| 社交 | chat | targetId |

Agent 规划器的产物只能是这 11 种之一——不存在"调 LLM 直接改数值"的通道。意图层现有的全部校验链(距离/权属/租约/容积/每日次数)同样是 Agent 的行为边界。

### 2.3 双来源同构与意图生命周期

```
玩家:  web socket ──→ runIntent ─┐
                                 ├─→ Zod 校验 → Simulation.request*(stale 重验) → 状态变更
Agent: agents/ 认知泵 ───────────┘                                              → 回执事件(EventBus 广播)
```

双来源在协议层合流,`request*` 校验与回执完全一致;托管切换(M4e)即意图来源的原子切换,不触碰世界状态。

### 2.4 EventBus

意图回执/数值里程碑/社交事件等全部经 EventBus 广播(web socket 转发+lab 日志流消费)。M4 起它同时是 **Agent 的感知输入源**(§4.1)——世界不主动调用 Agent,Agent 订阅世界。

## 3. Agent 架构总览

### 3.1 异步认知泵(不进 tick 循环)

Agent loop **不在 TickDriver 内**。`apps/server/src/agents/` 跑独立的 AgentScheduler(异步泵):

- **输入侧**: 订阅 EventBus(感知)+ 自有定时器(计划块边界/日时刻/反思阈值)
- **输出侧**: 产出的 Intent 交还意图执行层(唯一出口),提交前做 **stale 重验**——决策时角色在商店,执行时可能已被玩家接管或已移动;意图层校验链就是最后防线
- **理由**: LLM 延迟(秒级)与 tick 节拍(100ms)差两个数量级;塞进 tick 会把确定性模拟与外部 I/O 耦合,阻塞泵不影响世界帧率,反之世界永远不等模型

### 3.2 脑状态(brain state)

角色"脑内"的东西统一收敛为 **InnerState**(D2,`agents/cognition.ts`): `{ mood, focus, intents, lastEvaluation }`——当前情绪(C2)、当前关注(最近一次决策理由一句话)、今日弹性意图(DayIntents,§3.3)、最近一次活动评价(verdict+第一人称理由)。存内存 Map+异步落库 `characters.inner_state` jsonb,**不进 WorldCharacter**。世界侧角色只保留模拟必需的数值/位置/库存;重启/跨日不恢复旧意图,次日晨重新 composeIntents。其中情绪以 `character_moods` 冲量流水表为唯一真源(append-only,读取时按半衰期纯函数衰减聚合),Map 只是 MoodTracker 维护的同步镜像——重启零恢复成本。托管方针缓存(编译产物)与认知队列仍在同域维护。

### 3.3 延迟与倍率的张力 → 弹性意图模型(D3)→ 统一意图架构(E6)

16x 下 1 游戏小时 = 3.75 分钟真实时间,LLM 来不及对每分钟做决策,解法是**粗粒度决策**;但形态已从 v1 的「15 分钟块刚性日程(DayPlan)」演化为**弹性意图模型**: 慢思考每日晨间 `composeIntents` 产出 3~6 条 wants(做什么 + 第一人称为什么,`prompts/intents.*.md`;persona 全文注入),**只定方向不定时刻**。快层 `wantSelect` 在角色空闲时按 `urgency × activityBias × 数值需求` 评分择一执行(两段式 move_to/start_activity 沿用),完成/被打断/放弃即标态并重选下一条。计划与现实的偏差不再是需要"重规划修复"的矛盾,而是**天然的记忆素材**(经评价引擎写入记忆,§5.2)。睡眠不再由日程时间强制( planNight 已删),改纯**困倦数值压力**(rule 层 energy 梯度,夜间放大系数;无居所不强排保持)。LLM 失败回落按 activityBias+随机扰动生成个性化 wants,消灭同款模板。

> **统一意图架构(E6,2026-10-10 定稿)**: D/C 系列落地后系统长出**五种行为来源**(slow wants / jev / 社交动机引擎 / rule / triage respond),却有两种执行方式——只有 slow wants 全程走「意图存储→评分→两段式→结算」,其余四种都绕过存储直接发意图,症状一致: 到达即死(E5 验收 stroll=0、sell 死在门口、走近朋友被截断的共同根因)、trace 只剩一行 react 不可审计、被 want 层截胡。E6 收敛为**双系统产欲、单通道执行**:
>
> ```
> 生成器(回答「我想要什么」,只写不执行)
>   ├ 慢思 LLM(日频·贵): 当日规划 plan want
>   ├ 驱力(零模型·连续·免费): 恒稳态压力→urgency(drive want: 饥饿/疲劳/贫困/社交孤独/利他)
>   └ jev=System 1 通道(§4.3): 冲动 impulse want / 事件评价 event want
>   ↓ 统一写入
> 意图存储 Want{origin: plan|drive|impulse|event, urgency, 可选 expiresAtMin}
>   生命周期 pending→doing→done/abandoned;被中断回 pending;跨日清零
>   ↓ 唯一执行器(确定性·可审计)
> wantSelect 评分: urgency × bias × 需求增益 × 概率采样 → 两段式 → runIntent
>   ↓ 事件结算
> activity.finished / social.chat / revived → settleWant
> ```
>
> 三条设计规则: ①**LLM 永不直接执行**——输出只进意图存储/冲量,trace 天然全链路;②**压力→urgency,不是压力→动作**——驱力只回答「我多想要」,「怎么做」归执行器分支(ruleHunger 的吃/买/寻食逻辑搬进 wantSelect 驱力分支,消双轨);③**抢占=评分,不是特批**——高 urgency 冲动写入后自然胜出,活动容忍度(interruptibility)仍为硬闸;defer 队列溶解为冲动 want 的 `expiresAtMin`(**冲动会消退,计划才持久**);rent 保持即时结算——账单不是行为。
>
> 机制细节: `Want` 增 `origin` 与可选 `expiresAtMin`(hydrate 兜底旧行为 plan);`setIntents` 改**合并语义——替换 plan-origin、保留 drive/impulse-origin**(否则驱力/冲动写入会被晨间规划整体顶掉);**执行契约(E6.3 已落地)**——「抢占=评分」补齐胜负规则: doing=在契,空闲重评走「挑战者 vs 在位者」,挑战者评分≥在位者×`WANT_SEIZE_RATIO 1.4` 才许插队,否则在契者免评续做(重放执行分支,进度天然保留)。动因: 四源入池后 urgency 密集,无记忆每拍贪心每拍换王——E6.2 观察镇 plan 全 pending、earn 驱力饿死循环、会合被拆台零聊天的共同根因;抢占依然纯评分(E6 哲学不变),调度从无记忆贪心升级为带抢占阈值的优先级调度。校验拒绝退避(intentSkipUntil)保留,它管执行失败不是调度优先级。扩展公式: **新行为 = 活动定义 + 事件语义映射 + 生成器接线;生命周期/执行器/审计面永远不动**(自主建镇=build 活动+townNeeds 加行;救治=注册表映射 rescue want,urgency 由好感加权)。生效分期: **E6.1**=jev→want(含 probabilities 采样)+社交动机→want;**E6.2-S1**(已落地)=event→want 通道首个消费者——两阶段会合协议(§6,细则见 03-social-design §10);**E6.2-S2**(已落地)=rule→驱力+triage respond/defer→事件 want(细则见 10-cognition-design §7.5);**E6.3**(已落地)=执行契约+驱力收口范畴修正(`driveSatisfied` 仅对驱力词汇 eat/earn/forage/sleep 判缓解,default=false——曾有 default:true 把 drive 源社交 want 写入后一拍吞掉,对话结构性零落地+2 秒点火循环);**E6.4**(已落地)=社交动机引擎退场——点火改布尔门槛(fam>0+affinity>-30+对冷却外,affinity 择优,urgency 固定 0.5),同对冷却唯一防刷闸(细则见 03-social-design §11);**E6.2-S3**(规划)=②强度门评价式+评价式情绪。

## 4. 认知周期(五模块)

```
触发(事件/时刻) → ①感知 → ②记忆检索 → ③快层判定 → ④执行 → ⑤固化(反思)
                └────────────── 全程产生 trace(§7) ──────────────┘
```

### 4.1 感知(perception)

EventBus 事件按"与该角色的空间/社交相关度"过滤(附近的意图回执/对话/事件),过滤后写入记忆流并交 Jev 打分(§5.2)。感知是**主观的**: 同一场对话,A 写入的是"我和 B 聊了天气",旁观者 C 写入的是"A 和 B 在聊天气"。

### 4.2 记忆检索(memory retrieval)

以当前情境为 query,pgvector 三因子等权检索(§5.3),top-N 记忆作为判定证据,连同命中明细写入 trace。

### 4.3 快层判定(fast layer)

先规则后模型、逐级升高,命中即止。**E6 起 jev 重定义为 System 1 通道**: 任何「廉价、类型化、主观」的认知判断路由到 jev 槽;输出永远只进机制(want/评分/冲量),绝不直接执行。

| 层级 | 槽位 | 成本 | 频率 | 职责 |
|---|---|---|---|---|
| 驱力(E6.2 起,原 rule) | — | 0 | 连续巡检 | 恒稳态压力→**写驱力 want**(饥饿/疲劳/贫困/社交孤独/利他;压力映射 urgency,不直接产动作),执行逻辑归 wantSelect 对应分支(E6.2 前为 rule 直执,职责同旧表) |
| jev(System 1) | jev | 极低 | 空闲/事件(冷却+预算护栏) | 三职能: **①冲动生成**(choice 题→冲动 want,probabilities **采样**替代 argmax——冲动自然变率+性格差异涌现;候选由架构给,不碰执行);**②直觉评估**(score 题→事件重要度/情绪评价,E6.2 替换两张静态表,预算护栏沿用;memory importance 打分已是同款先例);**③内在言语**(观察项不排期)。confidence 门控: 低置信=没产生直觉,回落 continue |
| light | light | 低 | 中频 | 自由文本小任务(对话台词生成,§6;重要活动一句话复盘,D4) |
| slow | slow | 高 | 每日 1 次级 | 晨间意图生成(composeIntents)/反思洞察/方针编译 |

**判定输出只有两种**: `continue`(当前计划仍有效,零模型)或 `react`(打破计划,产出一个意图交执行)。绝大多数 tick 落在驱力/rule 层,**零模型调用**——这是 M4 验收硬指标("高频动作零慢思考调用")。

> v2(2026-10-08,随 10-cognition-design C3 落地): EventBus 叙事事件不直接进上表判定,先过**事件分级门(triage)**——①相关性(感知半径/熟人)→②强度(≥6 STRONG 才可打断忙碌,≥8 DECISIVE 过低容忍)→③活动容忍度(活动声明 interruptibility: sleep/meal=none 一律排事后,study/work=low,缺省 high)→④处置(ignore/idle/respond/assess/defer)→⑤中断评估(仅忙+歧义案烧一次 systemOne)。响应动作由**注册表**查表产生(scheduler 不硬编码业务语义),预算护栏(日 ≤4 次评估+30 游戏分冷却+同事件去重)防中断风暴;**忙守卫语义修订: 忙碌≠零反应,而是受控反应**。细则见 10-cognition-design §7.1。
>
> E6(2026-10-10 定稿): ④处置的 respond/defer 产物从「直接执行 intent」改为「**事件 want**」(E6.2-S2 已落地)——注册表保留,产出从 intent 改为事件语义→事件 want 的映射(救人→rescue want 等),抢占由评分裁决,defer 队列溶解为 expiresAtMin(写入不打断任何人,忙碌角色由 wantSelect 闲时评分调度)。②强度门评价式(预算内 jev score,静态表兜底)挪至 S3。细则见 10-cognition-design §7.5。

### 4.4 执行(execution)

react 产出的 Intent 走意图执行层(stale 重验+全量校验链),回执事件回流感知,形成闭环。

### 4.5 固化(consolidation)

> v2(2026-10-08,随 10-cognition-design C1 落地): 固化升级为**统一管线**——夜间睡眠结算与白天反思共用一次慢思考调用,产出结构化草稿(dreams/insights/relations 三段),详见 10-cognition-design §5。

- **反思(reflection,固化主产物)**: 触发源两条——睡眠结算(sleep.settled,睡饱 ≥240 分钟)或 importance 累计 ≥ 阈值(80,D5 自 150 下调: 阈值过高原先近乎永不触发)。慢思考对源记忆池归纳,产 insight(**必须带 sources 原文引用**,无引用丢弃)与 relations(对互动者的关系印象,upsert 到 character_impressions);insight 是认知爬梯 L1→L2 的主通道
- **梦境(dream,M5,氛围副产品)**: 同一次慢思考的 dreams 段(≤3 条),把当日事件变形为梦;定位是氛围/直播效果,不再承担认知产出
- **单向爬梯**: 固化产物写入即打 consolidatedAt,不再进后续源记忆池——认知只能从下层(情景记忆)提炼,防 insight 喂 insight 漂移
- **方针缓存(Talker-Reasoner 式)**: 生活方针(托管模式)由慢思考编译为快层可校验的缓存规则,方针文本变更才重编译

### 4.6 认知周期触发模型

| 触发源 | 时机 | 典型走到层 |
|---|---|---|
| EventBus 事件 | 附近对话/回执到达 | 分级门(triage,~90% 规则闸消化)→ rule → jev/⑤中断评估(必要时) |
| 阈值穿越 | 数值结算后(含困倦压力) | rule |
| want 状态迁移 | 完成/被打断/放弃 | rule(wantSelect 重选下一条) |
| 日时刻 | 晨间 | slow(意图生成 composeIntents) |
| 反思阈值 | importance 累计达线 | slow(反思) |

> E6 触发语义随架构演进: 阈值穿越/事件在 E6.2 起由「rule/respond 直执」改为「驱力/冲动写 want,由 wantSelect 统一择条执行」;到达(character.arrived)重入管线后 want 凭 doing 态续走第二段——**意图跨决策周期存活**是本架构消「到达即死」的核心性质。

## 5. 记忆系统

### 5.1 数据模型(memories 表,0004 迁移)

| 字段 | 类型 | 说明 |
|---|---|---|
| character_id | FK | 每角色独立的**主观**经验流 |
| content | text | **自然语言原文,人类可读,真相源**(§5.6) |
| type | enum | event(事件)/ insight(洞察)/ dialogue(对话)/ dream(梦境) |
| importance | int | 1~10,Jev 打分 |
| embedding | vector(pgvector) | content 的向量化,**派生检索索引,非记忆本体** |
| game_time | timestamptz | 记忆发生时的游戏时间 |
| source_ids | jsonb(C1,0013) | insight 的**溯源链**——引用的情景记忆 id 数组,记忆面板可点开原文 |
| consolidated_at | timestamptz(M5 起) | 非空=已固化,不再进源记忆池(单向爬梯) |

另有 **character_impressions 表**(C1,0013 迁移): 角色对角色的关系印象(唯一约束 character_id+about_id,upsert 定点覆盖),是认知爬梯 L3 关系模型的落点。

### 5.2 写入

感知过滤后的事件 → Jev 打分 1~10(平庸日常低分,显著事件高分)→ 低分丢弃,高分入库+向量化。写入是**主观转述**(以该角色视角措辞),不是全局事件日志。

> **记忆评价化(D4)**: 事件正文不再出自模板流水账,由**评价引擎**(`memory-evaluator.ts`)打底——五维确定性评分(persona 偏好匹配 activityBias/体力收益/社交获得/计划-实际偏差/当时 mood)汇成 verdict(good/ok/bad)与第一人称评价句,同时经 mood 层给 ±0.1 冲量。**重要活动**(|bias|=1 或有社交获得或被打断)追加一次轻槽 LLM 一句话复盘(节流 ≤4 次/角色/日,超限回落模板);其余纯模板零成本。`lastEvaluation` 写回 InnerState(§3.2)供后续评价与访谈引用。

### 5.3 检索(三因子等权)

score = min-max 归一化后的三因子之和:

| 因子 | 公式 |
|---|---|
| recency | 0.995^(距现在的游戏小时数) |
| importance | 条目存储分 |
| relevance | query embedding ↔ 条目 embedding 余弦相似度 |

top-N(默认 8~12)作为 prompt 证据与 trace 记录。

### 5.4 固化

见 §4.5(v2 统一管线): 一次慢思考产 dreams+insights+relations 三段——insight 带溯源链(source_ids 指回情景记忆),relations upsert 印象表,dream 仍写记忆流。全部成功才把源记忆打 consolidatedAt,失败静默次轮重试。固化条目重要性由慢思考给定。

### 5.5 遗忘 = 衰减,不删除

不物理删除记忆。recency 随游戏时间衰减使旧记忆在检索排序中自然沉底;排查时全量可查,仅世界删除(级联)才清数据。

### 5.6 人可见性(向量化 ≠ 黑盒)

> 针对用户关切(2026-10-05): "记忆系统需要人可见,用向量存储是否存在不可观测性问题?"

**不成立,因为向量不是记忆本体**:

1. `content` 自然语言原文 = 真相源,人直接可读;向量只是"下次相似情境能找到这条记忆"的**检索索引**(类比书的索引页——人读的是正文,索引只用于翻页)
2. 检索的**输出**(给 prompt 的证据、给记忆面板的展示)都是 content 原文;向量只在相似度排序内部出现,从不作为内容展示
3. 向量可随时从 content 重算,删除/重建索引零信息损失
4. **记忆面板(M4b)**: 按角色只读展示四类条目的 content+importance+game_time——"这个角色记得什么"对玩家完全透明

## 6. Agent 间对话

> 「想不想聊」由社交动机引擎回答(10-cognition-design §7.2,C4);本节只管「怎么聊」。
>
> E6(2026-10-10 定稿): 动机引擎归入 want 通路(E6.1 生效)——动机降为**驱力生成器**(欲望分→socialize want,urgency 映射),走近改走 want 两段式(不再被 want 层截断),贴身聊天由执行分支触发 light 台词双调用;共处破冰(acquaintanceStep)属感知/数值通道保持不动;「想不想聊不问模型」红线不变。
>
> E6.2-S1(2026-10-10 生效): 贴身聊天改**两阶段会合协议**——「先烧模型后会合」倒挂是 E6.1 产线走散空烧(62% 生成被丢弃)根因。拆召唤(零模型,给对方写 event want+会合台账)→应答(对方 wantSelect 评分自裁,应答方成为生成执行者)→生成(双方就位才烧模型)三拍;`onPath` 门控退役(走路中可被召唤),E6.1 产线补丁 89c374c 随之撤销。§6.1 为 C4 原始流程存档,现行实现以本注记+03-social-design §10 为准。
>
> E6.4(2026-10-10 生效): 社交动机引擎 desire 打分退场(03-social-design §11)——「想不想聊」由布尔门槛回答: 已认识+不嫌弃+同对冷却外即候选,affinity 择优写 socialize want(urgency 固定 0.5);§6.3 的收益封顶入口剔除随之废除(收益递减仍在聊天结算侧生效),同对冷却是唯一防刷闸。

### 6.1 流程(v1 实现,C4)

```
触发(社交动机点火:邻近=空闲管线直执;异地=进 jev 池寻路相聚)
  → A 发 chat 意图(与玩家同入口),line+reply 双句随意图一次结算
  → 服务端校验链(存活/距离/社交规则,与人类发起完全一致)
  → light LLM 生成 A 台词(prompt = 人设卡+特质+关系称号+定点印象+共同记忆+情绪)
  → light LLM 以 B 的人设闻声生成回复
  → 数值结算照旧(熟悉/好感/幸福,M3.6l 规则)
  → 双方各写一条 dialogue 记忆(各自视角)→ 固化进关系印象 → 反哺下一轮动机
```

要点: 对话是**意图驱动的世界事件**,不是 Agent 域私下通信;气泡/日志/数值回执对人类玩家全部可见。生成台词期间双方距离超出 SOCIAL_CHAT_DISTANCE(走散)→ 本轮放弃不结算(冷却已簿记,不重试)。

### 6.2 v1 范围(C4 实现)

- **一轮一对一答**(A 一句+B 一句即结束),多轮往返留 M6
- 台词生成走 light 槽**双调用**(发起者先说、听者闻声回一句);maxTokens 须给思考型模型留推理余量(512——120 会整段耗在 thinking 上致正文为空)
- prompt 上下文 = 人设卡 + 双方特质白描 + 关系称号(熟络度/好感)+ 定点印象一条 + 含对方姓名的高重要记忆 top-3 + 此刻情绪一句话
- 台词清洗: 取首个非空行/掐包裹引号/截 80 字(chat 意图校验上限);任一调用失败或清洗为空 → **整轮回落模板池双句**(`pickChatLine`,按熟络度分档)
- 现行 `pickChatLine` 模板池(15 句)即 LLM 不可用场景的回落实现(§6.3)

### 6.3 收益封顶与模板回落(v1 实现)

M3.6l 补2 已定"每日前 CHAT_DAILY_GAINED=6 次有收益,之后不拒绝但增益归零"。Agent 侧配套:

- ~~收益封顶的角色对在**动机引擎入口直接剔除**~~(E6.4 废除: 入口剔除闸随动机引擎退场,超收益档对话照常但增益全 ×0——频率由同对冷却自限)
- LLM 台词仅覆盖有收益区间;模板池语句数与分档维持 social-design §7

## 7. 可观测性(Agent Observability)

> 用户需求(2026-10-05): "agent 的快慢模型调用的过程都应该是可观测的"。

### 7.1 目标与原则

- 回答"**这个 agent 为什么这么做**": 从感知到意图产出的因果链可回溯
- 全层级覆盖: rule(零模型)也留判定痕迹;jev/light/slow 每次调用必记
- 观测数据与游戏世界同库,不引入外部 APM

### 7.2 认知 trace(cognition_trace 表)

每个认知周期一行,明细 JSONB:

| 字段 | 说明 |
|---|---|
| character_id / seq | 角色 + 角色内自增周期号 |
| game_time / wall_time | 游戏时间与真实时间 |
| trigger | 触发源(eventbus / threshold / schedule_block / day_rollover / reflection)+事件摘要 |
| perception | 感知到什么(含 Jev 打分结果) |
| retrieval | 检索命中 top-N(memory_id + 三因子得分) |
| decision | 判定层级(rule / jev / light / slow)+ 结论(continue / react + 意图摘要) |
| calls | 模型调用数组: {slot, protocol, task_type, promptTokens, completionTokens, latencyMs, outputPreview} |

### 7.3 与 token_usage 的关联

token_usage(M4a,每次成功模型调用一行)继续作为**计费流水真源**;trace.calls 是同一次调用的观测视图(task_type 可关联)。口径: 排查行为看 trace,算钱看 token_usage。

### 7.4 UI 观测面板

- lab 页新增「Agent 观测」区,复用现有事件日志流模式(worldStore 事件环形队列同款): 选角色 → 时间线展示周期 trace(触发 → 证据 → 判定 → 调用 → 产出意图)
- 与记忆面板互补: 记忆面板看"它记得什么",观测面板看"它为什么现在这么做"
- **采样策略**: rule 层 continue 的高频周期按采样记录(防日志洪水);react 周期与一切模型调用周期全量记录

### 7.5 体积控制

trace 只存元数据 + 输出摘要 + prompt 截断预览(各 ≤200 字符),不存 prompt 全文;完整行为重建靠 content 记忆 + 回执事件,足够。

## 8. 里程碑对应与维护约定

| 子阶段 | 承接本文章节 |
|---|---|
| M4b 记忆流 | §5(0004 迁移 + 三因子检索 + 记忆面板 §5.6) |
| M4c 感知+快层 | §4.1~4.4(决策气泡=react 可见化)+ §7 trace 首版 |
| M4d 慢思考 | §4.5~4.6 + §3.3(15 分钟块/重规划/方针缓存) |
| M4e 托管切换+访谈 | §2.3 + §4.5 方针缓存 |
| M4f 成本面板 | §7.3 |
| M5 梦境 | §4.5 |
| M6 多轮对话 | §6.2 |
| C1 固化管线 v2 | §4.5(白天+夜间统一反思管线)+ §5.1(source_ids 溯源/关系印象 0013) |
| C2 情绪主观化 | §3.2(mood 脑状态镜像)+ §5.1(character_moods 冲量流水 0014);细则见 10-cognition-design §4.4 |
| C3 事件响应层 | §4.3(事件分级门前置+忙守卫语义修订)+ §4.6(触发表 EventBus 行);细则见 10-cognition-design §7.1 |
| C4 社交行为闭环 | §6(对话 v1 实现:动机点火→light 双调用→chat 双句一次结算→记忆/印象回路)+ §4.3(空闲管线 idleSocialStep 接线);细则见 10-cognition-design §7.2 |
| D1~D6 运行机制深度重构 | §3.2(InnerState 统一内心状态)+ §3.3(弹性意图模型重写,替代 15 分钟块)+ §4.3/§4.6(want 执行循环与触发源改版)+ §4.5(反思阈值 80)+ §5.2(记忆评价化与轻槽复盘);共处破冰见 03-social-design §8 |
| E6 统一意图架构 | §3.3(双系统产欲单通道执行:生成器→意图存储→唯一执行器)+ §4.3(jev=System 1 通道三职能/驱力改版)+ §4.6(触发语义注记)+ §6(社交动机归入 want 通路+两阶段会合协议);细则见 10-cognition-design §7.5 与 03-social-design §10。E6.1=jev→want+社交动机→want;E6.2-S1=event→want 通道首消费者(会合协议);E6.2-S2(已落地)=rule→驱力+triage respond/defer→事件 want;E6.2-S3(规划)=强度门评价式+评价式情绪 |

维护约定: 改架构先改本文;每子阶段完工在文末变更记录追加一行(时间正序加表尾)。

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-10-10 | E6.4 社交点火简化落地随更: §6 注记增 E6.4 段(动机 desire 打分退场,布尔门槛+affinity 择优)+ §6.3 收益封顶入口剔除划除(收益递减仍在结算侧)+ §3.3 生效分期补 E6.4;机制细节权威在 03-social-design §11 | 90 日 0 对话+两涌现 bug 实证五闸+公式过度设计;用户拍板「大道至简」做减法 | 
| 2026-10-05 | 初稿定稿: 世界运行(tick/11 意图/双来源同构/EventBus)+ 异步认知泵(不进 tick)+ 脑状态外置 + 15 分钟块 + 五模块认知周期(感知/检索/快层/执行/固化)+ 成本四级(rule 零模型/jev/light/slow)+ 记忆系统(主观经验流/三因子检索/反思固化/衰减遗忘)+ 人可见性澄清(向量≠记忆本体,content 为真相源)+ Agent 间对话 v1(一轮一对一答/封顶回落模板池)+ 可观测性(cognition_trace 全周期 trace/token_usage 关联/lab 观测面板/采样与体积控制);吸收 M4a 后架构讨论三连与用户两条补充需求 |
| 2026-10-08 | C1 固化管线 v2 落地随更: §4.5 重写(反思升格固化主产物,夜间+白天双触发统一管线,单向爬梯红线;梦境改氛围副产品)+ §5.1 数据模型增 source_ids 溯源链与 character_impressions 印象表(0013)+ §5.4 固化描述同步;细节见 10-cognition-design §5/§10 |
| 2026-10-09 | C4 社交行为闭环落地随更: §6 重写为 v1 实现(动机引擎点火接管「想不想聊」→ light 槽双调用「怎么聊」:人设+特质+关系称号+定点印象+共同记忆+情绪 → line+reply 随 chat 意图一次结算;新增走散放弃护栏;封顶语义修订为动机入口剔除候选)+ §6.2 maxTokens 思考模型余量教训 + §8 里程碑表增 C4 行;动机细则见 10-cognition-design §7.2 |
| 2026-10-08 | C2 情绪主观化落地随更: §3.2 脑状态清单增当前情绪(真源=character_moods 冲量流水 0014,读取时按半衰期 240 游戏分衰减聚合,cognition Map 为同步镜像)+ §8 里程碑表补 C1/C2 行;事件规则打标/衰减聚合/访谈注入/面板历史细则见 10-cognition-design §4.4 |
| 2026-10-08 | C3 事件响应层落地随更: §4.3 增事件分级门前置段(①相关性→②强度→③容忍度→④处置→⑤中断评估,响应注册表+预算护栏;忙守卫语义修订为「忙碌≠零反应,受控反应」)+ §4.6 触发表 EventBus 行改经分级门+ §8 里程碑表补 C3 行;分级细则与处置枚举见 10-cognition-design §7.1 |
| 2026-10-09 | D 系列运行机制深度重构落地随更(6 功能提交+2 测试加固,23 游戏日长跑体检三病根治): §3.2 脑状态收敛为 InnerState(mood/focus/intents/lastEvaluation,inner_state jsonb)+ §3.3 重写为弹性意图模型(wants 替代 15 分钟块 DayPlan,只定方向不定时刻;睡眠删 planNight 改纯困倦压力 ruleSleepy;偏差=记忆素材而非重规划对象)+ §4.3 快层职责表改版(rule 困倦压力/want 重选,slow 晨间意图生成)+ §4.6 触发表改版(计划块边界行退役,want 状态迁移行上岗)+ §4.5 反思阈值 150→80+ §5.2 记忆评价化(五维评价引擎打底+重要活动轻槽复盘 ≤4 次/角色/日)+ §8 里程碑表补 D 行;共处破冰通道见 03-social-design §8 |
| 2026-10-10 | E6 统一意图架构定稿(先改本文再改代码): §3.3 增「双系统产欲、单通道执行」目标架构——五种行为来源(slow/jev/社交动机/rule/triage respond)统一为生成器只写不执行,意图存储加 Want.origin/expiresAtMin,setIntents 改合并语义(替换 plan、保留 drive/impulse),抢占=评分非特批,defer 溶解为冲动消退;§4.3 jev 重定义为 System 1 通道(冲动生成 probabilities 采样/直觉评估替换静态表/confidence 门控/内在言语观察项),rule 改版驱力(E6.2);§4.6 触发语义注记(意图跨决策周期存活);§6 社交动机归入 want 通路(E6.1);§8 里程碑表补 E6 行。动因: E5 验收 stroll=0/sell 死在门口/走近朋友被截断的共同根因=五种生成器三种执行方式;扩展公式「新行为=活动定义+事件语义映射+生成器接线」,自主建镇/救治零管线改动验证通过 |
| 2026-10-10 | E6.2-S1 两阶段会合协议落地随更: §6 注记增 E6.2-S1 段(召唤→应答→生成三拍,应答方成为生成执行者,onPath 门控退役撤销 89c374c;§6.1 转 C4 存档)+ §3.3 E6 生效分期补 E6.2-S1(event→want 通道首个消费者)+ §8 里程碑表 E6 行同步;机制细节权威在 03-social-design §10 | E6.1 产线走散空烧(2h 133 次=62% 生成被丢弃,烧掉 62% dialogue token);按「agent 运行机制系统化解决」原则把会合前移到生成之前,event→want 通道首个消费者落地 |
| 2026-10-10 | E6.2-S2 统一产欲落地随更: §3.3 生效分期标 E6.2-S2 已落地(评价式情绪/强度门评价式挪 S3)+ §4.3 E6 注记改事件 want 口径+ §8 里程碑表 E6 行同步;机制细节权威在 10-cognition-design §7.5 | 五种生成器最后两种直执通道(rule/triage respond)归一,「到达即死/trace 单行不可审计」病根在执行面闭合 |
