import { z } from 'zod';

/**
 * 世界维护系统协议面(M-G.5,design/08):损耗 spot 双端形态与维护岗位参数。
 * 损耗纯氛围(无数值后果,不扣幸福不入繁荣分);清洁/修理按单结算金币。
 */

export const maintenanceSpotSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['litter', 'fence_damage']),
  x: z.number().int(),
  y: z.number().int(),
  /** 渲染变体(0 起,web 池取模选贴图) */
  variant: z.number().int().min(0),
});

/** 维护点(损耗实例):litter=街道杂物,fence_damage=围栏破损(fenceTiles 内一格) */
export type MaintenanceSpot = z.infer<typeof maintenanceSpotSchema>;

/** 维护岗位(design/08 §4/numerical §5.1):clean 兜底 0 班/repair 建造 6 班/rescue 医疗 9 班 */
export type MaintenanceTaskId = 'clean' | 'repair' | 'rescue';

export interface MaintenanceTaskDef {
  id: MaintenanceTaskId;
  /** 活动类别(JOB_CATEGORIES 门槛键) */
  category: 'fallback' | 'build' | 'medical';
  durationMinutes: number;
  /** 按单结算金币 */
  pay: number;
}

export const MAINTENANCE_TASKS: Record<MaintenanceTaskId, MaintenanceTaskDef> = {
  clean: { id: 'clean', category: 'fallback', durationMinutes: 15, pay: 12 },
  repair: { id: 'repair', category: 'build', durationMinutes: 30, pay: 36 },
  rescue: { id: 'rescue', category: 'medical', durationMinutes: 30, pay: 45 },
};

/** 杂物生成周期(游戏分钟)与场上上限(design/08 §3) */
export const LITTER_PERIOD_MINUTES = 60;
export const LITTER_MAX_SPOTS = 12;
/** 围栏破损生成周期(游戏分钟)与场上上限 */
export const FENCE_PERIOD_MINUTES = 240;
export const FENCE_MAX_SPOTS = 4;
