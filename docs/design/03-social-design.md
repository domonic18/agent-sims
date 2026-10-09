# 社交设计(social-design)

> 状态: v1(2026-10-05)——模型与 v1 范围已定稿;参数与事件明细随实现补。
> 维护约定: 改社交机制先改本文档。上游依赖: 02-goal-design.md(特质相性引用其特质向量;社交收益计入繁荣分/故事流)。

## 0. 定位

社交同时解决 goal-design §3 盘点的两个洞: **幸福无用途**(社交成为幸福主要来源)与**开放世界缺故事来源**(关系不对称即剧情)。它是观察价值最高的子系统。

## 1. 定稿决策(2026-10-05)

| 决策点 | 定稿 | 理由 |
|---|---|---|
| 关系方向性 | **有向**(A→B 与 B→A 独立) | 单向挚友/互相看不顺眼本身就是剧情;6 角色规模存储翻倍可承受 |
| v1 动作范围 | **chat + 同场增益**(最小闭环) | gift 等经济打通放 v2 |
| 相性规则 | **v1 就上**,用随机特质向量 | 不等 LLM;否则社交网太均匀无戏 |

## 2. 关系数据模型: 二轴 × 有向

每对角色(A→B)两条独立记录:

| 轴 | 范围 | 涨跌 | 回答 |
|---|---|---|---|
| 熟悉度 familiarity | 0~100 | 共处/互动累积,缓涨;长期不见衰减 | 「认识多久」 |
| 好感度 affinity | −100~+100 | 互动质量决定,可负 | 「喜不喜欢」 |

- **关系称号不存储,纯派生**(可解释,LLM 读快照即可推理): 陌生人 / 点头之交 / 朋友 / 挚友 / 嫌弃,由二轴阈值映射。
- 存储: pairwise(6 角色 15 对全量下发无压力;角色规模上来再改增量同步)。

## 3. v1 动作集

### 3.1 chat(新意图,协议 +1)
- 前置: 同处一地(或紧邻,沿用锚点放宽语义)。
- 效果: 双方熟悉度+、好感小±(经相性系数调制)、幸福+小。
- 防刷: **递减收益 + 每日次数上限**(同对角色),参数随 numerical-design 落值。

### 3.2 同场增益(改结算,不加协议)
- 独自就餐 vs 两人同桌等: 联合活动幸福加成——社交成为幸福主要来源,幸福从装饰变资源。
- v1 最小形态: 就餐/散步/休息三类活动按「同场所正在活动的其他角色数」给幸福修正。

## 4. 相性(特质向量 v0)

- 每角色出生随机生成特质向量(0~1,维度沿用 goal-design §6: 雄心/享乐/宅/社交/节俭)。
- 好感变化量 × **性格兼容系数**(相性表,越兼容涨越快、排斥可跌): 雄心×享乐天然互斥、宅×宅舒适——社交网络按性格物以类聚,而非均匀网。
- 边界: v1 特质**只用于相性**,不驱动决策(决策层等 M4+ LLM,见 goal-design §8 路线)。

## 5. 与目标体系的挂钩

- 繁荣分: 挚友数/关系深度计入生涯账本(里程碑项,goal-design §5.2)。
- 人生事件流: `social.chat` / `friendship.formed` 等事件入 event bus → 观察者故事流。
- 个性呈现: 社交特质高的约饭频繁幸福好看;宅系独处回幸福更多——同一繁荣分不同路线。

## 6. 工程接口

- 快照: characters 增特质向量;新增 socials 段(pairwise)。
- 意图: 10→11(chat)。
- 事件: social.chat / relationship.changed / friendship.formed。
- 场所 affordance: 双人餐桌/长椅并坐/广场集会点(家具体系现成可挂,v2)。

## 7. 实现定稿(M3.6l,数值出处 numerical-design §6)

- 相性公式/称号阈值/chat 收益·递减·每日上限: 见 numerical-design §6.1~§6.4。
- 同场增益结算位置: 每 tick 逐角色、在活动净速率与繁荣分之后(applySocialPresenceBonus)。
- 幽灵/死亡对关系: v1 不特殊处理(关系保留、幽灵拒绝 chat);悼念/衰减加速留 M4+。

## 8. 共处破冰(D1,2026-10-09 落地)

v1 冷启动死锁: 社交动机要求 familiarity>0,而关系只能由 chat 创建、chat 只能由动机引擎发起——陌生对永远聊不上(长跑实测全镇互为陌生人 14 天零对话);且点火线数学不可达(SOCIAL_DESIRE_FIRE=0.7 > 初识者动机上限 0.6)。修法是**数值感知的共处破冰通道**,零模型:

