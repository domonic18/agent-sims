import {
  BACKPACK_VOLUME_LIMIT,
  CRAFT_RECIPE_IDS,
  FRIDGE_VOLUME_LIMIT,
  PROPERTY_DEFINITIONS,
  RECIPES,
  SHOP_ITEMS,
  getItem,
  inventoryVolume,
  placeIdMatches,
  type CraftRecipeId,
  type PlaceDefinition,
} from '@sims/shared';
import { homeAccess, type CharacterView } from './place';
import type { GoAndDoPending, RunIntent } from './useGoAndDo';

/** 站点家具中文名(制作面板站点标注) */
const STATION_LABEL: Record<'stove' | 'workbench', string> = {
  stove: '灶台',
  workbench: '木工台',
};

/**
 * 制作面板(M-G.6):配方材料持有/需求与产出一目了然,
 * 制作按钮复用 go-and-do——不在站点先前往最近使用格,到站自动下发 craft。
 */
export function CraftSection({
  character,
  pending,
  startCraft,
}: {
  character: CharacterView;
  pending: GoAndDoPending | null;
  startCraft: (recipeId: CraftRecipeId) => Promise<void>;
}) {
  const dead = !character.alive;
  const moving = character.pathRemaining > 0;
  return (
    <section className="panel-section">
      <h3>制作</h3>
      <ul className="shop-list">
        {CRAFT_RECIPE_IDS.map((id) => RECIPES[id]).map((recipe) => {
          const pendingCraft = pending?.kind === 'craft' && pending.id === recipe.id;
          const materials = recipe.inputs
            .map(
              (input) =>
                `${getItem(input.itemId)?.name ?? input.itemId} ${character.backpack[input.itemId] ?? 0}/${input.count}`,
            )
            .join(' ');
          const ready = recipe.inputs.every(
            (input) => (character.backpack[input.itemId] ?? 0) >= input.count,
          );
          const outputs = recipe.outputs
            .map((o) => `${getItem(o.itemId)?.name ?? o.itemId}×${o.count}`)
            .join(' ');
          return (
            <li key={recipe.id}>
              <span>
                {recipe.name}
                <small>
                  {STATION_LABEL[recipe.stationKind]} · {materials} → {outputs}
                </small>
              </span>
              <button
                type="button"
                disabled={moving || dead || !ready}
                title={ready ? '自动前往站点使用格开始制作(中断退料)' : '材料不足——先采集或拾荒'}
                onClick={() => void startCraft(recipe.id)}
              >
                {pendingCraft ? '途中…' : '制作'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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
  shopStock,
  buyItem,
}: {
  character: CharacterView;
  atPlace: PlaceDefinition | null;
  pending: GoAndDoPending | null;
  /** 商店货架余量(itemId→剩余份数,售罄即止) */
  shopStock: Record<string, number>;
  buyItem: (itemId: string) => Promise<void>;
}) {
  const dead = !character.alive;
  const moving = character.pathRemaining > 0;
  const inShop = atPlace !== null && placeIdMatches('shop', atPlace.id);
  return (
    <section className="panel-section">
      <h3>商店{inShop ? ' · 在店内' : ''}(初始存量 · 售罄即止)</h3>
      <ul className="shop-list">
        {SHOP_ITEMS.map((item) => {
          const pendingBuy = pending?.kind === 'buy' && pending.id === item.id;
          const stock = shopStock[item.id] ?? 0;
          const soldOut = stock <= 0;
          return (
            <li key={item.id}>
              <span>
                {item.name}
                <small>
                  {item.price}币 余{stock} 体积{item.volume} 体力+{item.effects.energy}
                  {item.effects.score > 0 ? ` 得分+${item.effects.score}` : ''}
                </small>
              </span>
              <button
                type="button"
                disabled={moving || dead || soldOut}
                title={
                  soldOut
                    ? '已售罄——初始存量卖完即止,可采集或制作获取'
                    : inShop
                      ? '购入放入背包(随身可吃)'
                      : '自动前往商店并购入背包'
                }
                onClick={() => void buyItem(item.id)}
              >
                {soldOut ? '售罄' : pendingBuy ? '途中…' : inShop ? '购入' : '到店购买'}
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
        <p className="hint">空空如也——到商店购入,或采集/制作获取食物</p>
      ) : (
        <ul className="shop-list">
          {entries.map(([itemId, count]) => {
            const item = getItem(itemId);
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
                    disabled={dead || item?.effects === undefined}
                    title={
                      item?.effects === undefined
                        ? '材料不可食用(制作/修补耗材)'
                        : `体力+${item.effects.energy}(任意地点可吃)`
                    }
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
            const item = getItem(itemId);
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
