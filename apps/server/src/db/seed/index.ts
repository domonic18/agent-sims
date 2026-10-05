import { MODEL_SLOTS } from '@sims/shared';
import { env } from '../../config/env.js';
import { createDb } from '../client.js';
import { adminUsers, modelConfigs, worldState } from '../schema/index.js';
import { hashPassword } from '../../utils/crypto.js';

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
