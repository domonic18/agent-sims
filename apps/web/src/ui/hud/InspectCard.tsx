import { useEffect, useState } from 'react';
import {
  furnitureDescription,
  furnitureLabel,
  getActivityDefinition,
  getItem,
  GATHER_TASKS,
  MAINTENANCE_TASKS,
  NODE_MAX_CHARGES,
  resourceNodeLabel,
  type ActivityDefinition,
  type GatherTaskDef,
} from '@sims/shared';
import {
  fetchGameAssetRegistry,
  type GameAssetRegistry,
} from '../../game/manifest';
import { NODE_SPRITE_OF } from '../../game/resources-view';
import { FENCE_DAMAGE_SPRITE, LITTER_SPRITES } from '../../game/maintenance-view';
import type { CharacterView } from '../side-panel/place';
import { reportAssetIssue } from '../../net/issueApi';
import { useInspectStore, type InspectTarget } from '../../store/inspectStore';

/** 家具 emoji 兜底(素材缺失/清单滞后时) */
const KIND_EMOJI: Record<string, string> = {
  bed: '🛏', desk: '📖', workstation: '💼', treadmill: '🏃', table: '🍽', bookshelf: '📚',
  shelf: '🏪', counter: '🧾', sofa: '🛋', plant: '🪴', fridge: '🧊', tv: '📺',
  wardrobe: '🚪', bench: '🪑', stove: '🍳', workbench: '🔨',
};

const PLACE_EMOJI: Array<[prefix: string, emoji: string]> = [
  ['restaurant', '🍽'], ['cafe', '☕'], ['shop', '🛍'], ['housing', '🏠'], ['home', '🏠'],
  ['library', '📚'], ['school', '🏫'], ['gym', '🏋'], ['clinic', '🏥'], ['hospital', '🏥'],
  ['hotel', '🏨'], ['park', '🌳'], ['beach', '🏖'], ['campsite', '⛺'], ['office', '🏢'],
];

/** 家具图标 slug:与渲染层 furniture-art 同一兜底链(sprite→kind→shelf 变体) */
function iconSlugOf(target: InspectTarget): string | null {
  switch (target.kind) {
    case 'furniture': {
      const f = target.furniture;
      return f.sprite ?? (f.kind === 'shelf' && f.w > f.h ? 'bench' : f.kind);
    }
    case 'resource':
      return NODE_SPRITE_OF[target.resource.kind] ?? null;
    case 'maintenance':
      return target.spot.kind === 'litter'
        ? LITTER_SPRITES[target.spot.variant % LITTER_SPRITES.length] ?? null
        : FENCE_DAMAGE_SPRITE;
    default:
      return null;
  }
}

function emojiOf(target: InspectTarget): string {
  switch (target.kind) {
    case 'furniture':
      return KIND_EMOJI[target.furniture.kind] ?? '📦';
    case 'resource':
      return target.resource.kind === 'berry_bush' ? '🍓' : '🗑';
    case 'maintenance':
      return target.spot.kind === 'litter' ? '🧹' : '🔨';
    default: {
      const id = target.place.id;
      const hit = PLACE_EMOJI.find(([prefix]) => id.startsWith(prefix));
      return hit?.[1] ?? '📍';
    }
  }
}

let iconRegistryPromise: Promise<GameAssetRegistry> | null = null;
const iconRegistry = (): Promise<GameAssetRegistry> => {
  iconRegistryPromise ??= fetchGameAssetRegistry();
  return iconRegistryPromise;
};

