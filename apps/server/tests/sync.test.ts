import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SOCKET_EVENTS,
  type SocketRole,
  type WorldEventMessage,
  type WorldSnapshotMessage,
} from '@sims/shared';
import { buildApp } from '../src/app.js';
import { BALANCE } from '../src/config/balance.js';
import { TickDriver } from '../src/world/driver.js';

/**
 * 同步层集成测试(arch §7):验证连接快照、tick 广播、离散事件转发、
 * 在线注册表与多次连接(重连)。纯 socket 面,不依赖 DB。
 * 快照在连接握手中同步下发,监听必须先于 connect 注册,否则错过首帧。
 * 与 index.ts 相同的驱动器接线(onTick → io.emit world.tick)在用例内复刻。
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

beforeAll(async () => {
  app = buildApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  port = Number(new URL(address).port);
}, 30_000);

afterAll(async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(app.clients.list()).toHaveLength(0);
  });

  it('每 tick 广播快照,角色移动产生到达事件', async () => {
    app.simulation.spawnCharacter('alice', 5, 7, '爱丽丝');
    app.simulation.requestMoveTo('alice', 7, 7);

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

    // 复刻 index.ts 接线,注入时钟按泵间隔连跑 3 拍(每拍 1 tick)
    let now = 0;
    const driver = new TickDriver(app.simulation, {
      now: () => (now += BALANCE.TICK_MS),
      onTick: () => app.io.emit(SOCKET_EVENTS.tick, app.simulation.snapshot()),
    });
    const pumped = driver.pump() + driver.pump() + driver.pump();

    expect(pumped).toBe(3);
    await until(() => tickMessages.length >= 3);
    expect(tickMessages.map((message) => message.tick)).toEqual([1, 2, 3]);
    expect(tickMessages[2]?.characters[0]?.x).toBe(7);
    expect(tickMessages[2]?.characters[0]?.pathRemaining).toBe(0);

    const arrived = events.find((message) => message.event.type === 'character.arrived');
    expect(arrived?.event).toMatchObject({ characterId: 'alice', tick: 2, x: 7, y: 7 });
    socket.disconnect();
    app.simulation.characters.delete('alice');
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
    app.simulation.setTimeScale(BALANCE.DEFAULT_TIME_SCALE);
  });
});
