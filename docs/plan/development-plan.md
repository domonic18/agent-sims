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
- 状态: **已完成**(2026-10-03)——四包 TS 工程/DB 基座(8 表四域+0000~0002 迁移含 pgvector)/dev compose 全链路(migrate→seed→/health)/质量门禁(check+test+build)落地;后台登录鉴权+模型配置管理(原 M4 范围)前置落地(web /admin 四槽位 CRUD+协议感知连通测试,Key AES-256-GCM 入库);Spike② 素材选型定稿(research/03);Spike① 实跑通过(`pnpm spike:llm` 4/4 槽位连通: minimax anthropic/deepseek/codiv Jev/智谱 embedding);生产栈 web 容器化 9000 单端口对外验证通过

### M2: 世界模拟 MVP

- 规模: L
- **调试总原则**: world/ 模拟核心为零 I/O 纯逻辑(不依赖 Socket.IO/Fastify/Phaser),时间注入式——可 headless 独立跑、可假时钟 0 延迟连跑、可手动单步;配 /debug 端点族(仅 NODE_ENV=development 生效,生产自动关闭)
- 子阶段(串行小步提交,每步有独立检查点):

| 子阶段 | 规模 | 实现内容 | 测试/调试手段 |
|--------|------|----------|---------------|
| M2.1 模拟核心骨架 | S ✅(2026-10-03) | tick 循环(accumulator)+注入式时钟;游戏日历(游戏分钟/日/昼夜判定);暂停/恢复;时间倍率(1x/4x/16x) | vitest 单测(时钟推进/暂停冻结/倍率/昼夜边界);headless 脚本 `sim:run --ticks=N` 输出状态摘要;/debug: `GET /debug/state`、`POST /debug/tick?n=`、`POST /debug/time/scale` |
| M2.2 地图与场所 | S ✅(2026-10-03) | tile 网格+可行走层;6~8 场所(位置/入口/占地)进 seed(落地调整: 布局代码静态定义,`GET /debug/map` 可核) | 可行走性查询单测;`GET /debug/map`;前端色块渲染对照(移交 M2.3 随移动观察一并做) |
| M2.3 寻路与移动 | M ✅(2026-10-03) | A*(可达/绕障/不可达);路径按速度逐游戏分钟推进;到达=离散事件进事件总线 | 寻路单测(正常/绕障/不可达/同格);移动推进单测(整分钟粒度+到达精度);`POST /debug/intent` 下发 move_to 实测(intents 层雏形);前端观察(移交 M2.6 渲染一并做) |
| M2.4 数值系统 | S ✅(2026-10-03) | 体力/幸福时间衰减(0~100 夹取);金币静态(M3 接活动) | 衰减与边界单测;`sim:run` 跑完整 1 游戏日输出数值曲线,验证衰减幅度合理性 |
| M2.5 同步层 | M ✅(2026-10-03) | Socket.IO 首连全量快照+增量(tick 序号)+断线重连重同步;player/spectator 角色标志(参观入口 M8,机制此处具备) | 双窗口一致性;kill 客户端重连后一致;`GET /debug/clients` |
| M2.6 前端渲染+HUD+素材 | M ✅(2026-10-04) | WS 层写 Zustand;Phaser 场景+路径插值;昼夜色调 overlay;HUD(时间/昼夜/三数值/暂停/加速);接入 Spike② 素材(tile+角色 sprite+行走动画) | 暂停按钮端到端(前端点→后端停→双端一致);60fps;素材渲染正确 |

- 验收标准(requirement §11): 浏览器看到角色按 tick 平滑移动;暂停立即冻结、恢复无状态丢失;桌面 Chrome/Edge 60fps
- 状态: **已完成**(2026-10-04)——M2.1~M2.6 全部落地并实测(模拟核心+Socket.IO 同步层+前端 Phaser 渲染/HUD/昼夜/素材动画,69 测试);验收项逐条过: 插值平滑移动/暂停即冻结/素材渲染正确

### M3: 核心玩法闭环

- 规模: M
- 任务: 活动定义化(学习/工作/生活,数值增减公式在此定稿=关闭 requirement §10-5);经济: 打工赚币/商店/租房/买房/家具购买摆放;活动面板/资产面板/数值反馈
- 验收标准: requirement §11「核心循环闭环」条通过
- 状态: **已完成**(2026-10-04)——M3.1~M3.4 全部落地并实测(活动/商店/房产摆放协议+执行+前端面板,91 测试);§11 核心循环闭环浏览器实测通过: 面板前往图书馆学习 60 分自动完成→办公楼打工 120 分赚 60 币→购买台灯入库存→摆放生效→食用蛋糕幸福即时回升,数值全部按公式增减

