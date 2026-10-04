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
- 状态: **已完成**(2026-10-04)——M3.5a~e 全部落地并实测(穿衣角色重制/地图 56×40 有机布局/38 tile 渲染精致化+相机/活动气泡与姿态映射/端到端走查);验收项逐条过: 六活动气泡同屏、昼夜对比、布局自然无均摆感、门窗立面+六色屋顶可辨、2x 画面精致、60fps

| 子阶段 | 状态 | 范围 | 验收 |
|--------|------|------|------|
| M3.5a 角色形象重制 | S ✅(2026-10-04) | LPC 穿衣角色合成: body+hair/bob(CC0)+pants+overalls 背带工装+shoes2 便鞋(逐层授权见 assets/character/credits.txt);通用表裁 rows 8-11 walk(9 帧)/22-25 idle(前 2 帧呼吸)/30-33 sit(前 2 帧),BOX 50% 缩 32px,6 套配色变体按角色 id 稳定哈希分配;WorldScene 动画状态机(walk/idle/sit 三组四向)+inActivity 驱动坐姿 | 浏览器见穿衣角色四向行走/坐姿/待机呼吸 |
| M3.5b 小镇布局重排与放大 | M ✅(2026-10-04) | TOWN_MAP 放大(32×24→56×40)重设计: 中央广场(12×11)+十字主街+三簇团——居住(公寓+公园,西南)/文教(图书馆+办公楼,东北)/商业(商店/餐厅/健身房,广场南缘一线);TileMapDefinition 新增 paths 铺装字段(主街/广场/门前小路,仅视觉可行走,协议先行);公园扩至 15×10 含 4×4 池塘水系收边+6 树;WorldScene 硬编码(POND_RECT/PARK_TREES)同步+铺装渲染+公园铺装跳障碍格;测试坐标九文件全量回归 | 单测 91 全绿+debug map ASCII 核对(七入口/三排建筑/池塘就位);浏览器: 四角色跨图寻路到达、活动中坐姿、2x 放大布局有机可辨识 |
| M3.5c 地图渲染精致化 | M ✅(2026-10-04) | Kenney 包扩裁 13→38 tile: 八向水岸/灰石广场/花草 meadow/六场所屋顶(棕·公寓/浅灰·办公楼/洋红·图书馆/橙·商店/红橙·餐厅/蓝青·健身房,餐厅健身房原表无实色 fill 以主色平底+屋脊细节瓦合成)/松圆秋树灌木/三色花丛/栅栏/火炬灯/野餐桌/门窗/双色遮阳篷(商店橙·餐厅绿作招牌);建筑真立面——上侧屋顶色块+底部两行墙身(上层窗交错、底层入口门、商铺门上篷),公园草皮+稀疏花丛+树/灌木/野餐桌/园灯+北缘栅栏入口留豁,街灯/广场灯点缀;相机默认 2x lerp 跟随选中角色,滚轮 1x~4x 围绕指针缩放,1x 自动停跟回中全图 | 浏览器: 2x 下门窗/遮阳篷/水岸/花丛细节可辨,1x 全图六屋顶色两两区分;滚轮缩放与切换选中角色跟随平滑(跟踪 alice 跨图/切 bill 镜头移交) |
| M3.5d 活动动画与状态指示 | M ✅(2026-10-04) | 快照 `activity.elapsedMinutes` 协议现成字段直用(零协议改动);WorldScene 头顶活动气泡——白底圆+emoji 图标(study📖/work🔨/rest💤/workout💪/stroll🚶/meal🍽️)+绿色环形进度(elapsed/duration 客户端算,仅 elapsed 变化重绘)+呼吸浮动;活动→姿态映射: 坐四项(study/work/rest/meal)+健身=原地 walk 动画+散步=站立 idle;活动结束气泡销毁 | 浏览器: 六活动气泡与进度弧同框可辨(eve💤25/60·frank📖48/60 弧随 tick 增长,dave🍽️+gina💪 双气泡同框),gina 原地跑两帧步态对比有差异,alice🚶站立,活动结束气泡消失;边缘角色镜头受 setBounds 钳制属预期(内部角色 frank 精确居中验证) |
| M3.5e 端到端验收 | S ✅(2026-10-04) | 六角色全活动 1x 全图同屏走查(eve💤公寓/frank📖图书馆/bill🔨办公楼/alice🚶公园/dave🍽️餐厅/gina💪健身房)+昼夜对比(22:00~06:00 判夜,夜色 overlay 像素实测 -35%)+性能(1x 全图最重负载 rAF 实测 60fps)+§11 暂停冻结复验(tick 冻结/恢复续走/活动进度保留);反馈三条(画面粗糙/缺活动动画/布局均摆地图偏小)随 a~d 逐项关闭 | 日/夜两张六气泡全景截图验收;§11 渲染相关条目+本轮用户反馈三条全部关闭 |

