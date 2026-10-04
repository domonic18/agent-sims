import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ACTIVITY_DEFINITIONS,
  PROPERTY_DEFINITIONS,
  SHOP_ITEMS,
  type Intent,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { WorldCanvas } from '../game/WorldCanvas';
import { reviveCharacter, setPaused, setTimeScale } from '../net/debugApi';
import { connectWorld, sendIntent } from '../net/socket';
import { useWorldStore } from '../store/worldStore';
import { SidePanel } from '../ui/SidePanel';
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
const TIME_SCALES = [1, 4, 16] as const;

/**
 * /lab 独立调试台(M3.6b;M3.6d 全屏化+操作收口;M3.6e 六意图):
 * 全屏画布+悬浮 HUD,右列=快捷操作面板(前往/活动/资产/商店)
 * +6 意图协议表单+世界状态只读表,左下=回执日志。
 * 暂停/倍率经 /debug 联调通道(M4 换正式指令)。
 * 地图全量操控(点击移动/方向键步进)仅此页开启,主页面纯观看。
 */
export default function LabPage() {
  const status = useWorldStore((state) => state.status);
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedId = useWorldStore((state) => state.selectedCharacterId);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [controlError, setControlError] = useState<string | null>(null);
  const [sideCollapsed, setSideCollapsed] = useState(false);
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

  const togglePause = async (): Promise<void> => {
    if (snapshot === null) return;
    try {
      await setPaused(!snapshot.paused);
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
  };

  const changeScale = async (scale: number): Promise<void> => {
    try {
      await setTimeScale(scale);
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
  };

  const revive = async (): Promise<void> => {
    if (character === null) return;
    try {
      await reviveCharacter(character.id);
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : String(error));
    }
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

      <div className="controls">
        <button type="button" onClick={() => void togglePause()} disabled={snapshot === null}>
          {snapshot?.paused ? '▶ 继续' : '⏸ 暂停'}
        </button>
        <span className="speed-group">
          {TIME_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className={snapshot?.timeScale === scale ? 'active' : ''}
              onClick={() => void changeScale(scale)}
              disabled={snapshot === null}
            >
              {scale}x
            </button>
          ))}
        </span>
        {snapshot?.paused === true && <span className="paused-badge">已暂停</span>}
        {character !== null && !character.alive && (
          <button type="button" className="revive-btn" onClick={() => void revive()}>
            ✚ 复活 {character.name}
          </button>
        )}
        {controlError !== null && <span className="control-error">{controlError}</span>}
      </div>

      <div className="canvas-wrap">
        <WorldCanvas />
        <Toasts />
      </div>

      <aside className={sideCollapsed ? 'lab-side collapsed' : 'lab-side'}>
        <SidePanel />
        {character !== null && (
          <section className="lab-panel">
            <h3>意图操作台(10 意图全量)</h3>
            <IntentForms key={character.id} character={character} onRun={run} />
          </section>
        )}
        <section className="lab-panel">
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
                  <th>存活</th>
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
                    <td className={c.energy <= 20 ? 'low-energy' : ''}>{Math.round(c.energy)}</td>
                    <td>{Math.round(c.happiness)}</td>
                    <td>{Math.round(c.coins)}</td>
                    <td className={c.alive ? '' : 'dead'}>{c.alive ? '✓' : '☠'}</td>
                    <td>{c.activity?.activityId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </aside>

      <button
        type="button"
        className="lab-side-toggle"
        style={{ right: sideCollapsed ? 12 : 318 }}
        title={sideCollapsed ? '展开操作列' : '收起操作列'}
        onClick={() => setSideCollapsed((value) => !value)}
      >
        {sideCollapsed ? '◀' : '▶'}
      </button>

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

/** 10 意图分组表单(buy/eat/store/take 同组);key=character.id 挂载,切角色时表单自动重置 */
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
