import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type SocketRole,
  type WorldEventMessage,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { useWorldStore } from '../store/worldStore';

const { setStatus, applySnapshot, applyEvent, applyControl } = useWorldStore.getState();

/**
 * 连接世界同步通道(arch §7):连接即收全量快照,此后每 tick 快照覆盖,
 * 离散事件走 world.event。M2 阶段 spectator 只读,无 client→server 指令。
 * 注意:监听必须先于连接建立注册——快照帧与 connect 同轮同步到达,
 * connect 回调返回后才挂监听会错过首帧。
 */
export function connectWorld(role: SocketRole = 'spectator'): Socket {
  const socket = io('/', { auth: { role } });
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