function useIconUrl(slug: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (slug === null) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void iconRegistry()
      .then((registry) => {
        if (cancelled) return;
        const asset = registry.bySlug.get(slug);
        setUrl(asset !== undefined ? `/assets/${asset.url}` : null);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return url;
}

export interface InspectCardProps {
  isAdmin: boolean;
  character: CharacterView | null;
  onActivity: (def: ActivityDefinition) => void;
  onSleep: () => void;
  onWorkTask: (targetId: string) => void;
  onMove: (x: number, y: number) => void;
}

/**
 * 点选物件信息卡(游览体验,游客与管理员共用):点画布上的家具/资源点/维护点/
 * 场所建筑弹出——「这是什么、能干什么」;图标用该物件素材贴图(pixelated 放大),
 * 缺失回退 emoji。管理员态卡内附快捷操作(go-and-do 合成,未选中角色置灰)。
 */
export function InspectCard(props: InspectCardProps): React.JSX.Element | null {
  const target = useInspectStore((state) => state.target);
  const close = useInspectStore((state) => state.close);
  const slug = target !== null ? iconSlugOf(target) : null;
  const iconUrl = useIconUrl(slug);
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  useEffect(() => {
    setReportState('idle');
  }, [target]);
  if (target === null) return null;

  const reportIssue = (): void => {
    if (slug === null) return;
    setReportState('sending');
    void reportAssetIssue({
      scope: 'asset',
      refSlug: slug,
      context: {
        key: target.kind === 'furniture' ? target.furniture.kind : target.kind,
        kind: target.kind,
        place: target.kind === 'furniture' ? target.placeName : '',
      },
    })
      .then(() => setReportState('done'))
      .catch(() => setReportState('error'));
  };

  const { character, isAdmin } = props;
  const disabled = character === null;
  const guard = (fn: () => void) => (): void => {
    if (character !== null) fn();
  };

  let title: string;
  let tag: string;
  let tone: string;
  let rows: Array<[string, string]>;
  let desc: string;
  let action: { label: string; run: () => void } | null = null;

  switch (target.kind) {
    case 'furniture': {
      const f = target.furniture;
      title = furnitureLabel(f.kind);
      tag = '家具';
      tone = 'furniture';
      rows = [['位置', `(${f.x}, ${f.y})`], ['归属', target.placeName]];
      desc = furnitureDescription(f.kind);
      const activity = f.activityId !== undefined ? getActivityDefinition(f.activityId) : null;
      if (f.kind === 'bed') {
        action = { label: '😴 去睡觉', run: guard(() => props.onSleep()) };
      } else if (activity !== null && f.use !== undefined) {
        desc += ` 可在此${activity.name}。`;
        action = { label: `▶ 去${activity.name}`, run: guard(() => props.onActivity(activity)) };
      }
      break;
    }
    case 'resource': {
      const r = target.resource;
      title = resourceNodeLabel(r.kind);
      tag = '资源';
      tone = 'resource';
      rows = [
        [
          '位置',
          `(${r.x}, ${r.y})`,
        ],
        [
          '存量',
          r.charges === null ? '无限' : `${r.charges} / ${NODE_MAX_CHARGES[r.kind] ?? '?'}`,
        ],
      ];
      const task = (Object.values(GATHER_TASKS) as GatherTaskDef[]).find(
        (t) => t.nodeKind === r.kind,
      );
      const yields = (task?.yields ?? [])
        .map((y) => `${getItem(y.itemId)?.name ?? y.itemId}×${y.count}${y.chance !== undefined ? `(概率 ${(y.chance * 100).toFixed(0)}%)` : ''}`)
        .join('、');
      desc =
        r.charges === null
          ? `翻找 ${task?.durationMinutes ?? '?'} 分钟,可获得 ${yields};永不枯竭。`
          : `采集 ${task?.durationMinutes ?? '?'} 分钟产出 ${yields};采空后次日清晨重生。`;
      action = { label: '⛏ 去采集', run: guard(() => props.onWorkTask(r.id)) };
      break;
    }
    case 'maintenance': {
      const spot = target.spot;
      const task = spot.kind === 'litter' ? MAINTENANCE_TASKS.clean : MAINTENANCE_TASKS.repair;
      title = spot.kind === 'litter' ? '杂物' : '围栏破损';
      tag = '维护点';
      tone = 'maint';
      rows = [['位置', `(${spot.x}, ${spot.y})`]];
      desc =
        spot.kind === 'litter'
          ? `街道散落的杂物——清洁 ${task.durationMinutes} 分钟即可清理,报酬 ${task.pay} 币;及时维护让城镇更繁荣。`
          : `围栏出现破损——修理 ${task.durationMinutes} 分钟即可修复(消耗修补钉×1),报酬 ${task.pay} 币。`;
      action = {
        label: spot.kind === 'litter' ? '🧹 去清洁' : '🔨 去修理',
        run: guard(() => props.onWorkTask(spot.id)),
      };
      break;
    }
    default: {
      const place = target.place;
      title = place.name;
      tag = '场所';
      tone = 'place';
      const furniture = place.furniture ?? [];
      const activities = new Set<string>();
      for (const f of furniture) {
        const def = f.activityId !== undefined ? getActivityDefinition(f.activityId) : null;
        if (def !== null) activities.add(def.name);
      }
      rows = [
        ['入口', `(${place.entrance.x}, ${place.entrance.y})`],
        ['家具', `${furniture.length} 件`],
      ];
      desc =
        activities.size > 0
          ? `在这里可以进行: ${[...activities].join('、')}。`
          : '城镇的一处场所。';
      action = {
        label: '🚶 前往',
        run: guard(() => props.onMove(place.entrance.x, place.entrance.y)),
      };
    }
  }

  return (
    <div className="px-box inspect-card">
      <div className="px-inner inspect-card-inner">
        <div className="inspect-head">
          <div className="inspect-icon">
            {iconUrl !== null ? <img src={iconUrl} alt="" /> : emojiOf(target)}
          </div>
          <b className="inspect-title">{title}</b>
          <span className={`inspect-tag ${tone}`}>{tag}</span>
          <button type="button" className="inspect-close" title="关闭" onClick={close}>
            ✕
          </button>
        </div>
        <div className="inspect-rows">
          {rows.map(([label, value]) => (
            <span key={label}>
              {label}:<b>{value}</b>
            </span>
          ))}
        </div>
        <p className="inspect-desc">{desc}</p>
        {isAdmin && (action !== null || slug !== null) && (
          <div className="inspect-admin">
            {action !== null && (
              <>
                <span>管理员</span>
                <button
                  type="button"
                  className="px-btn"
                  disabled={disabled}
                  title={disabled ? '先点击角色选中' : undefined}
                  onClick={action.run}
                >
                  {action.label}
                </button>
              </>
            )}
            {slug !== null && (
              <button
                type="button"
                className="px-btn"
                disabled={reportState === 'sending' || reportState === 'done'}
                title="这张图的显示内容不对?上报到后台素材问题清单"
                onClick={reportIssue}
              >
                {reportState === 'done'
                  ? '✓ 已上报'
                  : reportState === 'error'
                    ? '✕ 失败,重试'
                    : reportState === 'sending'
                      ? '…'
                      : '⚠ 图不对'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
