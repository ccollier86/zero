/** Synthetic installed-package consumer. All framework imports are public exports. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, defineEndpoint, defineJob, defineZeroConfig, type AppConfig, type WorkflowExecutionServerServices } from '@zero/framework/server';
import { flow, step } from '@zero/framework/workflows';

export function installedJobsConfig(): AppConfig {
  const root = process.cwd(), state = join(root, 'state');
  const job = defineJob({ name: 'installed.jobs', version: '1', workflow: { name: 'installed.workflow', version: 1 }, access: 'user',
    parseInput(value) {
      const input = value as { kind?: unknown; private?: unknown };
      if (!input || typeof input.kind !== 'string' || !/^[a-z.\-]{1,64}$/.test(input.kind)
        || input.private !== 'NEVER_PUBLISH_INSTALLED_JOB_INPUT') throw new Error('Invalid synthetic input.');
      return { kind: input.kind, private: input.private };
    }, service: { principal: 'installed.jobs', scopes: ['application'], isEligible: () => true } });
  return defineZeroConfig({ projectRoot: root,
    db: { mode: 'file', path: join(state, 'application.sqlite'), synchronous: 'FULL' },
    systemDb: { mode: 'file', path: join(state, 'system.sqlite'), synchronous: 'FULL' },
    tables: { installed_job_marks: { id: 'TEXT PRIMARY KEY', kind: 'TEXT NOT NULL' } },
    auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
    // Deliberately exercise the installed package's default fixed jobs actor,
    // with its default empty child environment. Never launch this app as jobs.
    jobs: { definitions: [job], rootDirectory: join(state, 'jobs') },
    logging: { preset: 'activity', rootDirectory: join(state, 'logging'),
      actors: { launch: { kind: 'source', entrypoint: join(root, 'logging-actor.ts') }, env: {}, executor: { startupTimeoutMs: 30000 } } },
    workflows: { register(registry) {
      registry.registerActivity<{ kind: string }, WorkflowExecutionServerServices>({ name: 'installed.activity', version: '1', capabilities: ['database'], async handler(context) {
        context.assertCurrentAuthority();
        await appendFile(join(root, 'calls.ndjson'), JSON.stringify({ instanceId: context.instanceId, kind: context.input.kind, version: 1, attempt: context.attempt }) + '\n');
        if (!context.zero?.data) throw new Error('The scoped workflow data facade was unavailable.');
        await context.zero.data.mutate({ type: 'create', table: 'installed_job_marks', row: { id: context.instanceId, kind: context.input.kind } },
          { idempotencyKey: 'installed-mark:' + context.instanceId });
        return { completed: true };
      } });
      // One code-owned graph per name is the registry contract. Pin its actual
      // activity version despite a newer default; do not invent a second code
      // graph registration to simulate the database publication API.
      registry.registerActivity({ name: 'installed.activity', version: '2', default: true,
        handler() { throw new Error('The unpinned default activity was selected.'); } });
      registry.create({ name: 'installed.workflow', version: 1, flow: flow(step('work', { name: 'installed.activity', version: '1' }, { retries: 1 })) });
    } },
    serverExtensions: [
      defineEndpoint({ method: 'GET', path: '/qualification/jobs-health', auth: 'user', handler({ zero }) {
        zero.access.requirePlatformAdmin();
        const state = zero.unsafe.jobs!.diagnostics();
        return { gate: state.gate, runner: state.runner };
      } }),
      defineEndpoint({ method: 'POST', path: '/qualification/enqueue', auth: 'user', async handler({ zero, body }) {
        const input = body as { kind: string; idempotencyKey: string };
        return zero.logging!.run(async () => Response.json(await zero.jobs!.enqueue(job,
          { kind: input.kind, private: 'NEVER_PUBLISH_INSTALLED_JOB_INPUT' }, { idempotencyKey: input.idempotencyKey }), { status: 202 }));
      } }),
      defineEndpoint({ method: 'GET', path: '/qualification/marks/:id', auth: 'user', async handler({ zero, params }) {
        zero.access.requirePlatformAdmin();
        if (!params || typeof params !== 'object' || !('id' in params) || typeof params.id !== 'string') throw new Error('A synthetic record identity is required.');
        return zero.data!.get('installed_job_marks', params.id);
      } }),
    ],
    appDir: join(root, 'app'), outDir: join(root, 'public-build'), generatedDir: join(root, 'generated'), storageDir: join(state, 'storage'),
    themeFoundation: 'legacy', migrate: true, ai: false, email: false, vector: false, kv: false, pdf: false, observability: false,
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
  });
}

/** The runner removes state only after this lifecycle owner confirms closure. */
export async function startInstalledJobsFixture(config: AppConfig): Promise<void> {
  const root = process.cwd();
  const marker = JSON.parse(await readFile(join(root, '.storage-synthetic-fixture.json'), 'utf8'));
  if (marker.project !== 'zero-platform' || marker.allocator !== 'src/jobs/test-support/installed-deployment/qualify.ts'
    || marker.kind !== 'synthetic-test-fixture' || typeof marker.run_id !== 'string') throw new Error('Owned synthetic root required.');
  let app: Awaited<ReturnType<typeof createApp>>;
  try { app = await createApp(config); }
  catch (error) {
    // createApp reports AggregateError when failed-startup retirement is not proven.
    if (!(error instanceof AggregateError)) await writeFile(join(root, 'closed.json'), JSON.stringify({ runId: marker.run_id, pid: process.pid, retired: true, startupFailed: true }));
    throw error;
  }
  let closing = false;
  const stop = async () => {
    if (closing) return; closing = true;
    try {
      await app.stop(true);
      await writeFile(join(root, 'closed.json'), JSON.stringify({ runId: marker.run_id, pid: process.pid, retired: true }));
      process.exitCode = 0;
    } catch { process.exitCode = 70; }
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  app.listen({ hostname: '127.0.0.1', port: 0 });
  await appendFile(join(root, 'boots.ndjson'), JSON.stringify({ pid: process.pid }) + '\n');
  await writeFile(join(root, 'ready.json'), JSON.stringify({ runId: marker.run_id, pid: process.pid, port: app.server!.port }));
}
