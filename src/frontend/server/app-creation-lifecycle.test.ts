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
  test('keeps concurrent bundle and style events bound to their owning app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-create-app-observability-'));
    const eventsA = new MemoryEventStore();
    const eventsB = new MemoryEventStore();
    let appA: Awaited<ReturnType<typeof createApp>> | null = null;
    let appB: Awaited<ReturnType<typeof createApp>> | null = null;

    try {
      const rootA = join(root, 'alpha');
      const rootB = join(root, 'beta');
      await Promise.all([
        mkdir(join(rootA, 'app'), { recursive: true }),
        mkdir(join(rootB, 'app'), { recursive: true }),
      ]);
      [appA, appB] = await Promise.all([
        createApp(config(rootA, {
          app: { name: 'Alpha' },
          kv: { durability: 'memory' },
          observability: { console: false, store: eventsA },
        })),
        createApp(config(rootB, {
          app: { name: 'Beta' },
          kv: { durability: 'memory' },
          observability: { console: false, store: eventsB },
        })),
      ]);

      expect(bundleOutcomeCount(eventsA)).toBe(1);
      expect(styleOutcomeCount(eventsA)).toBe(1);
      expect(bundleOutcomeCount(eventsB)).toBe(1);
      expect(styleOutcomeCount(eventsB)).toBe(1);
      expect(eventsA.query({ code: OBS_CODES.KV_STARTED.code }).count).toBe(1);
      expect(eventsB.query({ code: OBS_CODES.KV_STARTED.code }).count).toBe(1);

      appA.listen(0);
      appB.listen(0);
      expect(eventsA.query({ code: OBS_CODES.KV_STARTED.code }).count).toBe(1);
      expect(eventsB.query({ code: OBS_CODES.KV_STARTED.code }).count).toBe(1);
      await appB.stop();
      appB = null;
      await appA.stop();
      appA = null;
      expect(eventsA.query({ code: OBS_CODES.KV_STOPPED.code }).count).toBe(1);
      expect(eventsB.query({ code: OBS_CODES.KV_STOPPED.code }).count).toBe(1);
    } finally {
      if (appB) await appB.stop();
      if (appA) await appA.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

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
      }).events).toHaveLength(2);
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
      expect(events.query({ code: OBS_CODES.KV_START_FAILED.code }).count).toBe(1);
      expect(events.query({ code: OBS_CODES.KV_STARTED.code }).count).toBe(0);
      expect(events.query({ code: OBS_CODES.KV_STOPPED.code }).count).toBe(0);
      expect(events.query({
        code: OBS_CODES.PERSISTENCE_SQL_CLOSED.code,
      }).events).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

function bundleOutcomeCount(events: MemoryEventStore): number {
  return events.query({ code: OBS_CODES.APP_CLIENT_BUNDLE_READY.code }).count
    + events.query({ code: OBS_CODES.APP_CLIENT_BUNDLE_FAILED.code }).count;
}

function styleOutcomeCount(events: MemoryEventStore): number {
  return events.query({ code: OBS_CODES.APP_STYLES_READY.code }).count
    + events.query({ code: OBS_CODES.APP_STYLES_FAILED.code }).count;
}

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