### M3.6: 人工可玩验证(精细打磨,进 M4 前的质量闸)

- 规模: M
- 背景: 用户决策——M4 Agent 自治前,先由人类玩家操控角色验证游戏可玩、功能全部正常,再进 Agent 开发,便于问题定位(区分"游戏逻辑坏"与"Agent 决策坏")。人类操控界面与 Agent 动作空间同构(同一意图协议 7 类指令),本里程碑产出即 M4 的动作空间人工调试器,亦是 §2.2"自己操作"与 §11 验收项的前置
- 已定稿(2026-10-04 用户确认):
  - 操控模式=**上帝视角**: 下拉/点击选任意角色操作(§2.2 正式"玩家角色接管⇄托管切换"留 M4 一并做,避免返工)
  - **两步语义**: move_to 到达后显式 start_activity,服务端不做"到达自动接活动";复合意图 go_and_do 不加,等 M4 Agent 实际规划需求再议
  - **验收边界**: 本里程碑=功能验证(清单全过+无阻断缺陷),**不含**数值平衡与"好玩"调优(留 M4 随 Agent 经济观察调整),防无限打磨
- 任务:
  - 操控补全: 地图直接操作(点击可行走格→move_to;点击建筑→侧栏面板联动定位该场所动作;点击角色→切换操控对象)+操作结果即时反馈(IntentResult 语义回执 toast,成功轻提示/失败醒目)
  - **独立调试页**(用户补充需求): web 内新路由(/lab,主页面状态栏小入口)——全操作列举的操作台,与主页面同一 socket/worldStore 协议层;操作台按 7 意图分组给参数表单+执行按钮,回执日志逐条记录(时间/tick/意图摘要/ok/message),世界状态只读区(时钟/角色数值);地图视图与主页面复用同一场景组件。该页即 M3.6c 逐条走查的执行载体,亦是 M4 Agent 动作空间的持续调试器
  - 行动清单走查: docs/qa/playable-checklist.md 沉淀 7 意图全量操作清单(move_to/start_activity×6/stop_activity/buy_item×7 商品/rent/buy_property/place_furniture),逐条覆盖正常流+拒绝流(不可行走/不可达/余额不足/移动中开展活动/重复活动/无住宿摆放/租约过期摆放/食物当家具/未知目标…),走查操作统一经调试页执行
  - 设计定稿: 七个开放设计点逐条结论(维持现状/需修改),修改项转修复任务: ①体力归零无硬约束(不休息永动机漏洞) ②buy_item 无位置约束(网购语义 vs 商店建筑无功能) ③租约过期仍可 rest(start_activity 不查租约,与 place_furniture 不一致) ④无"停止移动"指令(stop_activity 只停活动) ⑤食物即买即吃不可囤粮 ⑥无睡眠机制(rest 无昼夜限制,§2.7 在 M4+) ⑦Agent 移动原语取向(用户验收提出: move_to 坐标 vs 方向原语;预案: 协议保持 move_to,方向键为人类输入层客户端合成,见 M3.6d changelog)
  - 修复回归: 走查与定稿产出的缺陷修复+清单回归

