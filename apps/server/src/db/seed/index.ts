import { randomBytes, scryptSync } from 'node:crypto';
import { MODEL_SLOTS } from '@sims/shared';
import { env } from '../../config/env.js';
import { createDb } from '../client.js';
import { adminUsers, modelConfigs, worldState } from '../schema/index.js';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

const { db, client } = createDb(env.DATABASE_URL);
try {
  await db.insert(worldState).values({ id: 1 }).onConflictDoNothing();

  await db
    .insert(modelConfigs)
    .values(
      MODEL_SLOTS.map((slot) => ({ slot, baseUrl: '', model: '', enabled: false })),
    )
    .onConflictDoNothing({ target: modelConfigs.slot });

  await db
    .insert(adminUsers)
    .values({
      username: 'admin',
      passwordHash: hashPassword(env.ADMIN_INITIAL_PASSWORD),
    })
    .onConflictDoNothing({ target: adminUsers.username });

  console.log('[db] seed 完成(幂等)');
} finally {
  await client.end();
}
