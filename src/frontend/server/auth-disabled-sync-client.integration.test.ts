import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

import {
  createPlatformSQLiteService,
} from '../../persistence';
import {
  createClient,
  type Client,
  type InternalClient,
} from '../client/sdk';
import { createApp } from './app-factory';

test('auth-disabled managed client completes its application-only Sync baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-authless-sync-client-'));
  const appDir = join(root, 'app');
  await mkdir(appDir, { recursive: true });
  const application = createPlatformSQLiteService({
    mode: 'file',
    path: join(root, 'application.db'),
  });
  const system = createPlatformSQLiteService({
    mode: 'file',
    path: join(root, 'system.db'),
  });
  let client: Client | null = null;
  const app = await createApp({
    db: { sqlite: application },
    systemDb: { sqlite: system },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    auth: false,
    stateSync: false,
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    resourceRoutes: false,
    appDir,
    outDir: join(root, 'out'),
    generatedDir: join(root, '.zero', 'generated'),
    observability: false,
    email: false,
    ai: false,
    vector: false,
    pdf: false,
    kv: false,
  });

  try {
    app.listen(0);
    client = createClient({
      url: `http://localhost:${app.server!.port}`,
      tables: {
        todos: { _pk: 'id', id: 'text', title: 'text' },
      },
      // This is the browser catalog emitted by an auth-disabled createApp().
      tableSyncPlanes: { todos: 'default' },
      auth: false,
    });
    await (client as InternalClient)._syncClient.waitForAuthorizationBaseline(2_000);

    client.collection('todos').insert({ id: 'todo-one', title: 'Ready' });
    await waitFor(() => application.raw.query(
      "SELECT title FROM todos WHERE id = 'todo-one'",
    ).get() !== null);
    expect(application.raw.query(
      "SELECT id, title FROM todos WHERE id = 'todo-one'",
    ).get()).toEqual({ id: 'todo-one', title: 'Ready' });
  } finally {
    client?.disconnect();
    await app.stop(true);
    application.close();
    system.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Sync mutation.');
    await Bun.sleep(10);
  }
}
