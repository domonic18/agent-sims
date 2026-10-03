# agent-sims 迭代计划

> 创建日期: 2026-10-03
> **本文件是状态真相源:里程碑与完成状态只在此维护,不回填过程。**

## 执行约定(2026-10-03 定稿)

- **串行验收推进**: M1→M8 顺序执行,每个里程碑跑对应验收清单 → 更新本文件状态 → 打 tag(`v0.x.0-mN`) → 再进下一个
- **分支模型**: 开发在 `develop` 分支小步提交;里程碑验收通过后合回 `main` 并打 tag,`main` 始终可运行
- **每轮迭代 CodeReview**: 静态检查/单测之外,每轮迭代收尾前按根 CLAUDE.md §3 执行 CodeReview(规范性/封装性/架构合理性),问题清零后收尾
- **资源准备时间点**: M4 开始前提供各家 API Key(慢思考LLM/轻量LLM/Jev/embedding,后台填写);M7 开始前提供飞书个人群+自定义机器人 webhook
- 规模图例: S(半个工作日内) / M(1~2 个工作日) / L(3~5 个工作日)

## 里程碑

### M0: 立项与方案定稿

- 目标: 项目骨架、技术调研、需求基准、总体架构全部定稿
- 状态: **已完成**(2026-10-03)

### M1: 工程基座

- 规模: S
- 任务:
  - 四包 TS 工程落地: tsconfig/build/check 脚本、ESLint 基础;server Fastify /health;web Vite+React 骨架;shared Zod 包
  - DB 基座: schema 四域首版(world/memory/agent/sys) + 0000 迁移(CREATE EXTENSION vector) + seed 骨架(幂等)
  - dev compose 跑通: migrate → seed → health 全链路
  - **Spike①**: 慢思考 LLM/轻量 LLM/Jev/embedding 各一次真实连通调用(脚本入 scripts/,验证账号与网络)
  - **Spike②**: 像素素材包选型(开源免费,角色/地图 tile),结论记录后供 M2 使用
- 验收标准: dev 环境 `compose up` 后 migrate+seed 成功、/health 返回 ok;Spike① 四类模型全部调通
- 状态: **进行中**(2026-10-03)——四包 TS 工程/DB 基座(8 表四域+0000~0001 迁移含 pgvector)/dev compose 全链路(migrate→seed→/health)/质量门禁(check+test+build)已落地;后台登录鉴权+模型配置管理(原 M4 范围)已前置落地(web /admin 四槽位 CRUD+连通测试,Key AES-256-GCM 入库);Spike② 素材选型已定稿(research/03);余 Spike①(后台填 Key 后 `pnpm spike:llm` 实跑)

### M2: 世界模拟 MVP

- 规模: L
- **调试总原则**: world/ 模拟核心为零 I/O 纯逻辑(不依赖 Socket.IO/Fastify/Phaser),时间注入式——可 headless 独立跑、可假时钟 0 延迟连跑、可手动单步;配 /debug 端点族(仅 NODE_ENV=development 生效,生产自动关闭)
- 子阶段(串行小步提交,每步有独立检查点):

| 子阶段 | 规模 | 实现内容 | 测试/调试手段 |
|--------|------|----------|---------------|
| M2.1 模拟核心骨架 | S | tick 循环(accumulator)+注入式时钟;游戏日历(游戏分钟/日/昼夜判定);暂停/恢复;时间倍率(1x/4x/16x) | vitest 单测(时钟推进/暂停冻结/倍率/昼夜边界);headless 脚本 `sim:run --ticks=N` 输出状态摘要;/debug: `GET /debug/state`、`POST /debug/tick?n=`、`POST /debug/time/scale` |
| M2.2 地图与场所 | S | tile 网格+可行走层;6~8 场所(位置/入口/占地)进 seed | 可行走性查询单测;`GET /debug/map`;前端色块渲染对照 |
| M2.3 寻路与移动 | M | A*(可达/绕障/不可达);路径按速度逐游戏分钟推进;到达=离散事件进事件总线 | 寻路单测(正常/绕障/不可达/同格);移动推进单测(整分钟粒度+到达精度);`POST /debug/intent` 下发 move_to 实测(intents 层雏形);前端观察 |
| M2.4 数值系统 | S | 体力/幸福时间衰减(0~100 夹取);金币静态(M3 接活动) | 衰减与边界单测;`sim:run` 跑完整 1 游戏日输出数值曲线,验证衰减幅度合理性 |
| M2.5 同步层 | M | Socket.IO 首连全量快照+增量(tick 序号)+断线重连重同步;player/spectator 角色标志(参观入口 M8,机制此处具备) | 双窗口一致性;kill 客户端重连后一致;`GET /debug/clients` |
| M2.6 前端渲染+HUD+素材 | M | WS 层写 Zustand;Phaser 场景+路径插值;昼夜色调 overlay;HUD(时间/昼夜/三数值/暂停/加速);接入 Spike② 素材(tile+角色 sprite+行走动画) | 暂停按钮端到端(前端点→后端停→双端一致);60fps;素材渲染正确 |

- 验收标准(requirement §11): 浏览器看到角色按 tick 平滑移动;暂停立即冻结、恢复无状态丢失;桌面 Chrome/Edge 60fps
- 状态: 未开始

### M3: 核心玩法闭环

- 规模: M
- 任务: 活动定义化(学习/工作/生活,数值增减公式在此定稿=关闭 requirement §10-5);经济: 打工赚币/商店/租房/买房/家具购买摆放;活动面板/资产面板/数值反馈
- 验收标准: requirement §11「核心循环闭环」条通过
- 状态: 未开始

### M4: Agent 内核与托管 ★关键里程碑

