import { useEffect, useRef, useState } from 'react';
import {
  constructionBlueprints,
  countWorkTargets,
  getActivityDefinition,
  getItem,
  GATHER_TASKS,
  isGatherTask,
  MAINTENANCE_TASKS,
  type ActivityDefinition,
  type BuildBlueprint,
  type WorkTaskId,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { SidePanel } from '../SidePanel';
import { findPlaceByRef, type CharacterView } from '../side-panel/place';
import type { GoAndDoPending, RunIntent } from '../side-panel/useGoAndDo';
import { pushToast } from '../../store/toastStore';
import { useWorldStore } from '../../store/worldStore';
import { activityChip } from './activityChip';

interface ActionBarProps {
  character: CharacterView | null;
  snapshot: WorldSnapshotMessage | null;
  pending: GoAndDoPending | null;
  run: RunIntent;
  startActivity: (def: ActivityDefinition) => Promise<void>;
  startSleep: () => Promise<void>;
  startWorkTask: (task: WorkTaskId) => Promise<void>;
}

/** 下拉菜单: 点击按钮开合,点击外部或选中后关闭 */
function Menu({ label, title, disabled, items }: {
  label: string;
  title: string;
  disabled: boolean;
  items: Array<{ key: string; text: string; hint: string; disabled: boolean; onPick: () => void }>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="hud-menu" ref={ref}>
      <button
        type="button"
        className="px-btn"
        title={title}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <div className="px-box hud-menu-list">
          <div className="px-inner">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className="px-btn hud-menu-item"
                disabled={item.disabled}
                title={item.hint}
                onClick={() => {
                  setOpen(false);
                  item.onPick();
                }}
              >
                {item.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 行动面板弹层(UI-1 C5): 内嵌全量 SidePanel(行动/物品/资产三页),点击外部关闭 */
function InventoryPopover({ onClose }: { onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div className="px-box inv-popover" ref={ref}>
      <div className="px-inner inv-popover-inner">
        <div className="inv-head">
          <b>行动面板</b>
          <button type="button" className="px-btn sq" title="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <SidePanel />
      </div>
    </div>
  );
}

/** 底部快捷动作条(UI-1): 高频 go-and-do 一键直达;全量操作(社交/商店/制作/背包/资产)收进 🧰 行动面板弹层 */
export function ActionBar({
  character,
  snapshot,
  pending,
  run,
  startActivity,
  startSleep,
  startWorkTask,
}: ActionBarProps): JSX.Element | null {
  const map = useWorldStore((state) => state.map);
  const buildDraft = useWorldStore((state) => state.buildDraft);
  const setBuildDraft = useWorldStore((state) => state.setBuildDraft);
  const [invOpen, setInvOpen] = useState(false);

  if (character === null || snapshot === null) return null;
  const dead = !character.alive;
  const homeless = character.housing === null;
  const chip = activityChip(character);
  const mealDef = getActivityDefinition('meal');
  const strollDef = getActivityDefinition('stroll');

  const goHome = async (): Promise<void> => {
    if (character.housing === null || map === null) return;
    const place = findPlaceByRef(map, character.housing.propertyId);
    if (place === null) return;
    await run({
      type: 'move_to',
      characterId: character.id,
      x: place.entrance.x,
      y: place.entrance.y,
    });
  };

  const taskItem = (task: WorkTaskId) => {
    const count = countWorkTargets(task, snapshot);
    const name = getActivityDefinition(task)?.name ?? task;
    return {
      key: task,
      text: `${name} · ${count > 0 ? `${count} 处` : '无目标'}`,
      hint: isGatherTask(task)
        ? `${GATHER_TASKS[task].durationMinutes}分 · 产出入背包`
        : `${MAINTENANCE_TASKS[task].durationMinutes}分 · +${MAINTENANCE_TASKS[task].pay}币/单`,
      disabled: dead || count === 0,
      onPick: () => void startWorkTask(task),
    };
  };

  // 建造菜单(S2批2,仅镇核心世界):蓝图不合格置灰;选定进选区模式(画布点击/拖画落单)
  const storage = snapshot.storage;
  const buildItem = (bp: BuildBlueprint) => {
    const knowledgeOk = character.knowledge >= bp.requiredKnowledge;
    const afford =
      bp.kind === 'fence'
        ? (storage['wood'] ?? 0) >= 1
        : Object.entries(bp.materials).every(([id, need]) => (storage[id] ?? 0) >= need);
    const mats = Object.entries(bp.materials)
      .map(([id, need]) => `${getItem(id)?.name ?? id}×${need}`)
      .join(' ');
    return {
      key: bp.id,
      text: bp.kind === 'fence' ? `${bp.label}(拖画条形)` : `${bp.label} ${bp.size!.w}×${bp.size!.h}`,
      hint:
        bp.kind === 'fence'
          ? `每格扣 ${mats} · 工时 ${bp.fenceWork!.baseMinutes}+${bp.fenceWork!.minutesPerCell}/格 · ${bp.fenceWork!.wagePerCell}币/格 · 知识≥${bp.requiredKnowledge}`
          : `单仓扣 ${mats} · 工时 ${bp.durationMinutes}分 · ${bp.wage}币 · 知识≥${bp.requiredKnowledge}`,
      disabled: dead || !knowledgeOk || !afford,
      onPick: () => {
        setBuildDraft({ blueprintId: bp.id });
        pushToast(
          true,
          bp.kind === 'fence'
            ? `建造${bp.label}:在画布拖画条形,ESC 取消`
            : `建造${bp.label}:单击画布落 ${bp.size!.w}×${bp.size!.h} 占地,ESC 取消`,
        );
      },
    };
  };
  const buildMenuItems =
    snapshot.storageSpot !== null
      ? constructionBlueprints(snapshot.gameType).map((bp) => buildItem(bp))
      : [];

  return (
    <div className="px-box hud-actions">
      <div className="px-inner hud-actions-inner">
        {chip !== null ? (
          <span className="hud-tag doing" title="当前行动">
            {chip.icon} {chip.label}
          </span>
        ) : (
          <span className="hud-tag idle">空闲</span>
        )}
        <i className="hud-sep" />
        <button
          type="button"
          className="px-btn"
          disabled={dead || homeless}
          title={homeless ? '无住房,先在资产页租住公寓' : '返回自家门口'}
          onClick={() => void goHome()}
        >
          🏠 回家
        </button>
        <button
          type="button"
          className="px-btn"
          disabled={dead || homeless}
          title={
            homeless
              ? '无住房,先在资产页租住公寓才能睡觉'
              : '回家上床睡 8 小时;昨夜累计睡 ≥4 小时免缺觉惩罚(须自家床)'
          }
          onClick={() => void startSleep()}
        >
          😴 睡觉
        </button>
        <button
          type="button"
          className="px-btn"
          disabled={dead}
          title="前往食堂就餐(花销换幸福)"
          onClick={() => void (mealDef !== null && startActivity(mealDef))}
        >
          🍚 吃饭
        </button>
        <button
          type="button"
          className="px-btn"
          disabled={dead}
          title="公园散步,回复幸福"
          onClick={() => void (strollDef !== null && startActivity(strollDef))}
        >
          🚶 散步
        </button>
        <Menu
          label="⛏ 采集 ▾"
          title="选择采集工单"
          disabled={dead}
          items={(Object.keys(GATHER_TASKS) as WorkTaskId[]).map((task) => taskItem(task))}
        />
        <Menu
          label="🔨 工作 ▾"
          title="选择维护工单"
          disabled={dead}
          items={(Object.keys(MAINTENANCE_TASKS) as WorkTaskId[]).map((task) => taskItem(task))}
        />
        {buildMenuItems.length > 0 && (
          <Menu
            label="🏗 建造 ▾"
            title="选择建造蓝图(材料从镇核心单仓扣除)"
            disabled={dead}
            items={buildMenuItems}
          />
        )}
        {buildDraft !== null && (
          <button
            type="button"
            className="px-btn on"
            title="点击取消建造选区(ESC 同效)"
            onClick={() => setBuildDraft(null)}
          >
            🏗 选区中…
          </button>
        )}
        <button
          type="button"
          className={`px-btn${invOpen ? ' on' : ''}`}
          title="行动面板(社交/商店/制作/背包/资产)"
          onClick={() => setInvOpen((value) => !value)}
        >
          🧰 行动
        </button>
        {pending !== null && <span className="hud-tag route">…途中自动接续</span>}
      </div>
      {invOpen && <InventoryPopover onClose={() => setInvOpen(false)} />}
    </div>
  );
}
