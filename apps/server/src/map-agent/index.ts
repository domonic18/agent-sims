/**
 * deepagents 装配(批C):单例 agent(checkpointer 持久对话)+ 按模型指纹
 * 缓存实例(配置变更自动重建);PostgresSaver 独立 pg 池复用 DATABASE_URL。
 */
import { Pool } from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { createDeepAgent } from 'deepagents';
import type { DbHandle } from '../db/client.js';
import { env } from '../config/env.js';
import { logTech } from '../telemetry.js';
import { loadChatModel } from './model.js';
import { buildMapAgentSystemPrompt } from './prompt.js';
import { createMapTools } from './tools.js';

let checkpointerPromise: Promise<PostgresSaver> | null = null;

async function getCheckpointer(): Promise<PostgresSaver> {
  checkpointerPromise ??= (async () => {
    const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    const saver = new PostgresSaver(pool);
    await saver.setup();
    logTech('info', 'map-agent', 'checkpointer 就绪');
    return saver;
  })();
  return checkpointerPromise;
}

type MapAgent = Awaited<ReturnType<typeof createDeepAgent>>;

let agentFingerprint: string | null = null;
let agentPromise: Promise<{ agent: MapAgent }> | null = null;

export async function getMapAgent(handle: DbHandle): Promise<MapAgent> {
  const { model, info } = await loadChatModel(handle);
  if (agentPromise === null || agentFingerprint !== info.fingerprint) {
    agentFingerprint = info.fingerprint;
    agentPromise = (async () => {
      const checkpointer = await getCheckpointer();
      const agent = createDeepAgent({
        model,
        tools: createMapTools(),
        systemPrompt: buildMapAgentSystemPrompt(),
        checkpointer,
        name: 'map-agent',
      });
      logTech('info', 'map-agent', 'agent 装配完成', { model: info.model });
      return { agent: agent as MapAgent };
    })();
  }
  const { agent } = await agentPromise;
  return agent;
}
