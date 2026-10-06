import { Server, type Socket } from 'socket.io';
import {
  CLIENT_EVENTS,
  SOCKET_EVENTS,
  SOCKET_ROLES,
  type IntentAck,
  type SocketRole,
  type WorldEventMessage,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { env } from '../config/env.js';
import { runIntent } from '../intents/execute.js';
import { verifyAdminToken } from '../utils/token.js';
import type { Simulation } from '../world/simulation.js';
import type { ClientRegistry } from './clients.js';

const normalizeRole = (value: unknown): SocketRole =>
  SOCKET_ROLES.includes(value as SocketRole) ? (value as SocketRole) : 'spectator';

/**
 * player 角色准入(游览/操控分层):生产环境必须持有效 admin token(与后台
 * /api/admin/auth/login 同一签发),防止公布页面后游客改握手角色越权操控;
 * 开发/测试环境豁免(本地走查与集成测试不便造 token)。
 */
export function resolveSocketRole(handshakeAuth: Record<string, unknown> | undefined): SocketRole {
  if (normalizeRole(handshakeAuth?.role) !== 'player') return 'spectator';
  if (env.NODE_ENV !== 'production') return 'player';
  const token = typeof handshakeAuth?.token === 'string' ? handshakeAuth.token : '';
  return verifyAdminToken(token, env.MASTER_KEY).valid ? 'player' : 'spectator';
}

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
    const role = resolveSocketRole(socket.handshake.auth);
    clients.add({ socketId: socket.id, role, connectedAt: new Date().toISOString() });
    socket.emit(SOCKET_EVENTS.snapshot, sim.snapshot() satisfies WorldSnapshotMessage);
    socket.on(CLIENT_EVENTS.intent, (payload: unknown, ack?: (response: IntentAck) => void) => {
      const reply = (response: IntentAck): boolean => (ack ? (ack(response), true) : false);
      if (role !== 'player') {
        return reply({ ok: false, message: '参观者只读,指令已忽略' });
      }
      reply(runIntent(sim, payload));
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

/** 每 tick 快照广播接线(arch §7):宿主驱动器 onTick 调用;index.ts 实时驱动与 sync.test 对照共用,防两端漂移 */
export function tickBroadcast(sim: Simulation, io: Server): () => void {
  return () => io.emit(SOCKET_EVENTS.tick, sim.snapshot());
}