| 子阶段 | 状态 | 范围 | 验收 |
|--------|------|------|------|
| M3.1 活动定义与执行 | M ✅(2026-10-04) | 活动目录入 shared(六类活动,数值公式定稿=关闭 §10-5);start/stop_activity 意图;逐分钟结算+按时长自动完成;move_to 打断进行中活动;activity.started/finished 事件 | 单测: 数值增减/自动完成/打断/破产中断(6 例);debug intent 实测(16x 下学习 60 分钟自动完成,数值按公式结算) |
| M3.2 经济·商店 | S ✅(2026-10-04) | 商品目录(家具/食物)入 shared;buy_item 意图(金币一次性扣减);库存入角色状态与快照 | 单测: 扣币/库存/余额不足拒绝(6 例);debug intent 实测(打工赚币→买食物/家具→余额不足拒绝);目录双端共用 |
| M3.3 房产与家具摆放 | M ✅(2026-10-04) | 初始租房,rent/buy_property 意图;家具摆放=抽象槽位+数值加成(不渲染具体位置,M3.4 面板可见) | 单测: 租/买扣币与状态、家具加成生效(7 例)+核心循环串接(打工→赚币→买家具→摆放→数值提升);debug intent 实测续租/买床/摆放/欠租拒绝 |
| M3.4 活动面板+资产面板+数值反馈 | M ✅(2026-10-04) | 活动面板(场所可用活动/进行中进度/取消);资产面板(金币/房产/家具);数值变化即时反馈 | 浏览器端到端走通核心循环闭环(§11 验收条): 学习→打工赚 60 币→买台灯→摆放→蛋糕即时反馈;面板操作与状态一致 |

### M3.5: 视觉与表现优化(用户反馈驱动,插队 M4 前)

- 规模: M
- 背景: 用户反馈——地图/建筑/人物粗糙;学习/打工/休息/健身/就餐缺动画指示;小镇是平均摆放不自然;地图偏小;整体需更精致
- 任务: 角色形象重制(补发/衣/鞋图层+全动画表);小镇布局重排与地图放大(TOWN_MAP 有机布局: 中央广场+主街+建筑簇团,弃均摆);渲染精致化(Kenney 包扩裁门窗立面/路网/花草,相机 2x 跟随);活动动画与状态指示(sit/idle 状态机+活动映射+头顶气泡进度)
- 素材源不变: Kenney Roguelike/RPG 包(~1700 tile 现仅用 13)+ LPC 生成器(现仅裸体素体+walk 行),均为"用量"问题非换源
- 验收标准: 浏览器多角色全活动动画演示;小镇布局自然(广场/主街/簇团可辨识,无均摆感);建筑有门窗立面且屋顶色可区分;相机放大下画面精致;60fps
- 状态: **进行中**(2026-10-04)

