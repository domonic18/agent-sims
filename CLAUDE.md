# agent-sims - Claude Code AI 上下文文件

## 1. 项目概览

- **愿景**: 像素风模拟人生网页游戏:玩家在模拟城市中学习/工作/生活,体力值+幸福值驱动活动反馈,打工赚金币用于消费、租房、买房、买家具;核心差异化——角色可随时托管给 AI Agent 代玩、也可随时接管,Agent 是玩家"人格的衍生",社交行为符合玩家人设,玩家之间可文字交流
- **架构**: 单进程单体——Node.js + TypeScript + Fastify 服务端(世界模拟+Agent内核) + Vite/React/Phaser 3 客户端;Postgres(pgvector)+Drizzle;Socket.IO 快照+增量;Docker Compose 交付(app+postgres)。详见 docs/arch/00
- **关键约束**: 模型与 API-Key 一律经后台管理配置(AES 加密存储),不进 env/代码;DB 迁移 forward-only,禁止手改已应用迁移;成本分级(规则→Jev→轻量LLM→慢思考LLM)是架构级设计

## 2. 项目结构

**⚠️ 执行任何任务前,先读本文件;涉及哪一层,再读 docs/ 对应 arch 文档(按需,勿全量加载)。**

- `apps/web/` 游戏客户端(Vite + React + Phaser 3;src 下 game/ui/admin/store/net)
- `apps/server/` 游戏服务端(单进程;src 下 world/agents/intents/llm/api/admin-api/socket/notify/db)
- `packages/shared/` 前后端共享 Zod 协议(意图指令集/事件/状态类型)
- `docker/` Dockerfile 与 compose(生产 app+postgres / 开发仅 db)
- `scripts/` 运维与工具脚本
- 测试就近放各包内(`*.test.ts` 同置)
- 文档:requirement/(需求基准) arch/(终态方案) plan/development-plan.md(状态真相源)

| 主题 | 文档 |
| ---- | ---- |
| 项目定位与范围 | docs/requirement/01 |
| 总体架构 | docs/arch/00 |

## 3. 通用编码规范与 AI 指令

- 你最重要的工作是管理自己的上下文。规划变更前,务必先阅读相关文件。
- KISS、YAGNI、DRY;单文件不超过 350 行,超限即拆分。
- 未经用户批准不要提交到 git。不要主动创建 *.md/README。
- 永远不要模拟、不要占位符、不要省略代码;对想法的好坏坦率诚实。
- 安全:外部输入边界校验;模型 API-Key 经后台管理 AES 加密存储,永不硬编码;env 仅运行配置(DATABASE_URL/MASTER_KEY 等);日志记事件不记敏感值。
- 状态只更新 plan/development-plan.md,不回填过程。

## 4. 任务完成后协议

1. 运行类型检查 / lint / 测试(命令就绪后固化为根 `package.json` 的 `check` 脚本)
2. 行为变更同步 CLAUDE.md / docs 对应章节
3. 里程碑进展写入 docs/plan/development-plan.md

# 重要指令提醒

按要求做;不多不少。
