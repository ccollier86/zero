/**
 * app/server.ts
 *
 * Runnable development entry for the example Zero app in this repository.
 * This file owns local app startup only; reusable platform exports remain in
 * `src/frontend/index.ts` and `src/frontend/server.ts`.
 */

import {
  OBS_CODES,
  createApp,
  emitPlatformCode,
  requirePlatformSQLiteService,
} from '@zero/framework/server';
import config from '../zero.config';
import {
  ensureLaunchBoardIndexes,
  resetLegacyLaunchBoardTables,
} from './launchboard/schema-compat';

resetLegacyLaunchBoardTables(config.db);

const app = await createApp(config);
ensureLaunchBoardIndexes(requirePlatformSQLiteService().raw);
const port = config.port ?? 3000;

app.listen(port);

emitPlatformCode(OBS_CODES.APP_LISTENING, {
  metadata: { url: `http://localhost:${port}`, port, dbMode: config.db.mode },
});
