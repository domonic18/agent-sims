/**
 * 随机起步图生成端点(批B):编辑器第三起步来源。复用 worldgen generateTownMap
 * (生成器依赖发布产物 manifest 素材池,不下沉前端);只返回定义不落库,
 * 保存仍走编辑器 POST/PUT 同一门禁。调用参数与建世界预览保持同构。
 */
import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  GAME_TYPES,
  WORLDGEN_DENSITIES,
  WORLDGEN_SIZES,
  type MapGenerateResponse,
} from '@sims/shared';
import { readManifestVersion } from '../assets/paths.js';
import { generateTownMap } from '../world/worldgen/generate.js';
import { loadAssetInput } from './worlds-create.js';
import type { DbHandle } from '../db/client.js';

const generateSchema = z.object({
  seed: z.number().int().min(0).max(9_999_999_999).optional(),
  gameType: z.enum(GAME_TYPES),
  size: z.enum(WORLDGEN_SIZES).default('small'),
  density: z.enum(WORLDGEN_DENSITIES).default('normal'),
});

export function registerMapGenerateRoutes(app: FastifyInstance, _handle: DbHandle): void {
  app.post('/api/admin/maps/generate', async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({ error: parsed.error.issues[0]?.message ?? '参数不合法' });
    }
    // generateTownMap 的种子是字符串形态(与建世界预览一致)
    const seed = parsed.data.seed !== undefined ? String(parsed.data.seed) : String(randomInt(1, 2 ** 31));
    const result = generateTownMap({
      seed,
      gameType: parsed.data.gameType,
      params: { size: parsed.data.size, density: parsed.data.density },
      manifestVersion: readManifestVersion(),
      // 与建世界预览同参:themePick 槽位影响 rng 消耗流,缺池会致同种子预览/成图分叉
      ...loadAssetInput(),
    });
    const body: MapGenerateResponse = { map: result.map, seed: Number(seed) };
    return await reply.send(body);
  });
}
