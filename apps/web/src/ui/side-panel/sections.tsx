import {
  ACTIVITY_DEFINITIONS,
  LOW_ENERGY_THRESHOLD,
  TOWN_MAP,
  findActivityAnchorAt,
  getActivityDefinition,
  type ActivityDefinition,
  type PlaceDefinition,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { formatCoins } from '../../format';
import { activityAnchors } from './place';
import type { CharacterView } from './place';
import type { GoAndDoPending, RunIntent } from './useGoAndDo';

/** 体力危急值(红档配色): ≤该值红,≤LOW_ENERGY_THRESHOLD 橙 */
const CRITICAL_ENERGY_LEVEL = 5;

function VitalBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  // 体力区段配色(M3.6f): >低体力阈值 绿 / ≤阈值 橙 / ≤危急值 红
  const level =
    value <= CRITICAL_ENERGY_LEVEL ? 'critical' : value <= LOW_ENERGY_THRESHOLD ? 'warn' : 'ok';
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

export function CharactersSection({
  snapshot,
  selectedId,
  character,
  onSelect,
}: {
  snapshot: WorldSnapshotMessage;
  selectedId: string | null;
  character: CharacterView | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="panel-section">
      <h3>角色</h3>
      {snapshot.characters.length === 0 ? (
        <p className="hint">世界暂无角色</p>
      ) : (
        <select
          value={selectedId ?? ''}
          onChange={(event) => onSelect(event.target.value)}
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
          <div className="coins">金币 {formatCoins(character.coins)}</div>
          <div className="coins" title="生涯质量账本 ≈ 累计等效幸福天;死亡 ×0.8(goal-design §5/§7)">
            繁荣分 {formatCoins(character.lifeScore)}
          </div>
          {!character.alive && (
            <div className="death-banner">☠️ 已死亡(幽灵态),等待复活(/lab 可复活)</div>
          )}
        </div>
      )}
    </section>
  );
}

export function GoSection({
  character,
  atPlace,
  focusPlaceId,
  run,
}: {
  character: CharacterView;
  atPlace: PlaceDefinition | null;
  focusPlaceId: string | null;
  run: RunIntent;
}) {
  const dead = !character.alive;
  const moving = character.pathRemaining > 0;
  return (
    <section className="panel-section">
      <h3>前往</h3>
      <ul className="activity-list">
        {TOWN_MAP.places.map((place) => {
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
  );
}

export function ActivitySection({
  character,
  atPlace,
  pending,
  run,
  startActivity,
}: {
  character: CharacterView;
  atPlace: PlaceDefinition | null;
  pending: GoAndDoPending | null;
  run: RunIntent;
  startActivity: (def: ActivityDefinition) => Promise<void>;
}) {
  const dead = !character.alive;
  const moving = character.pathRemaining > 0;
  const activity = character.activity;
  const activityDef = activity !== null ? getActivityDefinition(activity.activityId) : null;
  const progress =
    activity !== null && activityDef !== null
      ? Math.min(100, Math.round((activity.elapsedMinutes / activityDef.durationMinutes) * 100))
      : 0;
  return (
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
                ? findActivityAnchorAt(def.id, character.x, character.y) !== null
                : def.placeIds.includes(atPlace?.id ?? '');
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
  );
}
