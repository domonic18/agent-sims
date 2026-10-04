import type { WorldEvent } from './events.js';

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

/** 快照/tick 消息共用形态(server SimulationSnapshot 的协议面) */
export interface WorldSnapshotMessage {
  tick: number;
  paused: boolean;
  timeScale: number;
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
    happiness: number;
    coins: number;
    /** 进行中活动(null=空闲);前端活动面板与气泡消费 */
    activity: { activityId: string; elapsedMinutes: number } | null;
  }>;
}

/** world.event 消息封装:事件本体即 shared WorldEvent */
export interface WorldEventMessage {
  event: WorldEvent;
}

/** 连接角色标志:spectator 只读(参观入口 M8,机制此处具备) */
export const SOCKET_ROLES = ['player', 'spectator'] as const;

export type SocketRole = (typeof SOCKET_ROLES)[number];
