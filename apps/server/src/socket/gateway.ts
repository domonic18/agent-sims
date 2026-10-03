import { Server, type Socket } from 'socket.io';
import {
  SOCKET_EVENTS,
  SOCKET_ROLES,
  type SocketRole,
  type WorldEventMessage,
  type WorldSnapshotMessage,
} from '@sims/shared';
import type { Simulation } from '../world/simulation.js';
import type { ClientRegistry } from './clients.js';

const normalizeRole = (value: unknown): SocketRole =>
  SOCKET_ROLES.includes(value as SocketRole) ? (value as SocketRole) : 'spectator';

/**
 * Socket.IO 网关(arch §7):连接即发全量快照,订阅世界事件总线转发
 * 离散事件;每 tick 增量由宿主驱动器回调触发 broadcastTick。
 * spectator 只读:本层不注册任何 client→server 指令监听,
 * 后续指令通道(player)落地时在此按角色拦截。
 */
export function attachSocketGateway(
  httpServer: import('node:http').Server,
  sim: Simulation,
  clients: ClientRegistry,
): Server {
  const io = new Server(httpServer, {
    cors: { origin: true }, // 单机自部署,放开跨域(本地 Vite 5173 / frpc 同源)
  });

  io.on('connection', (socket: Socket) => {
    const role = normalizeRole(socket.handshake.auth?.role);
    clients.add({ socketId: socket.id, role, connectedAt: new Date().toISOString() });
    socket.emit(SOCKET_EVENTS.snapshot, sim.snapshot() satisfies WorldSnapshotMessage);
    socket.on('disconnect', () => {
      clients.remove(socket.id);
    });
  });

  // 离散事件即时转发(character.arrived/world.control)
  sim.events.subscribe((event) => {
    const message: WorldEventMessage = { event };
    io.emit(SOCKET_EVENTS.event, message);
  });

  return io;
}
