/**
 * 脑状态(agent-design §3.2):角色"脑内"的东西存本模块内存结构,
 * 不进 WorldCharacter——世界侧角色只保留模拟必需的数值/位置/库存。
 * M4c 自治开关;M4e 托管状态(含方针缓存);D2 起统一内心状态(innerState)
 * 承接 mood 镜像与 focus/intents/lastEvaluation(D3 起日程 DayPlan 由 intents 取代)。
 */

/** 方针编译产物(agent-design §4.5 Talker-Reasoner):慢思考把方针文本编译为
 * 计划层可校验的白名单活动集;编译失败为 null(只用原文) */
export interface CompiledPolicy {
  focus: string[];
  avoid: string[];
}

/** 托管状态(M4e):full=Agent 完全自主;policy=生活方针约束(原文+编译缓存)。
 * 托管即「指令来源=Agent」:泵驱动角色+玩家意图被网关拒收,世界状态零触碰 */
export interface HostingState {
  mode: 'full' | 'policy';
  policyText: string | null;
  compiled: CompiledPolicy | null;
}

/** 托管注册表:单一事实源,autonomy 是它的全托管视图(兼容 M4c 开关语义) */
const hosted = new Map<string, HostingState>();

export const hosting = {
  set(characterId: string, state: HostingState): void {
    hosted.set(characterId, state);
  },
  get(characterId: string): HostingState | undefined {
    return hosted.get(characterId);
  },
  delete(characterId: string): void {
    hosted.delete(characterId);
  },
  has(characterId: string): boolean {
    return hosted.has(characterId);
  },
  /** 全量现状(连接期托管同步 world.hosting 用) */
  entries(): Array<[string, HostingState]> {
    return [...hosted.entries()];
  },
};

/** 自治角色注册表(M4c 语义保留):=托管中的角色,泵只处理这些角色 */
export const autonomy = {
  enable(characterId: string): void {
    if (hosted.has(characterId)) return;
    hosted.set(characterId, { mode: 'full', policyText: null, compiled: null });
  },
  disable(characterId: string): void {
    hosted.delete(characterId);
  },
  has(characterId: string): boolean {
    return hosted.has(characterId);
  },
  list(): string[] {
    return [...hosted.keys()];
  },
};

/** 日程脑状态(M4d 慢层)已删除:D3 弹性意图模型起,当日 wants 存 innerState.intents */

/** 情绪脑状态(10-cognition §4.4,L5): valence -1~1(负=低落正=愉快,半衰期衰减),
 * labels=近期情绪事件标签,since=本轮情绪起点(游戏分钟)。
 * 不进快照不下发——玩家经访谈/面板间接观测;真源在 character_moods 表,
 * 内存镜像在 innerState(统一内心状态入口,供快层零延迟读取) */
export interface MoodState {
  valence: number;
  labels: string[];
  since: number | null;
}

/** 意图(want,弹性意图模型 D3 的执行单元):慢层生成、快层择一执行 */
export interface Want {
  id: string;
  activityId: string;
  placeId?: string;
  why: string;
  urgency: number;
  status: 'pending' | 'doing' | 'done' | 'abandoned';
  createdAtMin: number;
}

/** 当日意图集(慢层产出):D3 起取代刚性时间表 DayPlan */
export interface DayIntents {
  day: number;
  wants: Want[];
  source: 'llm' | 'fallback';
}

/** 关注点:最近一次决策理由的一句话(访谈/叙事/jev 题面注入) */
export interface FocusState {
  text: string;
  sinceMin: number;
}

/** 活动评价(记忆评价引擎 D4 写入):最近一次活动的第一人称判定 */
export interface ActivityEvaluation {
  activityId: string;
  verdict: 'good' | 'ok' | 'bad';
  reason: string;
  atMin: number;
}

/**
 * 统一内心状态(D2 地基,10-cognition §3):快层/慢层/记忆/社交/叙事的单一读写入口。
 * mood 真源在 character_moods 表(MoodTracker 重算镜像),不落 inner_state 列;
 * 其余字段落 characters.inner_state jsonb,重启灌回。
 */
export interface InnerState {
  mood: MoodState;
  focus: FocusState | null;
  /** 当日意图集(慢层 composeIntents 写,快层 wantSelect 择条执行;跨日/重规划由 scheduler 管理) */
  intents: DayIntents | null;
  lastEvaluation: ActivityEvaluation | null;
}

/** jsonb 持久化载荷(mood 除外:重启由 MoodTracker 按冲量流水重算) */
export type PersistedInnerState = Omit<InnerState, 'mood'>;