- 规模: L
- 任务:
  - intents: Zod 指令集+执行+双来源(玩家⇄Agent)原子切换
  - agents: 感知→记忆写入(Jev 打分)→记忆流(pgvector 三因子检索)→日计划(慢思考)→快层执行(规则+Jev)→矛盾重规划
  - llm: ModelRouter(OpenAI 兼容 + Jev /systemone 原生适配)+token 记账
  - 人设访谈(对话式 5~8 问);行动气泡;记忆/日程面板
  - **最小后台**: React Admin 骨架(登录+模型配置 CRUD 已于 M1 前置落地, plain React 版;本里程碑迁移 react-admin 框架并扩展资源)
  - 托管: 生活方针模式(主)+全托管
- 验收标准: requirement §11——气泡可见/切换<1s 状态不丢/方针遵守抽查/**高频动作零慢思考调用**/访谈生成人设卡
- 状态: 未开始

### M5: 睡眠与梦境记忆

- 规模: S
- 任务: 作息+睡眠活动(夜间入睡/体力恢复/缺觉软惩罚);入睡触发当天记忆固化(打分去重压缩→慢思考产出 1~3 条 dream);记忆面板四类条目(事件/洞察/梦境/对话)查看;离线时睡眠整理照常
- 验收标准: requirement §11——角色入睡体力恢复;次日记忆面板出现与当天经历对应的 dream 条目
- 状态: 未开始

### M6: NPC 体系

- 规模: M
- 任务: 三层 NPC 框架(核心 5~8 轻量 LLM / 背景 10~20 规则驱动+被交互唤醒升级留记忆);NPC 对话(轻量 LLM,人设约束+记忆引用);后台新增 NPC 人设卡 CRUD 资源
- 验收标准: requirement §11——NPC 回复符合人设且引用交互记忆/背景NPC 唤醒后记得上次/后台增删改查生效
- 状态: 未开始

### M7: 离线生活与飞书推送

- 规模: M
- 任务: 离线降频模拟(日计划 1 次/游戏日+规则引擎兜底+关键社交才唤醒慢思考);notify: 飞书 webhook(加签+串行队列)+关键事件规则;后台新增飞书 webhook 配置资源;重进生活摘要
- 验收标准: requirement §11——离线 8 小时重进: 收到关键事件推送+看到生活摘要
- 状态: 未开始

### M8: 后台完善+参观模式+全量打磨

- 规模: M
- 任务: 后台补齐——成本面板(token_usage 图表+阈值告警→飞书)、世界控制(暂停/恢复/时间流速);参观模式(同流只读+无操作入口);性能打磨(切换<1s/气泡<3s/60fps);requirement §11 全量验收过一遍
- 验收标准: requirement §11 全部通过
- 状态: 未开始

### 二期后置池

- 多人参与游玩、移动端、更多数值(饥饿/社交)、抱负系统深化——见 requirement §8 二期

## 状态图例

未开始 → 进行中 → 已完成 / 搁置

## 变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-10-03 | 初始化计划 | 项目立项 |
| 2026-10-03 | 定稿 M0~M8 里程碑 | 需求基准 v1.4 与架构 v1 定稿 |
| 2026-10-03 | 细化各里程碑任务清单;最小后台前置到 M4、飞书配置前置到 M7;M1 增加模型连通性与素材选型两个 spike;定稿串行验收推进与 tag 约定 | 开发计划评审确认 |
| 2026-10-03 | M2 细化为 M2.1~M2.6 六个子阶段+调试基建约定(world 纯逻辑/注入时钟/headless 跑批/debug 端点族) | 便于重点测试世界模拟各功能 |
| 2026-10-03 | 建立分目录 CLAUDE.md(apps/server、apps/web、packages/shared);开发流程增加每轮迭代 CodeReview 环节 | 规范完善 |
| 2026-10-03 | 目录规划增加 workspace/(宿主机持久化数据);dev/prod compose 由 named volume 改为 workspace bind mount | 数据落点统一到宿主机目录,便于备份与重置 |
| 2026-10-03 | 明确测试目录分层: 单测就近(`*.test.ts` 同置)/集成测试放包内 `tests/`/E2E 后置建 `e2e/`;不设顶层 tests/ | 测试组织按 JS/TS 生态就近派实践确认 |
| 2026-10-03 | M1 主体落地: 四包 TS 工程(tsconfig/ESLint/check)、shared Zod 包、server Fastify /health、web Vite+React 骨架、DB 基座(8 表四域 schema+0000 迁移含 pgvector+幂等 seed)、dev compose 全链路验证通过 | M1 工程基座启动(develop 分支) |
| 2026-10-03 | 执行约定改双分支模型: 开发在 develop 小步提交,里程碑验收后合回 main 打 tag | 用户要求建立 develop 开发分支 |
| 2026-10-03 | Spike② 定稿: 地图 tile 用 Kenney(CC0)、角色用 Universal LPC Spritesheet Generator(research/03);Spike① 脚本就绪(scripts/spike-llm-connectivity.mjs + `pnpm spike:llm`),待 API Key 实跑 | M1 收尾 |
| 2026-10-03 | 模型配置从 env 改为后台管理(参考 ai-invest-assisstant 实现): /api/admin 登录鉴权(scrypt+HMAC token 12h)+四槽位配置 CRUD(Key AES-256-GCM 只写+掩码回显)+连通测试(结果落库);web /admin 登录+配置页(React.lazy 独立 chunk);Spike① 脚本改走后台 API;登录与模型配置从 M4 前置落地;参考实现确认后保留 0001 迁移(测试结果三字段) | 用户要求模型配置走后台管理 |
