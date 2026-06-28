/**
 * app/server.ts
 *
 * Runnable development entry for the example Zero app in this repository.
 * This file owns local app startup only; reusable platform exports remain in
 * `src/frontend/index.ts` and `src/frontend/server.ts`.
 */

import { OBS_CODES, createApp, emitPlatformCode } from '@platform/server';

const port = Number(Bun.env.PORT ?? 3000);

const app = await createApp({
  db: { mode: Bun.env.DB_PATH ?? 'memory' },
  tables: {},
  auth: false,
  appDir: './app',
  port,
});

app.listen(port);

emitPlatformCode(OBS_CODES.APP_LISTENING, {
  metadata: { url: `http://localhost:${port}`, port },
});
