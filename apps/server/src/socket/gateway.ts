import { Server, type Socket } from 'socket.io';
import {
  CLIENT_EVENTS,
  SOCKET_EVENTS,
  SOCKET_ROLES,
  type IntentAck,
  type SocketRole,
  type WorldEventMessage,
  type WorldHostingMessage,
  type WorldPresenceMessage,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { env } from '../config/env.js';
import { hosting } from '../agents/cognition.js';
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
    // CORS 同源化(OPS-2):页面经 nginx 同源反代连接(本地 Vite dev 由 proxy 转发,亦同源),
    // 默认不发 CORS 头(origin:false);仅 CORS_ORIGINS 白名单场景才放开跨域握手
    cors: { origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false },
  });

  // 在线人数(直播访客数):全部 socket 连接都计入;变化时全端广播,新连者单发当前值
  const broadcastPresence = (): void => {
    io.emit(SOCKET_EVENTS.presence, { viewers: clients.list().length } satisfies WorldPresenceMessage);
  };

  io.on('connection', (socket: Socket) => {
    const role = resolveSocketRole(socket.handshake.auth);
    clients.add({ socketId: socket.id, role, connectedAt: new Date().toISOString() });
    socket.emit(SOCKET_EVENTS.snapshot, sim.snapshot() satisfies WorldSnapshotMessage);
    // 托管现状整表同步(M4e):hosting_changed 事件只保在线期间,重启恢复或
    // 离线期间的托管变更不会重放——不发这条,新开页面徽标会全部显示「未托管」
    socket.emit(
      SOCKET_EVENTS.hostingSync,
      {
        entries: hosting.entries().map(([characterId, state]) => ({ characterId, mode: state.mode })),
      } satisfies WorldHostingMessage,
    );
    broadcastPresence();
    socket.on(CLIENT_EVENTS.intent, (payload: unknown, ack?: (response: IntentAck) => void) => {
      const reply = (response: IntentAck): boolean => (ack ? (ack(response), true) : false);
      if (role !== 'player') {
        return reply({ ok: false, message: '参观者只读,指令已忽略' });
      }
      // 托管守卫(M4e):角色托管中=指令来源 Agent,玩家意图拒收;取不到 characterId 放行兼容
      const characterId =
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).characterId
          : undefined;
      if (typeof characterId === 'string' && hosting.has(characterId)) {
        return reply({ ok: false, message: '角色托管中,请先接管再操作' });
      }
      reply(runIntent(sim, payload));
    });
    socket.on('disconnect', () => {
      clients.remove(socket.id);
      broadcastPresence();
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
