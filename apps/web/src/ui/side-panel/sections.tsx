import {
  ACTIVITY_DEFINITIONS,
  CHAT_DAILY_GAINED,
  GATHER_TASKS,
  JOB_CATEGORIES,
  LOW_ENERGY_THRESHOLD,
  MAINTENANCE_TASKS,
  REVIVE_WINDOW_MINUTES,
  SOCIAL_CHAT_DISTANCE,
  WORK_TARGETS,
  isGatherTask,
  countWorkTargets,
  findActivityAnchorAt,
  getActivityDefinition,
  placeIdMatches,
  relationTitle,
  type ActivityDefinition,
  type JobCategoryId,
  type PlaceDefinition,
  type TileMapDefinition,
  type WorkTaskId,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { formatCoins } from '../../format';
import { pushToast } from '../../store/toastStore';
import { activityAnchors, findPlaceByRef } from './place';
import type { CharacterView } from './place';
import type { GoAndDoPending, RunIntent } from './useGoAndDo';

/** 体力危急值(红档配色): ≤该值红,≤LOW_ENERGY_THRESHOLD 橙 */
const CRITICAL_ENERGY_LEVEL = 5;

/** 死亡救治窗口倒计时(横幅内联):剩余不足 2 游戏小时红色警示 */
function DeathCountdown({ remaining }: { remaining: number }) {
  const hours = remaining / 60;
  return (
    <span className={hours < 2 ? 'death-urgent' : undefined}>
      {hours < 2 ? `救治窗口仅剩 ${Math.ceil(remaining)} 分钟` : `救治窗口剩余 ${Math.ceil(hours)} 小时`}
    </span>
  );
}

function VitalBar({
  label,
  value,
  title,
}: {
  label: string;
  value: number;
  title?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  // 体力区段配色(M3.6f): >低体力阈值 绿 / ≤阈值 橙 / ≤危急值 红
  const level =
    value <= CRITICAL_ENERGY_LEVEL ? 'critical' : value <= LOW_ENERGY_THRESHOLD ? 'warn' : 'ok';
  return (
    <div className="vital" title={title}>
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
          {snapshot.gameType === 'survival' && (
            <VitalBar
              label="健康"
              value={character.health}
              title="生存模式:体力低于饥饿线持续损耗,吃饱(体力≥康复线)自然恢复;归零重伤休整"
            />
          )}
          <div className="coins">金币 {formatCoins(character.coins)}</div>
          <div
            className="coins"
            title={
              snapshot.gameType === 'survival'
                ? '成就得分:事件直加单调递增(正向活动/美食/聊天);重伤苏醒不扣分(04 §2.5)'
                : '成就得分:事件直加单调递增;累倒送医超时苏醒扣 20%(04 §2.5)'
            }
          >
            得分 {formatCoins(character.score)}
          </div>
          <div className="coins" title="完成一次完整学习 +1;解锁岗位类别(M-G.4)">
            知识 {character.knowledge} 班
          </div>
          {character.sleepDebt && (
            <div
              className="coins"
              title="缺觉: 昨夜睡眠不足,今日正收益(金币/得分/产出)打折,睡满一夜后于 06:00 解除"
            >
              😪 缺觉中
            </div>
          )}
          {!character.alive && (
            <div className="death-banner">
              {snapshot.gameType === 'survival'
                ? '🤕 重伤休整(健康归零,唯一死亡闸门)'
                : '🚑 累倒送医中(体力耗尽)'}
              {character.diedAtGameMinutes !== null && (
                <DeathCountdown
                  remaining={Math.max(
                    0,
                    REVIVE_WINDOW_MINUTES -
                      (snapshot.clock.gameMinutes - character.diedAtGameMinutes),
                  )}
                />
              )}
            </div>
          )}
          {character.alive && character.collapsed && (
            <div className="death-banner">😵 虚脱倒地——就地休息/睡觉或喂食恢复</div>
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
            const near = distance <= SOCIAL_CHAT_DISTANCE;
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
                      : `距离太远,走近点再聊(曼哈顿 ≤ ${SOCIAL_CHAT_DISTANCE})`
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
  snapshot,
  pending,
  run,
  startActivity,
  startWorkTask,
  startSleep,
  continuousTask,
  toggleContinuous,
}: {
  map: TileMapDefinition;
  character: CharacterView;
  atPlace: PlaceDefinition | null;
  snapshot: WorldSnapshotMessage;
  pending: GoAndDoPending | null;
  run: RunIntent;
  startActivity: (def: ActivityDefinition) => Promise<void>;
  startWorkTask: (task: WorkTaskId) => Promise<void>;
  startSleep: () => Promise<void>;
  continuousTask: WorkTaskId | null;
  toggleContinuous: (task: WorkTaskId | null) => void;
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
  /** 同岗目标计数(工单行标签;TD-1 shared 注册表同源) */
  const workTargetCount = (task: WorkTaskId): number => countWorkTargets(task, snapshot);
  // 工单五岗(M-G.5 维护 + M-G.6 采集):目标在快照上(非地图锚点),接单自带寻路,行内带连续作业开关
  const renderWorkRow = (def: ActivityDefinition, locked: boolean) => {
    const task = def.id as WorkTaskId;
    const count = workTargetCount(task);
    const gather = isGatherTask(task);
    const durationMinutes = gather
      ? GATHER_TASKS[task].durationMinutes
      : MAINTENANCE_TASKS[task].durationMinutes;
    const reward = gather ? '以物代薪' : `+${MAINTENANCE_TASKS[task].pay}币/单`;
    const label = `${WORK_TARGETS[task].noun} ${count} ${WORK_TARGETS[task].measure}`;
    return (
      <li key={def.id} id={`activity-row-${def.id}`}>
        <span>
          {def.name}
          <small>
            {label} · {durationMinutes}分 {reward}
          </small>
        </span>
        <label className="continuous-toggle">
          <input
            type="checkbox"
            checked={continuousTask === task}
            disabled={locked || dead}
            title="开启后该角色空闲时自动接最近同岗单"
            onChange={(event) => toggleContinuous(event.target.checked ? task : null)}
          />
          连续
        </label>
        <button
          type="button"
          disabled={moving || dead}
          title={
            locked
              ? `知识不足: 需学习 ${JOB_CATEGORIES[def.category!].requiredKnowledge} 班`
              : count === 0
                ? '当前无工单目标'
                : `前往最近目标作业,${reward}`
          }
          onClick={() => {
            // 可解释拒绝:锁定/无目标仍可点击,点击即 toast 说明(disabled 会吞掉点击零反馈)
            if (locked) {
              pushToast(false, `知识不足: ${def.name} 需先学习 ${JOB_CATEGORIES[def.category!].requiredKnowledge} 班`);
              return;
            }
            if (count === 0) {
              pushToast(false, `当前没有${WORK_TARGETS[task].noun}可作业`);
              return;
            }
            void startWorkTask(task);
          }}
        >
          接单
        </button>
      </li>
    );
  };
  /** 睡觉行(M-G.2): 经 startSleep 只认自家床;无租房置灰(纯玩家手动,系统不代劳) */
  const renderSleepRow = (def: ActivityDefinition) => {
    const homeless = character.housing === null;
    const enRoute = pending?.kind === 'activity' && pending.id === 'sleep';
    return (
      <li key={def.id} id={`activity-row-${def.id}`} className={enRoute ? 'focused' : ''}>
        <span>
          {def.name}
          <small>自家床 {def.durationMinutes}分</small>
        </span>
        <button
          type="button"
          disabled={moving || dead}
          title={
            homeless
              ? '无住房,先在资产页租住公寓才能睡觉'
              : '回家上床睡 8 小时;昨夜 22:00~06:00 累计睡 ≥4 小时免缺觉惩罚(须自家床)'
          }
          onClick={() => {
            if (homeless) {
              pushToast(false, '无住房,先在资产页租住公寓才能睡觉');
              return;
            }
            void startSleep();
          }}
        >
          {enRoute ? '途中…' : '睡觉'}
        </button>
      </li>
    );
  };
  const renderRow = (def: ActivityDefinition, locked: boolean) => {
    if (def.id === 'sleep') {
      return renderSleepRow(def);
    }
    if (def.id in MAINTENANCE_TASKS || def.id in GATHER_TASKS) {
      return renderWorkRow(def, locked);
    }
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
          disabled={moving || dead}
          title={
            (locked
              ? `知识不足: 需学习 ${JOB_CATEGORIES[def.category!].requiredKnowledge} 班`
              : here
                ? ''
                : `自动前往 ${targetLabel} 并开始`) +
            (def.id === 'rest' ? '恢复速率: 床最快/沙发次之/长椅最慢' : '')
          }
          onClick={() => {
            if (locked) {
              pushToast(false, `知识不足: ${def.name} 需先学习 ${JOB_CATEGORIES[def.category!].requiredKnowledge} 班`);
              return;
            }
            void startActivity(def);
          }}
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
            {activity.activityId === 'sleep' ? (
              <>
                😴 睡眠({activity.elapsedMinutes}/{activityDef.durationMinutes} 分)· 本夜{' '}
                {character.sleepWindowMinutes} 分
              </>
            ) : (
              <>
                进行中:{activityDef.name}({activity.elapsedMinutes}/
                {activityDef.durationMinutes} 分)
              </>
            )}
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