- **acquaintanceStep**(15 游戏分节拍): 同场所共处的陌生对(familiarity=0 且无记录)累加共处分钟(acquaintance 字段随 socials 快照下发);
- 达 `ACQUAINTANCE_THRESHOLD_MINUTES`(120 共处分钟)→ 双向建交(familiarity=`ACQUAINTANCE_FAMILIARITY`=5)+ `first.met` 事件 + 双方各写一条记忆(经评价引擎);`ACQUAINTANCE_DAILY_CAP`=2 对/角色/日防速熟;
- 公式配套: 初识面熟加成 +0.15(动机引擎),`SOCIAL_DESIRE_FIRE` 0.7→0.45——初识者动机可达点火线,解死锁后能自发开口;
- 语义边界: 破冰≠成为朋友,只是把「认识」交给物理共处;聊不聊仍由动机引擎回答(10-cognition-design §7.2);
- 配套容忍: 轻活动(stroll/meal/rest/socialize)可被搭话不打断(不 finishActivity,聊完继续),替代旧「忙碌即跳过」。

## 9. E 系列社交强化(E1~E3,2026-10-09 落地)

D 系列长跑暴露社交管线三泄漏(colocated 口径与 chat 校验不一致致大场所必走散、生成前烧冷却致走散 43% 不重试、死循环 rule 挤占社交),用户拍板「全面加码」,三批落地:

### 9.1 口径拆分与走近再聊(E2)

- **chatReady / samePlace 双口径**: `chatReady`=曼哈顿 ≤ `SOCIAL_CHAT_DISTANCE`(与 world chat 校验同一口径,动机共处加成仅此档享受);`samePlace`=同场所或同活动但未贴身(旧 colocated 拆开,消灭「大场所判可聊、执行必拒」的口径泄漏)。
- **走近再聊**: samePlace 达点火线但未贴身 → 零 LLM 直接 `move_to` 对方当前位置(不簿记冷却不计数——走到才算主动);到场经 `character.arrived` 事件(triage self=3)自然重燃动机引擎,贴身即生成对话。
- **走散不罚**: 簿记改为同步先于任何 await(防双发);生成期间距离复查,走散 → 冷却降级为 `SOCIAL_RETRY_COOLDOWN_MINUTES`(10 分)短窗+当日主动计数返还+trace `walkedAway`,期满可重试。聊天落地才算一次主动社交。

### 9.2 人指向社交与即时印象(E2)

- **人指向 want**: Want 增 `targetCharacterId`;意图生成 prompt 注入熟人清单(名字+称号+一条印象+多久没聊),LLM 可产「找 X 聊聊」;执行层对带 target 的 socialize 先 `move_to` 对方当前位置寻人,到场交动机引擎接管。
- **聊后即时印象**: chat 落地后即时 upsert `character_impressions`——无印象建浅印象(「今天和 X 聊了几句:…」,规则拼接零 LLM),已有印象只刷新时刻不动文案;下次对话/意图 prompt 立即可见「刚聊过」,失败静默不影响聊天。

### 9.3 自然终止多轮对话(E3,斯坦福做法)

- **每轮 light 槽一次结构化调用**,顺带返回 `{ line, wantsMore }` 终止信号(零额外调用成本);双方 `wantsMore` 且未达 `CHAT_MAX_ROUNDS`(4)则续轮,奇数轮发起者/偶数轮对方。
- **轮间复查距离**: 生成期间被拽走 → 以已生成句收束(不丢句不续轮);任一轮调用失败 → 已有句照发、后续句由调用方模板池保底(≥2 句),整场失败回落模板双句。
- **协议**: chat 意图与 `social.chat` 事件由 `{line, reply}` 改 `lines: string[]`(2~4 句交替,发起者先说);world `chat()` 单场**结算一次**不按句数放大收益;`content` 保留(多句合并 `「l1」「l2」`)兼容旧渲染;web 气泡按句顺序在双方头顶交替冒泡(1.8s/句)。

### 9.4 聚会邀约最小版(E3)

- 发起方任意轮台词可顺带返回 `invitation?: { placeId, note }`(听者轮的邀约忽略);对话落地时**双方脑内**各记 `pendingInvitation { placeId, note, withId, day }`(InnerState 持久化,随 characters.inner_state 落库)。
- **次晨兑现**: 晨间意图生成发现 `pendingInvitation.day < 当日` → prompt 注入「昨天的约定(地点+理由)」并 unshift 一条高优(urgency 0.9)socialize 赴约 want(带 target),随后消费置 null。纯 wants 通道零新协议;玩家角色无 intents 自然跳过。

### 9.5 参数放宽(E2,数值权威 numerical-design §6.5)

`SOCIAL_DESIRE_FIRE` 0.45→0.35、`SOCIAL_PAIR_COOLDOWN_MINUTES` 60→30、`SOCIAL_DAILY_INITIATE_CAP` 6→8、共处加成 0.2→0.3;新增 `SOCIAL_RETRY_COOLDOWN_MINUTES`=10、`CHAT_MAX_ROUNDS`=4。
