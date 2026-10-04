import { useEffect, useRef, useState } from 'react';
import {
  ACTIVITY_DEFINITIONS,
  FURNITURE_LABELS,
  PROPERTY_DEFINITIONS,
  SHOP_ITEMS,
  TOWN_MAP,
  getActivityDefinition,
  type ActivityDefinition,
  type Intent,
  type PlaceDefinition,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { sendIntent } from '../net/socket';
import { pushToast } from '../store/toastStore';
import { useWorldStore } from '../store/worldStore';
import './side-panel.css';

/** 与服务端 _atPlace 同规则: 位于场所矩形内或入口格即"在场所" */
function findPlaceAt(snapshot: WorldSnapshotMessage, x: number, y: number): PlaceDefinition | null {
  for (const place of TOWN_MAP.places) {
    const inRect =
      x >= place.x && x < place.x + place.w && y >= place.y && y < place.y + place.h;
    if (inRect || (x === place.entrance.x && y === place.entrance.y)) {
      return place;
    }
  }
  return null;
}

interface ActivityAnchor {
  x: number;
  y: number;
  placeId: string;
  label: string;
}

/** 活动锚点使用格全集(M3.6e 内景): 与服务端 TileMap.activityAnchors 同源 TOWN_MAP */
function activityAnchors(activityId: string): ActivityAnchor[] {
  const anchors: ActivityAnchor[] = [];
  for (const place of TOWN_MAP.places) {
    for (const furniture of place.furniture ?? []) {
      if (furniture.activityId === activityId && furniture.use !== undefined) {
        anchors.push({
          x: furniture.use.x,
          y: furniture.use.y,
          placeId: place.id,
          label: FURNITURE_LABELS[furniture.kind],
        });
      }
    }
  }
  return anchors;
}

/**
 * 玩家侧边面板(M3.4;M3.6e 锚点语义):角色选择/数值/前往/活动/资产/商店。
 * 活动开始目标为室内家具使用格(书桌/床/跑步机…),无锚点活动(散步)仍按场所;
 * 全部操作经 socket 意图通道下发,状态随每 tick 快照自动刷新。
 */
export function SidePanel() {
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);
  const focusPlaceId = useWorldStore((state) => state.focusPlaceId);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(null);
  const pendingArrivalRef = useRef(false);

  const character = snapshot?.characters.find((c) => c.id === selectedId) ?? null;

  const run = async (intent: Intent): Promise<void> => {
    const ack = await sendIntent(intent);
    setFeedback(ack);
    pushToast(ack.ok, ack.message);
  };

  /**
   * 开始活动:已在锚点使用格(或无锚点活动已在场所)直接开始;否则先前往
   * 首个锚点使用格/场所入口,到达后自动接续开始。协议仍是两步显式语义,
   * 此处仅为客户端 UI 合成(move_to → start_activity)。
   */
  const startActivity = async (def: ActivityDefinition): Promise<void> => {
    if (character === null || snapshot === null) return;
    const anchors = activityAnchors(def.id);
    const atPlace = findPlaceAt(snapshot, character.x, character.y);
    const arrived =
      anchors.length > 0
        ? anchors.some((a) => character.x === a.x && character.y === a.y)
        : def.placeIds.includes(atPlace?.id ?? '');
    if (arrived) {
      await run({ type: 'start_activity', characterId: character.id, activityId: def.id });
      return;
    }
    // 未在位:锚点活动去首个使用格,无锚点活动(散步)去首选场所入口
    const target =
      anchors.length > 0
        ? { x: anchors[0]!.x, y: anchors[0]!.y }
        : (() => {
            const place = TOWN_MAP.places.find((p) => p.id === def.placeIds[0]);
            return place !== undefined ? { x: place.entrance.x, y: place.entrance.y } : null;
          })();
    if (target === null) return;
    const ack = await sendIntent({
      type: 'move_to',
      characterId: character.id,
      x: target.x,
      y: target.y,
    });
    setFeedback(ack);
    pushToast(ack.ok, ack.message);
    pendingArrivalRef.current = false;
    setPendingActivityId(ack.ok ? def.id : null);
  };

  useEffect(() => {
    setPendingActivityId(null);
  }, [selectedId]);

  // 前往途中随每 tick 快照检查:到达锚点使用格(或场所)后自动接续开始;
  // 途中改道/被打断则放弃。pendingArrivalRef 标记"快照已反映行进",
  // 未见行进前不判弃(move_to 刚下发时快照尚未反映移动)。
  useEffect(() => {
    if (pendingActivityId === null || character === null || snapshot === null) return;
    if (character.activity !== null) {
      pendingArrivalRef.current = false;
      setPendingActivityId(null);
      return;
    }
    if (character.pathRemaining > 0) {
      pendingArrivalRef.current = true;
      return;
    }
    const def = getActivityDefinition(pendingActivityId);
    if (def === null) {
      pendingArrivalRef.current = false;
      setPendingActivityId(null);
      return;
    }
    const anchors = activityAnchors(def.id);
    const arrived =
      anchors.length > 0
        ? anchors.some((a) => character.x === a.x && character.y === a.y)
        : def.placeIds.includes(findPlaceAt(snapshot, character.x, character.y)?.id ?? '');
    if (arrived) {
      pendingArrivalRef.current = false;
      setPendingActivityId(null);
      void run({ type: 'start_activity', characterId: character.id, activityId: def.id });
      return;
    }
    if (pendingArrivalRef.current) {
      pendingArrivalRef.current = false;
      setPendingActivityId(null);
    }
  }, [pendingActivityId, character, snapshot]);

  useEffect(() => {
    if (focusPlaceId === null) return;
    document
      .getElementById(`place-row-${focusPlaceId}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusPlaceId]);

  if (snapshot === null) {
    return <aside className="side-panel">等待世界快照…</aside>;
  }

  const activity = character?.activity ?? null;
  const activityDef = activity !== null ? getActivityDefinition(activity.activityId) : null;
  const progress =
    activity !== null && activityDef !== null
      ? Math.min(100, Math.round((activity.elapsedMinutes / activityDef.durationMinutes) * 100))
      : 0;
  const atPlace = character !== null ? findPlaceAt(snapshot, character.x, character.y) : null;
  const housing = character?.housing ?? null;
  const property = PROPERTY_DEFINITIONS[0];

  return (
    <aside className="side-panel">
      <section className="panel-section">
        <h3>角色</h3>
        {snapshot.characters.length === 0 ? (
          <p className="hint">世界暂无角色</p>
        ) : (
          <select
            value={selectedId ?? ''}
            onChange={(event) => selectCharacter(event.target.value)}
          >
            {snapshot.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {character !== null && (
          <div className="vitals">
            <VitalBar label="体力" value={character.energy} />
            <VitalBar label="幸福" value={character.happiness} />
            <div className="coins">金币 {Math.round(character.coins * 10) / 10}</div>
          </div>
        )}
      </section>

      {character !== null && (
        <>
          <section className="panel-section">
            <h3>前往</h3>
            <ul className="activity-list">
              {TOWN_MAP.places.map((place) => {
                const moving = character.pathRemaining > 0;
                const here = atPlace?.id === place.id;
                return (
                  <li
                    key={place.id}
                    id={`place-row-${place.id}`}
                    className={focusPlaceId === place.id ? 'focused' : ''}
                  >
                    <span>
                      {place.name}
                      {here && <small> · 在此</small>}
                    </span>
                    <button
                      type="button"
                      disabled={moving || here}
                      onClick={() =>
                        void run({
                          type: 'move_to',
                          characterId: character.id,
                          x: place.entrance.x,
                          y: place.entrance.y,
                        })
                      }
                    >
                      前往
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel-section">
            <h3>活动{atPlace !== null ? ` · ${atPlace.name}` : ' · 野外'}</h3>
            {activity !== null && activityDef !== null ? (
              <div className="activity-running">
                <div>
                  进行中:{activityDef.name}({activity.elapsedMinutes}/
                  {activityDef.durationMinutes} 分)
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <button type="button" onClick={() => void run({ type: 'stop_activity', characterId: character.id })}>
                  取消活动
                </button>
              </div>
            ) : (
              <ul className="activity-list">
                {ACTIVITY_DEFINITIONS.map((def) => {
                  const anchors = activityAnchors(def.id);
                  const targetLabel =
                    anchors.length > 0
                      ? anchors.map((a) => a.label).join('/')
                      : def.placeIds
                          .map((id) => TOWN_MAP.places.find((p) => p.id === id)?.name ?? id)
                          .join('/');
                  const here =
                    anchors.length > 0
                      ? anchors.some((a) => character.x === a.x && character.y === a.y)
                      : def.placeIds.includes(atPlace?.id ?? '');
                  const moving = character.pathRemaining > 0;
                  const pending = pendingActivityId === def.id;
                  return (
                    <li
                      key={def.id}
                      id={`activity-row-${def.id}`}
                      className={pending ? 'focused' : ''}
                    >
                      <span>
                        {def.name}
                        <small>
                          {targetLabel} {def.durationMinutes}分
                          {def.effects.coins !== 0 &&
                            (def.effects.coins > 0
                              ? ` +${def.effects.coins}/分`
                              : ` ${def.effects.coins}/分`)}
                        </small>
                      </span>
                      <button
                        type="button"
                        disabled={moving}
                        title={here ? undefined : `自动前往 ${targetLabel} 并开始`}
                        onClick={() => void startActivity(def)}
                      >
                        {pending ? '途中…' : '开始'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel-section">
            <h3>资产</h3>
            {housing !== null && property !== undefined && (
              <div className="housing">
                <div>
                  {property.name}:{' '}
                  {housing.ownership === 'owned'
                    ? '自有'
                    : `租约付至第 ${housing.paidThroughDay} 日`}
                </div>
                {housing.ownership === 'rent' && (
                  <div className="housing-actions">
                    <button
                      type="button"
                      onClick={() => void run({ type: 'rent_property', characterId: character.id, propertyId: property.id })}
                    >
                      续租 {property.rentPrice}币
                    </button>
                    <button
                      type="button"
                      onClick={() => void run({ type: 'buy_property', characterId: character.id, propertyId: property.id })}
                    >
                      买断 {property.buyPrice}币
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section
            id="place-row-shop"
            className={focusPlaceId === 'shop' ? 'panel-section focused' : 'panel-section'}
          >
            <h3>商店</h3>
            <ul className="shop-list">
              {SHOP_ITEMS.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.name}
                    <small>
                      {item.price}币 体力+{item.effects.energy}
                      {item.effects.happiness > 0 ? ` 幸福+${item.effects.happiness}` : ''}
                    </small>
                  </span>
                  <button
                    type="button"
                    onClick={() => void run({ type: 'buy_item', characterId: character.id, itemId: item.id })}
                  >
                    食用
                  </button>
                </li>
              ))}
            </ul>
          </section>
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

function VitalBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="vital">
      <span className="vital-label">{label}</span>
      <div className="vital-track">
        <div className="vital-fill" style={{ width: `${clamped}%` }} />
      </div>
      <span className="vital-value">{Math.round(value)}</span>
    </div>
  );
}
