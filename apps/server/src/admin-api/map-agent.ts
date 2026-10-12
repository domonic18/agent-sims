/**
 * AI 改图端点(批C):线程索引 CRUD + runs SSE(messages/updates/custom 三通道)。
 * 文档来源=请求体编辑器当前定义优先、maps 表兜底;run 结束按 mutated 异步回写
 * 草稿(agent 不直接落库,人工保存同一门禁);token 记账收口 usage_metadata。
 */
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TileMapDefinition } from '@sims/shared';
import type { DbHandle } from '../db/client.js';
import { mapAgentThreads, maps } from '../db/schema/index.js';
import { recordTokenUsage } from '../llm/usage.js';
import { getMapAgent } from '../map-agent/index.js';
import { beginThreadDoc, endThreadDoc } from '../map-agent/doc-store.js';
import { serializeMessage, serializeTodos, serializeUpdates, type CollectedUsage } from '../map-agent/serialize.js';

const createSchema = z.object({ mapId: z.string().uuid().nullish() });

const runSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  mapId: z.string().uuid().nullish(),
  definition: z.unknown().optional(),
});

/** 编辑器定义宽松判定(前端发来的本就是 TileMapDefinition,防呆即可) */
function looksLikeDefinition(v: unknown): v is TileMapDefinition {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d.width === 'number' && typeof d.height === 'number' && Array.isArray(d.places);
}

async function loadDefinitionFromDb(handle: DbHandle, mapId: string): Promise<TileMapDefinition | null> {
  const [row] = await handle.db.select().from(maps).where(eq(maps.id, mapId)).limit(1);
  return row?.definition ?? null;
}

export function registerMapAgentRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.post('/api/admin/map-agent/threads', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return await reply.code(400).send({ error: '参数不合法' });
    }
    const [row] = await handle.db
      .insert(mapAgentThreads)
      .values({ mapId: parsed.data.mapId ?? null })
      .returning();
    return await reply.send({ threadId: row!.id, title: row!.title, createdAt: row!.createdAt });
  });

  app.get('/api/admin/map-agent/threads', async (_request, reply) => {
    const rows = await handle.db.select().from(mapAgentThreads).orderBy(desc(mapAgentThreads.updatedAt)).limit(100);
    return await reply.send({
      items: rows.map((r) => ({ threadId: r.id, mapId: r.mapId, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    });
  });

  app.get('/api/admin/map-agent/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await handle.db.select().from(mapAgentThreads).where(eq(mapAgentThreads.id, id)).limit(1);
    if (!row) return await reply.code(404).send({ error: '线程不存在' });
    let messages: Record<string, unknown>[] = [];
    let todos: unknown = null;
    try {
      const agent = await getMapAgent(handle);
      const state = await agent.getState({ configurable: { thread_id: id } });
      const history = (state.values as { messages?: unknown[] }).messages ?? [];
      messages = history.map(serializeMessage);
      todos = serializeTodos((state.values as { todos?: unknown }).todos);
    } catch (err) {
      // checkpointer 未就绪/模型未配置时线程列表仍可用,历史降级为空
      request.log.warn({ err }, 'map-agent 历史加载降级');
    }
    return await reply.send({ threadId: row.id, mapId: row.mapId, title: row.title, messages, todos });
  });

  app.delete('/api/admin/map-agent/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await handle.db.delete(mapAgentThreads).where(eq(mapAgentThreads.id, id));
    return await reply.send({ ok: true });
  });

  app.post('/api/admin/map-agent/threads/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = runSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
    }
    const [threadRow] = await handle.db.select().from(mapAgentThreads).where(eq(mapAgentThreads.id, id)).limit(1);
    if (!threadRow) return await reply.code(404).send({ error: '线程不存在' });

    const mapId = parsed.data.mapId ?? threadRow.mapId ?? null;
    const doc = looksLikeDefinition(parsed.data.definition)
      ? parsed.data.definition
      : mapId !== null
        ? await loadDefinitionFromDb(handle, mapId)
        : null;
    if (doc === null) {
      return await reply.code(400).send({ error: '没有可用地图文档(编辑器未同步且无已保存地图)' });
    }

    let agent;
    try {
      agent = await getMapAgent(handle);
    } catch (err) {
      return await reply.code(400).send({ error: err instanceof Error ? err.message : '模型装配失败' });
    }

    beginThreadDoc(id, { mapId, doc });
    const usage: CollectedUsage = { promptTokens: 0, completionTokens: 0 };
    const title = threadRow.title === '新对话' ? parsed.data.message.slice(0, 24) : threadRow.title;

    const closed = new Promise<void>((resolve) => request.raw.on('close', resolve));
    const abort = new AbortController();
    void closed.then(() => abort.abort());

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    const write = (event: string, data: unknown): void => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    write('open', {});
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, 15_000);

    const run = (async (): Promise<void> => {
      try {
        // ReactAgent.stream 返回 Promise<流>;多 streamMode 下逐项为 [mode, payload],
        // messages 载荷又是 [chunk, metadata] 二元组——两层都要解
        const stream = await agent.stream(
          { messages: [{ role: 'user', content: parsed.data.message }] },
          {
            configurable: { thread_id: id },
            streamMode: ['messages', 'updates', 'custom'],
            recursionLimit: 60,
            signal: abort.signal,
          },
        );
        for await (const [mode, chunk] of stream) {
          if (mode === 'messages') {
            const [msg] = Array.isArray(chunk) ? chunk : [chunk];
            write('messages', [serializeMessage(msg), {}]);
          } else if (mode === 'updates') {
            // __start__ 补丁只含输入消息,转发会让 runtime 把 human 消息重复并入
            // 线程(与乐观追加的本地消息不同 id 不去重)——剔除后再发
            const rest =
              chunk !== null && typeof chunk === 'object' && '__start__' in (chunk as object)
                ? (({ __start__, ...others }) => others)(chunk as Record<string, unknown>)
                : chunk;
            if (rest !== null && typeof rest === 'object' && Object.keys(rest).length > 0) {
              write('updates', serializeUpdates(rest, usage));
            }
          } else if (mode === 'custom') {
            write('custom', chunk);
          }
        }
        write('end', {});
      } catch (err) {
        if (abort.signal.aborted) {
          write('end', {});
        } else {
          request.log.error({ err }, 'map-agent run 失败');
          write('error', { error: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    })();

    await Promise.race([run, closed]);

    // 收尾:回写草稿 + 标题 + token 记账(agent 不直接落库,人工保存同一门禁)
    const ended = endThreadDoc(id);
    await handle.db.update(mapAgentThreads).set({ title, updatedAt: new Date(), mapId: mapId ?? threadRow.mapId }).where(eq(mapAgentThreads.id, id));
    if (ended !== null && ended.mutated && ended.mapId !== null) {
      await handle.db
        .update(maps)
        .set({ definition: ended.doc, updatedAt: new Date() })
        .where(eq(maps.id, ended.mapId));
    }
    if (usage.promptTokens > 0 || usage.completionTokens > 0) {
      await recordTokenUsage(handle, {
        slot: 'slow',
        characterId: null,
        taskType: 'map_agent',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      });
    }
  });
}
