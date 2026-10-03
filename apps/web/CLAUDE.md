# agent-sims Web - Claude Code AI 上下文文件

> 本目录下的规则是对项目根目录 [CLAUDE.md](../../CLAUDE.md) 通用规则的补充。请先阅读根目录的通用规则。

## 1. 技术栈

- **框架**: React 18 + TypeScript 5.x(strict)
- **构建**: Vite 5
- **游戏渲染**: Phaser 3
- **状态**: Zustand(唯一状态源)
- **实时**: socket.io-client
- **后台**: React Admin(路由级懒加载)
- **测试**: Vitest

## 2. 开发命令

```bash
pnpm --filter @sims/web dev     # Vite 开发服务器(proxy → server)
pnpm --filter @sims/web build   # 生产构建
pnpm --filter @sims/web check   # tsc + lint
pnpm --filter @sims/web test    # vitest
```

## 3. 目录结构约定

```
src/
├── game/    # Phaser:场景/地图/角色渲染/路径插值/昼夜色调
├── ui/      # React:HUD、记忆/日程/对话/活动面板、人设访谈
├── admin/   # React Admin 后台(懒加载,独立 chunk)
├── store/   # Zustand store(唯一状态源,WS 层写入)
├── net/     # Socket.IO client:连接/快照/增量/重连/指令发送
└── main.tsx
```

## 4. 编码规范

### 基础约定

- 组件文件 PascalCase(`ActivityPanel.tsx`);hook 以 `use` 开头;其余文件 kebab-case
- 禁 `any`(必须用时注释原因);组件 props 定义 interface;`import type` 引类型
- 路径别名 `@/` 指向 `src/`

### 状态单向流(必须遵守)

世界状态唯一权威在服务端,客户端只做镜像:

```
WS 增量 → net/ 写入 → Zustand store → Phaser.update() 读(插值渲染)
                                    → React UI selector 订阅
```

- **禁止**在 Phaser scene 或组件内自建世界状态副本;**禁止**反向写 store 绕过 net 层
- 玩家操作只产生意图指令(`net/` 发送),不直接改本地状态等服务器回包

### Phaser

- scene 只做渲染与输入采集;**不直接 fetch/发请求**,一律经 `net/`
- EventBus 仅用于瞬态信号(镜头聚焦/特效),状态一律走 store
- 渲染插值按服务端下发的路径段两点插值,**禁止逐 tick 硬贴坐标**

### 协议与常量

- 协议类型一律 `import type from '@sims/shared'`,**禁止本地重复定义**
- UI 常量(颜色/尺寸/动画帧配置)在模块顶部统一或收 `ui/theme.ts`;素材路径统一资源清单管理,禁止散落硬编码

### admin

- React Admin 经 React.lazy 路由级懒加载,不得进主 bundle 关键路径

## 5. 测试规范

- **布局分层**: 单元测试就近与源码同置(`*.test.ts`);E2E 后置(M8),届时建 `e2e/`(Playwright:暂停端到端/双窗口一致性/断线重连),现在不建
- Vitest: store 逻辑、net 重连状态机、关键面板组件
- 渲染体验类(60fps/暂停端到端/素材显示)走浏览器实测,不写空壳测试

## 6. 任务完成后检查清单

完成前端编码任务后:

1. **类型与规范**: `pnpm --filter @sims/web check`
2. **构建**: `pnpm --filter @sims/web build`
3. **测试**: `pnpm --filter @sims/web test`
4. **浏览器实测**: 涉及交互的功能在浏览器验证(必要时双窗口/暂停/断线重连)
5. **每轮迭代 CodeReview**: 按根 CLAUDE.md §3 执行,问题清零后收尾
