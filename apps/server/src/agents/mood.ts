import { desc, eq } from 'drizzle-orm';
import type { WorldEvent } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import type { DbHandle } from '../db/client.js';
import { characterMoods } from '../db/schema/memory.js';
import { logTech } from '../telemetry.js';
import type { Simulation } from '../world/simulation.js';
import { mood as moodBrain, type MoodState } from './cognition.js';

/** 单条事件对单个角色的情绪冲量 */
export interface MoodDelta {
  characterId: string;
  delta: number;
  labels: string[];
}

interface MoodRow {
  delta: number;
  labels: string[];
  gameMinutes: number | null;
}

export interface MoodHistoryRow extends MoodRow {
  createdAt: Date;
}

/** 衰减贡献低于该值的冲量行不再参与聚合(-valence 与标签均忽略) */
const CONTRIB_EPSILON = 0.02;
/** |valence| 低于该值视为平静(访谈不注入,面板显示平淡) */
export const MOOD_NEUTRAL = 0.15;

/** 事件→情绪冲量规则映射(10-cognition §4.4: 规则打标零模型,不走 LLM)。
 * nameOf 解析互动对象名供标签措辞;白名单外事件(参数/控制/睡饱等)一律零冲量 */
export function moodDeltasFor(event: WorldEvent, nameOf: (id: string) => string): MoodDelta[] {
  switch (event.type) {
    case 'character.died':
      return [{ characterId: event.characterId, delta: -0.6, labels: ['倒下了'] }];
    case 'character.revived':
      return [{ characterId: event.characterId, delta: 0.4, labels: ['获救'] }];
    case 'character.auto_revived':
      return [{ characterId: event.characterId, delta: 0.2, labels: ['自己缓过来了'] }];
    case 'friendship.formed':
      return [
        { characterId: event.aId, delta: 0.5, labels: [`和${nameOf(event.bId)}结交了`] },
        { characterId: event.bId, delta: 0.5, labels: [`和${nameOf(event.aId)}结交了`] },
      ];
    case 'first.met':
      return [
        { characterId: event.aId, delta: 0.15, labels: [`认识了${nameOf(event.bId)}`] },
        { characterId: event.bId, delta: 0.15, labels: [`认识了${nameOf(event.aId)}`] },
      ];
    case 'craft.completed':
      return [{ characterId: event.characterId, delta: 0.4, labels: ['做出成品'] }];
    case 'work_task.completed':
      return [{ characterId: event.characterId, delta: 0.3, labels: ['完成工作'] }];
    case 'activity.finished':
      if (event.reason === 'insufficient_coins') {
        return [{ characterId: event.characterId, delta: -0.3, labels: ['囊中羞涩'] }];
      }
      if (event.reason === 'interrupted') {
        return [{ characterId: event.characterId, delta: -0.2, labels: ['被打断'] }];
      }
      return [];
    case 'sleep.debt_applied':
      return [{ characterId: event.characterId, delta: -0.3, labels: ['没睡够'] }];
    default:
      return [];
  }
}

function mostRecentFirst(a: MoodRow, b: MoodRow): number {
  return (b.gameMinutes ?? 0) - (a.gameMinutes ?? 0);
}

/** 冲量流水→当前情绪(纯函数): 每行按半衰期衰减求和后钳到 [-1,1];
 * 输入顺序不敏感(内部按游戏分钟新→旧重排,标签按新→旧去重取前 4,since=最早贡献行) */
export function aggregateMood(
  rows: MoodRow[],
  nowGameMinutes: number,
  halfLifeMinutes: number = BALANCE.MOOD_HALF_LIFE_MINUTES,
): MoodState {
  let valence = 0;
  const labels: string[] = [];
  let since: number | null = null;
  for (const row of [...rows].sort(mostRecentFirst)) {
    const at = row.gameMinutes ?? nowGameMinutes;
    const contribution = row.delta * Math.pow(0.5, Math.max(0, nowGameMinutes - at) / halfLifeMinutes);
    if (Math.abs(contribution) < CONTRIB_EPSILON) continue;
    valence += contribution;
    if (since === null || at < since) since = at;
    for (const label of row.labels) {
      if (!labels.includes(label)) labels.push(label);
    }
  }
  return {
    valence: Math.min(1, Math.max(-1, valence)),
    labels: labels.slice(0, 4),
    since,
  };
}

