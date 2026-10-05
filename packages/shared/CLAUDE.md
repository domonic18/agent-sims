# agent-sims Shared - Claude Code AI 上下文文件

> 本目录下的规则是对项目根目录 [CLAUDE.md](../../CLAUDE.md) 通用规则的补充。请先阅读根目录的通用规则。

## 1. 定位

前后端**唯一协议真相源**: Zod schema + 派生 TS 类型(意图指令集/世界事件/世界状态/后台 DTO)。被 `@sims/server` 与 `@sims/web` 双端引用。

**本包不放任何业务逻辑与 I/O**,只放协议定义与纯类型工具。

## 2. 规范

### 变更纪律(必须遵守)

- **改协议先改这里**: 新增指令/事件/字段必须先在本包定义,再两端实现;禁止两端各自私加字段
- 增量演进: 新字段优先可选(带默认值语义放消费端);破坏性变更必须 server/web 同一提交内同步升级,并在 `docs/plan/01-development-plan.md` 变更记录登记
- schema 与派生类型一致: `z.infer` 为唯一类型来源,禁止手写与 schema 平行的 interface

### 命名约定

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件 | 按域分文件 | `intents.ts` / `events.ts` / `state.ts` / `admin.ts` |
| Schema | camelCase 变量 | `moveToIntentSchema` |
| 派生类型 | PascalCase | `MoveToIntent` |
| 联合判别 | 点分字符串 | `"intent.completed"` / `"agent.bubble"` |
| 枚举常量 | UPPER_SNAKE_CASE | `ACTIVITY_TYPES` |

### 导出

- `src/index.ts` 桶导出,双端只从包根 import
- 不确定归属的协议先放对应域文件,跨域复用再上提

## 3. 任务完成后检查清单

1. `pnpm --filter @sims/shared build && pnpm --filter @sims/shared check`
2. **双端联动**: `pnpm --filter @sims/server check && pnpm --filter @sims/web check` 必须一起通过
3. **每轮迭代 CodeReview**: 按根 CLAUDE.md §3 执行
