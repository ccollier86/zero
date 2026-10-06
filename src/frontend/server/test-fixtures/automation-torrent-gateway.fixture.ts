/** Installed-package proof of an acknowledged trigger start retried after acceptance. */
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import {
  defineDatabaseAutomations, defineDatabaseFunction, defineDatabaseTrigger,
  type DatabaseTriggerFunctionInput,
} from '@zero/framework/database-automations';
import { createApp, type DatabaseAutomationExecutionServerServices } from '@zero/framework/server';
import { expr, flow, step } from '@zero/framework/workflows';

const root = process.cwd();
const attempts: Array<{ orderId: string; instanceId: string; title: unknown }> = [];
const executions: Array<{ orderId: string; title: string }> = [];
const starts = defineDatabaseFunction<DatabaseTriggerFunctionInput, void, DatabaseAutomationExecutionServerServices>({
  name: 'orders.start-processing', version: 1, mode: 'durable',
  async handler({ input, zero }) {
    const acknowledgement = await zero.torrent.start('order-processing', {
      orderId: input.change.rowId, title: input.change.row?.title,
    }, { key: 'process', initialMemory: { originSequence: input.change.sequence } });
    attempts.push({
      orderId: input.change.rowId, instanceId: acknowledgement.instanceId,
      title: input.change.row?.title,
    });
    if (attempts.length === 1) throw new Error('Synthetic lost acknowledgement after accepted start');
  },
});
const automations = defineDatabaseAutomations({
  functions: [starts],
  triggers: [defineDatabaseTrigger({
    name: 'orders.created', version: 1, table: 'orders', after: { insert: true }, run: starts,
  })],
});
const app = await createApp({
  db: { mode: 'file', path: join(root, 'runtime', 'application.db') },
  systemDb: { mode: 'file', path: join(root, 'runtime', 'system.db') },
  tables: { orders: { id: 'text primary key', title: 'text not null' } },
  databaseAutomations: automations,
  workflows: {
    register(registry) {
      registry.registerActivity<{ orderId: string; title: string }>({
        name: 'accept-order', version: '1',
        async handler({ input }) { executions.push(input); return { accepted: true }; },
      });
      registry.create({
        name: 'order-processing', version: 1,
        flow: flow(step('accept', { name: 'accept-order', version: '1' }, { input: expr.input() })),
      });
    },
  },
  auth: true, stateSync: false, email: false, ai: false, vector: false, kv: false,
  pdf: false, sitemap: false, appDir: join(root, 'app'), outDir: join(root, 'build'),
  generatedDir: join(root, 'generated'), serverRoutesDir: join(root, 'routes'),
  serverResourcesDir: false, serverPluginsDir: false, serverEndpointsDir: false,
  serverMiddlewareDir: false, routeAuth: 'explicit', publicPaths: ['/'],
  observability: { console: false, endpoint: false },
});
try {
  app.listen({ hostname: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${app.server!.port}`;
  assert.equal((await fetch(`${base}/proof/orders/order-one`, { method: 'POST' })).status, 200);
  await until(() => attempts.length >= 1);
  assert.equal((await fetch(`${base}/proof/orders/order-one`, { method: 'PATCH' })).status, 200);
  await until(() => attempts.length >= 2 && completedDeliveries() === 1);
  assert.equal(new Set(attempts.map(entry => entry.instanceId)).size, 1);
  assert.ok(attempts.every(entry => entry.title === 'Captured title'));
  assert.deepEqual(executions, [{ orderId: 'order-one', title: 'Captured title' }]);
  assert.equal((await fetch(`${base}/proof/orders/order-two`, { method: 'POST' })).status, 200);
  await until(() => attempts.length >= 3 && completedDeliveries() === 2);
  assert.equal(new Set(attempts.map(entry => entry.instanceId)).size, 2);
  assert.equal(executions.length, 2);
  const system = new Database(join(root, 'runtime', 'system.db'), { readonly: true, strict: true });
  try {
    assert.equal((system.query('SELECT COUNT(*) AS count FROM workflow_instances').get() as { count: number }).count, 2);
    assert.equal((system.query('SELECT COUNT(*) AS count FROM _workflow_system_start_receipts').get() as { count: number }).count, 2);
  } finally { system.close(); }
  console.log('[zero-public-automation-torrent] complete');
} finally { await app.stop(true); }

function completedDeliveries(): number {
  const source = new Database(join(root, 'runtime', 'application.db'), { readonly: true, strict: true });
  try {
    return (source.query("SELECT COUNT(*) AS count FROM _zero_database_automation_outbox WHERE status = 'completed'")
      .get() as { count: number }).count;
  } finally { source.close(); }
}
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'Trigger/Torrent acknowledgement deadline exceeded');
    await Bun.sleep(20);
  }
}
