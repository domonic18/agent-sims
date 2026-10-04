import { useEffect, useState } from 'react';
import {
  ACTIVITY_DEFINITIONS,
  PROPERTY_DEFINITIONS,
  SHOP_ITEMS,
  TOWN_MAP,
  getActivityDefinition,
  getShopItem,
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

/**
 * 玩家侧边面板(M3.4):角色选择/数值/活动/资产/商店。
 * 全部操作经 socket 意图通道下发,状态随每 tick 快照自动刷新。
 */
export function SidePanel() {
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);
  const focusPlaceId = useWorldStore((state) => state.focusPlaceId);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(null);

  const character = snapshot?.characters.find((c) => c.id === selectedId) ?? null;

  const run = async (intent: Intent): Promise<void> => {
    const ack = await sendIntent(intent);
    setFeedback(ack);
    pushToast(ack.ok, ack.message);
  };

  /**
   * 开始活动:在场直接开始;不在场先前往,到达后自动接续开始。
   * 协议仍是两步显式语义,此处仅为客户端 UI 合成(move_to → start_activity)。
   */
  const startActivity = async (def: ActivityDefinition): Promise<void> => {
    if (character === null) return;
    const place = TOWN_MAP.places.find((p) => p.id === def.placeId);
    if (atPlace?.id === def.placeId) {
      await run({ type: 'start_activity', characterId: character.id, activityId: def.id });
      return;
    }
    if (place === undefined) return;
    const ack = await sendIntent({
      type: 'move_to',
      characterId: character.id,
      x: place.entrance.x,
      y: place.entrance.y,
    });
    setFeedback(ack);
    pushToast(ack.ok, ack.message);
    setPendingActivityId(ack.ok ? def.id : null);
  };

  useEffect(() => {
    setPendingActivityId(null);
  }, [selectedId]);

  // 前往途中随每 tick 快照检查:到达目的地后自动接续开始;途中改道/被打断则放弃
  useEffect(() => {
    if (pendingActivityId === null || character === null || snapshot === null) return;
    if (character.activity !== null || character.pathRemaining > 0) return;
    const def = pendingActivityId !== null ? getActivityDefinition(pendingActivityId) : null;
    const at = findPlaceAt(snapshot, character.x, character.y);
    setPendingActivityId(null);
    if (def !== null && at?.id === def.placeId) {
      void run({ type: 'start_activity', characterId: character.id, activityId: def.id });
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
                  const place = TOWN_MAP.places.find((p) => p.id === def.placeId);
                  const here = atPlace?.id === def.placeId;
                  const moving = character.pathRemaining > 0;
                  const pending = pendingActivityId === def.id;
                  return (
                    <li
                      key={def.id}
                      id={`place-row-${def.placeId}`}
                      className={focusPlaceId === def.placeId || pending ? 'focused' : ''}
                    >
                      <span>
                        {def.name}·{place?.name ?? def.placeId}
                        <small>
                          {def.durationMinutes}分
                          {def.effects.coins !== 0 &&
                            (def.effects.coins > 0
                              ? ` +${def.effects.coins}/分`
                              : ` ${def.effects.coins}/分`)}
                        </small>
                      </span>
                      {!here && (
                        <button
                          type="button"
                          disabled={moving || place === undefined}
                          onClick={() =>
                            place !== undefined &&
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
                      )}
                      <button
                        type="button"
                        disabled={moving}
                        title={here ? undefined : '自动前往,到达后开始'}
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
                <div className="hint">
                  已摆放:
                  {housing.placedItems.length === 0
                    ? ' 无'
                    : housing.placedItems
                        .map((id) => getShopItem(id)?.name ?? id)
                        .join('、')}
                </div>
              </div>
            )}
            <div className="inventory">
              库存:
              {character.items.length === 0
                ? ' 无'
                : character.items.map((id) => getShopItem(id)?.name ?? id).join('、')}
            </div>
            {character.items.length > 0 && (
              <div className="housing-actions">
                {[...new Set(character.items)].map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void run({ type: 'place_furniture', characterId: character.id, itemId: id })}
                  >
                    摆放「{getShopItem(id)?.name ?? id}」
                  </button>
                ))}
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
                      {item.price}币
                      {item.category === 'food'
                        ? ` 体力+${item.effects.energy}${item.effects.happiness > 0 ? ` 幸福+${item.effects.happiness}` : ''}`
                        : ' 家具'}
                    </small>
                  </span>
                  <button
                    type="button"
                    onClick={() => void run({ type: 'buy_item', characterId: character.id, itemId: item.id })}
                  >
                    {item.category === 'food' ? '食用' : '购买'}
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
