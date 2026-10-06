import { getActivityDefinition } from '@sims/shared';
import { ACTIVITY_EMOJI } from '../../game/assets';
import type { CharacterView } from '../side-panel/place';

export interface ActivityChipInfo {
  icon: string;
  label: string;
  /** 0~100 进度,非时长型活动(前往中)为 null */
  progress: number | null;
}

/** 当前行动 chip 文案(左上角色面板与底部动作条共用): 活动中/前往中,空闲返回 null */
export function activityChip(character: CharacterView): ActivityChipInfo | null {
  if (character.activity !== null) {
    const def = getActivityDefinition(character.activity.activityId);
    const duration = def?.durationMinutes ?? 0;
    return {
      icon: def !== null ? ACTIVITY_EMOJI[def.id] : '✨',
      label: `${def?.name ?? character.activity.activityId} ${character.activity.elapsedMinutes}/${duration}分`,
      progress: duration > 0 ? Math.min(100, Math.round((character.activity.elapsedMinutes / duration) * 100)) : null,
    };
  }
  if (character.pathRemaining > 0) {
    return { icon: '🚶', label: '前往中', progress: null };
  }
  return null;
}
