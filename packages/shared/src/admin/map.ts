/**
 * 地图库协议(MS-1):后台地图管理面板/建世界选图/编辑器的共享视图类型。
 * 地图正文是 TileMapDefinition(town-map.ts),本文件只定义列表/详情/写入协议。
 */
import type { GameType } from '../worldgen.js';
import type { TileMapDefinition } from '../town-map.js';

/** 地图状态机: 草稿(编辑中)→已发布(建世界可选)→归档(不可选仍可查) */
export const MAP_STATUSES = ['draft', 'published', 'archived'] as const;
export type MapStatus = (typeof MAP_STATUSES)[number];

export const MAP_STATUS_LABELS: Record<MapStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

/** 布局体检摘要缓存(列表角标;发布门禁与明细由 definition 现算) */
export interface MapStats {
  width: number;
  height: number;
  placeCount: number;
}

/** 列表条目(不带 definition,预览按需拉详情) */
export interface MapSummaryItem {
  id: string;
  name: string;
  description: string;
  status: MapStatus;
  sizePreset: string;
  stats: MapStats | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface MapListResponse {
  items: MapSummaryItem[];
}

export interface MapDetailResponse extends MapSummaryItem {
  definition: TileMapDefinition;
}

/** POST /api/admin/maps 与 PUT /api/admin/maps/:id 请求体(整体写入) */
export interface MapWriteRequest {
  name: string;
  description?: string;
  sizePreset?: string;
  definition: TileMapDefinition;
}

/** POST /api/admin/maps/generate 请求:随机生成起步图(编辑器第三起步来源,不落库) */
export interface MapGenerateRequest {
  /** 缺省=服务端随机种子 */
  seed?: number;
  gameType: GameType;
  /** 尺寸档(缺省 small) */
  size?: 'small' | 'medium' | 'large';
}

export interface MapGenerateResponse {
  map: TileMapDefinition;
  /** 实际使用的种子(请求缺省时由服务端生成,回显供复现) */
  seed: number;
}

/** AI 改图会话索引条目(对话正文在 checkpointer,不在此处) */
export interface MapAgentThreadItem {
  threadId: string;
  mapId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MapAgentThreadListResponse {
  items: MapAgentThreadItem[];
}

export interface MapAgentThreadDetail {
  threadId: string;
  mapId: string | null;
  title: string;
  /** LangChainMessage 投影(assistant-ui 可累积形状) */
  messages: Record<string, unknown>[];
}

/** POST /threads/:id/runs 请求体(SSE 响应) */
export interface MapAgentRunRequest {
  message: string;
  /** 关联地图;run 结束 agent 修改回写其草稿 */
  mapId?: string | null;
  /** 编辑器当前定义优先作为文档来源 */
  definition?: unknown;
}
