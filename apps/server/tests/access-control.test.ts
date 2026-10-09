import { beforeEach, describe, expect, it, vi } from 'vitest';

/** env 单例替身:NODE_ENV 可按用例切换(默认 production 走校验分支) */
const envState = vi.hoisted(() => ({
  NODE_ENV: 'production',
  MASTER_KEY: 'unit-test-master-key',
}));

vi.mock('../src/config/env.js', () => ({ env: envState }));

const { resolveSocketRole } = await import('../src/socket/gateway.js');
const { canControlWorld } = await import('../src/api/world-settings.js');
const { issueAdminToken } = await import('../src/utils/token.js');

const issueToken = (ttlMs = 3_600_000): string =>
  issueAdminToken({ username: 'admin', masterKey: envState.MASTER_KEY, ttlMs }).token;

const requestWith = (authorization?: string) =>
  ({ headers: authorization === undefined ? {} : { authorization } }) as Parameters<
    typeof canControlWorld
  >[0];

describe('resolveSocketRole(player 角色准入)', () => {
  beforeEach(() => {
    envState.NODE_ENV = 'production';
  });

  it('production:player 角色 + 有效 token → player', () => {
    expect(resolveSocketRole({ role: 'player', token: issueToken() })).toBe('player');
  });

  it('production:player 角色 + 无 token → 降级 spectator', () => {
    expect(resolveSocketRole({ role: 'player' })).toBe('spectator');
  });

  it('production:player 角色 + 过期 token → 降级 spectator', () => {
    expect(resolveSocketRole({ role: 'player', token: issueToken(-1_000) })).toBe('spectator');
  });

  it('production:player 角色 + 签名伪造 token → 降级 spectator', () => {
    // 末位替换须保证不同:签名末位恰为 x 时 replace 会是无操作(1/64 概率踩中)
    const token = issueToken();
    const forged = token.slice(0, -1) + (token.endsWith('x') ? 'y' : 'x');
    expect(resolveSocketRole({ role: 'player', token: forged })).toBe('spectator');
  });

  it('spectator 角色即便持有效 token 也保持 spectator', () => {
    expect(resolveSocketRole({ role: 'spectator', token: issueToken() })).toBe('spectator');
  });

  it('开发/测试环境豁免:player 角色无 token 也放行', () => {
    envState.NODE_ENV = 'development';
    expect(resolveSocketRole({ role: 'player' })).toBe('player');
  });
});

describe('canControlWorld(/api/world/settings 写准入)', () => {
  beforeEach(() => {
    envState.NODE_ENV = 'production';
  });

  it('production:有效 Bearer token → 放行', () => {
    expect(canControlWorld(requestWith(`Bearer ${issueToken()}`))).toBe(true);
  });

  it('production:无 Authorization → 拒绝', () => {
    expect(canControlWorld(requestWith())).toBe(false);
  });

  it('production:非 Bearer 头 → 拒绝', () => {
    expect(canControlWorld(requestWith(issueToken()))).toBe(false);
  });

  it('production:过期 token → 拒绝', () => {
    expect(canControlWorld(requestWith(`Bearer ${issueToken(-1_000)}`))).toBe(false);
  });

  it('开发/测试环境豁免:无凭证放行', () => {
    envState.NODE_ENV = 'test';
    expect(canControlWorld(requestWith())).toBe(true);
  });
});
