import { getActivityDefinition, RECIPES, type MemoryType, type WorldEvent } from '@sims/shared';
import { BALANCE } from '../config/balance.js';
import { autonomy } from './cognition.js';
import { perceiveTasks } from './perception.js';
import type { DbHandle } from '../db/client.js';
import { memories } from '../db/schema/memory.js';
import type { ModelRouter } from '../llm/router.js';
import { logTech } from '../telemetry.js';
import type { Simulation } from '../world/simulation.js';

/** 记忆管线只依赖这四个入口,测试以桩替换(app 侧传 ModelRouter) */
export interface MemoryLlm {
  systemOne: ModelRouter['systemOne'];
  embed: ModelRouter['embed'];
  /** 自由文本对话(slow/light 槽);慢层日计划生成用 */
  chat: ModelRouter['chat'];
  /** 结构化输出(工具强制调用+schema 校验);认知固化等强格式场景用 */
  chatStructured: ModelRouter['chatStructured'];
}

/** 工作任务中文标签(events.ts workTaskIdSchema 同源,新增任务须同步) */
export const WORK_TASK_LABEL: Record<string, string> = {
  clean: '清扫',
  repair: '修补',
  rescue: '救援',
  gather_berry: '采摘浆果',
  scavenge: '拾荒',
  chop_tree: '砍树',
  mine_rock: '凿石',
  salvage_metal: '回收金属',
  pick_apple: '摘苹果',
  harvest_wheat: '收麦子',
};

const FINISH_REASON_NOTE: Record<string, string> = {
  completed: '',
  stopped: '(主动停下)',
  interrupted: '(中途被打断)',
  insufficient_coins: '(金币不足中止)',
};

const DEFAULT_IMPORTANCE = 5; // Jev 打分失败兜底=中位数
/** 十级重要性量表(score 题分级标准,答案 score=选中档位下标 0 起,+1 得 1~10 分) */
const IMPORTANCE_SCALE = [
  '毫无影响:转瞬即忘的琐事',
  '几乎无影响:对后续生活没有可感作用',
  '轻微影响:偶尔回想起,不改变行为',
  '略有影响:以后做类似事情时可能参考',
  '一般影响:对日常安排有小幅参考价值',
  '中等影响:会影响近期的选择或偏好',
  '较大影响:改变对某些人或事的看法',
  '重大影响:显著改变近期的目标或计划',
  '深远影响:动摇长期目标或重要人际关系',
  '决定性影响:彻底改变人生走向的事件',
];
const MAX_INFLIGHT = 6; // 全局并发管线(LLM 双调用/条)上限,超出丢弃新事件并记日志

interface MemoryTask {
  characterId: string;
  type: MemoryType;
  content: string;
}

