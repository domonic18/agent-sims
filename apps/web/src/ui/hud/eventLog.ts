import {
  getActivityDefinition,
  getRecipe,
  type WorldEvent,
} from '@sims/shared';
import { ACTIVITY_EMOJI } from '../../game/assets';

export type EventLogCategory = 'work' | 'social' | 'life' | 'world';

export interface EventLogEntry {
  icon: string;
  text: string;
  /** 数值增减着色: good=绿色收益/bad=红色损失/info=默认 */
  tone: 'info' | 'good' | 'bad';
  /** 关联角色(条目点击定位),null=无 */
  characterId: string | null;
}

export const EVENT_CATEGORY_LABEL: Record<EventLogCategory, string> = {
  work: '工作',
  social: '社交',
  life: '生活',
  world: '世界',
};

/** 事件类型 → 筛选分类(18 种 type 全覆盖,新增事件漏配即编译错误) */
export function eventLogCategory(type: WorldEvent['type']): EventLogCategory {
  switch (type) {
    case 'work_task.accepted':
    case 'work_task.cancelled':
    case 'work_task.completed':
    case 'craft.completed':
      return 'work';
    case 'social.chat':
    case 'friendship.formed':
      return 'social';
    case 'character.arrived':
    case 'activity.started':
    case 'activity.finished':
    case 'character.died':
    case 'character.revived':
    case 'character.auto_revived':
    case 'sleep.debt_applied':
      return 'life';
    case 'maintenance.spawned':
    case 'world.control':
    case 'world.params':
    case 'world.rules':
    case 'world.reset':
      return 'world';
  }
}

function activityIcon(activityId: string): string {
  return ACTIVITY_EMOJI[activityId as keyof typeof ACTIVITY_EMOJI] ?? '✨';
}

function activityName(activityId: string): string {
  return getActivityDefinition(activityId)?.name ?? activityId;
}

/** 世界事件 → 日志条目(icon+中文文本);nameOf 将角色 id 转显示名 */
export function eventLogLabel(event: WorldEvent, nameOf: (id: string) => string): EventLogEntry {
  switch (event.type) {
    case 'character.arrived':
      return {
        icon: '📍',
        text: `${nameOf(event.characterId)} 抵达 (${event.x},${event.y})`,
        tone: 'info',
        characterId: event.characterId,
      };
    case 'activity.started':
      return {
        icon: activityIcon(event.activityId),
        text: `${nameOf(event.characterId)} 开始 ${activityName(event.activityId)}`,
        tone: 'info',
        characterId: event.characterId,
      };
    case 'activity.finished': {
      const who = nameOf(event.characterId);
      const what = activityName(event.activityId);
      const base = `${who} ${what} ${event.elapsedMinutes}分`;
      switch (event.reason) {
        case 'completed':
          return { icon: '✅', text: `${who} 完成 ${what}(${event.elapsedMinutes}分)`, tone: 'good', characterId: event.characterId };
        case 'stopped':
          return { icon: '⏹', text: `${base} 手动停止`, tone: 'info', characterId: event.characterId };
        case 'interrupted':
          return { icon: '⚠️', text: `${base} 被移动打断`, tone: 'info', characterId: event.characterId };
        case 'insufficient_coins':
          return { icon: '💸', text: `${who} ${what}余额不足,中断`, tone: 'bad', characterId: event.characterId };
        case 'died':
          return { icon: '🚑', text: `${who} 倒下(送医/重伤),${what}中断`, tone: 'bad', characterId: event.characterId };
        case 'collapsed':
          return { icon: '😵', text: `${who} 体力耗尽虚脱,${what}中断`, tone: 'bad', characterId: event.characterId };
      }
    }
    case 'character.died':
      return {
        icon: '☠️',
        text: event.revivable
          ? `${nameOf(event.characterId)} 倒下了,等待救治`
          : `${nameOf(event.characterId)} 倒下了(救治窗口已过)`,
        tone: 'bad',
        characterId: event.characterId,
      };
    case 'character.revived':
      return {
        icon: '❤️',
        text: `${nameOf(event.characterId)} 获救复活`,
        tone: 'good',
        characterId: event.characterId,
      };
    case 'character.auto_revived':
      return {
        icon: '✨',
        text: `${nameOf(event.characterId)} 自行苏醒`,
        tone: 'info',
        characterId: event.characterId,
      };
    case 'world.control':
      return {
        icon: '⏯',
        text: `世界${event.paused ? '暂停' : '继续'}(${event.timeScale}x)`,
        tone: 'info',
        characterId: null,
      };
    case 'world.params':
      return {
        icon: '🎛️',
        text: `世界参数更新(${Object.keys(event.params).length} 项)`,
        tone: 'info',
        characterId: null,
      };
    case 'world.rules':
      return {
        icon: '📏',
        text: `规则变更: 死亡${event.rules.allowDeath ? '开' : '关'}·闲聊${event.rules.allowChat ? '开' : '关'}`,
        tone: 'info',
        characterId: null,
      };
    case 'world.reset':
      return { icon: '🌍', text: '世界已重置', tone: 'info', characterId: null };
    case 'social.chat': {
      const delta = event.affinityDelta;
      const tail = delta !== 0 ? `(好感${delta > 0 ? '+' : ''}${delta})` : '';
      return {
        icon: '💬',
        text: `${nameOf(event.fromId)} → ${nameOf(event.toId)}:${event.content}${tail}`,
        tone: 'info',
        characterId: event.fromId,
      };
    }
    case 'friendship.formed':
      return {
        icon: '🤝',
        text: `${nameOf(event.aId)} 与 ${nameOf(event.bId)} 成为${event.title}`,
        tone: 'good',
        characterId: event.aId,
      };
    case 'maintenance.spawned':
      return event.spot.kind === 'litter'
        ? { icon: '🗑️', text: `街道出现杂物 (${event.spot.x},${event.spot.y})`, tone: 'info', characterId: null }
        : { icon: '🚧', text: `围栏破损 (${event.spot.x},${event.spot.y})`, tone: 'info', characterId: null };
    case 'work_task.accepted':
      return {
        icon: activityIcon(event.task),
        text: `${nameOf(event.characterId)} 接受 ${activityName(event.task)}工单`,
        tone: 'info',
        characterId: event.characterId,
      };
    case 'work_task.cancelled':
      return {
        icon: '⚠️',
        text: `${nameOf(event.characterId)} 的工单失效(无薪中断)`,
        tone: 'bad',
        characterId: event.characterId,
      };
    case 'work_task.completed': {
      const base = `${nameOf(event.characterId)} 完成 ${activityName(event.task)}`;
      return {
        icon: '✅',
        text: event.pay > 0 ? `${base} +${event.pay}币` : `${base},产出入包`,
        tone: 'good',
        characterId: event.characterId,
      };
    }
    case 'craft.completed': {
      const recipe = getRecipe(event.recipeId);
      return {
        icon: activityIcon(event.recipeId),
        text: `${nameOf(event.characterId)} 制作完成 ${recipe?.name ?? event.recipeId}`,
        tone: 'good',
        characterId: event.characterId,
      };
    }
    case 'sleep.debt_applied':
      return {
        icon: '😪',
        text: `${nameOf(event.characterId)} 缺觉:今日收益 ×0.7(昨夜睡 ${event.sleptMinutes}分)`,
        tone: 'bad',
        characterId: event.characterId,
      };
  }
}
