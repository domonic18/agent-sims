import {
  ACTIVITY_DEFINITIONS,
  CHAT_DAILY_GAINED,
  JOB_CATEGORIES,
  LOW_ENERGY_THRESHOLD,
  SOCIAL_PRESENCE_DISTANCE,
  findActivityAnchorAt,
  getActivityDefinition,
  placeIdMatches,
  relationTitle,
  type ActivityDefinition,
  type JobCategoryId,
  type PlaceDefinition,
  type TileMapDefinition,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { formatCoins } from '../../format';
import { activityAnchors, findPlaceByRef } from './place';
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
          <div className="coins" title="完成一次完整学习 +1;解锁岗位类别(M-G.4)">
            知识 {character.knowledge} 班
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
  map,
  character,
  atPlace,
  focusPlaceId,
  run,
}: {
  map: TileMapDefinition;
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
        {map.places.map((place) => {
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

export function SocialSection({
  snapshot,
  character,
  run,
}: {
  snapshot: WorldSnapshotMessage;
  character: CharacterView;
  run: RunIntent;
}) {
  const dead = !character.alive;
  const moving = character.pathRemaining > 0;
  const others = snapshot.characters.filter((c) => c.id !== character.id);
  return (
    <section className="panel-section">
      <h3>社交 · 同处一地可闲聊</h3>
      {others.length === 0 ? (
        <p className="hint">世界暂无其他角色</p>
      ) : (
        <ul className="activity-list">
          {others.map((other) => {
            const distance = Math.abs(other.x - character.x) + Math.abs(other.y - character.y);
            const near = distance <= SOCIAL_PRESENCE_DISTANCE;
            const relation = snapshot.socials.find(
              (s) => s.fromId === character.id && s.toId === other.id,
            );
            const title = relationTitle(relation?.familiarity ?? 0, relation?.affinity ?? 0);
            return (
              <li key={other.id}>
                <span>
                  {other.name}
                  <small>
                    · {title} · {near ? '在身旁' : `距离 ${distance}`}
                    {!other.alive && ' · ☠️'}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={moving || dead || !near || !other.alive}
                  title={
                    near
                      ? `与 ${other.name} 闲聊(每日前 ${CHAT_DAILY_GAINED} 次有收益,之后无增益)`
                      : `距离太远,走近点再聊(曼哈顿 ≤ ${SOCIAL_PRESENCE_DISTANCE})`
                  }
                  onClick={() =>
                    void run({
                      type: 'chat',
                      characterId: character.id,
                      targetId: other.id,
                    })
                  }
                >
                  聊天
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ActivitySection({
  map,
  character,
  atPlace,
  pending,
  run,
  startActivity,
}: {
  map: TileMapDefinition;
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
  // 职业类别分组(M-G.4): 无 category=日常活动;岗位按类别成组,知识不足整组置灰
  const daily = ACTIVITY_DEFINITIONS.filter((def) => def.category === undefined);
  const jobGroups = (Object.keys(JOB_CATEGORIES) as JobCategoryId[])
    .map((id) => ({
      id,
      meta: JOB_CATEGORIES[id],
      defs: ACTIVITY_DEFINITIONS.filter((def) => def.category === id),
    }))
    .filter((group) => group.defs.length > 0);
  const renderRow = (def: ActivityDefinition, locked: boolean) => {
    const anchors = activityAnchors(map, def.id);
    const targetLabel =
      anchors.length > 0
        ? anchors.map((a) => a.label).join('/')
        : def.placeIds.map((id) => findPlaceByRef(map, id)?.name ?? id).join('/');
    const here =
      anchors.length > 0
        ? findActivityAnchorAt(map, def.id, character.x, character.y) !== null
        : atPlace !== null && def.placeIds.some((id) => placeIdMatches(id, atPlace.id));
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
          disabled={moving || dead || locked}
          title={
            (locked
              ? `知识不足: 需学习 ${JOB_CATEGORIES[def.category!].requiredKnowledge} 班`
              : here
                ? ''
                : `自动前往 ${targetLabel} 并开始`) +
            (def.id === 'rest' ? '恢复速率: 床最快/沙发次之/长椅最慢' : '')
          }
          onClick={() => void startActivity(def)}
        >
          {enRoute ? '途中…' : '开始'}
        </button>
      </li>
    );
  };
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
        <>
          <ul className="activity-list">{daily.map((def) => renderRow(def, false))}</ul>
          {jobGroups.map((group) => {
            const locked = character.knowledge < group.meta.requiredKnowledge;
            return (
              <div key={group.id} className={`job-group${locked ? ' locked' : ''}`}>
                <h4>
                  {group.meta.label}类岗位
                  {locked && (
                    <small className="job-lock-hint">需学习 {group.meta.requiredKnowledge} 班</small>
                  )}
                </h4>
                <ul className="activity-list">
                  {group.defs.map((def) => renderRow(def, locked))}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
