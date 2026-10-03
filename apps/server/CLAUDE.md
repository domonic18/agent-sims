# agent-sims Server - Claude Code AI 上下文文件

> 本目录下的规则是对项目根目录 [CLAUDE.md](../../CLAUDE.md) 通用规则的补充。请先阅读根目录的通用规则。

## 1. 技术栈

- **运行时**: Node.js 22 + TypeScript 5.x(ESM,strict 全开)
- **Web 框架**: Fastify 5
- **实时**: Socket.IO 4
- **数据库**: PostgreSQL 16 + pgvector;Drizzle ORM + drizzle-kit(postgres-js 驱动)
- **校验**: Zod(协议真相源在 packages/shared)
- **加密**: Node crypto AES-256-GCM(主密钥来自 `MASTER_KEY`)
- **测试**: Vitest

## 2. 开发命令

```bash
pnpm --filter @sims/server dev          # 本地开发
pnpm --filter @sims/server build        # 构建
pnpm --filter @sims/server check        # tsc + lint
pnpm --filter @sims/server test         # vitest
pnpm --filter @sims/server db:migrate   # 跑迁移
pnpm --filter @sims/server db:seed      # 幂等 seed
pnpm --filter @sims/server sim:run      # headless 批跑模拟(调试)
```

## 3. 目录结构与依赖方向

```
src/
├── index.ts      # 启动顺序: migrate → seed → 世界循环 → HTTP/WS
├── config/       # env 装载与运行配置(唯一 process.env 读取点)
├── db/           # schema(四域)/seed(幂等基础数据)/连接池
├── world/        # 世界模拟核心: tick/时钟/昼夜/暂停/地图/寻路/数值(纯逻辑零 I/O)
├── agents/       # Agent 内核: perceive/memory/consolidate/reflect/plan/converse
├── intents/      # 意图指令层: Zod 校验/执行/双来源切换
├── llm/          # ModelRouter: provider 适配 + token 记账 + prompt 模板
├── api/          # REST(状态/存档)
├── admin-api/    # 后台接口
├── socket/       # Socket.IO 网关(快照+增量/角色标志)
└── notify/       # 飞书 webhook(加签+串行队列)
```

**依赖方向(强制)**: `world/` 不 import 其他任何 src 模块与基础设施(fastify/socket.io/drizzle/pg 全禁);`agents/` → world/llm/db;接口层(api/admin-api/socket) → world/agents/intents;全部模块可依赖 `@sims/shared`。

## 4. 编码规范

### 命名约定

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件 | kebab-case | `memory-stream.ts` |
| 类型/类 | PascalCase | `IntentCommand`、`WorldClock` |
| 函数/变量 | camelCase | `advanceTick`、`retrieveMemories` |
| 常量 | UPPER_SNAKE_CASE | `TICK_MS`、`REFLECT_THRESHOLD` |
| 私有成员 | 前导下划线 | `_rebuildIndex` |
| DB 表/字段 | snake_case 单数 | `memories.importance` |
| 事件/消息 type | 点分字符串(联合类型判别字段) | `"intent.completed"`、`"agent.bubble"` |

### 常量与配置分层(必须遵守,新增常量先判断属于哪一层)

1. **部署可调参数**(端口/超时/批量大小/URL)→ `config/`(env 装载);**禁止**在业务模块散读 `process.env`
2. **游戏平衡数值**(tick 时长/衰减速率/反思阈值/时间倍率档位/作息时刻)→ `config/balance.ts` 统一管理;需后台热调的落 DB(sys 域)并经 admin-api 暴露
3. **协议常量与枚举**(指令类型/事件名/角色 tier)→ `@sims/shared`
4. **模块私有契约**(仅本模块消费的白名单/注册表)→ 本模块顶部,UPPER_SNAKE_CASE

### 架构强制项(违反视为事故级)

1. **world/ 纯逻辑零 I/O**: 时间经注入 `clock`、随机数经注入 `rng`(测试可复现);这是 headless 跑批与单测的前提
2. **固定 tick 只推进连续量**(位移/数值衰减);离散事件走事件总线;**tick 内禁止发起 LLM 调用**(决策一律事件驱动异步)
3. **世界状态只能经意图指令层变更**: intents 校验(Zod)→执行;禁止业务代码绕过 intents 直接改世界状态
4. **LLM 调用唯一入口 llm/ModelRouter**: 自动记 `token_usage`;禁止业务模块直连模型 API;模型 Key 仅从 `model_configs` AES 解密读取,**禁止读 env**
5. **迁移 forward-only**: drizzle-kit 生成入 git,禁止手改已应用迁移
6. **协议字段双端同步**: 事件/消息结构必须先在 `@sims/shared` 定义,禁止 server 单方面私加字段
7. **/debug/\* 端点仅在 NODE_ENV=development 注册**,生产自动关闭

## 5. 测试规范

- **布局分层**: 单元测试就近与源码同置(`*.test.ts`);集成测试(跨模块/依赖 DB)放包内 `tests/`,目录在首个集成测试落地时创建,不设顶层 tests/
- Vitest;`world/` 单测全覆盖: 时钟推进/暂停冻结/倍率换算/昼夜边界/寻路(正常/绕障/不可达/同格)/移动推进/数值衰减边界
- 时间与随机一律注入,测试 0 延迟连跑(秒级模拟完整游戏日)
- 涉及 DB 的集成测试连 dev compose 的 postgres,归入 `tests/`;整日模拟验证走 `sim:run`

## 6. 任务完成后检查清单

完成后端编码任务后:

1. **类型与规范**: `pnpm --filter @sims/server check`
2. **测试**: `pnpm --filter @sims/server test`
3. **schema 变更**: 迁移已生成且 forward-only,未手改历史迁移
4. **常量落位**: 按 §4 分层检查,无硬编码散落
5. **每轮迭代 CodeReview**: 按根 CLAUDE.md §3 执行,问题清零后收尾