function clampImportance(score: number): number {
  return Math.min(10, Math.max(1, Math.round(score)));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 记忆写入器(M4b/A2):订阅 sim.events 把玩家意图驱动的经历转写为角色记忆。
 * 管线=Jev 打分(importance 1~10,失败兜底 5)→ embedding 槽向量化(失败落空向量)
 * →memories 落库(带 gameMinutes)。EventBus 订阅处于 tick 调用链上,故订阅回调
 * 只做满载判定即返回,管线异步 fire-and-forget,任何失败只落技术日志绝不外抛。
 * 护栏:全局并发上限 6,管线满时丢弃新事件并记日志(记忆非关键路径,宁缺不积压)。
 */
export class MemoryWriter {
  private inFlight = 0;
  /** 白天反思累加器(10-cognition §5): 各角色自上次反思起的新增记忆 importance 累计 */
  private readonly importanceSinceReflection = new Map<string, number>();
  private reflectionHook: ((characterId: string) => void) | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly sim: Simulation,
    private readonly handle: DbHandle,
    private readonly llm: MemoryLlm,
  ) {
    this.unsubscribe = sim.events.subscribe((event) => this.onEvent(event));
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** 注册白天反思触发器(固化器装配时挂入): importance 累计越阈即回调一次并清零累加 */
  setReflectionHook(hook: (characterId: string) => void): void {
    this.reflectionHook = hook;
  }

  private onEvent(event: WorldEvent): void {
    // 当事人经历(M4b 主线)+ 附近自治角色的旁观感知(M4c §4.1)进同一条并发管线
    const main = this.toTask(event);
    const perceived = perceiveTasks(event, this.sim.characters, autonomy.list());
    const tasks: MemoryTask[] = main === null ? perceived : [main, ...perceived];
    for (const task of tasks) {
      if (this.inFlight >= MAX_INFLIGHT) {
        logTech('warn', 'memory', '记忆管线已满,丢弃新事件', { characterId: task.characterId });
        continue;
      }
      this.inFlight += 1;
      void this.run(task).finally(() => {
        this.inFlight -= 1;
      });
    }
  }

  private async run(task: MemoryTask): Promise<void> {
    try {
      let importance = DEFAULT_IMPORTANCE;
      try {
        const name = this.sim.characters.get(task.characterId)?.name ?? '无名居民';
        const result = await this.llm.systemOne(
          'jev',
          `居民「${name}」的一段经历:${task.content}`,
          {
            importance: {
              type: 'score',
              instructions: '评估这段经历对该居民未来行为与决策的影响程度,选出最贴合的一档',
              criteria: IMPORTANCE_SCALE,
            },
          },
          { taskType: 'memory.importance', characterId: task.characterId },
        );
        const answer = result.answers.importance;
        importance =
          answer?.type === 'score' ? clampImportance(answer.score + 1) : DEFAULT_IMPORTANCE;
      } catch (err) {
        logTech('warn', 'memory', 'Jev 打分失败,兜底中位数', {
          characterId: task.characterId,
          err: errMsg(err),
        });
      }
      await this.persist(task, importance);
    } catch (err) {
      logTech('error', 'memory', '记忆落库失败', {
        characterId: task.characterId,
        err: errMsg(err),
      });
    }
  }

  /** 向量化+落库(Jev 打分之后/跳过时的公共尾段);固化产物(consolidated)不进反思累加 */
  private async persist(
    task: MemoryTask,
    importance: number,
    opts: { sourceIds?: string[]; consolidated?: boolean } = {},
  ): Promise<void> {
    let embedding: number[] | null = null;
    try {
      const emb = await this.llm.embed('embedding', [task.content], {
        taskType: 'memory.embed',
        characterId: task.characterId,
      });
      embedding = emb.vector;
    } catch (err) {
      logTech('warn', 'memory', '向量化失败,记忆以无向量落库', {
        characterId: task.characterId,
        err: errMsg(err),
      });
    }
    await this.handle.db.insert(memories).values({
      characterId: task.characterId,
      type: task.type,
      content: task.content,
      importance,
      embedding,
      gameMinutes: this.sim.clock.gameMinutes,
      sourceIds: opts.sourceIds ?? null,
      consolidatedAt: opts.consolidated === true ? new Date() : null,
    });
    if (opts.consolidated !== true) {
      const accumulated =
        (this.importanceSinceReflection.get(task.characterId) ?? 0) + importance;
      if (accumulated >= BALANCE.REFLECTION_IMPORTANCE_THRESHOLD) {
        this.importanceSinceReflection.set(task.characterId, 0);
        this.reflectionHook?.(task.characterId);
      } else {
        this.importanceSinceReflection.set(task.characterId, accumulated);
      }
    }
  }

  /**
   * 直写记忆(M4d 慢层):跳过 Jev 打分,importance 由调用方给定(如计划=6)。
   * 走同一条并发管线护栏(满载丢弃+技术日志),供日程生成等非事件时刻写入;
   * M5 梦境固化走 type='dream',默认仍为 'event'(日程=计划性经历)。
   * C1 固化管线 v2: opts.sourceIds=insight 溯源链;opts.consolidated=固化产物
   * (dream/insight)写入即标记,不再进次夜/反思的源记忆池(单向爬梯,10-cognition §3)。
   */
  async writeManual(
    characterId: string,
    content: string,
    importance: number,
    type: MemoryType = 'event',
    opts: { sourceIds?: string[]; consolidated?: boolean } = {},
  ): Promise<void> {
    if (this.inFlight >= MAX_INFLIGHT) {
      logTech('warn', 'memory', '记忆管线已满,丢弃直写', { characterId });
      return;
    }
    this.inFlight += 1;
    try {
      await this.persist(
        { characterId, type, content },
        clampImportance(importance),
        opts,
      );
    } catch (err) {
      logTech('error', 'memory', '直写记忆落库失败', {
        characterId,
        err: errMsg(err),
      });
    } finally {
      this.inFlight -= 1;
    }
  }

  /** 事件→记忆任务;白名单全为玩家意图驱动,控制/参数/存档类事件不入记忆。
   * 对话与结交 v1 只记发起方(aId/fromId),另一方的记忆由后续固化窗口补。 */
  private toTask(event: WorldEvent): MemoryTask | null {
    const nameOf = (id: string): string => this.sim.characters.get(id)?.name ?? '某居民';
    switch (event.type) {
      case 'activity.finished': {
        const label = getActivityDefinition(event.activityId)?.name ?? event.activityId;
        return {
          characterId: event.characterId,
          type: 'event',
          content: `我${label}了 ${event.elapsedMinutes} 分钟${FINISH_REASON_NOTE[event.reason] ?? ''}`,
        };
      }
      case 'work_task.completed': {
        const label = WORK_TASK_LABEL[event.task] ?? event.task;
        return {
          characterId: event.characterId,
          type: 'event',
          content: `我做完了一份${label}的活计,挣到 ${event.pay} 金币`,
        };
      }
      case 'craft.completed': {
        const label = RECIPES[event.recipeId as keyof typeof RECIPES]?.name ?? event.recipeId;
        return {
          characterId: event.characterId,
          type: 'event',
          content: `我做成了一批${label}`,
        };
      }
      case 'social.chat':
        // C4 双句对话 content 已含「问」「答」单引号对,模板改为转述式容纳两种形态
        return {
          characterId: event.fromId,
          type: 'dialogue',
          content: `我和${nameOf(event.toId)}聊了聊:${event.content}`,
        };
      case 'friendship.formed':
        return {
          characterId: event.aId,
          type: 'dialogue',
          content: `我和${nameOf(event.bId)}结成了${event.title}`,
        };
      case 'first.met':
        return {
          characterId: event.aId,
          type: 'dialogue',
          content: `我初次认识了${nameOf(event.bId)},是个面生的邻居`,
        };
      case 'character.died':
        return {
          characterId: event.characterId,
          type: 'event',
          content: event.revivable ? '我倒下了,等待救治' : '我倒下了',
        };
      default:
        return null;
    }
  }
}

/** app 装配入口(与 attachWorldEventLog 同款);返回实例便于测试观察与 dispose */
export function attachMemoryWriter(
  sim: Simulation,
  handle: DbHandle,
  llm: MemoryLlm,
): MemoryWriter {
  return new MemoryWriter(sim, handle, llm);
}
