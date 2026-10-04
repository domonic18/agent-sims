import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  SOCKET_EVENTS,
  type IntentAck,
  type SocketRole,
  type WorldEventMessage,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { buildApp } from '../src/app.js';
import { BALANCE } from '../src/config/balance.js';
import { tickBroadcast } from '../src/socket/gateway.js';
import { TickDriver } from '../src/world/driver.js';

/**
 * 同步层集成测试(arch §7):验证连接快照、tick 广播、离散事件转发、
 * 在线注册表与多次连接(重连)。纯 socket 面,不依赖 DB。
 * 快照在连接握手中同步下发,监听必须先于 connect 注册,否则错过首帧。
 * onTick 广播与 index.ts 共用 tickBroadcast 接线;每用例重建 app 隔离世界状态。
 */

let app: ReturnType<typeof buildApp>;
let port = 0;

const openSocket = (role: SocketRole = 'spectator'): Socket =>
  io(`http://127.0.0.1:${port}`, { auth: { role } });

const connected = (socket: Socket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });

const waitFor = <T>(socket: Socket, event: string, timeoutMs = 3_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${event} 超时`)), timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

/** 轮询等待异步投递完成(broadcast 经网络到达客户端早于断言) */
const until = async (condition: () => boolean, timeoutMs = 3_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(condition()).toBe(true);
};

// 每用例重建 app(端口/世界状态全隔离),用例间互不污染
beforeEach(async () => {
  app = buildApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  port = Number(new URL(address).port);
}, 30_000);

afterEach(async () => {
  await app.close();
});

describe('socket 同步层', () => {
  it('连接即发全量快照', async () => {
    const socket = openSocket();
    const snapshotPromise = waitFor<WorldSnapshotMessage>(socket, SOCKET_EVENTS.snapshot);
    await connected(socket);
    const snapshot = await snapshotPromise;

    expect(snapshot.tick).toBe(0);
    expect(snapshot.paused).toBe(false);
    expect(snapshot.timeScale).toBe(BALANCE.DEFAULT_TIME_SCALE);
    expect(snapshot.clock.time).toBe('08:00');
    expect(snapshot.characters).toEqual([]);
    socket.disconnect();
  });

  it('在线客户端注册表随连接/断线增减', async () => {
    const spectator = openSocket('spectator');
    const player = openSocket('player');
    await Promise.all([connected(spectator), connected(player)]);

    const list = app.clients.list();
    expect(list).toHaveLength(2);
    expect(list.map((client) => client.role).sort()).toEqual(['player', 'spectator']);

    player.disconnect();
    spectator.disconnect();
    await until(() => app.clients.list().length === 0);
    expect(app.clients.list()).toHaveLength(0);
  });

  it('每 tick 广播快照,角色移动产生到达事件', async () => {
    app.simulation.spawnCharacter('alice', 8, 12, '爱丽丝');
    app.simulation.requestMoveTo('alice', 10, 12);

    const socket = openSocket();
    const snapshotPromise = waitFor<WorldSnapshotMessage>(socket, SOCKET_EVENTS.snapshot);
    await connected(socket);
    const initial = await snapshotPromise;
    expect(initial.characters).toHaveLength(1);
    expect(initial.characters[0]?.pathRemaining).toBe(2);

    const events: WorldEventMessage[] = [];
    socket.on(SOCKET_EVENTS.event, (message: WorldEventMessage) => events.push(message));
    const tickMessages: WorldSnapshotMessage[] = [];
    socket.on(SOCKET_EVENTS.tick, (snapshot: WorldSnapshotMessage) => tickMessages.push(snapshot));

    // 与 index.ts 相同的 onTick 广播接线,注入时钟按泵间隔连跑 3 拍(每拍 1 tick)
    let now = 0;
    const driver = new TickDriver(app.simulation, {
      now: () => (now += BALANCE.TICK_MS),
      onTick: tickBroadcast(app.simulation, app.io),
    });
    const pumped = driver.pump() + driver.pump() + driver.pump();

    expect(pumped).toBe(3);
    await until(() => tickMessages.length >= 3);
    expect(tickMessages.map((message) => message.tick)).toEqual([1, 2, 3]);
    expect(tickMessages[2]?.characters[0]?.x).toBe(10);
    expect(tickMessages[2]?.characters[0]?.pathRemaining).toBe(0);

    const arrived = events.find((message) => message.event.type === 'character.arrived');
    expect(arrived?.event).toMatchObject({ characterId: 'alice', tick: 1, x: 10, y: 12 }); // 2 格 @2格/分 → 第 1 tick 到达
    socket.disconnect();
  });

  it('控制变更经 world.control 事件转发,新连接快照反映最新状态', async () => {
    app.simulation.setPaused(true);
    app.simulation.setTimeScale(4);

    const socket = openSocket();
    const snapshotPromise = waitFor<WorldSnapshotMessage>(socket, SOCKET_EVENTS.snapshot);
    await connected(socket);
    const snapshot = await snapshotPromise;
    expect(snapshot.paused).toBe(true);
    expect(snapshot.timeScale).toBe(4);

    const controlPromise = waitFor<WorldEventMessage>(socket, SOCKET_EVENTS.event);
    app.simulation.setPaused(false);
    const control = await controlPromise;
    expect(control.event.type).toBe('world.control');
    if (control.event.type === 'world.control') {
      expect(control.event.paused).toBe(false);
      expect(control.event.timeScale).toBe(4);
    }

    socket.disconnect();
  });

  it('意图通道: player 指令执行并 ack,spectator 指令丢弃,非法意图拒绝', async () => {
    app.simulation.spawnCharacter('bill', 8, 12, '比尔');
    const emitIntent = (socket: Socket, payload: unknown): Promise<IntentAck> =>
      new Promise((resolve) => {
        socket.emit(CLIENT_EVENTS.intent, payload, (ack: IntentAck) => resolve(ack));
      });

    const player = openSocket('player');
    await connected(player);
    const moved = await emitIntent(
      player,
      { type: 'move_to', characterId: 'bill', x: 9, y: 12 },
    );
    expect(moved.ok).toBe(true);
    expect(moved.message).toContain('路径');
    expect(app.simulation.character('bill').path).toHaveLength(1);

    const businessError = await emitIntent(
      player,
      { type: 'move_to', characterId: 'bill', x: 0, y: 0 },
    );
    expect(businessError).toMatchObject({ ok: false });
    expect(businessError.message).toContain('不可行走');

    const invalid = await emitIntent(player, { type: 'teleport', characterId: 'bill' });
    expect(invalid).toMatchObject({ ok: false, message: expect.stringContaining('意图不合法') });

    const spectator = openSocket('spectator');
    await connected(spectator);
    const rejected = await emitIntent(
      spectator,
      { type: 'move_to', characterId: 'bill', x: 10, y: 12 },
    );
    expect(rejected).toMatchObject({ ok: false, message: expect.stringContaining('只读') });
    expect(app.simulation.character('bill').path).toHaveLength(1); // 未被执行

    player.disconnect();
    spectator.disconnect();
    await until(() => app.clients.list().length === 0);
  });
});
