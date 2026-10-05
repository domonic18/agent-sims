# 01-像素模拟人生与 Agent 代玩技术调研

> 调研日期: 2026-10-03
> 目的: 为 agent-sims(像素风模拟人生,角色可托管 AI Agent 代玩/接管)的技术架构提供依据。

## 1. 直接对标项目

### 1.1 Generative Agents / Smallville(斯坦福,2023)——本项目最重要的参照

- 论文 *Generative Agents: Interactive Simulacra of Human Behavior*(Park et al., UIST 2023),官方开源 `github.com/joonspk-research/generative_agents`
- 形态: 25 个 LLM Agent 在 Sims 风格 2D 小镇生活,呈现涌现行为(情人节派对自组织、信息在 Agent 间传播)
- **技术栈与我们高度一致: Phaser 渲染 2D 世界 + Web 后端**——验证了 Phaser 路线可行
- 核心架构(可直接借鉴为我们的 Agent 代玩内核):
  - **Memory Stream**: 观察(事件)流式存储,按 新近度×重要性×相关性 三因子加权检索
  - **Reflection**: 由底层记忆合成高层洞察(如"张三喜欢画画"),反哺后续决策
  - **Planning**: 先生成日程计划,执行中对环境变化做响应式重规划
  - **Dialogue**: 基于记忆检索生成符合关系的对话
- ⚠️ 成本教训: 原版单次模拟运行 API 成本数百美元;已有后续研究 *Affordable Generative Agents*(OpenReview)专门降本——**成本设计必须进入我们的架构,不是优化项**

### 1.2 AI Town(a16z-infra / Convex,2023,MIT)

- `github.com/a16z-infra/ai-town`: 受 Generative Agents 启发的可二开虚拟小镇
- 技术栈: **TypeScript 全栈** + Convex(后端状态/记忆管理)+ Pixi(渲染)+ LLM API + TTS
- 价值: MIT 协议可自由参考其 TS 工程结构、角色/记忆/对话的数据建模

### 1.3 Wild Willows(TS + React/Vite + Phaser 3)

- `github.com/baileydunning/wild-willows`: 开源 cozy 风生活模拟
- 价值: **React 做 UI 外壳(面板/HUD)+ Phaser 做游戏画布**的工程组合实例,与我们「数值面板+游戏画面」的结构一致

### 1.4 生态空白确认

- 未发现高知名度的开源「Phaser 3 模拟人生类」游戏;最接近的是 RimWorld 类(Magical Life)与城市建造类(Cytopia)
- **「可托管 Agent 代玩的像素模拟人生」在开源界是空白**——创意差异化得到验证

## 2. 「Agent 代玩」的两条技术路线(关键架构决策输入)

| | 路线 A: 原生集成(Generative Agents 路线) | 路线 B: 屏幕控制(Cradle 路线) |
|---|---|---|
| 原理 | Agent 透过**游戏状态 API** 观察世界、下发意图指令,是游戏世界一等公民 | Agent 像人一样**看截图、控制鼠标键盘**操作游戏客户端 |
| 代表 | Generative Agents / AI Town | Cradle(BAAI,ICML 2025,已玩过 RDR2/星露谷/城市天际线/**模拟人生**) |
| 优势 | 低延迟、低成本、意图级精确、天然支持"随时接管" | 游戏零改造,可验证任意游戏 |
| 劣势 | 需要自建游戏 API/指令层 | 慢、贵、视觉误判率高、接管切换体验差 |
| 对我们 | **✅ 自研游戏必然选 A**——托管/接管就是同一状态机切换操作权 | 仅作体验验证参照,不采用 |

Cradle 的六模块(信息收集/自我反思/任务推断/技能沉淀/行动规划/记忆)仍值得借鉴为路线 A 的 Agent 内部结构。

## 3. 支撑技术组件

- **记忆与终身学习**: Voyager(Minecraft,首个 LLM 终身学习 Agent,技能库以代码形式沉淀)——启发: 玩家 Agent 的"成长"可用可沉淀的记忆/技能表示
- **人设一致性(人格衍生)**: Persona-aware 对齐研究(2025,角色扮演与目标人设对齐)、AI companion 身份协商研究(arXiv 2026-01)——「Agent 社交行为符合玩家人设」有现成方法论: 人设卡+对话风格约束+记忆检索
- **综合参考**: ACM CSUR 综述 *A Survey on LLM-based Game Agents*(git-disl/awesome-LLM-game-agent-papers)——最全论文索引,后续深入按图索骥

## 4. 对本项目架构的初步启示

1. 渲染层 Phaser 3 + UI 外壳(React)分离;参考 Smallville/AI Town 的世界状态同步方式
2. Agent 代玩内核 = 人设卡 + Memory Stream(三因子检索)+ Reflection + Planning + 意图指令集;**这是项目的技术护城河,应最先做原型验证**
3. 成本分级设计: 高频小决策用小模型/规则,低频反思/对话用大模型;预算告警进面板
4. 托管/接管 = 游戏操作权的原子切换,架构上 Agent 与玩家走**同一套意图指令层**,只是指令来源不同
5. 多人文字交流可参考 AI Town 的对话流实现

## 5. Sources

- [Generative Agents 官方开源 (joonspk-research/generative_agents)](https://github.com/joonspk-research/generative_agents) / [论文解读: 记忆-反思-规划架构](https://www.emergentmind.com) / [Smallville 涌现行为讨论](https://summify.io)
- [Affordable Generative Agents (OpenReview)](https://openreview.net)
- [AI Town 项目介绍](https://grokipedia.com) / [Hugging Face 收录页](https://huggingface.co) / [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town)
- [Wild Willows (TS+React+Phaser3 生活模拟)](https://github.com/baileydunning/wild-willows) / [CFWK: Phaser 3 像素优先渲染实践](https://github.com)
- [Cradle: 通用计算机控制 Agent (ICML 2025)](https://icml.cc/virtual/2025/poster/46393) / [项目页](https://baai-agents.github.io/Cradle/) / [GitHub](https://github.com/baai-agents/cradle)
- [Voyager: 开放式终身学习 Agent](https://community.libretranslate.com)
- [ACM CSUR: LLM Game Agents 综述论文索引](https://github.com/git-disl/awesome-LLM-game-agent-papers)
- [Persona-aware 对齐 / AI Companion 身份研究 (arXiv 2026-01)](https://arxiv.org)
