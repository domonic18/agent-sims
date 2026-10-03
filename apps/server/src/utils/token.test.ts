import { describe, expect, it } from 'vitest';
import { issueAdminToken, verifyAdminToken } from './token.js';

const KEY = 'unit-test-master-key';

describe('issueAdminToken/verifyAdminToken', () => {
  it('签发后校验通过并还原用户名', () => {
    const { token } = issueAdminToken({ username: 'admin', masterKey: KEY, ttlMs: 60_000 });
    const result = verifyAdminToken(token, KEY);
    expect(result).toEqual({ valid: true, username: 'admin' });
  });

  it('过期 token 校验失败(reason=expired)', () => {
    const { token } = issueAdminToken({ username: 'admin', masterKey: KEY, ttlMs: -1_000 });
    expect(verifyAdminToken(token, KEY)).toEqual({ valid: false, reason: 'expired' });
  });

  it('密钥不符校验失败(reason=signature)', () => {
    const { token } = issueAdminToken({ username: 'admin', masterKey: KEY, ttlMs: 60_000 });
    expect(verifyAdminToken(token, 'other-key')).toEqual({ valid: false, reason: 'signature' });
  });

  it('伪造签名校验失败', () => {
    const { token } = issueAdminToken({ username: 'admin', masterKey: KEY, ttlMs: 60_000 });
    const forged = `${token.slice(0, -4)}cafe`;
    expect(verifyAdminToken(forged, KEY)).toEqual({ valid: false, reason: 'signature' });
  });

  it('格式不合法返回 malformed', () => {
    expect(verifyAdminToken('garbage', KEY)).toEqual({ valid: false, reason: 'malformed' });
    expect(verifyAdminToken('v1.aaa.bbb.ccc', KEY)).toEqual({ valid: false, reason: 'malformed' });
  });
});
