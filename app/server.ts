/**
 * app/server.ts
 *
 * Runnable development entry for the example Zero app in this repository.
 * This file owns local app startup only; reusable platform exports remain in
 * `src/frontend/index.ts` and `src/frontend/server.ts`.
 */

import { OBS_CODES, createApp, emitPlatformCode, getSyncDB } from '@platform/server';
import type { SQLiteStorageConfig, SQLiteStorageMode } from '@platform/server';
import { tables } from './launchboard/schema';
import { seedLaunchBoardDatabase } from './launchboard/seed';

const port = Number(Bun.env.PORT ?? 3000);
const dbConfig = resolveLaunchBoardDatabaseConfig();

const app = await createApp({
  app: {
    name: 'LaunchBoard',
    publicUrl: Bun.env.APP_PUBLIC_URL ?? `http://localhost:${port}`,
  },
  db: dbConfig,
  tables,
  auth: false,
  sitemap: true,
  appDir: './app',
  port,
});

const syncDb = getSyncDB();
if (!syncDb) throw new Error('[launchboard] ReactiveDB was not initialized by createApp().');
seedLaunchBoardDatabase(syncDb);

app.listen(port);

emitPlatformCode(OBS_CODES.APP_LISTENING, {
  metadata: { url: `http://localhost:${port}`, port, dbMode: dbConfig.mode },
});

/** Resolve the LaunchBoard dev database to Zero's hot in-memory runtime by default. */
function resolveLaunchBoardDatabaseConfig(): SQLiteStorageConfig {
  const mode = resolveDatabaseMode(Bun.env.DB_MODE);
  const path = Bun.env.DB_PATH ?? './data/launchboard.db';
  const snapshotPath = Bun.env.DB_SNAPSHOT_PATH ?? './data/launchboard.snapshot.db';

  if (mode === 'ephemeral') return { mode };
  if (mode === 'file') return { mode, path };

  return {
    mode,
    path,
    snapshotPath,
  };
}

function resolveDatabaseMode(value: string | undefined): SQLiteStorageMode {
  if (!value) return 'hot';
  if (value === 'hot' || value === 'file' || value === 'ephemeral') return value;
  throw new Error(`[launchboard] DB_MODE must be "hot", "file", or "ephemeral"; received "${value}".`);
}
