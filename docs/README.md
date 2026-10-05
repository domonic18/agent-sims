# agent-sims 文档中心

> 像素风模拟人生网页游戏:玩家在模拟城市中学习/工作/生活,体力值+幸福值驱动活动反馈,打工赚金币用于消费、租房、买房、买家具;核心差异化——角色可随时托管给 AI Agent 代玩、也可随时接管,Agent 是玩家"人格的衍生",社交行为符合玩家人设,玩家之间可文字交流

## 文档体系铁律

1. **分组与序号**: 文档按类型入六目录,目录内一律两位序号(`00-` 仅用于总体/入口类,并列文档从 `01-` 起),序号即阅读顺序
2. **单一权威源**: 每类知识只有一个权威文档——需求=requirement/01、架构=arch/00、迭代状态=plan/01、各领域设计=design 对应编号文档;**实现与文档冲突时先改文档再改代码**
3. **状态只记一处**: 里程碑进展只写 plan/01-development-plan.md(变更记录表),其余文档不回填过程
4. 新增文档: 先确定唯一目录与序号,再在本 README 登记索引;跨文档只引用"目录/序号-名称"稳定路径

## 文档索引

### requirement/(需求基准 · 变更需谨慎)

| # | 文档 | 说明 |
|---|------|------|
| 01 | [01-requirement.md](requirement/01-requirement.md) | 需求基准 v1.5: 两条根本原则(人格衍生/成本分级)、托管/决策可见/暂停恢复、后台管理、素材库与素材管理(§2.8)、随机世界与游戏模式(§2.9)、生存玩法远期立项(§2.10)、NPC 三层、离线生活+飞书、一期 14 项、不做清单、验收标准 |

### arch/(架构 · 终态方案)

| # | 文档 | 说明 | 阅读时机 |
|---|------|------|----------|
| 00 | [00-architecture.md](arch/00-architecture.md) | 架构 v1: 选型总览/系统拓扑/目录组织/世界 tick/意图指令层/Agent 内核概览/四层决策路由/数据模型(含 asset 域)/后台管理/部署/关键决策记录 | 首次进入项目必读 |

### design/(领域设计 · 各自单一权威)

| # | 文档 | 权威范围 | 状态 |
|---|------|----------|------|
| 01 | [01-agent-design.md](design/01-agent-design.md) | 世界运行机制+Agent 运行机制(认知周期/记忆系统/可观测性) | M4 设计定稿 |
| 02 | [02-goal-design.md](design/02-goal-design.md) | 目标与激励(三层目标/繁荣分;与 04 分工见其 §0) | v1.1 |
| 03 | [03-social-design.md](design/03-social-design.md) | 社交机制(二轴关系/相性/社交收益) | v1 |
| 04 | [04-numerical-design.md](design/04-numerical-design.md) | 全部游戏数值(与代码常量一一对应) | M3.6g 定稿 |
| 05 | [05-asset-library-design.md](design/05-asset-library-design.md) | 素材库(分类树/批量导入/放大校验/发布链路) | v1.5 立项 |
| 06 | [06-worldgen-design.md](design/06-worldgen-design.md) | 种子驱动整图随机生成管线+创建向导 | v1.5 立项 |
| 07 | [07-survival-design.md](design/07-survival-design.md) | 末日生存玩法(远期概要,待细化) | 远期 |

### plan/(迭代计划 · 状态真相源)

| # | 文档 | 说明 |
|---|------|------|
| 01 | [01-development-plan.md](plan/01-development-plan.md) | 里程碑 M0~M8 + M-L/M-S 与完成状态;**只在此维护状态,不回填过程** |

### qa/(测试与走查)

| # | 文档 | 说明 |
|---|------|------|
| 01 | [01-playable-checklist.md](qa/01-playable-checklist.md) | 人工可玩走查清单(M3.6c,意图全量操作覆盖) |

### research/(调研评估 · 结论快照)

| # | 文档 | 说明 |
|---|------|------|
| 01 | [01-pixel-sims-agent-play-research.md](research/01-pixel-sims-agent-play-research.md) | 对标 Generative Agents/AI Town/Wild Willows;代玩两路线结论;成本风险 |
| 02 | [02-tech-stack-research.md](research/02-tech-stack-research.md) | 同步/tick/Phaser+React;GenAgents 降本数据;双系统先例;后台/DB/飞书实测 |
| 03 | [03-asset-pack-research.md](research/03-asset-pack-research.md) | 素材包对比与选型(初版 Kenney;v1.5 起已购 LimeZu 完整版,现状见 public/assets/README.md) |

## 背景速览(新会话先看这里)

- **由来**: 创意池创意1,2026-10-03 立项
- **技术路线(2026-10-03 定,现 Phaser 4)**: Phaser 渲染 + React UI 外壳;Agent 代玩走**原生集成路线**(状态 API+意图指令集);Agent 内核参照 Generative Agents;**成本分级是硬约束**
- **架构定稿(arch/00)**: 单体单进程(Node+Fastify);Socket.IO 快照+增量;Postgres+pgvector+Drizzle;四层决策路由(规则→Jev→轻量 LLM→慢思考 LLM);antd v5 后台;Docker Compose 交付
- **当前阶段(2026-10-05)**: M0~M3.6 完成(世界模拟/核心玩法/视觉打磨/人工验证);游戏界面已全套切换 LimeZu 素材;后台五项重构+antd v5 迁移完成;**游戏系统优先方针定稿**——M4(Agent 内核)暂缓(设计定稿+M4a 完成,复用保留),下一步 **M-L 素材库与随机世界体系** → **M-G 游戏玩法与配套系统**(日志三件套/睡眠规则版/UI 素材打磨,零 LLM 人工验证) → Agent 线回归;**M-S 末日生存**(远期)
