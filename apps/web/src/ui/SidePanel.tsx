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

/** 容积上限(与服务端 BALANCE 对应,数值文档 §3.2): 背包 8 / 冰箱 30 */
const BACKPACK_VOLUME_LIMIT = 8;
const FRIDGE_VOLUME_LIMIT = 30;

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

/** 库存体积(count × 商品 volume 求和,与服务端 _inventoryVolume 同规则) */
function volumeOf(record: Record<string, number>): number {
  return Object.entries(record).reduce(
    (sum, [itemId, count]) => sum + (SHOP_ITEMS.find((item) => item.id === itemId)?.volume ?? 0) * count,
    0,
  );
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
  /** go-and-do 待办: 到达目标后自动接续(activity=开始活动 / buy=店内购入) */
  const [pending, setPending] = useState<{ kind: 'activity' | 'buy'; id: string } | null>(null);
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
    // 未在位:锚点活动去最近使用格,无锚点活动(散步)去首选场所入口
    const nearest =
      anchors.length > 0
        ? anchors.reduce((best, a) =>
            Math.abs(a.x - character.x) + Math.abs(a.y - character.y) <
            Math.abs(best.x - character.x) + Math.abs(best.y - character.y)
              ? a
              : best,
          )
        : null;
    const target =
      nearest !== null
        ? { x: nearest.x, y: nearest.y }
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
    setPending(ack.ok ? { kind: 'activity', id: def.id } : null);
  };

  /**
   * 购物(M3.6f 店内购约束):已在商店直接购入;否则 go-and-do——
   * 先前往商店入口,到达后自动接续 buy_item。
   */
  const buyItem = async (itemId: string): Promise<void> => {
    if (character === null || snapshot === null) return;
    if (atPlace?.id === 'shop') {
      await run({ type: 'buy_item', characterId: character.id, itemId });
      return;
    }
    const shop = TOWN_MAP.places.find((p) => p.id === 'shop');
    if (shop === undefined) return;
    const ack = await sendIntent({
      type: 'move_to',
      characterId: character.id,
      x: shop.entrance.x,
      y: shop.entrance.y,
    });
    setFeedback(ack);
    pushToast(ack.ok, ack.ok ? '前往商店,到达后自动购入' : ack.message);
    pendingArrivalRef.current = false;
    setPending(ack.ok ? { kind: 'buy', id: itemId } : null);
  };

  useEffect(() => {
    setPending(null);
  }, [selectedId]);

  // 前往途中随每 tick 快照检查:到达目标(锚点使用格/场所/商店)后自动接续;
  // 途中改道/被打断则放弃。pendingArrivalRef 标记"快照已反映行进",
  // 未见行进前不判弃(move_to 刚下发时快照尚未反映移动)。
  useEffect(() => {
    if (pending === null || character === null || snapshot === null) return;
    if (character.activity !== null) {
      pendingArrivalRef.current = false;
      setPending(null);
      return;
    }
    if (character.pathRemaining > 0) {
      pendingArrivalRef.current = true;
      return;
    }
    const finish = (): void => {
      pendingArrivalRef.current = false;
      setPending(null);
    };
    if (pending.kind === 'buy') {
      if (findPlaceAt(snapshot, character.x, character.y)?.id === 'shop') {
        finish();
        void run({ type: 'buy_item', characterId: character.id, itemId: pending.id });
        return;
      }
    } else {
      const def = getActivityDefinition(pending.id);
      if (def === null) {
        finish();
        return;
      }
      const anchors = activityAnchors(def.id);
      const arrived =
        anchors.length > 0
          ? anchors.some((a) => character.x === a.x && character.y === a.y)
          : def.placeIds.includes(findPlaceAt(snapshot, character.x, character.y)?.id ?? '');
      if (arrived) {
        finish();
        void run({ type: 'start_activity', characterId: character.id, activityId: def.id });
        return;
      }
    }
    if (pendingArrivalRef.current) {
      finish();
    }
  }, [pending, character, snapshot]);

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
  const dead = character !== null && !character.alive;
  const moving = character !== null && character.pathRemaining > 0;
  const inShop = atPlace?.id === 'shop';
  const day = snapshot.clock.day;
  // 冰箱存取前提: 位于自己住房且(自有或租约未过期)
  const atHome = housing !== null && atPlace?.id === housing.propertyId;
  const leaseValid = housing === null || housing.ownership === 'owned' || housing.paidThroughDay >= day;
  // 容积上限(与服务端 BALANCE 对应,数值文档 §3.2): 背包 8 / 冰箱 30
  const backpackEntries = Object.entries(character?.backpack ?? {}).filter(([, count]) => count > 0);
  const fridgeEntries = Object.entries(character?.fridge ?? {}).filter(([, count]) => count > 0);
  const backpackUsed = volumeOf(character?.backpack ?? {});
  const fridgeUsed = volumeOf(character?.fridge ?? {});

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
            {!character.alive && (
              <div className="death-banner">☠️ 已死亡(幽灵态),等待复活(/lab 可复活)</div>
            )}
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
                      disabled={moving || here || dead}
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
                  const enRoute = pending?.kind === 'activity' && pending.id === def.id;
                  return (
                    <li
                      key={def.id}
                      id={`activity-row-${def.id}`}
                      className={enRoute ? 'focused' : ''}
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
                        disabled={moving || dead}
                        title={
                          (here ? '' : `自动前往 ${targetLabel} 并开始`) +
                          (def.id === 'rest' ? '恢复速率: 床最快/沙发次之/长椅最慢' : '')
                        }
                        onClick={() => void startActivity(def)}
                      >
                        {enRoute ? '途中…' : '开始'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel-section">
            <h3>资产(四公寓)</h3>
            <ul className="activity-list">
              {PROPERTY_DEFINITIONS.map((prop) => {
                const current = housing?.propertyId === prop.id;
                const owned = current && housing?.ownership === 'owned';
                const expired =
                  current && housing?.ownership === 'rent' && housing.paidThroughDay < day;
                return (
                  <li
                    key={prop.id}
                    id={`asset-row-${prop.id}`}
                    className={expired ? 'expired' : ''}
                  >
                    <span>
                      {prop.name}
                      {current && <small> · 现居</small>}
                      {current && !owned && (
                        <small>
                          {' '}· 付至第 {housing?.paidThroughDay} 日
                          {expired
                            ? ' ⚠已过期'
                            : (housing?.paidThroughDay ?? 0) === day
                              ? ' · 今日到期'
                              : ` · 剩 ${(housing?.paidThroughDay ?? 0) - day} 天`}
                        </small>
                      )}
                      <small>
                        {' '}租{prop.rentPrice}/买{prop.buyPrice}币
                      </small>
                    </span>
                    {owned ? (
                      <em className="owned-tag">自有</em>
                    ) : (
                      <span className="housing-actions">
                        <button
                          type="button"
                          disabled={moving || dead}
                          onClick={() =>
                            void run({ type: 'rent_property', characterId: character.id, propertyId: prop.id })
                          }
                        >
                          {current ? '续租' : '租下'}
                        </button>
                        <button
                          type="button"
                          disabled={moving || dead}
                          onClick={() =>
                            void run({ type: 'buy_property', characterId: character.id, propertyId: prop.id })
                          }
                        >
                          {current ? '买断' : '买下'}
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section
            id="place-row-shop"
            className={focusPlaceId === 'shop' ? 'panel-section focused' : 'panel-section'}
          >
            <h3>商店{inShop ? ' · 在店内' : ''}</h3>
            <ul className="shop-list">
              {SHOP_ITEMS.map((item) => {
                const pendingBuy = pending?.kind === 'buy' && pending.id === item.id;
                return (
                  <li key={item.id}>
                    <span>
                      {item.name}
                      <small>
                        {item.price}币 体积{item.volume} 体力+{item.effects.energy}
                        {item.effects.happiness > 0 ? ` 幸福+${item.effects.happiness}` : ''}
                      </small>
                    </span>
                    <button
                      type="button"
                      disabled={moving || dead}
                      title={inShop ? '购入放入背包(随身可吃)' : '自动前往商店并购入背包'}
                      onClick={() => void buyItem(item.id)}
                    >
                      {pendingBuy ? '途中…' : inShop ? '购入' : '到店购买'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel-section">
            <h3>
              背包(随身) · 体积 {backpackUsed}/{BACKPACK_VOLUME_LIMIT}
            </h3>
            {backpackEntries.length === 0 ? (
              <p className="hint">空空如也——到商店购入食物随身携带</p>
            ) : (
              <ul className="shop-list">
                {backpackEntries.map(([itemId, count]) => {
                  const item = SHOP_ITEMS.find((i) => i.id === itemId);
                  return (
                    <li key={itemId}>
                      <span>
                        {item?.name ?? itemId}
                        <small>
                          ×{count} 体积{backpackUsed}/{BACKPACK_VOLUME_LIMIT}
                        </small>
                      </span>
                      <span className="housing-actions">
                        <button
                          type="button"
                          disabled={dead}
                          title={`体力+${item?.effects.energy ?? 0}(任意地点可吃)`}
                          onClick={() =>
                            void run({ type: 'eat_item', characterId: character.id, itemId })
                          }
                        >
                          吃
                        </button>
                        <button
                          type="button"
                          disabled={dead || !atHome || !leaseValid}
                          title={
                            !atHome
                              ? '须回到自己的住房才能存入冰箱'
                              : !leaseValid
                                ? '租约已过期,先续租或买断'
                                : '存入家中冰箱(腾出背包空间)'
                          }
                          onClick={() =>
                            void run({ type: 'store_item', characterId: character.id, itemId, count: 1 })
                          }
                        >
                          存入冰箱
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {backpackUsed >= BACKPACK_VOLUME_LIMIT && (
              <p className="hint err">背包已满——先吃点,或回家存入冰箱</p>
            )}
          </section>

          <section className="panel-section">
            <h3>
              冰箱(家中仓储) · 体积 {fridgeUsed}/{FRIDGE_VOLUME_LIMIT}
            </h3>
            {fridgeEntries.length === 0 ? (
              <p className="hint">空空如也——把背包食物存进来囤粮</p>
            ) : (
              <ul className="shop-list">
                {fridgeEntries.map(([itemId, count]) => {
                  const item = SHOP_ITEMS.find((i) => i.id === itemId);
                  const canTake = !dead && atHome && leaseValid;
                  return (
                    <li key={itemId}>
                      <span>
                        {item?.name ?? itemId}
                        <small>×{count}</small>
                      </span>
                      <button
                        type="button"
                        disabled={!canTake}
                        title={
                          !atHome
                            ? '须回到自己的住房才能取出'
                            : !leaseValid
                              ? '租约已过期,先续租或买断'
                              : '取出到背包(之后随时可吃)'
                        }
                        onClick={() =>
                          void run({ type: 'take_item', characterId: character.id, itemId, count: 1 })
                        }
                      >
                        取出
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {fridgeEntries.length > 0 && !atHome && <p className="hint">不在自家:存取冰箱先回家(入口或室内)</p>}
            {atHome && !leaseValid && <p className="hint err">租约已过期,无法存取——先续租或买断</p>}
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
  // 体力区段配色(M3.6f): >20 绿 / ≤20 橙 / ≤5 红
  const level = value <= 5 ? 'critical' : value <= 20 ? 'warn' : 'ok';
  return (
    <div className="vital">
      <span className="vital-label">{label}</span>
      <div className="vital-track">
        <div className={`vital-fill ${level}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="vital-value">{Math.round(value)}</span>
    </div>
  );
}
