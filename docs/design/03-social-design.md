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

- **v2 衰减归零死锁修复(2026-10-10 观察轮)**: 初版破冰只对「无关系记录」的陌生对生效,而 `FAMILIARITY_DECAY_PER_DAY` 1/日会把建交初值 5 衰减归零——归零后无任何恢复路径(聊天加成要求先点火,点火要求 familiarity>0,鸡生蛋死锁),60 日存档实证全镇 12 条关系 familiarity 全 0、历史零对话(叠加 driveStep 收口吞 want,见 10-cognition §7.5)。修法: ①acquaintanceStep 放行「熟络归零的旧识」走 meetByProximity 重逢刷新(共处满阈值后熟络度抬回初值,好感不动);②meetByProximity 增 `metNotified` 持久化标记,首识事件一对只发一次,兑现「旧识重逢静默刷新不重发」既有注释意图;③旧存档无标记的归零关系重逢补发一次 first.met 后静默(存档兼容)。

> E6(2026-10-10): 破冰通道属**感知/数值层**,不属决策层,统一意图架构(01-agent-design §3.3)不触碰本节;动机引擎(E6.1 起)降为驱力生成器写 socialize want,封顶剔除/冷却/日预算照旧在动机段把门,§9.1「走近再聊」的直执 move_to 改走 want 两段式——见 10-cognition-design §7.5。
> E6.4(2026-10-10): 动机引擎 desire 打分退场(§11),点火线/日预算闸随之废除,把门收敛为同对冷却一闸。

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

## 10. 两阶段会合协议(E6.2-S1,2026-10-10 落地)

E6.1 产线观察(2026-10-10,2h trace): 聊天生成被丢弃 133 次/2h(62%),烧掉 62% 的 dialogue prompt token(≈23 万/2h)——根因是「先烧模型、后会合」的顺序倒挂: 动机点火即发起完整生成,生成期间任一方移动即走散,已烧的台词全部作废。修法是把会合**前移到生成之前**,拆成三拍,只有第三拍烧模型:

### 10.1 三拍

1. **召唤(零模型)**: wantSelect socialize 分支判贴身可聊,但执行时无会合(对方没在等我)→ 不生成,改为——给对方写一条 **event want**(origin=event,urgency=`SOCIAL_SUMMON_URGENCY`=0.9 赴约档,`SOCIAL_SUMMON_TTL_MINUTES`=90 半衰;E6 统一意图架构下 event 是合法 want 来源,这是 event→want 通道的首个消费者)+ 建会合台账(rendezvous),即返回。
2. **应答(agent 自裁)**: 对方的 wantSelect 评分自然竞争——召唤 want(0.9 赴约档)通常胜出;被更高分让位即婉拒,TTL 到期自然过期。召唤方在台账在册期间对目标 `executeWants(target)` 即时 kick,贴身且空闲即应答,不等对方空闲管线节拍。
3. **生成(唯一烧模型口)**: 双方就位(贴身 + 对方静置)才进 `runChatGeneration`。原先「生成后」的距离复查前移为「生成前」校验——走散空烧通道闭合。**应答方成为生成执行者**(chat 意图/气泡/lines/印象归应答方名下),主动社交记账(日计数+冷却)归发起方。

### 10.2 门控与护栏(wantSelect socialize 贴身分支,顺序判定)

- `chatGeneratingWith`: 该对生成在途 → 原地静候(对级 Set 护栏);
- `summonAwaiting`: 我召唤的对方尚未应答 → 不重复点火、不代答(台账去重);
- `pairLastChatAt` 短冷却: 簿记后 `SOCIAL_RETRY_COOLDOWN_MINUTES` 内不重开;
- **onPath 门控退役**: 「对方在途不点火」(E6.1 补丁 89c374c)撤销——走路中正是被召唤的好时机,召唤成本为零模型,应答由对方自己裁决。角色级生成护栏(一人同时只进一场,防三方对撞双烧)保留。
- **会合挂起**: 召唤后对方仍忙(非轻活动)→ 发起方 want 留 doing 原地静候(trace 采样),不空转不生成。
- **rendezvousSweep**: 15 游戏分一拍,`SOCIAL_SUMMON_GIVE_UP_MINUTES`=120 未会合 → 发起方 want 标 abandoned + 台账散场,零 token;替换旧「走散 walkedAway 降级短窗冷却」语义(§9.1 走散不罚的簿记保留用于真实走散残余场景)。
- **召唤不簿记**: 写召唤不写 pairLastChatAt(否则短冷却会挡住应答方即时 commit)。

### 10.3 参数与配套修复

- 新参数(数值权威随 numerical-design 落值): `SOCIAL_SUMMON_URGENCY`=0.9、`SOCIAL_SUMMON_TTL_MINUTES`=90、`SOCIAL_SUMMON_GIVE_UP_MINUTES`=120。
- **bookSocial pair 修复**(双代理测试暴露的生产 bug): 应答方执行生成时冷却被记到 self-pair(`initiatorId|initiatorId`),同对冷却永不生效 → settle 后动机引擎无限重烧。修法: 记账按发起方视角取同伴。
- 双代理对等语义: 双方都有动机引擎,互相召唤/反向寻人/在各自日预算内发起是合法生产行为,观察口径按发起方过滤。

## 11. 点火简化——动机引擎退场(E6.4,2026-10-10 落地)

「大道至简」复盘(用户拍板): 社交的本质就是两个人交流、关系随交流渐变。实证:E6.2观察镇 90 游戏日 12 条关系 **0 场对话**;且 E6.3 观察轮两个 bug(driveStep 收口吞 want、破冰衰减归零死锁)都是规则交互的涌现产物——五闸+desire 五项公式每个单独看都合理,叠加后的状态空间没人能推演,补丁在滚雪球(E6.3→fba6bed→b846a09)。修法是**做减法**:

