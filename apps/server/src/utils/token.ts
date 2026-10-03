import { createHmac, timingSafeEqual } from 'node:crypto';

export interface IssuedAdminToken {
  token: string;
  /** 有效期(秒) */
  expiresIn: number;
}

export type AdminTokenVerifyResult =
  | { valid: true; username: string }
  | { valid: false; reason: 'malformed' | 'expired' | 'signature' };

/**
 * 签发后台会话 token:格式 v1.<payloadB64url>.<sigB64url>,
 * payload 为 {sub, exp}(epoch 秒),HMAC-SHA256 以 masterKey 派生密钥签名。
 */
export function issueAdminToken(options: {
  username: string;
  masterKey: string;
  ttlMs: number;
}): IssuedAdminToken {
  const b64url = (input: Buffer | string) =>
    Buffer.from(input).toString('base64url');
  const payload = b64url(
    JSON.stringify({
      sub: options.username,
      exp: Math.floor((Date.now() + options.ttlMs) / 1000),
    }),
  );
  const signature = b64url(sign(payload, options.masterKey));
  return { token: `v1.${payload}.${signature}`, expiresIn: Math.round(options.ttlMs / 1000) };
}

export function verifyAdminToken(token: string, masterKey: string): AdminTokenVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) {
    return { valid: false, reason: 'malformed' };
  }
  const [, payload, signature] = parts;
  const expected = sign(payload, masterKey);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { valid: false, reason: 'signature' };
  }
  let parsed: { sub?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (typeof parsed.sub !== 'string' || typeof parsed.exp !== 'number') {
    return { valid: false, reason: 'malformed' };
  }
  if (parsed.exp * 1000 <= Date.now()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, username: parsed.sub };
}

function sign(payload: string, masterKey: string): Buffer {
  return createHmac('sha256', `admin-token:${masterKey}`).update(payload).digest();
}
