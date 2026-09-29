import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import { MemoryEventStore, OBS_CODES } from '../../observability';
import {
  createPlatformSQLiteService,
  type PlatformSQLiteService,
} from '../../persistence';
import { customPolicy, defineResource } from '../../resources';
import { createApp } from './app-factory';

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

const apps: ManagedApp[] = [];
const sqliteServices: PlatformSQLiteService[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.stop(true);
  for (const sqlite of sqliteServices.splice(0).reverse()) sqlite.close();
  for (const root of roots.splice(0).reverse()) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('createApp observability isolation', () => {
  test('keeps registry, resource-policy, sync-mode, and DataQuery events in the owning app sink', async () => {
    const appAEvents = new MemoryEventStore();
    const appBEvents = new MemoryEventStore();
    let failAppAPolicy = false;
    const [preparedA, preparedB] = await Promise.all([
      prepareApp('alpha', appAEvents, () => failAppAPolicy),
      prepareApp('beta', appBEvents),
    ]);

    // createApp() selects its app-local sink before awaiting resource loading.
    // Starting both together deterministically reproduces the old ambient-sink
    // race: Alpha yields, Beta becomes ambient, and then Alpha registers.
    const [appA, appB] = await Promise.all([
      preparedA.start(),
      preparedB.start(),
    ]);

    expect(codes(appAEvents, OBS_CODES.RESOURCE_REGISTRY_READY.code)).toHaveLength(1);
    expect(codes(appBEvents, OBS_CODES.RESOURCE_REGISTRY_READY.code)).toHaveLength(1);

    // Both app runtimes already exist before either startup hook fires. An
    // ambient emitter would therefore send Alpha's warning to Beta's sink.
    appA.app.listen(0);
    appB.app.listen(0);

    const [appAStarted] = codes(appAEvents, OBS_CODES.SYNC_STARTED.code);
    const [appBStarted] = codes(appBEvents, OBS_CODES.SYNC_STARTED.code);
    expect(appAStarted?.metadata).toMatchObject({ databaseMode: 'ephemeral' });
    expect(appBStarted?.metadata).toMatchObject({ databaseMode: 'ephemeral' });
    expect(appAStarted?.error).toBeUndefined();
    expect(appBStarted?.error).toBeUndefined();
    expect(appAStarted?.metadata).not.toHaveProperty('db');
    expect(appBStarted?.metadata).not.toHaveProperty('db');
    expect(JSON.stringify([appAStarted, appBStarted])).not.toContain(preparedA.root);
    expect(JSON.stringify([appAStarted, appBStarted])).not.toContain(preparedB.root);

    const routeFailure = await fetch(
      `http://localhost:${appA.app.server!.port}/__observability-failure`,
    );
    expect(routeFailure.status).toBe(500);
    expect(codes(appAEvents, OBS_CODES.APP_REQUEST_FAILED.code)).toHaveLength(1);
    expect(codes(appBEvents, OBS_CODES.APP_REQUEST_FAILED.code)).toHaveLength(0);

    const appARequestEvents = await fetch(
      `http://localhost:${appA.app.server!.port}/api/_zero/observability/events?code=${encodeURIComponent(OBS_CODES.APP_REQUEST_FAILED.code)}`,
    );
    const appBRequestEvents = await fetch(
      `http://localhost:${appB.app.server!.port}/api/_zero/observability/events?code=${encodeURIComponent(OBS_CODES.APP_REQUEST_FAILED.code)}`,
    );
    expect(appARequestEvents.status).toBe(200);
    expect(appBRequestEvents.status).toBe(200);
    expect((await appARequestEvents.json() as { count: number }).count).toBe(1);
    expect((await appBRequestEvents.json() as { count: number }).count).toBe(0);

    expect(codes(appAEvents, OBS_CODES.SYNC_MODE_AUTO_LAZY.code)).toHaveLength(1);
    expect(codes(appBEvents, OBS_CODES.SYNC_MODE_AUTO_LAZY.code)).toHaveLength(1);

    failAppAPolicy = true;
    const denied = await fetch(
      `http://localhost:${appA.app.server!.port}/api/data?table=events`,
    );
    expect(denied.status).toBe(500);
    expect(await denied.json()).toEqual({
      error: 'Resource policy callback failed',
      code: 'policy-error',
    });
    expect(codes(
      appAEvents,
      OBS_CODES.RESOURCE_POLICY_EVALUATION_FAILED.code,
    )).toHaveLength(1);
    expect(codes(
      appBEvents,
      OBS_CODES.RESOURCE_POLICY_EVALUATION_FAILED.code,
    )).toHaveLength(0);

    failAppAPolicy = false;
    appA.sqlite.raw.exec('DROP TABLE events');
    const failed = await fetch(
      `http://localhost:${appA.app.server!.port}/api/data?table=events`,
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: 'Data query failed',
      code: 'data-query-failed',
    });
    const [dataQueryFailure] = codes(
      appAEvents,
      OBS_CODES.DATA_QUERY_FAILED.code,
    );
    expect(dataQueryFailure).toBeDefined();
    expect(dataQueryFailure?.error).toBeUndefined();
    expect(dataQueryFailure?.userId).toBeUndefined();
    expect(dataQueryFailure?.metadata).toEqual({ table: 'events' });
    expect(codes(appBEvents, OBS_CODES.DATA_QUERY_FAILED.code)).toHaveLength(0);
  }, 30_000);
});

async function prepareApp(
  label: string,
  events: MemoryEventStore,
  shouldFailPolicy: () => boolean = () => false,
): Promise<{
  root: string;
  start(): Promise<{ app: ManagedApp; sqlite: PlatformSQLiteService }>;
}> {
  const root = await mkdtemp(join(tmpdir(), `zero-observability-${label}-`));
  roots.push(root);
  const appDir = join(root, 'app');
  await mkdir(appDir, { recursive: true });
  const sqlite = createPlatformSQLiteService({ mode: 'memory' });
  sqliteServices.push(sqlite);
  return {
    root,
    async start() {
      const app = await createApp({
        db: { sqlite },
        tables: {
          events: {
            id: 'text primary key',
            title: 'text not null',
          },
        },
        resources: [defineResource({
          table: 'events',
          exposure: 'all',
          actions: ['list'],
          policy: customPolicy(() => {
            if (shouldFailPolicy()) throw new Error(`${label} policy failed`);
            return true;
          }, { name: `${label}-policy` }),
        })],
        syncDefaults: {
          autoLazy: { rowLimit: 1, action: 'lazy' },
        },
        auth: false,
        migrate: false,
        email: false,
        ai: false,
        vector: false,
        pdf: false,
        kv: false,
        serverResourcesDir: false,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        resourceRoutes: false,
        appDir,
        outDir: join(root, 'out'),
        generatedDir: join(root, '.zero', 'generated'),
        observability: {
          console: false,
          store: events,
          endpoint: { read: 'development' },
        },
      });
      app.get('/__observability-failure', () => {
        throw new Error(`${label} route private failure`);
      });
      apps.push(app);
      sqlite.raw.run(
        'INSERT INTO events (id, title) VALUES (?, ?), (?, ?)',
        [`${label}-1`, 'One', `${label}-2`, 'Two'],
      );
      return { app, sqlite };
    },
  };
}

function codes(store: MemoryEventStore, code: string) {
  return store.query({ code }).events;
}
