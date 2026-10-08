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

角色"脑内"的东西(当前日程、方针缓存、认知队列、上次判定、当前情绪)存 `agents/cognition.ts` 内存 Map+异步落库,**不进 WorldCharacter**。世界侧角色只保留模拟必需的数值/位置/库存;世界重启或角色复活时脑状态按存档恢复。其中情绪(C2)以 `character_moods` 冲量流水表为唯一真源(append-only,读取时按半衰期纯函数衰减聚合),Map 只是 MoodTracker 维护的同步镜像——重启零恢复成本。

### 3.3 延迟与倍率的张力 → 15 分钟块

16x 下 1 游戏小时 = 3.75 分钟真实时间,LLM 来不及对每分钟做决策。解法是**粗粒度决策**: 慢思考产出 15 分钟块级计划(去哪/做什么),块内执行交给快层(规则+Jev,零/廉价);计划与现实的矛盾由快层上报,触发局部重规划(§4.5/§4.6)。

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

先规则后模型、逐级升高,命中即止:

| 层级 | 槽位 | 成本 | 频率 | 职责 |
|---|---|---|---|---|
| rule | — | 0 | 每 tick | 阈值反应(体力≤20→觅食/回家睡;房租临期→交租;计划块到期→执行下块) |
| jev | jev | 极低 | 高频(事件驱动) | 候选选一(systemone 类型化问答:"现在去哪?A 商店 B 家 C 长椅") |
| light | light | 低 | 中频 | 自由文本小任务(对话台词生成,§6) |
| slow | slow | 高 | 每日 1 次级 | 日计划生成/矛盾重规划/反思洞察/方针编译 |

**判定输出只有两种**: `continue`(当前计划仍有效,零模型)或 `react`(打破计划,产出一个意图交执行)。绝大多数 tick 落在 rule 层,**零模型调用**——这是 M4 验收硬指标("高频动作零慢思考调用")。

> v2(2026-10-08,随 10-cognition-design C3 落地): EventBus 叙事事件不直接进上表判定,先过**事件分级门(triage)**——①相关性(感知半径/熟人)→②强度(≥6 STRONG 才可打断忙碌,≥8 DECISIVE 过低容忍)→③活动容忍度(活动声明 interruptibility: sleep/meal=none 一律排事后,study/work=low,缺省 high)→④处置(ignore/idle/respond/assess/defer)→⑤中断评估(仅忙+歧义案烧一次 systemOne)。响应动作由**注册表**查表产生(scheduler 不硬编码业务语义),预算护栏(日 ≤4 次评估+30 游戏分冷却+同事件去重)防中断风暴;**忙守卫语义修订: 忙碌≠零反应,而是受控反应**。细则见 10-cognition-design §7.1。

### 4.4 执行(execution)

react 产出的 Intent 走意图执行层(stale 重验+全量校验链),回执事件回流感知,形成闭环。

### 4.5 固化(consolidation)

> v2(2026-10-08,随 10-cognition-design C1 落地): 固化升级为**统一管线**——夜间睡眠结算与白天反思共用一次慢思考调用,产出结构化草稿(dreams/insights/relations 三段),详见 10-cognition-design §5。

- **反思(reflection,固化主产物)**: 触发源两条——睡眠结算(sleep.settled,睡饱 ≥240 分钟)或 importance 累计 ≥ 阈值(150)。慢思考对源记忆池归纳,产 insight(**必须带 sources 原文引用**,无引用丢弃)与 relations(对互动者的关系印象,upsert 到 character_impressions);insight 是认知爬梯 L1→L2 的主通道
- **梦境(dream,M5,氛围副产品)**: 同一次慢思考的 dreams 段(≤3 条),把当日事件变形为梦;定位是氛围/直播效果,不再承担认知产出
- **单向爬梯**: 固化产物写入即打 consolidatedAt,不再进后续源记忆池——认知只能从下层(情景记忆)提炼,防 insight 喂 insight 漂移
- **方针缓存(Talker-Reasoner 式)**: 生活方针(托管模式)由慢思考编译为快层可校验的缓存规则,方针文本变更才重编译

### 4.6 认知周期触发模型

| 触发源 | 时机 | 典型走到层 |
|---|---|---|
| EventBus 事件 | 附近对话/回执到达 | 分级门(triage,~90% 规则闸消化)→ rule → jev/⑤中断评估(必要时) |
| 阈值穿越 | 数值结算后 | rule |
| 计划块边界 | 15 分钟块到期 | rule(执行下块)/ slow(矛盾重规划) |
| 日时刻 | 00:00 | slow(日计划) |
| 反思阈值 | importance 累计达线 | slow(反思) |

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

- 收益封顶的角色对在**动机引擎入口直接剔除**(不点火、不产生闲聊)——高频无收益社交零成本,不烧 LLM 也不刷模板
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

维护约定: 改架构先改本文;每子阶段完工在文末变更记录追加一行(时间正序加表尾)。

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-10-05 | 初稿定稿: 世界运行(tick/11 意图/双来源同构/EventBus)+ 异步认知泵(不进 tick)+ 脑状态外置 + 15 分钟块 + 五模块认知周期(感知/检索/快层/执行/固化)+ 成本四级(rule 零模型/jev/light/slow)+ 记忆系统(主观经验流/三因子检索/反思固化/衰减遗忘)+ 人可见性澄清(向量≠记忆本体,content 为真相源)+ Agent 间对话 v1(一轮一对一答/封顶回落模板池)+ 可观测性(cognition_trace 全周期 trace/token_usage 关联/lab 观测面板/采样与体积控制);吸收 M4a 后架构讨论三连与用户两条补充需求 |
| 2026-10-08 | C1 固化管线 v2 落地随更: §4.5 重写(反思升格固化主产物,夜间+白天双触发统一管线,单向爬梯红线;梦境改氛围副产品)+ §5.1 数据模型增 source_ids 溯源链与 character_impressions 印象表(0013)+ §5.4 固化描述同步;细节见 10-cognition-design §5/§10 |
| 2026-10-09 | C4 社交行为闭环落地随更: §6 重写为 v1 实现(动机引擎点火接管「想不想聊」→ light 槽双调用「怎么聊」:人设+特质+关系称号+定点印象+共同记忆+情绪 → line+reply 随 chat 意图一次结算;新增走散放弃护栏;封顶语义修订为动机入口剔除候选)+ §6.2 maxTokens 思考模型余量教训 + §8 里程碑表增 C4 行;动机细则见 10-cognition-design §7.2 |
| 2026-10-08 | C2 情绪主观化落地随更: §3.2 脑状态清单增当前情绪(真源=character_moods 冲量流水 0014,读取时按半衰期 240 游戏分衰减聚合,cognition Map 为同步镜像)+ §8 里程碑表补 C1/C2 行;事件规则打标/衰减聚合/访谈注入/面板历史细则见 10-cognition-design §4.4 |
| 2026-10-08 | C3 事件响应层落地随更: §4.3 增事件分级门前置段(①相关性→②强度→③容忍度→④处置→⑤中断评估,响应注册表+预算护栏;忙守卫语义修订为「忙碌≠零反应,受控反应」)+ §4.6 触发表 EventBus 行改经分级门+ §8 里程碑表补 C3 行;分级细则与处置枚举见 10-cognition-design §7.1 |
