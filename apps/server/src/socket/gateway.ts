import { Server, type Socket } from 'socket.io';
import {
  CLIENT_EVENTS,
  intentSchema,
  SOCKET_EVENTS,
  SOCKET_ROLES,
  type IntentAck,
  type SocketRole,
  type WorldEventMessage,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { executeIntent } from '../intents/execute.js';
import type { Simulation } from '../world/simulation.js';
import type { ClientRegistry } from './clients.js';

const normalizeRole = (value: unknown): SocketRole =>
  SOCKET_ROLES.includes(value as SocketRole) ? (value as SocketRole) : 'spectator';

/**
 * Socket.IO 网关(arch §7):连接即发全量快照,订阅世界事件总线转发
 * 离散事件;每 tick 增量由宿主驱动器回调触发 broadcastTick。
 * 意图通道(M3.4):player 指令经协议校验后执行并 ack;spectator
 * 只读,指令直接丢弃(ack 拒绝,requirement §2.1)。
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
    socket.on(CLIENT_EVENTS.intent, (payload: unknown, ack?: (response: IntentAck) => void) => {
      const reply = (response: IntentAck): boolean => (ack ? (ack(response), true) : false);
      if (role !== 'player') {
        return reply({ ok: false, message: '参观者只读,指令已忽略' });
      }
      const parsed = intentSchema.safeParse(payload);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reply({ ok: false, message: issue ? `意图不合法: ${issue.message}` : '意图不合法' });
      }
      try {
        reply(executeIntent(sim, parsed.data));
      } catch (err) {
        reply({ ok: false, message: err instanceof Error ? err.message : '意图执行失败' });
      }
    });
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
