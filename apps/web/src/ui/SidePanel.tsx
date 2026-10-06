import { useEffect, useRef, useState } from 'react';
import { LOW_ENERGY_THRESHOLD, type WorkTaskId } from '@sims/shared';
import { sendIntent } from '../net/socket';
import { pushToast } from '../store/toastStore';
import { useWorldStore } from '../store/worldStore';
import {
  ActivitySection,
  CharactersSection,
  GoSection,
  SocialSection,
} from './side-panel/sections';
import {
  AssetsSection,
  BackpackSection,
  CraftSection,
  FridgeSection,
  ShopSection,
} from './side-panel/shop';
import { findPlaceAt } from './side-panel/place';
import { nearestWorkTarget, useGoAndDo } from './side-panel/useGoAndDo';
import './side-panel.css';

/** 面板分页: 行动(前往/活动/社交) · 物品(商店/背包/冰箱) · 资产(住房) */
type PanelTab = 'actions' | 'items' | 'assets';

const TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'actions', label: '行动' },
  { id: 'items', label: '物品' },
  { id: 'assets', label: '资产' },
];

/**
 * 玩家侧边面板(M3.4;M3.6e 锚点语义;M3.6h 拆分;M3.6i 分页重构;社交 v1 行动页增社交小节):
 * 顶部角色状态常驻,正文按「行动/物品/资产」三页收纳,底部操作反馈常驻,
 * 免长滚动且菜单结构一目了然。活动开始目标为室内家具使用格(书桌/床/跑步机…),
 * 无锚点活动(散步)仍按场所;全部操作经 socket 意图通道下发,状态随每 tick 快照刷新。
 * 地图点击建筑 → 自动切到行动页并滚动定位对应场所行。
 */
export function SidePanel() {
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);
  const focusPlaceId = useWorldStore((state) => state.focusPlaceId);
  const map = useWorldStore((state) => state.map);
  const continuousWork = useWorldStore((state) => state.continuousWork);
  const toggleContinuousWork = useWorldStore((state) => state.toggleContinuousWork);
  const [tab, setTab] = useState<PanelTab>('actions');

  const character = snapshot?.characters.find((c) => c.id === selectedId) ?? null;
  const { feedback, run, startActivity, buyItem, startWorkTask, startCraft, startSleep, pending } =
    useGoAndDo(character, snapshot, selectedId);

  // 连续作业自动接单(M-G.5):开关角色空闲(无活动/不在途/存活/体力高于阈值)即
  // 自动接最近同岗单;被服务端拒绝的目标记入黑名单防逐 tick 重试,重开开关清空。
  const autoFailedRef = useRef<Set<string>>(new Set());
  const autoBusyRef = useRef(false);
  useEffect(() => {
    if (character === null || snapshot === null || !character.alive) return;
    const task = continuousWork[character.id];
    if (task === undefined || autoBusyRef.current) return;
    if (character.activity !== null || character.pathRemaining > 0) return;
    if (character.energy <= LOW_ENERGY_THRESHOLD) return;
    const target = nearestWorkTarget(task, character, snapshot);
    if (target === null || autoFailedRef.current.has(target.targetId)) return;
    autoBusyRef.current = true;
    void sendIntent({ type: 'work_task', characterId: character.id, targetId: target.targetId })
      .then((ack) => {
        if (!ack.ok) autoFailedRef.current.add(target.targetId);
        pushToast(ack.ok, ack.ok ? `连续作业 · ${ack.message}` : ack.message);
      })
      .finally(() => {
        autoBusyRef.current = false;
      });
  }, [character, snapshot, continuousWork]);

  const toggleContinuous = (task: WorkTaskId | null): void => {
    if (character === null) return;
    autoFailedRef.current.clear();
    toggleContinuousWork(character.id, task);
  };

  useEffect(() => {
    if (focusPlaceId === null) return;
    setTab('actions'); // 场所行全在行动页(前往列表)
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`place-row-${focusPlaceId}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPlaceId]);

  if (snapshot === null) {
    return <aside className="side-panel">等待世界快照…</aside>;
  }

  const atPlace = character !== null && map !== null ? findPlaceAt(map, character.x, character.y) : null;
  const day = snapshot.clock.day;

  return (
    <aside className="side-panel">
      <CharactersSection
        snapshot={snapshot}
        selectedId={selectedId}
        character={character}
        onSelect={selectCharacter}
      />

      <nav className="panel-tabs" aria-label="面板分页">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {character !== null && map !== null && tab === 'actions' && (
        <>
          <GoSection
            map={map}
            character={character}
            atPlace={atPlace}
            focusPlaceId={focusPlaceId}
            run={run}
          />
          <ActivitySection
            map={map}
            character={character}
            atPlace={atPlace}
            snapshot={snapshot}
            pending={pending}
            run={run}
            startActivity={startActivity}
            startWorkTask={startWorkTask}
            startSleep={startSleep}
            continuousTask={continuousWork[character.id] ?? null}
            toggleContinuous={toggleContinuous}
          />
          <SocialSection snapshot={snapshot} character={character} run={run} />
        </>
      )}

      {character !== null && tab === 'items' && (
        <>
          <ShopSection character={character} atPlace={atPlace} pending={pending} buyItem={buyItem} />
          <CraftSection character={character} pending={pending} startCraft={startCraft} />
          <BackpackSection character={character} atPlace={atPlace} day={day} run={run} />
          <FridgeSection character={character} atPlace={atPlace} day={day} run={run} />
        </>
      )}

      {character !== null && tab === 'assets' && (
        <AssetsSection character={character} day={day} run={run} />
      )}

      {feedback !== null && (
        <p className={feedback.ok ? 'feedback ok' : 'feedback err'}>
          {feedback.ok ? '✓' : '✗'} {feedback.message}
        </p>
      )}
    </aside>
  );
}
