import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = buildApp({ logger: true });

app
  .listen({ port: env.GAME_PORT, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`agent-sims server listening at ${address}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
