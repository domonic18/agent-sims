import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  verifyPassword,
} from './crypto.js';

const KEY = 'unit-test-master-key';

describe('encryptSecret/decryptSecret', () => {
  it('加解密往返还原原文', () => {
    const plain = 'sk-test-abc123XYZ';
    expect(decryptSecret(encryptSecret(plain, KEY), KEY)).toBe(plain);
  });

  it('相同明文两次加密产生不同密文(随机 IV)', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('密钥不符时解密抛错', () => {
    const payload = encryptSecret('secret', KEY);
    expect(() => decryptSecret(payload, 'another-master-key')).toThrow();
  });

  it('密文被篡改时解密抛错', () => {
    const payload = encryptSecret('secret', KEY);
    const tampered = `${payload.slice(0, -2)}xx`;
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it('格式不合法时抛错', () => {
    expect(() => decryptSecret('not-a-cipher', KEY)).toThrow('密文格式不合法');
  });
});

describe('maskSecret', () => {
  it('长密钥保留前 4 后 4,星号封顶 8', () => {
    expect(maskSecret('sk-abcdefghijklmnop')).toBe('sk-a********mnop');
  });

  it('中等长度星号按差值展示', () => {
    expect(maskSecret('1234567890')).toBe('1234**7890');
  });

  it('短密钥全掩码', () => {
    expect(maskSecret('short')).toBe('*****');
    expect(maskSecret('12345678')).toBe('********');
  });

  it('空串返回空串', () => {
    expect(maskSecret('')).toBe('');
  });
});

describe('verifyPassword', () => {
  function hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  }

  it('正确口令通过', () => {
    expect(verifyPassword('admin-pass-1', hashPassword('admin-pass-1'))).toBe(true);
  });

  it('错误口令拒绝', () => {
    expect(verifyPassword('wrong', hashPassword('right'))).toBe(false);
  });

  it('格式不合法拒绝', () => {
    expect(verifyPassword('x', 'plain-text')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });
});
