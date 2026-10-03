# agent-sims 文档中心

> 像素风模拟人生网页游戏:玩家在模拟城市中学习/工作/生活,体力值+幸福值驱动活动反馈,打工赚金币用于消费、租房、买房、买家具;核心差异化——角色可随时托管给 AI Agent 代玩、也可随时接管,Agent 是玩家"人格的衍生",社交行为符合玩家人设,玩家之间可文字交流
> 文档体系铁律:**requirement/ 是需求基准,arch/ 是终态方案,plan/ 是迭代状态真相源**。
> 按需阅读,勿全量加载。

## 文档索引

### requirement/(需求基准)

| 文档 | 说明 |
|------|------|
| [01-requirement.md](requirement/01-requirement.md) | 需求基准 v1.4: 两条根本原则(人格衍生/成本分级)、托管与决策可见、暂停/恢复、后台管理(模型Key/NPC增删改查)、NPC三层、睡眠做梦记忆、离线生活+飞书推送、单人+参观模式、一期12项、不做清单、验收标准 |

### arch/(架构设计 · 终态方案)

| 文档 | 说明 | 阅读时机 |
|------|------|----------|
| [00-总体架构设计.md](arch/00-总体架构设计.md) | 架构 v1: 选型总览/系统拓扑/目录组织/世界tick/意图指令层/Agent内核(含睡眠梦境固化§6.4)/四层决策路由/数据模型/后台管理/部署 | 首次进入项目必读 |

### research/(调研评估)

| 文档 | 说明 |
|------|------|
| [01-像素模拟人生与Agent代玩技术调研.md](research/01-像素模拟人生与Agent代玩技术调研.md) | Generative Agents/AI Town/Wild Willows 对标;代玩两条路线(原生集成 vs 屏幕控制)结论;成本风险 |
| [02-架构选型调研.md](research/02-架构选型调研.md) | 同步方案/tick/Phaser+React集成;GenAgents工程细节+降本数据(AGA 70~96%)+双系统先例+Sleep-time Compute;后台/DB/飞书/Codiv Jev实测 |

### plan/(迭代计划 · 状态真相源)

| 文档 | 说明 |
|------|------|
| [development-plan.md](plan/development-plan.md) | 里程碑与完成状态;**只在此维护状态,不回填过程** |

## 背景速览(新会话先看这里)

- **由来**: 创意池创意1,2026-10-03 立项并完成项目骨架初始化
- **技术路线(2026-10-03 调研定)**: Phaser 3 渲染 + React UI 外壳;Agent 代玩选**原生集成路线**(游戏状态 API + 意图指令集),不采用屏幕控制;Agent 内核参照 Generative Agents(人设卡+Memory Stream+Reflection+Planning);**成本分级设计是硬约束**(Smallville 单次运行数百美元的教训)
- **生态空白**: 开源界无「可托管 Agent 代玩的像素模拟人生」,创意差异化已验证
- **架构定稿(2026-10-03, arch/00)**: 单体单进程(Node+Fastify);Socket.IO 快照+增量、1s 固定tick+事件驱动;Postgres+pgvector+Drizzle;四层决策路由(规则→Jev微决策打分→轻量LLM对话→慢思考LLM规划反思,**Jev 不做对话生成**);睡觉做梦=记忆固化窗口(Sleep-time Compute 背书);React Admin 后台;pnpm workspace;Docker Compose 交付(app+postgres)
- **当前阶段**: 需求基准 v1.4 + 架构 v1 已定稿;下一步按 development-plan M1(工程基座)动工
