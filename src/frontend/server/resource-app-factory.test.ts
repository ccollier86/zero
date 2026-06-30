/**
 * resource-app-factory.test.ts
 *
 * Verifies createApp wires app-owned resource definitions into the resource
 * registry. This test covers startup composition only; resource CRUD, /api/data,
 * and sync enforcement are covered by later Phase 5 slices.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'bun:test';

import { clearKvService, getKvService } from '../../kv';
import { clearPlatformSQLiteService, getPlatformSQLiteService } from '../../persistence';
import { defineResource, getResourceRegistry, readOnly } from '../../resources';
import { createApp } from './app-factory';

async function createTempRoot(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, 'test-resource-app-'));
}

describe('createApp resource registration', () => {
  test('registers inline and package-mode resource definitions', async () => {
    const rootDir = await createTempRoot();
    const resourcesDir = join(rootDir, 'server', 'resources');
    const appDir = join(rootDir, 'app');
    const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;

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

      await createApp({
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

      const registry = getResourceRegistry();
      expect(registry.getByTable('tickets')?.primaryKey).toBe('ticket_id');
      expect(registry.getByTable('projects')?.primaryKey).toBe('project_id');
    } finally {
      cleanupPlatformSQLiteService();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('exposes the shared platform SQL service to app-owned backend routes', async () => {
    const rootDir = await createTempRoot();
    const routesDir = join(rootDir, 'server', 'routes');
    const appDir = join(rootDir, 'app');
    const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;

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

      const app = await createApp({
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

      const response = await app.handle(new Request('http://localhost/api/sql', {
        method: 'POST',
      }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        note_id: 'note_1',
        title: 'Shared SQL',
      });

      cleanupPlatformSQLiteService();
    } finally {
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
