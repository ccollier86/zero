/**
 * resource-app-factory.test.ts
 *
 * Verifies createApp wires app-owned resource definitions into the resource
 * registry. This test covers startup composition only; resource CRUD, /api/data,
 * and sync enforcement are covered by later Phase 5 slices.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, test } from 'bun:test';

import { clearKvService, getKvService } from '../../kv';
import {
  clearPlatformSQLiteService,
  createPlatformSQLiteService,
  getPlatformSQLiteService,
} from '../../persistence';
import {
  authenticatedOnly,
  defineResource,
  getResourceRegistry,
  globalRealm,
  readOnly,
  ResourceRegistryError,
  tenantRealm,
} from '../../resources';
import { defineDatabaseRealm } from '../../databases/database-realm';
import { createApp } from './app-factory';

async function createTempRoot(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, 'test-resource-app-'));
}

describe('createApp resource registration', () => {
  test('passes tenant-database isolation into resource registration', async () => {
    const rootDir = await createTempRoot();
    const isolatedRoot = join(rootDir, 'tenant-databases');
    const physicalTables = {
      documents: {
        id: 'text primary key',
        title: 'text not null',
      },
      private_notes: {
        id: 'text primary key',
        body: 'text not null',
      },
    };
    const realm = defineDatabaseRealm({
      name: 'resource-app-physical-tenants',
      version: '1',
      tables: physicalTables,
    });
    const sqlite = createPlatformSQLiteService({ mode: 'memory' });
    let app: Awaited<ReturnType<typeof createApp>> | undefined;

    try {
      await mkdir(join(rootDir, 'app'), { recursive: true });
      app = await createApp({
        db: { sqlite },
        tables: physicalTables,
        resources: [
          defineResource({
            table: 'documents',
            exposure: 'all',
            realm: tenantRealm(),
            policy: authenticatedOnly(),
          }),
          defineResource({
            table: 'private_notes',
            exposure: 'http',
            realm: tenantRealm(),
            policy: authenticatedOnly(),
          }),
        ],
        auth: { tenancy: 'multi', bootstrap: 'public' },
        databaseTopology: {
          mode: 'multiple',
          rootDirectory: isolatedRoot,
          realm,
          actors: {
            launch: {
              kind: 'source',
              entrypoint: fileURLToPath(import.meta.url),
            },
          },
          tenantIsolation: 'tenant-database',
        },
        serverResourcesDir: false,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        appDir: join(rootDir, 'app'),
        outDir: join(rootDir, 'out'),
        generatedDir: join(rootDir, '.zero', 'generated'),
        observability: false,
        kv: false,
      });
      app.listen(0);

      expect(getResourceRegistry().getByTable('documents')?.storage).toEqual({
        kind: 'tenant',
        isolation: 'tenant-database',
      });
      const physicalShadows = sqlite.raw.query(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name IN ('documents', 'private_notes')
        ORDER BY name
      `).all();
      expect(physicalShadows).toEqual([]);
    } finally {
      await app?.stop();
      sqlite.close();
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('rejects a tenant actor realm that includes a global resource table', async () => {
    const rootDir = await createTempRoot();
    const isolatedRoot = join(rootDir, 'tenant-databases');
    const tables = {
      documents: {
        id: 'text primary key',
        title: 'text not null',
      },
      app_settings: {
        id: 'text primary key',
        value: 'text not null',
      },
    };
    const realm = defineDatabaseRealm({
      name: 'resource-app-invalid-physical-tenants',
      version: '1',
      tables,
    });

    try {
      await mkdir(join(rootDir, 'app'), { recursive: true });
      await expect(createApp({
        db: { mode: 'memory' },
        tables,
        resources: [
          defineResource({
            table: 'documents',
            exposure: 'all',
            realm: tenantRealm(),
            policy: authenticatedOnly(),
          }),
          defineResource({
            table: 'app_settings',
            exposure: 'all',
            realm: globalRealm(),
            policy: authenticatedOnly(),
          }),
        ],
        auth: { tenancy: 'multi', bootstrap: 'public' },
        databaseTopology: {
          mode: 'multiple',
          rootDirectory: isolatedRoot,
          realm,
          actors: {
            launch: {
              kind: 'source',
              entrypoint: fileURLToPath(import.meta.url),
            },
          },
          tenantIsolation: 'tenant-database',
        },
        serverResourcesDir: false,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        appDir: join(rootDir, 'app'),
        outDir: join(rootDir, 'out'),
        generatedDir: join(rootDir, '.zero', 'generated'),
        observability: false,
        kv: false,
      })).rejects.toThrow(
        'tenant realm tables must exactly match tenant-owned resource tables',
      );
    } finally {
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('fails startup when an existing tenant discriminator is actually nullable', async () => {
    const rootDir = await createTempRoot();
    const sqlite = createPlatformSQLiteService({ mode: 'memory' });
    sqlite.raw.run(`
      CREATE TABLE documents (
        id text primary key,
        tenant_id text,
        title text not null
      )
    `);

    try {
      await expect(createApp({
        db: { sqlite },
        migrate: false,
        tables: {
          documents: {
            id: 'text primary key',
            tenant_id: 'text not null',
            title: 'text not null',
          },
        },
        resources: [defineResource({
          table: 'documents',
          exposure: 'all',
          realm: tenantRealm(),
          policy: authenticatedOnly(),
        })],
        auth: { tenancy: 'multi', bootstrap: 'public' },
        serverResourcesDir: false,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        appDir: join(rootDir, 'app'),
        outDir: join(rootDir, 'out'),
        generatedDir: join(rootDir, '.zero', 'generated'),
        observability: false,
        kv: false,
      })).rejects.toThrow('Apply the required schema migration');
    } finally {
      sqlite.close();
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('fails startup when an existing tenant resource lacks its actual leading index', async () => {
    const rootDir = await createTempRoot();
    const sqlite = createPlatformSQLiteService({ mode: 'memory' });
    sqlite.raw.run(`
      CREATE TABLE documents (
        id text primary key,
        tenant_id text not null,
        title text not null
      )
    `);

    try {
      let startupError: unknown;
      try {
        await createApp({
          db: { sqlite },
          migrate: false,
          tables: {
            documents: {
              id: 'text primary key',
              tenant_id: 'text not null',
              title: 'text not null',
            },
          },
          resources: [defineResource({
            table: 'documents',
            exposure: 'all',
            realm: tenantRealm(),
            policy: authenticatedOnly(),
          })],
          auth: { tenancy: 'multi', bootstrap: 'public' },
          serverResourcesDir: false,
          serverPluginsDir: false,
          serverMiddlewareDir: false,
          serverEndpointsDir: false,
          serverRoutesDir: false,
          appDir: join(rootDir, 'app'),
          outDir: join(rootDir, 'out'),
          generatedDir: join(rootDir, '.zero', 'generated'),
          observability: false,
          kv: false,
        });
      } catch (error) {
        startupError = error;
      }

      expect(startupError).toBeInstanceOf(ResourceRegistryError);
      expect((startupError as ResourceRegistryError).issues).toContainEqual(
        expect.objectContaining({
          code: 'resource-tenant-storage-index-missing',
          resource: 'documents',
        }),
      );
    } finally {
      sqlite.close();
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('rejects sync-only resources whose loading mode can require HTTP hydration', async () => {
    const rootDir = await createTempRoot();
    try {
      for (const mode of ['lazy', 'auto'] as const) {
        await expect(createApp({
          db: { mode: 'memory' },
          tables: {
            documents: {
              serverTable: { id: 'text primary key', title: 'text not null' },
              clientTable: { _pk: 'id', _sync: mode },
            },
          },
          resources: [defineResource({
            table: 'documents',
            exposure: 'sync',
            policy: readOnly(),
          })],
          auth: false,
          serverResourcesDir: false,
          serverPluginsDir: false,
          serverMiddlewareDir: false,
          serverEndpointsDir: false,
          serverRoutesDir: false,
          appDir: join(rootDir, `app-${mode}`),
          outDir: join(rootDir, `out-${mode}`),
          generatedDir: join(rootDir, '.zero', `generated-${mode}`),
          observability: false,
          kv: false,
        })).rejects.toThrow('lazy Sync hydration requires /api/data');
      }
    } finally {
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('rejects physical sync-only auto resources for every auto-lazy action', async () => {
    const rootDir = await createTempRoot();
    const tables = {
      documents: {
        id: 'text primary key',
        title: 'text not null',
      },
    };
    const realm = defineDatabaseRealm({
      name: 'sync-only-auto-physical-tenants',
      version: '1',
      tables,
    });

    try {
      await mkdir(join(rootDir, 'app'), { recursive: true });
      for (const action of ['warn', 'reject'] as const) {
        await expect(createApp({
          db: { mode: 'memory' },
          tables,
          resources: [defineResource({
            table: 'documents',
            exposure: 'sync',
            realm: tenantRealm(),
            policy: authenticatedOnly(),
          })],
          auth: { tenancy: 'multi', bootstrap: 'public' },
          databaseTopology: {
            mode: 'multiple',
            rootDirectory: join(rootDir, `tenant-databases-${action}`),
            realm,
            actors: {
              launch: {
                kind: 'source',
                entrypoint: fileURLToPath(import.meta.url),
              },
            },
            tenantIsolation: 'tenant-database',
          },
          syncDefaults: { autoLazy: { action } },
          serverResourcesDir: false,
          serverPluginsDir: false,
          serverMiddlewareDir: false,
          serverEndpointsDir: false,
          serverRoutesDir: false,
          appDir: join(rootDir, 'app'),
          outDir: join(rootDir, `out-${action}`),
          generatedDir: join(rootDir, '.zero', `generated-${action}`),
          observability: false,
          kv: false,
        })).rejects.toThrow('lazy Sync hydration requires /api/data');
      }
    } finally {
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('registers inline and package-mode resource definitions', async () => {
    const rootDir = await createTempRoot();
    const resourcesDir = join(rootDir, 'server', 'resources');
    const appDir = join(rootDir, 'app');
    const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;
    let app: Awaited<ReturnType<typeof createApp>> | undefined;

    try {
      await mkdir(resourcesDir, { recursive: true });
      await mkdir(appDir, { recursive: true });
      await writeFile(
        join(resourcesDir, 'projects.ts'),
        [
          `import { defineResource, readOnly } from '${serverImport}';`,
          "export default defineResource({ table: 'projects', policy: readOnly() });",
          '',
        ].join('\n')
      );

      app = await createApp({
        db: { mode: 'memory' },
        tables: {
          tickets: {
            ticket_id: 'text primary key',
            title: 'text not null',
          },
          projects: {
            project_id: 'text primary key',
            name: 'text not null',
          },
        },
        resources: [
          defineResource({
            table: 'tickets',
            policy: readOnly(),
          }),
        ],
        serverResourcesDir: resourcesDir,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        appDir,
        outDir: join(rootDir, 'out'),
        observability: false,
        kv: false,
      });
      app.listen(0);

      const registry = getResourceRegistry();
      expect(registry.getByTable('tickets')?.primaryKey).toBe('ticket_id');
      expect(registry.getByTable('projects')?.primaryKey).toBe('project_id');
    } finally {
      await app?.stop();
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('exposes the shared platform SQL service to app-owned backend routes', async () => {
    const rootDir = await createTempRoot();
    const routesDir = join(rootDir, 'server', 'routes');
    const appDir = join(rootDir, 'app');
    const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;
    let app: Awaited<ReturnType<typeof createApp>> | undefined;

    try {
      await mkdir(routesDir, { recursive: true });
      await mkdir(appDir, { recursive: true });
      await writeFile(
        join(routesDir, 'sql.ts'),
        [
          `import { createServerRoute } from '${serverImport}';`,
          "export default createServerRoute({ name: 'test.sql', prefix: '/api/sql' })",
          "  .post('/', ({ zero }) => {",
          "    zero.sql?.raw.prepare('INSERT INTO notes (note_id, title) VALUES (?, ?)').run('note_1', 'Shared SQL');",
          "    return zero.db.queryOne('notes', 'note_1');",
          "  });",
          '',
        ].join('\n')
      );

      app = await createApp({
        db: { mode: 'memory' },
        tables: {
          notes: {
            note_id: 'text primary key',
            title: 'text not null',
          },
        },
        serverResourcesDir: false,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: routesDir,
        appDir,
        outDir: join(rootDir, 'out'),
        observability: false,
        auth: false,
        kv: false,
      });
      app.listen(0);

      const response = await fetch(`http://localhost:${app.server!.port}/api/sql`, {
        method: 'POST',
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        note_id: 'note_1',
        title: 'Shared SQL',
      });

    } finally {
      await app?.stop();
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('persists app ReactiveDB rows across hot SQLite app restarts', async () => {
    const rootDir = await createTempRoot();
    const routesDir = join(rootDir, 'server', 'routes');
    const appDir = join(rootDir, 'app');
    const dbPath = join(rootDir, 'data', 'launchboard.db');
    const snapshotPath = join(rootDir, 'data', 'launchboard.snapshot.db');
    const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;
    let firstApp: Awaited<ReturnType<typeof createApp>> | undefined;
    let secondApp: Awaited<ReturnType<typeof createApp>> | undefined;

    try {
      await mkdir(routesDir, { recursive: true });
      await mkdir(appDir, { recursive: true });
      await writeFile(
        join(routesDir, 'launchboard.ts'),
        [
          `import { createServerRoute } from '${serverImport}';`,
          "export default createServerRoute({ name: 'test.launchboard', prefix: '/api/launchboard' })",
          "  .post('/category', ({ zero }) => {",
          "    zero.db.insert('launch_categories', {",
          "      category_id: 'category-persisted',",
          "      name: 'Persisted Category',",
          "      color: 'bg-amber-500',",
          "      sort_order: 0,",
          "    });",
          "    return zero.db.queryOne('launch_categories', 'category-persisted');",
          "  })",
          "  .get('/category', ({ zero, status }) => {",
          "    const row = zero.db.queryOne('launch_categories', 'category-persisted');",
          "    return row ?? status(404, { error: 'missing' });",
          "  });",
          '',
        ].join('\n')
      );

      firstApp = await createHotLaunchboardTestApp({ rootDir, routesDir, appDir, dbPath, snapshotPath });
      firstApp.listen(0);
      const firstBaseUrl = `http://localhost:${firstApp.server!.port}`;
      const writeResponse = await fetch(`${firstBaseUrl}/api/launchboard/category`, { method: 'POST' });
      expect(writeResponse.status).toBe(200);
      await expect(writeResponse.json()).resolves.toEqual({
        category_id: 'category-persisted',
        name: 'Persisted Category',
        color: 'bg-amber-500',
        sort_order: 0,
      });

      await firstApp.stop();
      firstApp = undefined;
      expect(existsSync(snapshotPath)).toBe(true);

      secondApp = await createHotLaunchboardTestApp({ rootDir, routesDir, appDir, dbPath, snapshotPath });
      secondApp.listen(0);
      const secondBaseUrl = `http://localhost:${secondApp.server!.port}`;
      const readResponse = await fetch(`${secondBaseUrl}/api/launchboard/category`);
      expect(readResponse.status).toBe(200);
      await expect(readResponse.json()).resolves.toEqual({
        category_id: 'category-persisted',
        name: 'Persisted Category',
        color: 'bg-amber-500',
        sort_order: 0,
      });
    } finally {
      await firstApp?.stop();
      await secondApp?.stop();
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('mounts durable platform KV for app-owned backend routes and recovers after restart', async () => {
    const rootDir = await createTempRoot();
    const routesDir = join(rootDir, 'server', 'routes');
    const appDir = join(rootDir, 'app');
    const kvDir = join(rootDir, 'data', 'kv');
    const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;

    try {
      await mkdir(routesDir, { recursive: true });
      await mkdir(appDir, { recursive: true });
      await writeFile(
        join(routesDir, 'kv.ts'),
        [
          `import { createServerRoute } from '${serverImport}';`,
          "export default createServerRoute({ name: 'test.kv', prefix: '/api/kv' })",
          "  .post('/write', async ({ zero }) => {",
          "    await zero.kv?.set('demo:message', 'persisted');",
          "    await zero.counter?.increment('demo:hits', 2);",
          "    return { value: zero.kv?.get('demo:message'), hits: zero.counter?.value('demo:hits') ?? 0 };",
          "  })",
          "  .get('/read', ({ zero }) => ({",
          "    mounted: Boolean(zero.kv),",
          "    value: zero.kv?.get('demo:message') ?? null,",
          "    hits: zero.counter?.value('demo:hits') ?? 0,",
          "  }));",
          '',
        ].join('\n')
      );

      const first = await createKvTestApp({ rootDir, routesDir, appDir, kvDir });
      first.listen(0);
      const firstBaseUrl = `http://localhost:${first.server!.port}`;
      const writeResponse = await fetch(`${firstBaseUrl}/api/kv/write`, { method: 'POST' });
      expect(writeResponse.status).toBe(200);
      await expect(writeResponse.json()).resolves.toEqual({ value: 'persisted', hits: 2 });
      await first.stop();

      const second = await createKvTestApp({ rootDir, routesDir, appDir, kvDir });
      second.listen(0);
      const secondBaseUrl = `http://localhost:${second.server!.port}`;
      const readResponse = await fetch(`${secondBaseUrl}/api/kv/read`);
      expect(readResponse.status).toBe(200);
      await expect(readResponse.json()).resolves.toEqual({
        mounted: true,
        value: 'persisted',
        hits: 2,
      });
      await second.stop();
    } finally {
      await cleanupPlatformKvService();
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

async function createHotLaunchboardTestApp(input: {
  rootDir: string;
  routesDir: string;
  appDir: string;
  dbPath: string;
  snapshotPath: string;
}) {
  return createApp({
    db: {
      mode: 'hot',
      path: input.dbPath,
      snapshotPath: input.snapshotPath,
      snapshotIntervalMs: 60_000,
    },
    tables: {
      launch_categories: {
        category_id: 'text primary key',
        name: 'text not null',
        color: 'text not null',
        sort_order: 'integer not null',
      },
    },
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: input.routesDir,
    appDir: input.appDir,
    outDir: join(input.rootDir, `out-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    observability: false,
    auth: false,
    kv: false,
  });
}

async function createKvTestApp(input: {
  rootDir: string;
  routesDir: string;
  appDir: string;
  kvDir: string;
}) {
  return createApp({
    db: { mode: 'memory' },
    tables: {
      notes: {
        note_id: 'text primary key',
        title: 'text not null',
      },
    },
    kv: {
      baseDir: input.kvDir,
      durability: 'always',
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    },
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: input.routesDir,
    appDir: input.appDir,
    outDir: join(input.rootDir, `out-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    observability: false,
    auth: false,
  });
}

async function cleanupPlatformKvService(): Promise<void> {
  const service = getKvService();
  if (!service) return;
  await service.stop();
  clearKvService(service);
}

function cleanupPlatformSQLiteService(): void {
  const service = getPlatformSQLiteService();
  service?.close();
  clearPlatformSQLiteService(service);
}
