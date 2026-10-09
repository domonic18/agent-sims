import type { FastifyInstance } from 'fastify';
import { SOCKET_EVENTS, type AgentDecisionMessage } from '@sims/shared';
import { attachMemoryWriter } from './agents/memory-writer.js';
import { attachMemoryConsolidator } from './agents/memory-consolidation.js';
import { attachNarrator } from './agents/narrator.js';
import { attachMoodTracker } from './agents/mood.js';
import { AgentScheduler } from './agents/scheduler.js';
import { ModelRouter } from './llm/router.js';
import { whenTechLogIdle } from './telemetry.js';
import { attachWorldEventLog } from './world/event-log.js';
import { attachWorldParamPersist } from './world/param-persist.js';

/**
 * 运行时子系统装配(buildApp 专用):世界事件落库/参数存档订阅、LLM 记忆管线
 * (写入/梦境固化/自我叙事/情绪打标)、Agent 调度泵与 onClose 关停顺序
 * (先退订停泵,io 先于 fastify 关停避免双路并发 close 竞态,技术日志冲刷后断库)。
 * 只管订阅与生命周期,不含路由注册。
 */
export function bootstrap(app: FastifyInstance): void {
  const handle = app.db;
  const sim = app.simulation;
  // 世界事件落库+参数存档订阅(EventBus 零 I/O,宿主侧串行链写入)
  const eventLog = attachWorldEventLog(handle, sim.events);
  const paramPersist = attachWorldParamPersist(handle, sim.events);
  // 记忆写入(M4b/A2):订阅同一总线,管线异步走 Jev/embedding,不阻塞 tick;
  // llm 装饰器供检索 API 复用(测试可覆写为桩)
  app.decorate('llm', new ModelRouter(handle));
  const memoryWriter = attachMemoryWriter(sim, handle, app.llm);
  // 梦境固化(M5):订阅 sleep.settled,睡饱者次晨慢槽整理当日记忆产 dream,离线照常
  attachMemoryConsolidator(sim, handle, app.llm, memoryWriter);
  // 自我叙事演化(C5): 订阅 settled/debt 周级锚与里程碑事件,慢槽修订「我是谁」
  const narrator = attachNarrator(sim, handle, app.llm, memoryWriter);
  // 情绪打标(C2):订阅世界事件按规则表写冲量流水,零模型,离线照常
  const moodTracker = attachMoodTracker(sim, handle);
  // Agent 调度泵(M4c/M4d):自治角色默认空集(开关走 admin API),react 气泡经独立 socket 事件广播
  const agentScheduler = new AgentScheduler({
    sim,
    handle,
    llm: app.llm,
    memoryWriter,
    onBubble: (message) => {
      app.io.emit(SOCKET_EVENTS.decision, message satisfies AgentDecisionMessage);
    },
  });

  app.addHook('onClose', async () => {
    eventLog.dispose();
    paramPersist.dispose();
    agentScheduler.dispose();
    moodTracker.dispose();
    narrator.dispose();
    // io.close 同时关闭底层 http server,先于 fastify 关停以避免双路并发 close 竞态
    await new Promise<void>((resolve) => {
      app.io.close(() => resolve());
    });
    // 先冲刷技术日志串行链再断库,避免关停窗口丢尾条
    await whenTechLogIdle();
    await handle.client.end();
  });
}
