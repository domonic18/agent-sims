import { io, type Socket } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SOCKET_EVENTS,
  type Intent,
  type IntentAck,
  type SocketRole,
  type WorldEventMessage,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { useWorldStore } from '../store/worldStore';

const { setStatus, applySnapshot, applyEvent, applyControl } = useWorldStore.getState();

let worldSocket: Socket | null = null;

/**
 * 连接世界同步通道(arch §7):连接即收全量快照,此后每 tick 快照覆盖,
 * 离散事件走 world.event;player 角色可经意图通道下发指令(M3.4)。
 * 注意:监听必须先于连接建立注册——快照帧与 connect 同轮同步到达,
 * connect 回调返回后才挂监听会错过首帧。
 */
export function connectWorld(role: SocketRole = 'player'): Socket {
  const socket = io('/', { auth: { role } });
  worldSocket = socket;
  socket.on('connect', () => setStatus('connected'));
  socket.on('disconnect', () => setStatus('disconnected'));
  socket.on('connect_error', () => setStatus('disconnected'));
  socket.on(SOCKET_EVENTS.snapshot, (snapshot: WorldSnapshotMessage) => applySnapshot(snapshot));
  socket.on(SOCKET_EVENTS.tick, (snapshot: WorldSnapshotMessage) => applySnapshot(snapshot));
  socket.on(SOCKET_EVENTS.event, (message: WorldEventMessage) => {
    applyEvent(message.event);
    // 暂停期间 tick 广播停摆,控制事件需就地修正快照,否则 UI 状态滞后一拍
    if (message.event.type === 'world.control') {
      applyControl(message.event.paused, message.event.timeScale);
    }
  });
  return socket;
}

/** 发送意图并等待 ack(M3.4);未连接时直接返回失败回执 */
export function sendIntent(intent: Intent): Promise<IntentAck> {
  const socket = worldSocket;
  if (socket === null || !socket.connected) {
    return Promise.resolve({ ok: false, message: '未连接世界' });
  }
  return new Promise((resolve) => {
    socket.emit(CLIENT_EVENTS.intent, intent, (ack: IntentAck) => resolve(ack));
  });
}
