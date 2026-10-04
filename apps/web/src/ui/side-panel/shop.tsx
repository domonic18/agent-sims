import {
  BACKPACK_VOLUME_LIMIT,
  FRIDGE_VOLUME_LIMIT,
  PROPERTY_DEFINITIONS,
  SHOP_ITEMS,
  inventoryVolume,
  type PlaceDefinition,
} from '@sims/shared';
import { homeAccess, type CharacterView } from './place';
import type { GoAndDoPending, RunIntent } from './useGoAndDo';

export function AssetsSection({
  character,
  day,
  run,
}: {
  character: CharacterView;
  day: number;
  run: RunIntent;
}) {
  const housing = character.housing;
  const dead = !character.alive;
  const moving = character.pathRemaining > 0;
  return (
    <section className="panel-section">
      <h3>资产(四公寓)</h3>
      <ul className="activity-list">
        {PROPERTY_DEFINITIONS.map((prop) => {
          const current = housing?.propertyId === prop.id;
          const owned = current && housing?.ownership === 'owned';
          const expired = current && housing?.ownership === 'rent' && housing.paidThroughDay < day;
          return (
            <li key={prop.id} id={`asset-row-${prop.id}`} className={expired ? 'expired' : ''}>
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
  );
}

export function ShopSection({
  character,
  atPlace,
  pending,
  buyItem,
}: {
  character: CharacterView;
  atPlace: PlaceDefinition | null;
  pending: GoAndDoPending | null;
  buyItem: (itemId: string) => Promise<void>;
}) {
  const dead = !character.alive;
  const moving = character.pathRemaining > 0;
  const inShop = atPlace?.id === 'shop';
  return (
    <section
      id="place-row-shop"
      className={atPlace?.id === 'shop' ? 'panel-section focused' : 'panel-section'}
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
  );
}

export function BackpackSection({
  character,
  atPlace,
  day,
  run,
}: {
  character: CharacterView;
  atPlace: PlaceDefinition | null;
  day: number;
  run: RunIntent;
}) {
  const dead = !character.alive;
  const { atHome, leaseValid } = homeAccess(character.housing, atPlace?.id ?? null, day);
  const backpackUsed = inventoryVolume(character.backpack);
  const entries = Object.entries(character.backpack).filter(([, count]) => count > 0);
  return (
    <section className="panel-section">
      <h3>
        背包(随身) · 体积 {backpackUsed}/{BACKPACK_VOLUME_LIMIT}
      </h3>
      {entries.length === 0 ? (
        <p className="hint">空空如也——到商店购入食物随身携带</p>
      ) : (
        <ul className="shop-list">
          {entries.map(([itemId, count]) => {
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
                    onClick={() => void run({ type: 'eat_item', characterId: character.id, itemId })}
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
  );
}

export function FridgeSection({
  character,
  atPlace,
  day,
  run,
}: {
  character: CharacterView;
  atPlace: PlaceDefinition | null;
  day: number;
  run: RunIntent;
}) {
  const dead = !character.alive;
  const { atHome, leaseValid } = homeAccess(character.housing, atPlace?.id ?? null, day);
  const entries = Object.entries(character.fridge).filter(([, count]) => count > 0);
  return (
    <section className="panel-section">
      <h3>
        冰箱(家中仓储) · 体积 {inventoryVolume(character.fridge)}/{FRIDGE_VOLUME_LIMIT}
      </h3>
      {entries.length === 0 ? (
        <p className="hint">空空如也——把背包食物存进来囤粮</p>
      ) : (
        <ul className="shop-list">
          {entries.map(([itemId, count]) => {
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
      {entries.length > 0 && !atHome && <p className="hint">不在自家:存取冰箱先回家(入口或室内)</p>}
      {atHome && !leaseValid && <p className="hint err">租约已过期,无法存取——先续租或买断</p>}
    </section>
  );
}