| 子阶段 | 状态 | 范围 | 验收 |
|--------|------|------|------|
| M3.6a 地图直接操控+操作反馈 | M ✅(2026-10-04) | WorldScene 指针交互——点击可行走格下发 move_to(含步行动画沿途可见)、点击建筑矩形联动侧栏面板(高亮该场所可用活动/前往入口)、点击角色切换选中;意图回执 toast(IntentResult.message 成功/失败分流);协议零改动(全部复用现有 7 意图) | 浏览器: 点击空地角色走过去、点击建筑面板跳转、非法点击(水面/建筑体)有语义拒绝提示、操作成功/失败均有可见反馈 |
| M3.6b 独立调试页(全操作列举) | M ✅(2026-10-04) | web 新路由 /lab: 地图视图复用 WorldScene+操作台——7 意图分组参数表单(move_to x,y/start_activity 六活动下拉/stop_activity/buy_item 七商品下拉/rent·buy_property/place_furniture)+执行按钮;回执日志(时间/tick/意图/ok/message,最新在上);世界状态只读区(时钟/tick/角色三数值);入口=主页面状态栏小链接;不做批量脚本与断言自动化(回归靠单测+/debug API) | 浏览器: /lab 页可对任意角色执行全部 7 意图并看到回执与状态变化;主页面不受影响 |
| M3.6c 行动清单+人工全量走查 | M ✅(2026-10-04) | docs/qa/playable-checklist.md: 7 意图 ×(正常流+各拒绝流)37 条 9 组,含主链路(移动→到达→开始→进行中→自动完成/中止)与经济链路(打工赚币→消费→房产→家具加成)两条串测;统一经 /lab 调试页执行(协议层边界 2 条经 /debug/intent),每条记录 通过/缺陷号 | 清单全绿(37/37 ✅ 零缺陷),无需转 M3.6d 缺陷项 |
| M3.6d 设计定稿+缺陷修复回归 | S(进行中) | 七设计点逐条定稿落档(维持/修改);修改项实现+清单回归+单测补齐;用户容器验收反馈修复(首批已落地: 全屏 HUD+方向键步进;二批: 页面角色收口+lab 全屏化+前往/活动解耦) | 七点全部落档,缺陷清零,门禁绿 |
| M3.6e 建筑内景与家具素材 | M(预案,待用户确认) | 用户验收反馈③: 角色可进入建筑物,室内有桌子/椅子/办公桌/跑步机等素材。方案预案: 单地图透视内景(模拟人生剖切风,同一 56×40 地图)——建筑由实心立面改为可行走内景(墙圈+门洞连通室内地板,屋顶取消/半透明);家具素材=活动锚点(书桌→学习、办公桌→打工、跑步机→健身、床→休息、餐台→就餐),角色走至锚点相邻格执行,姿态与家具匹配(坐椅/卧床);服务端 blockedRects 细粒度化(室内可行走、墙/家具阻挡,寻路经门);placeIds 启用多场所(如 study 加 home 书桌);玩家购买家具可摆放进自家内景(place_furniture 落格,M4 房间编辑雏形);素材优先 Kenney tileset 现有帧,不足补 0x72/LPC 免费素材 | 内景可视可走,活动锚点经家具表达,清单回归绿 |

