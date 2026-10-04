import { useState } from 'react';
import {
  ACTIVITY_DEFINITIONS,
  PROPERTY_DEFINITIONS,
  SHOP_ITEMS,
  type Intent,
  type WorldSnapshotMessage,
} from '@sims/shared';

type CharacterSnapshot = WorldSnapshotMessage['characters'][number];

export type RunFn = (intent: Intent, summary: string) => void;

/** 10 意图分组表单(buy/eat/store/take 同组);key=character.id 挂载,切角色时表单自动重置 */
export function IntentForms({
  character,
  onRun,
}: {
  character: CharacterSnapshot;
  onRun: RunFn;
}) {
  return (
    <div className="intent-groups">
      <div className="intent-group">
        <span className="intent-name">move_to/stop_move</span>
        <MoveToForm character={character} onRun={onRun} />
      </div>
      <div className="intent-group">
        <span className="intent-name">start/stop_activity</span>
        <ActivityForm character={character} onRun={onRun} />
      </div>
      <div className="intent-group">
        <span className="intent-name">buy/eat/store/take_item</span>
        <ShopForm character={character} onRun={onRun} />
      </div>
      <div className="intent-group">
        <span className="intent-name">rent/buy_property</span>
        <PropertyForm character={character} onRun={onRun} />
      </div>
    </div>
  );
}

function MoveToForm({ character, onRun }: { character: CharacterSnapshot; onRun: RunFn }) {
  const [x, setX] = useState(String(character.x));
  const [y, setY] = useState(String(character.y));
  const submit = (): void => {
    const nx = Number.parseInt(x, 10);
    const ny = Number.parseInt(y, 10);
    if (!Number.isInteger(nx) || !Number.isInteger(ny)) return;
    void onRun({ type: 'move_to', characterId: character.id, x: nx, y: ny }, `move_to(${nx},${ny})`);
  };
  return (
    <span className="intent-controls">
      <input type="number" value={x} onChange={(e) => setX(e.target.value)} />
      <input type="number" value={y} onChange={(e) => setY(e.target.value)} />
      <button type="button" onClick={submit}>
        移动
      </button>
      <button
        type="button"
        onClick={() => void onRun({ type: 'stop_move', characterId: character.id }, 'stop_move')}
      >
        停止
      </button>
    </span>
  );
}

function ActivityForm({ character, onRun }: { character: CharacterSnapshot; onRun: RunFn }) {
  const [activityId, setActivityId] = useState(ACTIVITY_DEFINITIONS[0]?.id ?? '');
  return (
    <span className="intent-controls">
      <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
        {ACTIVITY_DEFINITIONS.map((def) => (
          <option key={def.id} value={def.id}>
            {def.name}·{def.durationMinutes}分
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={activityId === ''}
        onClick={() =>
          activityId !== '' &&
          void onRun(
            { type: 'start_activity', characterId: character.id, activityId },
            `start_activity(${activityId})`,
          )
        }
      >
        开始
      </button>
      <button
        type="button"
        onClick={() => void onRun({ type: 'stop_activity', characterId: character.id }, 'stop_activity')}
      >
        停止
      </button>
    </span>
  );
}

function ShopForm({ character, onRun }: { character: CharacterSnapshot; onRun: RunFn }) {
  const [itemId, setItemId] = useState(SHOP_ITEMS[0]?.id ?? '');
  const [count, setCount] = useState('1');
  const countNum = (): number => {
    const parsed = Number.parseInt(count, 10);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 0;
  };
  return (
    <span className="intent-controls">
      <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
        {SHOP_ITEMS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}·{item.price}币·体积{item.volume}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        value={count}
        onChange={(e) => setCount(e.target.value)}
        title="存取数量(store/take 用)"
      />
      <button
        type="button"
        disabled={itemId === ''}
        onClick={() =>
          itemId !== '' &&
          void onRun({ type: 'buy_item', characterId: character.id, itemId }, `buy_item(${itemId})`)
        }
      >
        购买
      </button>
      <button
        type="button"
        disabled={itemId === ''}
        onClick={() =>
          itemId !== '' &&
          void onRun({ type: 'eat_item', characterId: character.id, itemId }, `eat_item(${itemId})`)
        }
      >
        吃
      </button>
      <button
        type="button"
        disabled={itemId === '' || countNum() < 1}
        onClick={() => {
          const n = countNum();
          if (itemId !== '' && n >= 1) {
            void onRun(
              { type: 'store_item', characterId: character.id, itemId, count: n },
              `store_item(${itemId},${n})`,
            );
          }
        }}
      >
        存
      </button>
      <button
        type="button"
        disabled={itemId === '' || countNum() < 1}
        onClick={() => {
          const n = countNum();
          if (itemId !== '' && n >= 1) {
            void onRun(
              { type: 'take_item', characterId: character.id, itemId, count: n },
              `take_item(${itemId},${n})`,
            );
          }
        }}
      >
        取
      </button>
    </span>
  );
}

function PropertyForm({ character, onRun }: { character: CharacterSnapshot; onRun: RunFn }) {
  const [propertyId, setPropertyId] = useState(PROPERTY_DEFINITIONS[0]?.id ?? '');
  return (
    <span className="intent-controls">
      <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
        {PROPERTY_DEFINITIONS.map((property) => (
          <option key={property.id} value={property.id}>
            {property.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={propertyId === ''}
        onClick={() =>
          propertyId !== '' &&
          void onRun(
            { type: 'rent_property', characterId: character.id, propertyId },
            `rent_property(${propertyId})`,
          )
        }
      >
        续租
      </button>
      <button
        type="button"
        disabled={propertyId === ''}
        onClick={() =>
          propertyId !== '' &&
          void onRun(
            { type: 'buy_property', characterId: character.id, propertyId },
            `buy_property(${propertyId})`,
          )
        }
      >
        买断
      </button>
    </span>
  );
}
