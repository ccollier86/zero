/** Managed createApp proof for durable automations in a real Fabric actor. */

import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE,
} from '../../database-automations/automation-source-catalog-schema-sql';
import { createNamedDatabaseRef } from '../../databases/database-binding-ref';
import {
  databaseAutomationActorFixtureRealm,
} from '../../databases/test-fixtures/database-automation-actor-realm';
import { createApp } from './app-factory';

const DATABASE_ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../../databases/test-fixtures/database-automation-actor-entry.ts',
  import.meta.url,
));
const SOURCE_NAME = 'managed-automation-proof';

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

const activeApps = new Set<ManagedApp>();
const roots = new Set<string>();

afterEach(async () => {
  await Promise.allSettled([...activeApps].map((app) => app.stop(true)));
  activeApps.clear();
  await Promise.all([...roots].map((root) =>
    rm(root, { recursive: true, force: true })));
  roots.clear();
}, 30_000);

describe('managed ReactiveDB automations across Fabric', () => {
  test('discovers a named actor source and completes its durable host function', async () => {
    const root = await createRoot();
    const appDir = join(root, 'app');
    const routesDir = join(root, 'server', 'routes');
    const receiptPath = join(root, 'durable-host-receipt.json');
    await Promise.all([
      mkdir(appDir, { recursive: true }),
      mkdir(routesDir, { recursive: true }),
    ]);
    await writeAutomationRoute(routesDir);

    const app = await createApp({
      db: { mode: 'file', path: join(root, 'application.db') },
      systemDb: { mode: 'file', path: join(root, 'system.db') },
      tables: {},
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: join(root, 'fabric'),
        realm: databaseAutomationActorFixtureRealm,
        actors: {
          launch: { kind: 'source', entrypoint: DATABASE_ACTOR_ENTRYPOINT },
        },
        tenantIsolation: 'shared-row',
        readers: false,
        idleTimeoutMs: 60_000,
        sweepIntervalMs: false,
      },
      auth: false,
      workflows: false,
      stateSync: false,
      email: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: routesDir,
      appDir,
      outDir: join(root, 'out'),
      generatedDir: join(root, '.zero', 'generated'),
      observability: { console: false, endpoint: false },
    });
    activeApps.add(app);
    app.listen(0);

    const base = `http://localhost:${app.server!.port}`;
    const mutation = await fetch(`${base}/api/fabric-automation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptPath }),
    });
    expect(mutation.status).toBe(200);
    await expect(mutation.json()).resolves.toEqual({
      orderId: 'order-one',
      rollup: {
        rollup_id: 'rollup-order-one',
        order_id: 'order-one',
        source_sequence: 1,
        state: 'committed',
      },
    });

    expect(readCatalogSource(join(root, 'system.db'))).toEqual({
      source_ref: createNamedDatabaseRef(SOURCE_NAME),
      source_kind: 'named',
      logical_source_id: SOURCE_NAME,
      scope_kind: 'application',
      scope_id: 'application',
      tenant_id: null,
      lifecycle_status: 'active',
    });

    await waitForCompletedDelivery(base, receiptPath);
    await expect(Bun.file(receiptPath).json()).resolves.toMatchObject({
      functionIdentity: 'function:orders.record-delivery@1',
      operation: 'insert',
      rowId: 'order-one',
      scopeKind: 'application',
    });

    await withTimeout(app.stop(true), 10_000, 'managed app shutdown');
    activeApps.delete(app);
  }, 30_000);
});

async function createRoot(): Promise<string> {
  const base = join(process.cwd(), '.zero');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'fabric-automation-e2e-'));
  roots.add(root);
  return root;
}

async function writeAutomationRoute(routesDir: string): Promise<void> {
  const serverImport = pathToFileURL(
    join(process.cwd(), 'src/frontend/server.ts'),
  ).href;
  await Bun.write(join(routesDir, 'fabric-automation.ts'), [
    `import { createServerRoute } from ${JSON.stringify(serverImport)};`,
    `const SOURCE_NAME = ${JSON.stringify(SOURCE_NAME)};`,
    "export default createServerRoute({ name: 'test.fabric-automation', prefix: '/api/fabric-automation' })",
    "  .post('/', async ({ body, zero }) => {",
    "    const manager = zero.unsafe.databases;",
    "    if (!manager) throw new Error('Fabric manager unavailable');",
    '    const receiptPath = (body as { receiptPath?: unknown }).receiptPath;',
    "    if (typeof receiptPath !== 'string') throw new Error('Receipt path unavailable');",
    '    const lease = await manager.acquireNamed(SOURCE_NAME);',
    '    try {',
    '      await lease.execute({',
    "        type: 'mutate',",
    "        idempotencyKey: 'create-order-one',",
    '        mutation: {',
    "          type: 'create',",
    "          table: 'orders',",
    "          row: { order_id: 'order-one', title: 'Proof', receipt_path: receiptPath },",
    '        },',
    '      });',
    '      const result = await lease.execute({',
    "        type: 'get',",
    "        table: 'order_rollups',",
    "        id: 'rollup-order-one',",
    "        consistency: { mode: 'strong' },",
    '      });',
    "      return { orderId: 'order-one', rollup: result.value };",
    '    } finally {',
    '      lease.release();',
    '    }',
    '  })',
    "  .get('/status', async ({ zero }) => {",
    '    const manager = zero.unsafe.databases;',
    "    if (!manager) throw new Error('Fabric manager unavailable');",
    '    const lease = await manager.acquireNamed(SOURCE_NAME);',
    '    try {',
    '      const result = await lease.execute({',
    "        type: 'query',",
    "        name: 'automation.latestDelivery',",
    '        input: null,',
    "        consistency: { mode: 'strong' },",
    '      });',
    '      return result.value;',
    '    } finally {',
    '      lease.release();',
    '    }',
    '  });',
    '',
  ].join('\n'));
}

function readCatalogSource(path: string): Record<string, unknown> | null {
  const database = new Database(path, { readonly: true, strict: true });
  try {
    return database.query(`
      SELECT
        source_ref,
        source_kind,
        logical_source_id,
        scope_kind,
        scope_id,
        tenant_id,
        lifecycle_status
      FROM ${DATABASE_AUTOMATION_SOURCE_CATALOG_TABLE}
      WHERE source_kind = 'named' AND logical_source_id = ?
    `).get(SOURCE_NAME) as Record<string, unknown> | null;
  } finally {
    database.close(false);
  }
}

async function waitForCompletedDelivery(
  base: string,
  receiptPath: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !(await Bun.file(receiptPath).exists())) {
    await Bun.sleep(25);
  }
  let lastStatus: unknown = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/fabric-automation/status`);
    const status = await response.json() as {
      status?: unknown;
      attempt_count?: unknown;
      source_row_id?: unknown;
    } | null;
    lastStatus = status;
    if (status?.status === 'completed') {
      expect(status).toEqual({
        status: 'completed',
        attempt_count: 1,
        source_row_id: 'order-one',
      });
      expect(await Bun.file(receiptPath).exists()).toBe(true);
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for Fabric automation delivery: ${JSON.stringify({
      status: lastStatus,
      receiptExists: await Bun.file(receiptPath).exists(),
    })}`,
  );
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  return await Promise.race([
    operation,
    Bun.sleep(timeoutMs).then(() => {
      throw new Error(`Timed out waiting for ${description}.`);
    }),
  ]);
}
