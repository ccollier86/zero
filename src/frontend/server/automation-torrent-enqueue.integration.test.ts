/** Real managed per-source dispatcher proof: slow Torrent work does not occupy the durable automation handoff lane. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineDatabaseAutomations } from '../../database-automations/database-automations';
import { defineDatabaseFunction } from '../../database-automations/database-function';
import { defineDatabaseTrigger } from '../../database-automations/database-trigger';
import type { DatabaseTriggerFunctionInput } from '../../database-automations/database-trigger-input';
import type { ReactiveDB } from '../../sync/reactive-db';
import { flow, step } from '../../workflows/workflow-dsl';
import { expr } from '../../workflows/workflow-expression';
import type { WorkflowService } from '../../workflows/workflow-service';
import { createApp } from './app-factory';
import { defineZeroPlugin } from './server-extensions';
import type { DatabaseAutomationExecutionServerServices } from './database-automation-execution-services';

test('two changes in the same application DB hand off independently while the first AI-like workflow stays blocked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'automation-enqueue-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let release!: () => void, entered!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  const active = new Promise<void>(resolve => { entered = resolve; });
  let db!: ReactiveDB, workflows!: WorkflowService;
  const receipts: { row: string; run: string }[] = [], finished: string[] = [];
  try {
    await mkdir(join(root, 'app'));
    const handoff = defineDatabaseFunction<DatabaseTriggerFunctionInput, void, DatabaseAutomationExecutionServerServices>({
      name: 'messages.handoff', version: 1, mode: 'durable', async handler({ input, zero }) {
        const receipt = await zero.torrent.enqueue('reply', { row: input.change.rowId });
        receipts.push({ row: input.change.rowId, run: receipt.instanceId });
      },
    });
    app = await createApp({ projectRoot: root,
      db: { mode: 'file', path: join(root, 'application.db') }, systemDb: { mode: 'file', path: join(root, 'system.db') },
      tables: { messages: { id: 'text primary key' } }, databaseAutomations: defineDatabaseAutomations({ functions: [handoff],
        triggers: [defineDatabaseTrigger({ name: 'messages.received', version: 1, table: 'messages', after: { insert: true }, run: handoff })] }),
      auth: true, workflows: { register(registry) {
        registry.registerActivity<{ row: string }>({ name: 'reply.act', version: '1', async handler({ input }) {
          if (input.row === 'slow') { entered(); await slow; }
          finished.push(input.row); return { replied: input.row };
        } });
        registry.create({ name: 'reply', version: 1, flow: flow(step('reply', { name: 'reply.act', version: '1' }, { input: expr.input() })) });
      } },
      serverExtensions: [defineZeroPlugin({ name: 'capture-fixture', setup({ zero }) { db = zero.db; workflows = zero.workflows!; } })],
      email: false, ai: false, vector: false, pdf: false, kv: false, sitemap: false,
      logging: { rootDirectory: 'logs' }, observability: { console: false, endpoint: false },
      themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
      appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverResourcesDir: false, serverRoutesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
      resourceRoutes: false,
    });
    app.listen({ hostname: '127.0.0.1', port: 0 });
    db.insert('messages', { id: 'slow' }); db.insert('messages', { id: 'fast' });
    await bounded(active);
    await until(() => receipts.length === 2 && finished.includes('fast'));
    expect(finished).toEqual(['fast']);
    expect(workflows.get(receipts.find(r => r.row === 'slow')!.run)?.status).toBe('running');
    expect(workflows.get(receipts.find(r => r.row === 'fast')!.run)?.status).toBe('completed');
    await until(() => Number((db.prepare("SELECT COUNT(*) AS count FROM _zero_database_automation_outbox WHERE status = 'completed'").get() as { count: number }).count) === 2);
    // Further writes are admitted while slow external work remains outstanding.
    db.insert('messages', { id: 'later' }); await until(() => finished.includes('later'));
    release(); await until(() => finished.includes('slow'));
  } finally { release(); await app?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 30000);

async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 10000;
  while (!check()) { if (Date.now() >= end) throw new Error('Managed enqueue did not make independent progress'); await Bun.sleep(5); }
}
async function bounded(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Workflow did not start')), 10000); })]); }
  finally { clearTimeout(timer); }
}
