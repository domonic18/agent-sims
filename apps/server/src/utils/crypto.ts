import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

function deriveKey(masterKey: string): Buffer {
  return createHash('sha256').update(masterKey, 'utf8').digest();
}

/** AES-256-GCM 加密;密文格式 v1.<iv>.<tag>.<data>(均 base64) */
export function encryptSecret(plain: string, masterKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(masterKey), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
}

/** AES-256-GCM 解密;密文被篡改或密钥不符时抛错 */
export function decryptSecret(payload: string, masterKey: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('密文格式不合法');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(masterKey), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const data = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return data.toString('utf8');
}

/** 掩码展示:保留前 4 后 4,星号封顶 8;≤8 字符全掩码 */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '*'.repeat(secret.length);
  return `${secret.slice(0, 4)}${'*'.repeat(Math.min(secret.length - 8, 8))}${secret.slice(-4)}`;
}

/** 校验 seed 落库的 scrypt:salt:hash 口令哈希 */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const candidate = scryptSync(password, salt, expected.length);
  return timingSafeEqual(candidate, expected);
}