- **砍**: desire 公式五项(好感基础/久未聊/初识面熟/贴身情境/情绪)与 `SOCIAL_DESIRE_FIRE` 点火线;每日主动上限闸(`SOCIAL_DAILY_INITIATE_CAP`);收益封顶剔除闸(`CHAT_DAILY_GAINED` 入口判定)。social-motive.ts 整文件删除。这些防线防御的「敌人」(高频刷聊)从未在产线出现,反而真实制造了 2 秒点火循环(症状被误当病因加闸)。
- **留**: affinity>-30 嫌弃剔除(不找厌恶的人);同对冷却 `SOCIAL_PAIR_COOLDOWN_MINUTES`=30(**唯一防刷闸**);聊天结算数学(fam+6/aff±4×相性/递减档)与两阶段会合协议原样。
- **新点火语义**(布尔门槛): 候选=已认识(fam>0)+对方存活+不嫌弃+对冷却外;按 affinity 择优写 socialize want(urgency 固定 0.5,竞争语义归 wantSelect)。**异地熟人也点火**走寻人两段式——纯偶遇式社交在分散小镇永远凑不齐共处,寻人正是会合协议的存在意义。
- **性格表达归位**: 关系好坏由 affinity 排序(最想聊谁)与聊天结算的相性系数表达,不再由点火公式模拟;若部署后聊天频率确需限流,凭数据加回唯一预算参数(先简后加)。
- 参数退役: `SOCIAL_DESIRE_FIRE`/`SOCIAL_DAILY_INITIATE_CAP` 自 BALANCE 与设置目录删除;存量世界 params 快照残留键经 SYS_CONFIG_FIELDS 白名单静默跳过,兼容无感。

## 12. 路上相遇事件化(E8,2026-10-11 落地)

决策观测镇实证的追逐死锁: 双方都有指向对方的在途 socialize want,相向而行各寻各的——A 到达 B 的出发点时 B 也到达 A 的,交错穿越贴身带后各自折返,8 次召唤 8 次超时 100% 放鸽子。**根因是采样鸿沟,不是意愿冲突**: 决策层按 15 游戏分/块采样,wantSelect 的贴身判定对相向而行两人(各 2 格/tick)交错窗口仅 ~1 游戏分,命中率 ~7%——93% 的路上相遇对决策层不可见。「双向都想聊」是合理生产行为(E6.2 已确立双代理对等语义),不许用点火互斥消灭;缺的是「路上碰面」这一瞬时物理事实的承接机制。

**机制**: 相遇升格为一等世界事件 `social.encounter`,与 character.arrived 同构——**连续物理事实归世界层 tick 级观测,经事件桥接离散决策层**。

- **世界层(零认知)**: `_detectEncounters` 每角色步进后扫描存活对,曼哈顿距离 ≤`ENCOUNTER_DISTANCE 2` 且**至少一方在移动**即发事件;同对冷却 `ENCOUNTER_COOLDOWN_MINUTES 15`(边沿触发近似,防同一次相遇重复惊动);双方静止不触发(静止共处是生活常态,移动交错才是相遇)。世界只报告「两人靠近了」,不知道 want/认知。
- **认知层分流(social-loop.onEncounter,零模型)**: 当事人自证相关——任一方有指向对方的在途 socialize want(pending/doing)才算相遇,否则擦肩而过(高频零惊动,路人相遇连 trace 都不进)。想聊→**双方停步**(requestStopMove,「见面停下来说话」的物理表达,同 rent 即时结算先例)→进既有两阶段会合协议(id 字典序小者为发起方,谁发起只定协议角色);任一方不可打断活动(睡觉/进餐,interruptibility='none')或非自治→不打扰。react 决策 trace 留痕(trigger=eventbus,perception.encounter/bidirectional)。
- **会合协议复用不改**: 召唤→应答→生成三拍、rendezvous 台账去重(会合窗口内重复相遇不重入)、rendezvousSweep 超时回收全部原样。停步解决的是「到得了」(双方原地贴身,召唤即时应答),生成仍由协议闸门把守。

**否决的 patch 项**(对照自检): 调大采样频率(治标,token 随频率涨,且任何有限采样对更快的交错都失明)/拉长贴身判定距离(误伤相邻格共处语义)/点火互斥(消灭合理意愿,违铁律)/让对方等 N tick(魔法数 patch,等待本身正是采样鸿沟的另一种表达)。事件化把「快于采样粒度的瞬时事实」的承接做成通用机制——未来任何 tick 级物理现象(碰撞/相遇/坠物)都走同一条 世界观测→事件→分流 通道。

参数: `ENCOUNTER_DISTANCE 2`(贴身带,与 SOCIAL_CHAT_DISTANCE 同值)、`ENCOUNTER_COOLDOWN_MINUTES 15`(≈一个决策块)。

**E9 补丁——搭话节流(2026-10-11)**: 高人流枢纽的相遇流会逐拍插队同一应答者(E7E8复验镇实证小林 meal want doing 空转 18 游戏时被饿死)。分流增加一道闸: 应答者已有在途 origin=event 的 socialize want(并发上限 1,「一人一次只应付得了一场搭话」)且该 want 不指向本次发起方→本次相遇只 trace encounterDropped(event_chat_busy,记在发起方),不停步不召唤。闸放在停步判定之前——放后面,擦肩就变成定身。在途 event want 恰指向发起方时不节流: 那是既有会合的消费,不是新搭话。