| 子阶段 | 状态 | 范围 | 验收 |
|--------|------|------|------|
| M3.5a 角色形象重制 | S ✅(2026-10-04) | LPC 穿衣角色合成: body+hair/bob(CC0)+pants+overalls 背带工装+shoes2 便鞋(逐层授权见 assets/character/credits.txt);通用表裁 rows 8-11 walk(9 帧)/22-25 idle(前 2 帧呼吸)/30-33 sit(前 2 帧),BOX 50% 缩 32px,6 套配色变体按角色 id 稳定哈希分配;WorldScene 动画状态机(walk/idle/sit 三组四向)+inActivity 驱动坐姿 | 浏览器见穿衣角色四向行走/坐姿/待机呼吸 |
| M3.5b 小镇布局重排与放大 | M ✅(2026-10-04) | TOWN_MAP 放大(32×24→56×40)重设计: 中央广场(12×11)+十字主街+三簇团——居住(公寓+公园,西南)/文教(图书馆+办公楼,东北)/商业(商店/餐厅/健身房,广场南缘一线);TileMapDefinition 新增 paths 铺装字段(主街/广场/门前小路,仅视觉可行走,协议先行);公园扩至 15×10 含 4×4 池塘水系收边+6 树;WorldScene 硬编码(POND_RECT/PARK_TREES)同步+铺装渲染+公园铺装跳障碍格;测试坐标九文件全量回归 | 单测 91 全绿+debug map ASCII 核对(七入口/三排建筑/池塘就位);浏览器: 四角色跨图寻路到达、活动中坐姿、2x 放大布局有机可辨识 |
| M3.5c 地图渲染精致化 | M | Kenney 包扩裁: 建筑立面(窗/门/招牌)、路网、水岸、花草/长椅/栅栏/路灯;建筑真立面+双色屋顶(解决餐厅/池塘同青色、公寓/健身房同橙色);装饰细节分层渲染;相机 2x 跟随当前角色+滚轮缩放 | 浏览器: 放大下建筑有门窗细节、六场所屋顶色可辨;跟随镜头平滑 |
| M3.5d 活动动画与状态指示 | M | 动画状态机(idle/walk/sit);活动映射: 学习=坐+书气泡/打工=坐+锤气泡/休息=坐+Zzz/健身=原地跑/就餐=坐+餐盘气泡;头顶活动图标+环形进度(M4 决策气泡简化版,预留复用) | 浏览器: 六活动各有可辨识动画与气泡指示,进度随 tick 走 |
| M3.5e 端到端验收 | S | 全活动+昼夜+多角色同屏走查;性能(60fps)确认;截图验收 | §11 渲染相关条目+本轮用户反馈三条全部关闭 |

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
| 2026-10-03 | 模型配置增加接入协议(openai/anthropic, 0002 迁移): 连通测试按协议分流(anthropic→/v1/messages + x-api-key/anthropic-version 头),失败详情附实际探测 URL;embedding 槽位固定 openai;web 槽位卡片加协议下拉(embedding 隐藏);research/02 修正 Jev 实测模型名为 `diffusiongemma-26b`(openjev-* 实测 404) | 实测: minimax anthropic 地址探测 404、Jev 模型名过时 |
| 2026-10-03 | **M1 完结**: Spike① 实跑 4/4 槽位连通(slow=minimax MiniMax-M2.7 anthropic / light=deepseek-chat / jev=codiv diffusiongemma-26b / embedding=智谱 embedding-3 2048 维);验收标准全部满足 | 后台配置四槽位 Key 后实测通过 |
| 2026-10-03 | M2 启动,M2.1 落地: world/ 纯逻辑三件套(GameClock 游戏日历/Simulation 固定 tick+暂停+倍率/TickDriver accumulator 实时驱动,时间注入零 I/O);游戏平衡数值入 config/balance.ts;/debug 端点族(state/tick/pause/time/scale)仅 development 注册;headless `sim:run`;world 单测 14 例 | M2 世界模拟 MVP 开工 |
| 2026-10-03 | M2.2 落地: TileMap 可行走层(默认可行走+障碍覆盖+边界墙)+7 场所(6 建筑+公园)静态定义于 world/map-data.ts+`GET /debug/map`;决策——城镇布局由原计划"进 seed"改为代码静态定义(布局为固定游戏内容,无后台管理需求);前端色块渲染对照移交 M2.3 随移动观察一并做 | 城镇布局无需 DB 化,KISS |
| 2026-10-03 | M2.3 落地: move_to 意图与 character.arrived 事件入 @sims/shared(协议先行);A* 寻路(4 向)+stepMovement 按速度逐 tick 推进+EventBus 离散事件;intents/execute.ts 为世界状态变更唯一入口;/debug/spawn+/debug/intent 联调端点;前端观察移交 M2.6 随渲染一并做 | M2 核心模拟层就绪,同步层(M2.5)可直接消费 snapshot+事件 |
| 2026-10-03 | M2.4 落地: 体力/幸福每游戏分钟自然衰减 0.05/0.03(0~100 夹取,上界供活动增益)+金币静态;完整游戏日 sim:run 曲线体力 100→28/幸福 100→56.8,作为 M3 活动数值设计基线 | 数值基线定稿需实测幅度支撑 |
| 2026-10-03 | M2.5 落地: @sims/shared 增 sync.ts(SOCKET_EVENTS/world.snapshot 全量快照协议/SOCKET_ROLES)+world.control 控制事件入事件联合(协议先行);socket/gateway(连接即快照+离散事件转发,无 client→server 监听=spectator 只读)+clients 注册表+TickDriver onTick 回调;io 装配入 buildApp(app.io 装饰器,onClose 先 await io.close 再关 pg,消除双路 close 竞态);`GET /debug/clients`;tests/sync 集成测试 4 例(快照/注册表/tick 广播+到达事件/控制事件)。决策——每 tick 增量暂用全量快照(状态小,tick 序号天然防乱序,M4 感知层复用);坑——socket.io 快照帧与 connect 同轮同步到达,客户端监听必须先于 connect 注册,否则错过首帧 | 同步层就绪,M2.6 前端直接消费 |
| 2026-10-04 | M2.6 落地+**M2 里程碑完结**: net/socket(socket.io-client,监听先于 connect)+zustand worldStore(status/snapshot/lastEvent,world.control 就地 patch 快照);Phaser WorldScene+HUD(时间/昼夜/tick/暂停/1x4x16x);TOWN_MAP 下沉 @sims/shared 双端共用防漂移;素材接入——Kenney tile 13 格条带(松林边界/六建筑屋顶+墙身/入口泥路/水/公园)+LPC 角色 walk 四向 9 帧缩 32px,裁切产物入 public/assets(原始包不入库,授权文件归档,帧配置集中在 game/assets.ts),角色按插值方向切 walk 动画、静止定格 frame0、步频随 timeScale;昼夜 overlay lerp。决策——每角色分离快照目标与渲染浮点坐标,偏差>4 格视为瞬移吸附;暂停冻结=快照停更自然达成,前端零特殊处理;坑——Phaser overlay fillAlpha=0 与对象 alpha 相乘恒 0(fillAlpha=1+setAlpha(lerp))。门禁 69 测试+浏览器端到端(暂停冻结 tick 21117/16x 实测/夜间压暗/行走动画转向切换) | M2 世界模拟 MVP 全量就绪,M3 玩法闭环开工 |
| 2026-10-04 | M3 启动,细化为 M3.1~M3.4 四个子阶段;活动数值公式定稿(关闭 requirement §10-5): 六类活动(学习/打工/休息/健身/散步/就餐)按"每游戏分钟净增量"定义体力/幸福/金币效果,与自然衰减叠加,打工 0.5 币/分、就餐 0.4 币/分;决策——活动目录随 TOWN_MAP 先例入 @sims/shared 双端共用;move_to 自动打断进行中活动;角色位于场所入口格或矩形内即可开始活动;金币下限夹 0,净负金币活动(就餐)余额不足自动中断(insufficient_coins);活动达 durationMinutes 自动完成 | M3 核心玩法闭环开工 |
| 2026-10-04 | M3.1 落地: shared/activities.ts 六类活动目录(数值公式定稿,关闭 requirement §10-5)+start/stop_activity 意图+activity.started/finished 事件(结束原因 completed/stopped/interrupted/insufficient_coins)+快照角色增 activity 字段;server world/activity.ts 逐分钟结算(净增量叠加自然衰减,净负金币结算前判定防透支)+simulation 开始/停止/打断编排+移动中禁 start(先到再开始);单测 6 例+16x debug intent 实测。附带修复——docker-postgres-1 遗留容器(旧版 compose 挂错数据目录)移除后重建 dev 库(-p agent-sims-dev,workspace/postgres-dev+migrate+seed),dev/prod compose 项目名约定写入注释 | M3.1 活动层就绪,M3.2 商店开工 |
| 2026-10-04 | M3.2 落地: shared/shop.ts 商品目录(4 家具+3 食物,可辨识 union——furniture 带摆放 bonus 每分钟被动加成、food 带一次性 effects)+buy_item 意图+快照角色增 items(家具库存,食物即买即耗不入库);server requestBuyItem(结算前余额判定不透支,food 即时结算 clampVital,furniture 入库存)+execute case;单测 7 例+debug intent 实测(打工 120 分赚 60 币→买面包体力+6/买台灯入库/买床余额不足拒绝)。决策——食物买入即结算不设 use_item 意图(保持指令面最小),家具 bonus 字段 M3.2 仅携带、M3.3 摆放后生效 | M3.2 商店就绪,M3.3 房产开工 |
| 2026-10-04 | M3.3 落地: shared/property.ts 房产目录(公寓 租 8 币/日·买断 500)+rent/buy_property/place_furniture 三意图+快照角色增 housing(propertyId/ownership/paidThroughDay/placedItems);server 初始租房(生成即租住公寓预付至次日)+续租顺延(过期从今日起算)/买断免租/摆放(库存→住宅,须有效住宿)+已摆家具每分钟被动加成(欠租即停发,续租恢复);单测 7 例含核心循环串接(打工 120 分赚 60 币→买床+台灯→摆放→加成生效)+debug intent 实测(续租至第 4 日/买床摆放/余额不足与欠租拒绝)。决策——租约欠租不驱逐仅停发加成与禁止摆放(机制留白,面板可见);房产内容随活动/商品先例入 shared | M3.3 房产层就绪,M3.4 前端面板开工 |
| 2026-10-04 | M3.4 落地+**M3 里程碑完结**: socket 意图通道(client→server player.intent+ack,spectator 丢弃=§2.1 只读,非法意图 400 语义回执;集成测试 player 执行/spectator 拒绝/非法拒绝)+web 侧边面板(角色下拉自动选中/数值条/活动面板——所在场所可用活动开始·不在场所显示前往入口·进行中进度条+取消/资产面板——租约与续租买断·库存摆放·已摆列表/商店七商品购买食用)+每 tick 快照驱动即时刷新。浏览器端到端 §11 核心循环闭环实测: 16x 下前往图书馆学习 60 分自动完成→办公楼打工 120 分金币 0→60→购买台灯 15 币入库存→摆放生效→食用蛋糕幸福+10 即时反馈,面板操作与状态全程一致。坑——vite 代理默认 3100 生产容器,dev 须 GAME_SERVER_ORIGIN=http://localhost:3500;清理历史孤儿 tsx watch 进程。M3 收尾待办: 用户验收后合回 main 打 tag(M1~M3 均未执行) | M3 核心玩法闭环全量就绪,M4 Agent 感知/规划开工 |
| 2026-10-04 | **M3.5 启动**(用户反馈驱动插队 M4 前): 角色裸体素体→补装重制;地图 13 tile 均摆小镇→放大+有机布局(广场/主街/簇团);渲染精致化(门窗立面/装饰/相机 2x 跟随);活动动画与头顶气泡指示。素材源不变(Kenney 包 1700 tile 仅用 13、LPC 仅裸体+walk,均为用量问题),细化为 M3.5a~e 五个子阶段,完结后进 M4 | 用户反馈: 画面粗糙/缺活动动画/布局平均不自然/地图偏小/需更精致 |
| 2026-10-04 | M3.5a 落地: LPC 穿衣角色——逐图层像素扫描发现基础款上衣/鞋仅 21 行(无 sit/idle/run 内容),改选全高图层(hair/bob=CC0、pants、overalls 背带工装、shoes2 便鞋均 46 行全动画,授权 OGA-BY/CC-BY-SA/GPL 逐层归档 credits.txt);通用表 832×2944 实测行布局(walk 8-11/idle 22-25/sit 30-33,四向 up/left/down/right),裁切 BOX 50% 缩 32px 得 288×384 紧凑表 ×6 套配色变体(角色 id 稳定哈希分配);WorldScene 三组四向动画状态机(activity≠null→sit 坐姿,静止→idle 呼吸,移动→walk)。坑——Phaser 场景类不走 vite HMR,改码后须整页刷新;16x 下 120 分活动仅 7.5 实秒,验收切 1x。浏览器实测: 四角色四配色同屏、行走迈步/门口坐姿/站立呼吸三态可辨 | M3.5a 完结,M3.5b 小镇布局重排开工 |
| 2026-10-04 | M3.5b 落地: TOWN_MAP 32×24→56×40(约 2.9 倍,计划行原文"40×30"系笔误顺手修正)——中央广场 12×11 压十字主街交点,北排公寓 12×8/图书馆 11×8/办公楼 10×8,南排商店 7×8/餐厅 9×8/健身房 11×8 沿广场南缘,公园扩 15×10 移居西南(池塘 4×4 水系收边+6 树);shared TileMapDefinition 增 `paths: BlockedRect[]`(主街/广场/门前小路,仅视觉可行走,server TileMap 零改动),WorldScene 主循环铺装渲染+POND_RECT/PARK_TREES 同步;测试坐标九文件回归(map/pathfinding fixture 补 paths/property/activity/execute/sync/character/shop/sim-run)。坑——公园 `_fillPlace` 后铺会盖掉园内池塘水面(旧布局池塘在园外不触发),修复为铺装跳 blockedRects;dev 端口——3100 被生产 Docker 容器占用,dev 须 `GAME_PORT=3500`+`GAME_SERVER_ORIGIN=http://localhost:3500`;放大截图用 `transform: scale(2)`(body zoom 会改 layout 尺寸触发 Scale.FIT 重置)。验收: ASCII 七入口核对+浏览器跨图寻路(18/16 格)到达+2x 放大坐姿/铺装可辨 | M3.5b 完结,M3.5c 渲染精致化开工 |
