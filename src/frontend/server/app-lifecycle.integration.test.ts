import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { getTokenService } from '../../auth/auth.plugin';
import { getKvService } from '../../kv';
import { getPdfService } from '../../pdf';
import { getSyncDB } from '../../sync/sync.plugin';
import { getVectorStore } from '../../vector';
import { getWorkflowRegistry, getWorkflowService } from '../../workflows';
import { createApp } from './app-factory';
import type { AppConfig } from './types';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

describe('createApp lifecycle ownership', () => {
  test('stop before listen disposes every composed owner exactly once', async () => {
    const root = await testRoot('pre-listen-stop');
    const app = await createApp(testConfig(root));
    const db = getSyncDB();
    const sqlite = db?.getSQLiteService();
    const workflowRegistry = getWorkflowRegistry();
    expect(db).not.toBeNull();
    expect(sqlite).not.toBeNull();
    expect(getWorkflowRegistry()).not.toBeNull();

    let dbDisposals = 0;
    const disposeDB = db!.dispose.bind(db);
    db!.dispose = () => {
      dbDisposals += 1;
      disposeDB();
    };
    let sqliteCloses = 0;
    const closeSQLite = sqlite!.close.bind(sqlite);
    sqlite!.close = () => {
      sqliteCloses += 1;
      closeSQLite();
    };

    await Promise.all([app.stop(), app.stop()]);
    await app.stop();

    expect({ dbDisposals, sqliteCloses }).toEqual({
      dbDisposals: 1,
      sqliteCloses: 1,
    });
    // Other test apps can own process-wide convenience getters concurrently;
    // this stopped app must never remain published as the active owner.
    expect(getSyncDB()).not.toBe(db);
    expect(getWorkflowRegistry()).not.toBe(workflowRegistry);
  }, 60_000);

  test('failed construction restores every older active runtime owner', async () => {
    const firstRoot = await testRoot('older-owner');
    const failingRoot = await testRoot('failed-owner');
    const invalidRoutes = join(failingRoot, 'server', 'routes');
    await mkdir(invalidRoutes, { recursive: true });
    await Bun.write(join(invalidRoutes, 'invalid.ts'), 'export default 42;\n');

    const first = await createApp(testConfig(firstRoot));
    first.listen(0);
    await waitFor(() => Boolean(
      getTokenService()
      && getKvService()
      && getPdfService()
      && getVectorStore()
      && getWorkflowService()
    ));
    const owners = {
      db: getSyncDB(),
      tokens: getTokenService(),
      kv: getKvService(),
      pdf: getPdfService(),
      vectors: getVectorStore(),
      workflowRegistry: getWorkflowRegistry(),
      workflows: getWorkflowService(),
    };

    try {
      await expect(createApp({
        ...testConfig(failingRoot),
        serverRoutesDir: invalidRoutes,
      })).rejects.toThrow();

      expect(getSyncDB()).toBe(owners.db);
      expect(getTokenService()).toBe(owners.tokens);
      expect(getKvService()).toBe(owners.kv);
      expect(getPdfService()).toBe(owners.pdf);
      expect(getVectorStore()).toBe(owners.vectors);
      expect(getWorkflowRegistry()).toBe(owners.workflowRegistry);
      expect(getWorkflowService()).toBe(owners.workflows);
    } finally {
      await first.stop();
    }
  }, 60_000);
});

async function testRoot(name: string): Promise<string> {
  await mkdir(join(process.cwd(), '.zero'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), `.zero/${name}-`));
  cleanupRoots.push(root);
  await mkdir(join(root, 'app'), { recursive: true });
  return root;
}

function testConfig(root: string): AppConfig {
  return {
    app: { publicUrl: 'https://app.test' },
    db: { mode: 'memory' },
    tables: {},
    auth: true,
    workflows: {},
    vector: true,
    pdf: true,
    kv: { durability: 'memory' },
    email: false,
    ai: false,
    appDir: join(root, 'app'),
    outDir: join(root, 'out'),
    migrate: false,
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    resourceRoutes: false,
    observability: false,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Lifecycle condition did not settle');
}