const WANT_STATUSES: readonly Want['status'][] = ['pending', 'doing', 'done', 'abandoned'];

/** 形状校验式灌回:库值残缺/类型不对逐字段兜默认,防脏数据毒化脑状态 */
function hydrate(saved: unknown): PersistedInnerState {
  const raw = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>;
  const focus =
    typeof raw.focus === 'object' &&
    raw.focus !== null &&
    typeof (raw.focus as Record<string, unknown>).text === 'string' &&
    typeof (raw.focus as Record<string, unknown>).sinceMin === 'number'
      ? { text: (raw.focus as { text: string }).text, sinceMin: (raw.focus as { sinceMin: number }).sinceMin }
      : null;
  const rawIntents =
    typeof raw.intents === 'object' && raw.intents !== null ? (raw.intents as Record<string, unknown>) : null;
  const intents: DayIntents | null =
    rawIntents !== null &&
    typeof rawIntents.day === 'number' &&
    (rawIntents.source === 'llm' || rawIntents.source === 'fallback') &&
    Array.isArray(rawIntents.wants)
      ? {
          day: rawIntents.day,
          source: rawIntents.source,
          wants: (rawIntents.wants as unknown[]).flatMap((entry) => {
            if (typeof entry !== 'object' || entry === null) return [];
            const w = entry as Record<string, unknown>;
            if (typeof w.id !== 'string' || typeof w.activityId !== 'string' || typeof w.why !== 'string') return [];
            if (typeof w.urgency !== 'number' || typeof w.createdAtMin !== 'number') return [];
            const status = WANT_STATUSES.find((s) => s === w.status);
            if (status === undefined) return [];
            return [
              {
                id: w.id,
                activityId: w.activityId,
                why: w.why,
                urgency: w.urgency,
                status,
                createdAtMin: w.createdAtMin,
                ...(typeof w.placeId === 'string' ? { placeId: w.placeId } : {}),
              } satisfies Want,
            ];
          }),
        }
      : null;
  const evaluation =
    typeof raw.lastEvaluation === 'object' &&
    raw.lastEvaluation !== null &&
    typeof (raw.lastEvaluation as Record<string, unknown>).activityId === 'string' &&
    typeof (raw.lastEvaluation as Record<string, unknown>).reason === 'string'
      ? (raw.lastEvaluation as ActivityEvaluation)
      : null;
  return { focus, intents, lastEvaluation: evaluation };
}

const innerStates = new Map<string, InnerState>();

function emptyMood(): MoodState {
  return { valence: 0, labels: [], since: null };
}

export const innerState = {
  get(characterId: string): InnerState | undefined {
    return innerStates.get(characterId);
  },
  /** 取或建(默认中性情绪+无关注+无意图) */
  ensure(characterId: string): InnerState {
    let state = innerStates.get(characterId);
    if (state === undefined) {
      state = { mood: emptyMood(), focus: null, intents: null, lastEvaluation: null };
      innerStates.set(characterId, state);
    }
    return state;
  },
  /** MoodTracker 镜像同步入口(readMood 重算后写) */
  setMood(characterId: string, moodState: MoodState): void {
    this.ensure(characterId).mood = moodState;
  },
  moodOf(characterId: string): MoodState | undefined {
    return innerStates.get(characterId)?.mood;
  },
  /** 慢层产出当日意图集(整体替换) */
  setIntents(characterId: string, intents: DayIntents): void {
    this.ensure(characterId).intents = intents;
  },
  /** 清空意图(拒绝退避 3 连/托管变更/角色下线):快层回退数值压力决策 */
  clearIntents(characterId: string): void {
    this.ensure(characterId).intents = null;
  },
  clear(characterId: string): void {
    innerStates.delete(characterId);
  },
  /** 落库载荷(无记录返回 null;浅拷贝防序列化期间被改) */
  persistedOf(characterId: string): PersistedInnerState | null {
    const state = innerStates.get(characterId);
    if (state === undefined) return null;
    return {
      focus: state.focus === null ? null : { ...state.focus },
      intents:
        state.intents === null ? null : { ...state.intents, wants: state.intents.wants.map((w) => ({ ...w })) },
      lastEvaluation: state.lastEvaluation === null ? null : { ...state.lastEvaluation },
    };
  },
  /** 启动恢复灌回(只补 focus/intents/lastEvaluation,mood 等 MoodTracker 重算) */
  restore(characterId: string, saved: unknown): void {
    const persisted = hydrate(saved);
    const state = this.ensure(characterId);
    state.focus = persisted.focus;
    state.intents = persisted.intents;
    state.lastEvaluation = persisted.lastEvaluation;
  },
};
