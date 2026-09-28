import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { getEmailRuntime } from '../../email';
import { getKvService } from '../../kv';
import { MemoryEventStore, OBS_CODES } from '../../observability';
import { defineResource, readOnly } from '../../resources';
import { createApp } from './app-factory';
import type { AppConfig } from './types';

describe.serial('createApp composition lifecycle', () => {
  test('releases owned resources and compatibility providers after early failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-create-app-failure-'));
    const events = new MemoryEventStore();
    let app: Awaited<ReturnType<typeof createApp>> | null = null;

    try {
      await mkdir(join(root, 'app'), { recursive: true });
      await expect(createApp(config(root, {
        app: { name: 'Failed App' },
        observability: { console: false, store: events },
        tables: {
          documents: {
            serverTable: { id: 'text primary key' },
            clientTable: { _pk: 'id', _sync: 'lazy' },
          },
        },
        resources: [defineResource({
          table: 'documents',
          exposure: 'sync',
          policy: readOnly(),
        })],
      }))).rejects.toThrow('lazy Sync hydration requires /api/data');

      expect(events.query({
        code: OBS_CODES.PERSISTENCE_SQL_CLOSED.code,
      }).events).toHaveLength(1);
      expect(getEmailRuntime().app.name).not.toBe('Failed App');

      app = await createApp(config(root, {
        app: { name: 'Surviving App' },
      }));
      expect(getEmailRuntime().app.name).toBe('Surviving App');
      app.listen(0);
      await app.stop();
      app = null;
    } finally {
      if (app) await app.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('does not publish an app when a managed async owner fails to start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-create-app-start-failure-'));
    const events = new MemoryEventStore();

    try {
      await mkdir(join(root, 'app'), { recursive: true });
      const blocked = join(root, 'not-a-directory');
      await Bun.write(blocked, 'file');

      await expect(createApp(config(root, {
        observability: { console: false, store: events },
        kv: {
          baseDir: join(blocked, 'kv'),
          durability: 'everysec',
        },
      }))).rejects.toThrow();

      expect(getKvService()).toBeNull();
      expect(events.query({
        code: OBS_CODES.PERSISTENCE_SQL_CLOSED.code,
      }).events).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

function config(root: string, overrides: Partial<AppConfig>): AppConfig {
  return {
    app: {},
    db: { mode: 'ephemeral' },
    tables: {},
    auth: false,
    email: false,
    migrate: false,
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
    appDir: join(root, 'app'),
    outDir: join(root, 'out'),
    generatedDir: join(root, '.zero', 'generated'),
    observability: false,
    ...overrides,
  };
}