/** 当前情绪→人读措辞(访谈 prompt 用);平静且无标签返回 null(不注入) */
export function describeMood(state: MoodState): string | null {
  if (state.labels.length === 0 && Math.abs(state.valence) < MOOD_NEUTRAL) return null;
  const tone =
    state.valence >= 0.45
      ? '很高兴'
      : state.valence >= MOOD_NEUTRAL
        ? '心情不错'
        : state.valence <= -0.45
          ? '很沮丧'
          : state.valence <= -MOOD_NEUTRAL
            ? '有点低落'
            : '心情平静';
  return state.labels.length > 0 ? `${tone}(${state.labels.join('、')})` : tone;
}

async function readRows(handle: DbHandle, characterId: string, limit = 200): Promise<MoodRow[]> {
  return handle.db
    .select({
      delta: characterMoods.delta,
      labels: characterMoods.labels,
      gameMinutes: characterMoods.gameMinutes,
    })
    .from(characterMoods)
    .where(eq(characterMoods.characterId, characterId))
    .orderBy(desc(characterMoods.createdAt))
    .limit(limit);
}

/** 重算并返回当前情绪(每次直读表,衰减实时正确),同步刷脑状态镜像 */
export async function readMood(
  handle: DbHandle,
  characterId: string,
  nowGameMinutes: number | null,
): Promise<MoodState> {
  const rows = await readRows(handle, characterId);
  // 角色不在活跃世界(旧世界/离线)时以最近一条冲量的游戏时刻为"现在",防真实时间虚增衰减
  const now = nowGameMinutes ?? (rows[0]?.gameMinutes ?? 0);
  const state = aggregateMood(rows, now);
  moodBrain.set(characterId, state);
  return state;
}

/** 面板历史(新→旧截断) */
export async function readMoodHistory(
  handle: DbHandle,
  characterId: string,
  limit = 50,
): Promise<MoodHistoryRow[]> {
  return handle.db
    .select({
      delta: characterMoods.delta,
      labels: characterMoods.labels,
      gameMinutes: characterMoods.gameMinutes,
      createdAt: characterMoods.createdAt,
    })
    .from(characterMoods)
    .where(eq(characterMoods.characterId, characterId))
    .orderBy(desc(characterMoods.createdAt))
    .limit(limit);
}

/**
 * 情绪打标器(C2,10-cognition §4.4): 订阅世界事件按规则表写情绪冲量流水,
 * 并同步 cognition.mood 脑状态镜像。零模型零 embedding,fire-and-forget,
 * 失败只落技术日志(情绪非关键路径,不阻塞事件总线)。
 */
export class MoodTracker {
  private readonly unsubscribe: () => void;

  constructor(
    private readonly sim: Simulation,
    private readonly handle: DbHandle,
  ) {
    this.unsubscribe = sim.events.subscribe((event) => this.onEvent(event));
  }

  dispose(): void {
    this.unsubscribe();
  }

  private onEvent(event: WorldEvent): void {
    const deltas = moodDeltasFor(event, (id) => this.sim.characters.get(id)?.name ?? '某居民');
    if (deltas.length === 0) return;
    const gameMinutes = this.sim.clock.gameMinutes;
    void (async () => {
      try {
        for (const { characterId, delta, labels } of deltas) {
          await this.handle.db
            .insert(characterMoods)
            .values({ characterId, delta, labels, gameMinutes });
        }
        for (const characterId of new Set(deltas.map((d) => d.characterId))) {
          await readMood(this.handle, characterId, gameMinutes);
        }
      } catch (err) {
        logTech('warn', 'mood', '情绪冲量落库失败', {
          type: event.type,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }
}

/** app 装配入口(与 attachMemoryWriter 同款);返回实例便于测试观察与 dispose */
export function attachMoodTracker(sim: Simulation, handle: DbHandle): MoodTracker {
  return new MoodTracker(sim, handle);
}
