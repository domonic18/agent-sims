import { getActivityDefinition, RECIPES, type WorldEvent } from '@sims/shared';
import { WORK_TASK_LABEL } from './memory-writer.js';
import type { WorldCharacter } from '../world/character.js';

/** 感知半径(曼哈顿距离,格):附近的事件才会被角色"看到" */
export const PERCEPTION_RADIUS = 8;

/** 旁观感知产出的记忆任务(与 MemoryWriter 自身经历任务同构,走同一管线) */
export interface PerceivedTask {
  characterId: string;
  type: 'event';
  content: string;
}

type Characters = Map<string, WorldCharacter>;

/**
 * 旁观感知(agent-design §4.1):EventBus 事件按空间相关度过滤给每个自治角色,
 * 产出**主观视角**记忆文本——同一场对话,A 写"我和 B 聊了天气",旁观者 C 写
 * "A 和 B 在聊天气"。当事人自己不在此列(其经历由 MemoryWriter 主线写入)。
 * 纯函数:测试直接喂事件与角色表。
 */
export function perceiveTasks(
  event: WorldEvent,
  characters: Characters,
  watchers: readonly string[],
): PerceivedTask[] {
  const tasks: PerceivedTask[] = [];
  for (const watcherId of watchers) {
    const watcher = characters.get(watcherId);
    if (watcher === undefined) continue;
    const subjectIds = eventSubjects(event);
    if (mainlineSubjects(event).includes(watcherId)) continue; // 主线已写,不旁观自己
    const subject = characters.get(subjectIds[0] ?? '');
    if (subject === undefined) continue;
    const distance =
      Math.abs(subject.x - watcher.x) + Math.abs(subject.y - watcher.y);
    if (distance > PERCEPTION_RADIUS) continue;
    const content = describeEvent(event, characters, watcherId);
    if (content !== null) {
      tasks.push({ characterId: watcherId, type: 'event', content });
    }
  }
  return tasks;
}

/** 事件当事人 id 列表(triage 相关性门与感知位置共用;取首个在世界的当事人) */
export function eventSubjects(event: WorldEvent): string[] {
  switch (event.type) {
    case 'activity.started':
    case 'activity.finished':
    case 'character.died':
    case 'character.revived':
    case 'character.auto_revived':
    case 'work_task.accepted':
    case 'work_task.cancelled':
    case 'work_task.completed':
    case 'craft.completed':
      return [event.characterId];
    case 'social.chat':
      return [event.fromId, event.toId];
    case 'friendship.formed':
      return [event.aId, event.bId];
    case 'first.met':
      return [event.aId, event.bId];
    default:
      return [];
  }
}

/** 主线(MemoryWriter 自身经历)已覆盖的当事人:感知跳过,避免双写。
 * social.chat 主线只记发起方,听者视角由感知补齐。 */
function mainlineSubjects(event: WorldEvent): string[] {
  switch (event.type) {
    case 'activity.started':
    case 'activity.finished':
    case 'character.died':
    case 'character.revived':
    case 'character.auto_revived':
    case 'work_task.accepted':
    case 'work_task.completed':
    case 'craft.completed':
      return [event.characterId];
    case 'social.chat':
      return [event.fromId];
    case 'friendship.formed':
      return [event.aId];
    case 'first.met':
      return [event.aId];
    default:
      return [];
  }
}

/** 事件→旁观者视角中文模板;不产生记忆的事件型返回 null */
function describeEvent(
  event: WorldEvent,
  characters: Characters,
  watcherId: string,
): string | null {
  const nameOf = (id: string): string => characters.get(id)?.name ?? '某居民';
  switch (event.type) {
    case 'activity.started': {
      const label = getActivityDefinition(event.activityId)?.name ?? event.activityId;
      return `我看到${nameOf(event.characterId)}开始${label}`;
    }
    case 'activity.finished': {
      const label = getActivityDefinition(event.activityId)?.name ?? event.activityId;
      return `我看到${nameOf(event.characterId)}做完了一次${label}`;
    }
    case 'character.died':
      return `我看到${nameOf(event.characterId)}倒下了`;
    case 'character.revived':
    case 'character.auto_revived':
      return `我看到${nameOf(event.characterId)}恢复了行动`;
    case 'social.chat': {
      const [a, b] = [event.fromId, event.toId];
      // 双方对话:旁观者记第三方转述;听者补一句"对我说"(主线只记发起方);
      // C4 双句 content 自带「」单引号对,此处不再包裹
      if (watcherId === b) return `我听到${nameOf(a)}对我说:${event.content}`;
      return `我看到${nameOf(a)}和${nameOf(b)}在聊天`;
    }
    case 'friendship.formed':
      return `我看到${nameOf(event.aId)}和${nameOf(event.bId)}结成了${event.title}`;
    case 'first.met':
      return `我看到${nameOf(event.aId)}和${nameOf(event.bId)}初次相识`;
    case 'work_task.completed': {
      const label = WORK_TASK_LABEL[event.task] ?? event.task;
      return `我看到${nameOf(event.characterId)}做完了${label}的活计`;
    }
    case 'craft.completed': {
      const label = RECIPES[event.recipeId as keyof typeof RECIPES]?.name ?? event.recipeId;
      return `我看到${nameOf(event.characterId)}做成了一批${label}`;
    }
    default:
      return null;
  }
}
