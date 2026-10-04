import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  defineDatabaseAutomations,
} from '../../database-automations/database-automations';
import {
  defineDatabaseFunction,
  type DatabaseDurableFunctionContext,
} from '../../database-automations/database-function';
import {
  defineDatabaseTrigger,
} from '../../database-automations/database-trigger';
import type {
  DatabaseTriggerFunctionInput,
} from '../../database-automations/database-trigger-input';
import type {
  DatabaseTransactionFunctionCapability,
} from '../../database-automations/database-transaction-function-capability';
import { createApp } from './app-factory';
import type {
  DatabaseAutomationExecutionServerServices,
} from './database-automation-execution-services';

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

const activeApps: ManagedApp[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of activeApps.splice(0).reverse()) await app.stop(true);
  for (const root of roots.splice(0).reverse()) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('managed ReactiveDB automations', () => {
  test('commits transaction functions and drains durable application work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-app-automations-'));
    roots.push(root);
    const appDir = join(root, 'app');
    const routesDir = join(root, 'server', 'routes');
    await mkdir(appDir, { recursive: true });
    await mkdir(routesDir, { recursive: true });
    await writeMutationRoute(routesDir);

    const durableContexts: Array<DatabaseDurableFunctionContext<
      DatabaseTriggerFunctionInput,
      DatabaseAutomationExecutionServerServices
    >> = [];
    let resolveDelivery!: () => void;
    const delivered = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    const rollup = defineDatabaseFunction<
      DatabaseTriggerFunctionInput,
      void,
      DatabaseTransactionFunctionCapability
    >({
      name: 'orders.rollup',
      version: 1,
      mode: 'transaction',
      handler: ({ input, transaction }) => {
        transaction.insert('order_rollups', {
          rollup_id: `rollup-${input.change.rowId}`,
          order_id: input.change.rowId,
          state: 'committed',
        });
      },
    });
    const notify = defineDatabaseFunction<
      DatabaseTriggerFunctionInput,
      void,
      DatabaseAutomationExecutionServerServices
    >({
      name: 'orders.notify',
      version: 1,
      mode: 'durable',
      handler: async (context) => {
        durableContexts.push(context);
        resolveDelivery();
      },
    });
    const automations = defineDatabaseAutomations({
      functions: [rollup, notify],
      triggers: [defineDatabaseTrigger({
        name: 'orders.created',
        version: 1,
        table: 'orders',
        after: { insert: true },
        run: [rollup, notify],
      })],
    });

    const app = await createApp({
      db: { mode: 'file', path: join(root, 'application.db') },
      systemDb: { mode: 'file', path: join(root, 'system.db') },
      tables: {
        orders: {
          order_id: 'text primary key',
          title: 'text not null',
        },
        order_rollups: {
          rollup_id: 'text primary key',
          order_id: 'text not null',
          state: 'text not null',
        },
      },
      databaseAutomations: automations,
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
      observability: false,
    });
    activeApps.push(app);
    app.listen(0);

    const base = `http://localhost:${app.server!.port}`;
    const mutation = await fetch(`${base}/api/automation-proof`, {
      method: 'POST',
    });
    expect(mutation.status).toBe(200);
    await expect(mutation.json()).resolves.toEqual({
      order_id: 'order-one',
      state: 'committed',
    });

    await withTimeout(delivered, 5_000);
    const durableContext = durableContexts[0];
    if (!durableContext) throw new Error('Durable context was not captured.');
    expect(durableContext?.input.change).toMatchObject({
      table: 'orders',
      operation: 'insert',
      rowId: 'order-one',
    });
    expect(durableContext?.zero.scope).toMatchObject({
      scopeKind: 'application',
    });
    expect(durableContext?.zero.torrent).toBeTruthy();

    await waitForCompletedDelivery(base);
  }, 20_000);
});

async function writeMutationRoute(routesDir: string): Promise<void> {
  const serverImport = pathToFileURL(
    join(process.cwd(), 'src/frontend/server.ts'),
  ).href;
  await writeFile(join(routesDir, 'automation-proof.ts'), [
    `import { createServerRoute } from '${serverImport}';`,
    "export default createServerRoute({ name: 'test.automation', prefix: '/api/automation-proof' })",
    "  .post('/', ({ zero }) => {",
    "    zero.unsafe.db.insert('orders', { order_id: 'order-one', title: 'Proof' });",
    "    const rollup = zero.unsafe.db.queryOne('order_rollups', 'rollup-order-one');",
    "    return { order_id: rollup?.order_id ?? null, state: rollup?.state ?? null };",
    "  })",
    "  .get('/status', ({ zero }) => zero.unsafe.sql?.raw",
    "    .query(\"SELECT status FROM _zero_database_automation_outbox LIMIT 1\")",
    "    .get() ?? null);",
    '',
  ].join('\n'));
}

async function waitForCompletedDelivery(base: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${base}/api/automation-proof/status`);
    const status = await response.json() as { status?: string } | null;
    if (status?.status === 'completed') return;
    await Bun.sleep(10);
  }
  throw new Error('Durable database function did not complete.');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    Bun.sleep(timeoutMs).then(() => {
      throw new Error('Timed out waiting for durable database function.');
    }),
  ]);
}
