import { useEffect } from 'react';
import { useWorldStore } from '../store/worldStore';
import {
  ActivitySection,
  CharactersSection,
  GoSection,
} from './side-panel/sections';
import {
  AssetsSection,
  BackpackSection,
  FridgeSection,
  ShopSection,
} from './side-panel/shop';
import { findPlaceAt } from './side-panel/place';
import { useGoAndDo } from './side-panel/useGoAndDo';
import './side-panel.css';

/**
 * 玩家侧边面板(M3.4;M3.6e 锚点语义;M3.6h 拆分至 side-panel/):
 * 角色选择/数值/前往/活动/资产/商店/背包/冰箱。
 * 活动开始目标为室内家具使用格(书桌/床/跑步机…),无锚点活动(散步)仍按场所;
 * 全部操作经 socket 意图通道下发,状态随每 tick 快照自动刷新。
 */
export function SidePanel() {
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);
  const focusPlaceId = useWorldStore((state) => state.focusPlaceId);

  const character = snapshot?.characters.find((c) => c.id === selectedId) ?? null;
  const { feedback, run, startActivity, buyItem, pending } = useGoAndDo(
    character,
    snapshot,
    selectedId,
  );

  useEffect(() => {
    if (focusPlaceId === null) return;
    document
      .getElementById(`place-row-${focusPlaceId}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusPlaceId]);

  if (snapshot === null) {
    return <aside className="side-panel">等待世界快照…</aside>;
  }

  const atPlace = character !== null ? findPlaceAt(snapshot, character.x, character.y) : null;
  const day = snapshot.clock.day;

  return (
    <aside className="side-panel">
      <CharactersSection
        snapshot={snapshot}
        selectedId={selectedId}
        character={character}
        onSelect={selectCharacter}
      />

      {character !== null && (
        <>
          <GoSection character={character} atPlace={atPlace} focusPlaceId={focusPlaceId} run={run} />
          <ActivitySection
            character={character}
            atPlace={atPlace}
            pending={pending}
            run={run}
            startActivity={startActivity}
          />
          <AssetsSection character={character} day={day} run={run} />
          <ShopSection character={character} atPlace={atPlace} pending={pending} buyItem={buyItem} />
          <BackpackSection character={character} atPlace={atPlace} day={day} run={run} />
          <FridgeSection character={character} atPlace={atPlace} day={day} run={run} />
        </>
      )}

      {feedback !== null && (
        <p className={feedback.ok ? 'feedback ok' : 'feedback err'}>
          {feedback.ok ? '✓' : '✗'} {feedback.message}
        </p>
      )}
    </aside>
  );
}
