import type { WorldEvent } from './events.js';
import type { GameType } from './worldgen.js';
import type { MaintenanceSpot } from './maintenance.js';
import type { ResourceNode } from './production.js';
import type { SocialRelationView, TraitVector } from './social.js';

/**
 * Socket.IO 同步协议(arch §7):首连全量快照 + 每 tick 增量(带 tick 序号)
 * + 离散事件转发;断线重连即重新快照。玩家/参观者同一条流。
 */

export const SOCKET_EVENTS = {
  /** server→client 连接即发:全量快照 */
  snapshot: 'world.snapshot',
  /** server→client 每 tick:当前状态(含 tick 序号,客户端丢弃乱序) */
  tick: 'world.tick',
  /** server→client 离散事件(character.arrived/world.control 等) */
  event: 'world.event',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** client→server 意图通道(M3.4):player 可发,spectator 服务端丢弃 */
export const CLIENT_EVENTS = {
  intent: 'player.intent',
} as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];

/** 意图执行回执(socket ack 协议面) */
export interface IntentAck {
  ok: boolean;
  message: string;
}

/** 快照/tick 消息共用形态(server SimulationSnapshot 的协议面) */
export interface WorldSnapshotMessage {
  tick: number;
  paused: boolean;
  timeScale: number;
  /** 游戏模式(M-S/S1):growth=成长小镇,survival=末日生存;前端面板按此分流显示 */
  gameType: GameType;
  clock: {
    gameMinutes: number;
    day: number;
    /** HH:mm */
    time: string;
    isNight: boolean;
  };
  characters: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    pathRemaining: number;
    energy: number;
    /** 健康(M-S/S1):0~100,仅 survival 模式有压力源(饥饿损耗/吃饱恢复),growth 恒满 */
    health: number;
    coins: number;
    /** 存活状态(false=幽灵态: growth 累倒送医/survival 重伤休整,等待救治/超时苏醒) */
    alive: boolean;
    /** 体力虚脱倒地(numerical §2.3,alive=true 时): 原地倒地,意图只放行休息/睡觉/进食,
     * 体力回升即爬起;survival 下健康照跑饥饿线,可滑向重伤休整 */
    collapsed: boolean;
    /** 死亡时刻(纪元起游戏分钟,null=存活);救治倒计时 = 窗口 - (当前 - 此值)(M-G.5) */
    diedAtGameMinutes: number | null;
    /** 随身背包(itemId→数量,仅 >0 项);买入入此,任意地点可吃 */
    backpack: Record<string, number>;
    /** 家中冰箱库存(itemId→数量,仅 >0 项);须在家经 store_item/take_item 存取 */
    fridge: Record<string, number>;
    /** 得分(numerical §2.5,2026-10-07 替代幸福/繁荣分): 事件直加单调递增,唯一扣分=累倒送医超时 */
    score: number;
    /** 知识(M-G.4): 完成一次完整学习(study 60 分)+1,不衰减;岗位类别门槛(numerical §5.1) */
    knowledge: number;
    /** 本夜睡眠窗口(22:00~06:00)累计入睡分钟(M-G.2);06:00 结算缺觉后清零 */
    sleepWindowMinutes: number;
    /** 缺觉惩罚生效中(M-G.2): 昨夜睡不足,当日正收益 ×SLEEP_DEBT_MULTIPLIER;到期自动解除 */
    sleepDebt: boolean;
    /** 特质向量 v0(social-design §4): 0~1 五维,相性计算输入;M3.6k 配置可覆盖 */
    traits: TraitVector;
    /** 进行中活动(null=空闲);前端活动面板与气泡消费;anchorKind=rest 档位(床/沙发/长椅) */
    activity: { activityId: string; elapsedMinutes: number; anchorKind: string | null } | null;
    /** 住宿状态(null=无住宿): 租约付到日/自有 */
    housing: {
      propertyId: string;
      ownership: 'rent' | 'owned';
      /** 租约付到的游戏日(含);自有忽略此字段 */
      paidThroughDay: number;
    } | null;
  }>;
  /** 有向关系全量(社交 v1: A→B 与 B→A 独立两条;称号前端派生 relationTitle) */
  socials: SocialRelationView[];
  /** 世界维护点全量(M-G.5 损耗系统):web diff 渲染 */
  maintenance: MaintenanceSpot[];
  /** 资源节点全量(M-G.6 生产系统):charges=null 无限/0 枯竭,web diff 渲染 */
  resources: ResourceNode[];
  /** 商店货架余量(食物经济 2026-10-07):itemId→剩余份数,售罄即止不补货;web 展示/禁购 */
  shopStock: Record<string, number>;
}

/** world.event 消息封装:事件本体即 shared WorldEvent */
export interface WorldEventMessage {
  event: WorldEvent;
}

/** 连接角色标志:spectator 只读(参观入口 M8,机制此处具备) */
export const SOCKET_ROLES = ['player', 'spectator'] as const;

export type SocketRole = (typeof SOCKET_ROLES)[number];
