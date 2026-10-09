import type { AssetAnimConfig, AssetStatus } from '../asset-manifest.js';

/** POST /api/admin/assets/ai-review 单件结论(视觉模型审核) */
export interface AssetAiReviewResult {
  match: 'yes' | 'no' | 'unsure';
  see: string;
  kindGuess: string | null;
  problems: string[];
  suggestion: string | null;
}

export interface AssetAiReviewItem {
  id: number;
  slug: string;
  ok: boolean;
  error?: string;
  result?: AssetAiReviewResult;
}

export interface AssetAiReviewResponse {
  items: AssetAiReviewItem[];
}

// ============ 素材管理(M-L.2,design/05) ============

export interface AssetCategoryView {
  id: number;
  parentId: number | null;
  level: number;
  slug: string;
  name: string;
  sortOrder: number;
  /** 直挂素材数(不含子孙分类) */
  assetCount: number;
}

export interface AssetAdminView {
  id: number;
  slug: string;
  name: string;
  categoryId: number;
  /** 挂载分类 slug(kind 层;tile/props 挂 theme 层) */
  categorySlug: string;
  domain: string;
  width: number;
  height: number;
  gridW: number;
  gridH: number;
  anchor: string;
  tier: number;
  tags: string[];
  status: AssetStatus;
  source: string;
  anim: AssetAnimConfig | null;
}

export interface AssetListResponse {
  total: number;
  items: AssetAdminView[];
}

export interface AssetPublishResult {
  version: string;
  assetCount: number;
}

export interface AssetBulkStatusResult {
  updated: number;
}

// ============ 素材问题反馈(UI-2 报错闭环) ============

/** 问题作用域:asset=素材图错误(画错/裁错/分类错),anim=角色表动画异常(朝向/残帧) */
export const ASSET_ISSUE_SCOPES = ['asset', 'anim'] as const;

export type AssetIssueScope = (typeof ASSET_ISSUE_SCOPES)[number];

export const ASSET_ISSUE_STATUSES = ['open', 'resolved'] as const;

export type AssetIssueStatus = (typeof ASSET_ISSUE_STATUSES)[number];

/** 素材问题单(游戏内信息卡/动画演示器/审查页三处上报,后台清单流转) */
export interface AssetIssueView {
  id: number;
  scope: AssetIssueScope;
  /** asset=素材 slug;anim=角色表 slug */
  refSlug: string;
  /** scope=asset 时关联的素材 id(可空:动画问题无素材行) */
  refId: number | null;
  /** 上报上下文(anim: group/dir/row/frames/fps;asset: kind/theme 等) */
  context: Record<string, unknown> | null;
  note: string | null;
  status: AssetIssueStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AssetIssueListResponse {
  total: number;
  items: AssetIssueView[];
}
