# agent-sims

> 像素风模拟人生网页游戏:玩家在模拟城市中学习/工作/生活,体力值+幸福值驱动活动反馈,打工赚金币用于消费、租房、买房、买家具;核心差异化——角色可随时托管给 AI Agent 代玩、也可随时接管,Agent 是玩家"人格的衍生",社交行为符合玩家人设,玩家之间可文字交流

## 技术栈

- 客户端: Vite + React + Phaser 4(Zustand 唯一状态源)
- 服务端: Node.js + TypeScript + Fastify 单进程(世界模拟 + Agent 内核)
- 数据: PostgreSQL + pgvector(Drizzle ORM,迁移 forward-only)
- 实时: Socket.IO(快照+增量,玩家/参观者同流)
- 模型: ModelRouter 适配(慢思考 LLM / 轻量对话 LLM / Jev / embedding,后台可配)
- 交付: Docker Compose(app + postgres 两容器)

## 快速开始

```bash
# 1. 复制环境变量
cp .env.example .env

# 2. 启动开发数据库(仅 postgres 容器)
docker compose -f docker/docker-compose.dev.yml up -d

# 3. 安装依赖并启动(M1 工程基座落地后可用)
pnpm install
pnpm dev
```

生产部署: `docker compose -f docker/docker-compose.yml up -d`

## 文档

完整文档见 [docs/README.md](docs/README.md)：

- **需求基准**：[docs/requirement/](docs/requirement/)
- **架构设计**：[docs/arch/](docs/arch/)
- **迭代计划**：[docs/plan/01-development-plan.md](docs/plan/01-development-plan.md)
- **调研评估**：[docs/research/](docs/research/)

## 目录结构

```
apps/web/        游戏客户端(Vite + React + Phaser 4)
apps/server/     游戏服务端(世界模拟/Agent内核/接口,单进程)
packages/shared/ 前后端共享 Zod 协议
docker/          Dockerfile 与 compose(生产/开发)
docs/            文档中心(需求基准/架构终态/迭代计划/调研评估)
scripts/         运维与工具脚本
workspace/       宿主机持久化数据(postgres 数据卷/备份,不入库)
```