- 验收标准: 行动清单全绿+六设计点定稿落档+无阻断缺陷;产出的人工操控界面(主页面地图操控+/lab 全操作调试页)即 M4 玩家接管模式与动作空间调试的地基

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
| 2026-10-04 | M3.5c 落地: tile 条带 13→38(裁切脚本重生成)——程序化选色替代目测(像素采样定六屋顶主色,避开会与草同色的绿组/与水面相近的青组;透明底 props 角像素 alpha 验证),八向水岸/广场/花草/门窗/遮阳篷/栅栏/火炬灯/野餐桌全就位;坑——原表 rows 26-28 之外多记了 5 个 tile 坐标(pine/tree/autumn/bush/lamp 全差一行落到家具区: 火炬灯/营火/烛台/镜子),长椅 tile 在该包中不存在以木桌代野餐桌,餐厅·健身房无实色屋顶 fill 以"主色平底+屋脊细节瓦 alpha 叠加"合成(与 Kenney 纯色 fill 观感一致);渲染——建筑真立面(上侧屋顶色+两行墙身: 上层窗交错/底层入口门/商铺门上篷招牌)+池塘按格位 8 向岸+公园花丛树桌灯栅栏(入口 x9 留豁)+街灯广场灯,装饰三层分离(底瓦/props d5/overlay d6,角色 d10);相机——默认 2x lerp(0.15)跟随 store 选中角色,滚轮 1x~4x 围绕指针缩放(setZoom 前取 getWorldPoint 锚点,缩放后 setScroll 回填),1x 自动 stopFollow+centerOn 全图,放大自动重挂跟随。验收: 2x 门窗/篷/水岸/花丛细节可辨,1x 六屋顶两两区分,跨图跟随与切角色镜头移交平滑 | M3.5c 完结,M3.5d 活动动画气泡开工 |
| 2026-10-04 | M3.5d 落地: 快照 `activity.elapsedMinutes` 系协议现成字段,零协议改动;WorldScene 增头顶气泡容器(depth 随角色节点)——白底圆+黑描边+emoji 活动图标(📖🔨💤💪🚶🍽️)+绿色进度弧(elapsed/durationMinutes 客户端算,<2% 不画避免零弧闪烁),仅 elapsed 变化才重绘,呼吸浮动 sin(now/400);姿态映射 ACTIVITY_POSES——study/work/rest/meal 坐姿、workout 原地 walk 动画、stroll 站立 idle,活动结束即销毁气泡。坑——边缘角色(如 gina x47/56)跟随镜头被 setBounds 钳在图缘无法居中,一度误判为 lerp 不收敛 bug,像素级验证(右缘 0 背景色=地形贴边)+内部角色 frank 精确居中对照后确认系预期钳制行为;活动有时长,验收须开活动后立即截图(1 tick≈1s,stroll 20min 约 20s 窗口)。验收: 六活动气泡/进度弧全见(eve💤25/60·frank📖48/60 弧随 tick 增长·dave🍽️+gina💪 同框),gina 两帧步态差异实证原地跑,alice🚶站立,结束气泡消失 | M3.5d 完结,M3.5e 端到端验收待启动 |
| 2026-10-04 | M3.5e 落地+**M3.5 里程碑完结**: 六角色全活动 1x 全图同屏走查(eve💤公寓/frank📖图书馆/bill🔨办公楼/alice🚶公园/dave🍽️餐厅/gina💪健身房,六气泡+六色屋顶+广场路网+公园池塘单屏全可辨)+昼夜对比(判夜 22:00~06:00,overlay 0x0a1436@α0.38 同点位像素实测 -35%,日/夜两张全景验收图)+§11 渲染条目复验——暂停→tick 686 冻结 2.5s 不动、恢复续走且活动进度保留(eve/frank 59/60 在续),1x 全图最重负载 rAF 实测 60fps(3s/181 帧)。坑——夜色压暗系轻度调色,小图目检两度误判"overlay 未生效/画布冻结"(64×36 下采样探针会把气泡呼吸级微动抹成"无变化"),同点位像素采样三图一致暗 35% 才确认无 bug;运行时排查用 window 临时钩子读 scene 内部(用后即撤);server 重启后 spawn 六角色,zsh for 循环 `set --` 不分词静默失败(第二次踩),显式逐条 curl 替代。反馈三条全关: 画面粗糙(a 角色重制+c 门窗立面/花草/水岸)、缺活动动画指示(d 气泡+姿态映射)、布局均摆·地图偏小(b 56×40 广场主街簇团)。M3 收尾待办: 用户验收后合回 main 打 tag(M1~M3 均未执行) | M3.5 完结,M4 Agent 内核与托管开工 |
| 2026-10-04 | **M3.6 立项**(用户决策,M4 前质量闸): 人类玩家上帝视角操控验证可玩后再进 Agent 开发,便于定位"游戏逻辑 vs Agent 决策";人类操控与 Agent 动作空间同构(同一 7 意图协议),产出即 M4 接管模式地基。已定稿: 上帝视角(正式接管切换留 M4)/两步语义(move_to→显式 start_activity,不加 go_and_do 复合)/验收边界=功能验证不含数值调优。行动空间全量盘点落档: 7 意图(move_to·start/stop_activity×6 活动·buy_item×7 商品·rent/buy_property·place_furniture)+被动系统(衰减 0.05/0.03 每分、昼夜 22~06),六开放设计点(体力零硬约束/buy_item 无位置/租约一致性/无停止移动/食物不可囤/无睡眠)留 M3.6d 逐条定稿。子阶段: a 地图直接操控+回执 toast→b 独立调试页 /lab(全操作列举,用户补充)→c 行动清单 30 条人工走查(经调试页执行)→d 定稿+修复回归 | M3.6 计划待用户确认后开工 |
| 2026-10-04 | M3.6a 落地: toastStore(zustand,最多 4 条/3.2s 自动消退/pushToast 供 Phaser 直调)+Toasts 组件(画布底部居中悬浮,✓绿框/✗红框分流,点击可提前关);WorldScene `_handleMapClick` 三分支——点角色(命中盒 |dx|≤10 且 y∈[node-28,node+8])→selectCharacter、点建筑矩形(排除 park 可行走)→focusPlace(id)+「已定位」toast、其余空地→无选中先提示/有选中经 sendIntent move_to 由服务端裁决(拒绝语义原样上 toast);worldStore 增 focusPlaceId(与 selectedCharacterId 同级,快照覆盖不清理);SidePanel——run() 回执双写(底部 feedback+toast)、活动行/商店区块挂 `place-row-{placeId}` 锚点+focused 黄底高亮、useEffect scrollIntoView 联动。坑——验收用固定相机推算点击坐标,镜头跟随目标移动后 scroll 钳制值变化会导致点击落点偏移(点击语义仍正确,由服务端就近裁决);Playwright click 须 run_code 用页面绝对坐标(canvas FIT letterbox 换算)。浏览器验收全过: 点 Eve 选中切换/点池塘「✗ 目标不可行走: (5,31)」/点商店「✓ 已定位」+黄底高亮+滚动定位/点空地「✓ Eve 前往 (14,26),路径 5 格」且角色实际到达/空地点击清除高亮,console 零报错,门禁 91 测试全绿 | M3.6a 完结,M3.6b 独立调试页 /lab 开工 |
| 2026-10-04 | M3.6b 落地: /lab 独立调试台(react-router lazy 路由)——WorldCanvas 抽取复用(Phaser 生命周期封装,GamePage 同步改用,主页面 chunk 1749kB→7.8kB、Phaser 拆共享 chunk);LabPage 五分组 7 意图表单(move_to x,y/start·stop_activity 六活动下拉/buy_item 七商品下拉/rent·buy_property 双按钮/place_furniture 库存派生)+回执日志(时间·tick·意图摘要·ok/message,最新在上,上限 100)+世界状态只读表(坐标/体力/幸福/金币/活动,选中行高亮);主页面状态栏 lab 入口+lab 返回链接双向;Toasts/WorldScene 地图点击在 /lab 同样生效。走查即逮两 bug 当场修: ①FurnitureForm 挂载时库存空→购买后 select 显示新项但提交 state 仍空(按钮禁死),改"未选择派生回退到首个库存项";②日志 id 模块级计数器 HMR 重载归零撞重复 key(React 每帧报错刷屏,生产无 HMR 不触发),改组件内 useRef。验收(bob 全程): move_to 到达办公楼入口/水面 (5,31) 拒绝;打工 16x 自动完成 +60 币、1x 中途停止 4 tick +2 币;学习错场所拒绝;买咖啡·台灯扣款;续租付至第 4 日;买断 500 币拒(余 31);摆放台灯先遭租约过期拒(设计点③实例)→续租后「摆放,加成生效中」;主页面往返数据一致。坑——16x 下工具往返 9 实秒=141 游戏分,打工 120 分早自动完成,中途停止类验证须 1x;dev server 期间自重启一次角色清空(tick 回退即此信号) | M3.6b 完结,M3.6c 行动清单+全量走查开工 |
| 2026-10-04 | **M3.6c 落地,M3.6c 全量走查零缺陷收官**: docs/qa/playable-checklist.md 37 条 9 组(move 7/活动 10/停止 2/购买 6/房产 4/摆放 4/主链 MC-01/经济链 EC-01/被动 2)全部 ✅,走查主体 carl(0 币满值 spawn)统一经 /lab 下发,仅 PF-03/PF-04 两协议层边界经 /debug/intent。关键实证: ①八类拒绝语义全数原样回执——不可行走坐标(含越界不崩)/金币不足(含售价回显)/错场所「须在场所 X 入口或范围内」/重复「已在进行活动」/「移动中,到达后再开始活动」/「租约已过期(付至第 N 日)」/食物当家具「是食物,购买时即已食用」/「未知商品」;②六活动方向+量级吻合——学习体 4.7→0 幸 7.5→1.5、健身幸 0→12(+0.32 净/分×40)、休息体 0→26 幸 0→4、就餐体+9 幸+6 币-12、散步幸+2、打工完整 +60 精确/中停 13 分 +6.5 精确按分(activity settle 结算前判定,0 币就餐首分钟即断不透支);③被动系统——衰减 19 游戏时 92→30/95→58 与 0.05/0.03 精确吻合,夜画布亮度 106 vs 昼 158(压暗 33%,PIL 像素实测);④EC-01 全链贯通: 打工赚币→买食物(即买即吃不入库)→续租→买断 500(ownership=owned 免租)→四家具入库(回购同款 UI 去重合并)→台灯摆放生效,每步回执+余额变动留痕。方法论坑: ①体力/幸福 0 值起跑时活动负效果方向不可辨(下限钳制),先喂食物抬升再重测(SA-01 二跑);②续租语义实证 max(过期日,今日)+1(simulation.ts:167)——走查跨日时「付至第 8 日」非预期第 7 日,勿误判 bug;③BP-02 攒币 500 用 bash 直连 /debug/intent 循环打工 12 轮(16x 每轮 7.5 实秒 +60 分毫不差),绕开 MCP 往返延迟;④MV-05(移动打断活动)与 SA-09(移动中拒开活动)互为镜像各验一半;⑤16x 适合"完整周期/攒币"类验证,4x+紧邻读数适合"方向量级"类,中途停止类开跑后须立即停(4x 窗口 30 实秒) | M3.6c 完结,M3.6d 设计定稿+缺陷修复回归开工 |
| 2026-10-04 | **M3.6d 开工**(用户容器验收反馈先行修复): ①主页面全屏化——game-page 改 fixed inset-0 深色底,画布铺满视口(Phaser Scale.FIT 在其内等比缩放,letterbox 与底色融合),状态栏/倍率控制/角色条/最近事件全部转悬浮 HUD(半透明深色圆角面板,文字配色改亮色系),侧栏 absolute 右缘+限高滚动,.game-main display:contents 摘除 flex 包裹;②方向键/WASD 步进移动——WorldScene addKeys 八键,长按向选中角色每步发一格 move_to,步进节奏由快照 pathRemaining 门控(行走中不下发,到达续步),180ms 最小间隔防连发+撞墙拒绝 toast 1.2s 节流防刷屏,焦点在 input/select/textarea 时忽略按键(防 /lab 表单输入串扰)。**设计点⑦新增**(用户验收提出): Agent 移动原语取向——预案为协议保持 move_to 坐标(目标空间语义/服务端统一寻路与碰撞裁决/可校验可重放/与人类地图点击同构),方向键定位为人类输入层客户端合成糖、不进协议不增原语,Agent 侧漫游类行为可由 move_to 组合表达;M3.6d 正式定稿。门禁 check/91 测试/build 全绿 | M3.6d 首批验收反馈修复完成,七设计点定稿进行中 |
| 2026-10-04 | **验收反馈③: 活动操作按钮常驻**(用户反馈侧栏只有「前往」导航、缺睡觉/学习/工作等活动按钮): 原实现活动行按角色是否在场二选一显示「开始/前往」,角色在野外时整列全是「前往」,无活动入口——观感即"只有去地点、没有做活动"。改为活动行常驻「开始」按钮: 在场直接 start_activity;不在场点击先 move_to 前往,到达后由快照驱动 effect 自动接续 start_activity(途中改道/被打断则放弃),途中按钮转「途中…」+行高亮。「前往」保留为纯导航。协议仍两步显式语义,无服务端改动,纯客户端 UI 合成——与设计点⑦"方向键为输入层合成糖"同构。CSS 补列表行 span flex:1/按钮不收缩防换行。首版接续逻辑踩坑: move_to 下发后首个快照尚未反映移动(path 仍 0、坐标仍原地),接续 effect 立即误判"未行进且不在目的地"静默放弃 pending——修复为 pendingArrivalRef 标记"快照已反映行进",未见行进前不判弃。顺带修 web 容器 nginx 缺 /debug 反代(页面倍率按钮 405)。容器实测: 1x 全链(开始→途中…→到达自动开始→进行中/自然完成)+4x 散步全程贯通 | 门禁+容器实测通过,已提交 |
| 2026-10-04 | **验收反馈④: 页面角色收口+lab 全屏化+前往/活动解耦**(用户四条反馈): ①首页转纯观看——WorldScene 增 interactive 开关(WorldCanvas 传 registry,create 时读取),主页面关闭地图移动/方向键/场所定位,仅保留点选角色跟随+滚轮缩放(观看辅助);暂停/倍率控制栏、SidePanel 操作面板、Toast 全量迁出首页;②/lab 全屏化——lab.css 重写为 fixed inset-0 深色 HUD(与首页同规格): 控制栏(暂停/1x/4x/16x)自首页迁入左上,右列 .lab-side 限高滚动整合「快捷操作 SidePanel+7 意图协议表单+世界状态只读表」三段,回执日志转左下悬浮面板(深色主题配色);③前往/活动解耦——SidePanel 拆「前往」「活动」两节: 前往=七场所纯导航(在此标记,地图点击联动 scrollIntoView 仍指向场所行);活动=六活动常驻「开始」(自动前往+到达接续逻辑保留,行 id 改 activity-row-*,场所名显示 placeIds join);**协议层配套**: ActivityDefinition.placeId→placeIds: readonly string[](场所与活动解耦的数据地基,为"将来在公寓书桌学习"预留),服务端 start_activity 校验改任一场所命中,单场所内容下行为与回执文案零变化(91 测试全绿);④建筑内景立项 **M3.6e**(用户反馈人物无法进入建筑物): 方案预案=单地图透视内景(模拟人生剖切风),家具素材作活动锚点,详见 M3.6e 行——待用户确认方案后开工 | 门禁 check/91 测试/build 全绿,容器实测与 M3.6e 确认进行中 |
