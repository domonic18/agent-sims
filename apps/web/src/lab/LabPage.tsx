import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ACTIVITY_DEFINITIONS,
  PROPERTY_DEFINITIONS,
  SHOP_ITEMS,
  getShopItem,
  type Intent,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { WorldCanvas } from '../game/WorldCanvas';
import { connectWorld, sendIntent } from '../net/socket';
import { useWorldStore } from '../store/worldStore';
import { Toasts } from '../ui/Toasts';
import './lab.css';

type CharacterSnapshot = WorldSnapshotMessage['characters'][number];

interface LogEntry {
  id: number;
  time: string;
  tick: number | null;
  summary: string;
  ok: boolean;
  message: string;
}

const LOG_MAX = 100;

/**
 * /lab 独立调试台(M3.6b):7 意图分组参数表单+执行按钮,回执日志逐条留痕,
 * 世界状态只读区;地图复用 WorldScene,协议层与主页面同一套 socket/worldStore。
 * M3.6c 行动清单走查的执行载体,亦是 M4 Agent 动作空间的持续调试器。
 */
export default function LabPage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const selectCharacter = useWorldStore((state) => state.selectCharacter);
  const [log, setLog] = useState<LogEntry[]>([]);
  const nextLogIdRef = useRef(1);

  useEffect(() => {
    const socket = connectWorld();
    return () => {
      socket.disconnect();
    };
  }, []);

  const character = snapshot?.characters.find((c) => c.id === selectedId) ?? null;

  const run = async (intent: Intent, summary: string): Promise<void> => {
    const tick = useWorldStore.getState().snapshot?.tick ?? null;
    const ack = await sendIntent(intent);
    const id = nextLogIdRef.current++;
    setLog((prev) =>
      [
        {
          id,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          tick,
          summary,
          ok: ack.ok,
          message: ack.message,
        },
        ...prev,
      ].slice(0, LOG_MAX),
    );
  };

  return (
    <main className="lab-page">
      <div className="status-bar">
        <span className="title">
          agent-sims · lab 调试台 <Link to="/">← 返回主页面</Link>
        </span>
        {snapshot !== null ? (
          <span>
            第 {snapshot.clock.day} 天 {snapshot.clock.time} {snapshot.clock.isNight ? '🌙' : '☀️'} ·
            tick {snapshot.tick} · {snapshot.paused ? '已暂停' : `${snapshot.timeScale}x`}
          </span>
        ) : (
          <span>等待世界快照…</span>
        )}
        <span className={status}>
          {status === 'connected' ? '' : status === 'connecting' ? '连接中…' : '已断开,自动重连中'}
        </span>
      </div>

      <div className="lab-main">
        <div className="canvas-wrap">
          <WorldCanvas />
          <Toasts />
        </div>

        <aside className="lab-panel">
          <section className="panel-section">
            <h3>操控角色</h3>
            {snapshot === null || snapshot.characters.length === 0 ? (
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
          </section>

          {character !== null && (
            <section className="panel-section">
              <h3>意图操作台(7 意图全量)</h3>
              <IntentForms key={character.id} character={character} onRun={run} />
            </section>
          )}

          <section className="panel-section">
            <h3>世界状态(只读)</h3>
            {snapshot === null ? (
              <p className="hint">等待快照…</p>
            ) : (
              <table className="world-table">
                <thead>
                  <tr>
                    <th>角色</th>
                    <th>坐标</th>
                    <th>体力</th>
                    <th>幸福</th>
                    <th>金币</th>
                    <th>活动</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.characters.map((c) => (
                    <tr key={c.id} className={c.id === selectedId ? 'selected' : ''}>
                      <td>{c.name}</td>
                      <td>
                        {c.x},{c.y}
                      </td>
                      <td>{Math.round(c.energy)}</td>
                      <td>{Math.round(c.happiness)}</td>
                      <td>{Math.round(c.coins)}</td>
                      <td>{c.activity?.activityId ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </aside>
      </div>

      <section className="lab-log">
        <h3>回执日志(最新在上)</h3>
        {log.length === 0 ? (
          <p className="hint">尚无操作记录——从上方操作台下发意图</p>
        ) : (
          <ul>
            {log.map((entry) => (
              <li key={entry.id} className={entry.ok ? 'ok' : 'err'}>
                <span className="meta">
                  {entry.time} · tick {entry.tick ?? '—'}
                </span>
                <code>{entry.summary}</code>
                <span className="message">
                  {entry.ok ? '✓' : '✗'} {entry.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** 7 意图分组表单;key=character.id 挂载,切角色时表单自动重置 */
function IntentForms({
  character,
  onRun,
}: {
  character: CharacterSnapshot;
  onRun: (intent: Intent, summary: string) => void;
}) {
  return (
    <div className="intent-groups">
      <div className="intent-group">
        <span className="intent-name">move_to</span>
        <MoveToForm character={character} onRun={onRun} />
      </div>
      <div className="intent-group">
        <span className="intent-name">start/stop_activity</span>
        <ActivityForm character={character} onRun={onRun} />
      </div>
      <div className="intent-group">
        <span className="intent-name">buy_item</span>
        <ShopForm character={character} onRun={onRun} />
      </div>
      <div className="intent-group">
        <span className="intent-name">rent/buy_property</span>
        <PropertyForm character={character} onRun={onRun} />
      </div>
      <div className="intent-group">
        <span className="intent-name">place_furniture</span>
        <FurnitureForm character={character} onRun={onRun} />
      </div>
    </div>
  );
}

type RunFn = (intent: Intent, summary: string) => void;

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
  return (
    <span className="intent-controls">
      <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
        {SHOP_ITEMS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}·{item.price}币
          </option>
        ))}
      </select>
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

function FurnitureForm({ character, onRun }: { character: CharacterSnapshot; onRun: RunFn }) {
  const owned = [...new Set(character.items)];
  const [picked, setPicked] = useState<string | null>(null);
  // 购买发生在组件挂载后时首个库存项晚于初始化,未选择前派生回退,避免显示值与提交值脱节
  const itemId = picked !== null && owned.includes(picked) ? picked : (owned[0] ?? '');
  if (owned.length === 0) {
    return <span className="hint">库存为空——先经 buy_item 购买家具</span>;
  }
  return (
    <span className="intent-controls">
      <select value={itemId} onChange={(e) => setPicked(e.target.value)}>
        {owned.map((id) => (
          <option key={id} value={id}>
            {getShopItem(id)?.name ?? id}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={itemId === ''}
        onClick={() =>
          itemId !== '' &&
          void onRun(
            { type: 'place_furniture', characterId: character.id, itemId },
            `place_furniture(${itemId})`,
          )
        }
      >
        摆放
      </button>
    </span>
  );
}
