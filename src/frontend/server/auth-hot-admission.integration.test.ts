/** Real managed hot/on-write Fabric, active outbox, and login without replay/retry. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from './app-factory';
import { authenticatedOnly, defineResource, tenantRealm } from '../../resources';
import { realm, tables } from './test-fixtures/auth-admission-hot/realm';
import { defineZeroPlugin } from './server-extensions';
import type { LoggingRuntime } from '../../logging/logging-runtime';
import { MemoryEventStore, OBS_CODES } from '../../observability';
import { DATABASE_ERROR_CODES } from '../../databases/database-error';
import {
  DATABASE_OBSERVABILITY_MAX_DURATION_MS, DATABASE_OBSERVABILITY_MAX_SLOT,
  DATABASE_OBSERVABILITY_PHASES,
} from '../../databases/database-observability-contract';

test('populated hot actors and outbox work admit repeated login, refresh and protected reads without retries', async () => {
  const scratch = Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'auth-hot-admission-'));
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let logger: LoggingRuntime | null = null;
  const nativeDiagnostics = createNativeDiagnostics();
  const started = performance.now(), stages: unknown[] = [];
  const foregroundAuthMs: number[] = [];
  const reportPath = Bun.env.ZERO_LOGGING_QUALIFICATION_REPORT;
  let reportTask = Promise.resolve();
  const mark = (stage: string) => {
    const diagnostics = logger?.diagnostics();
    stages.push({ stage, elapsedMs: Math.round(performance.now() - started), foregroundAuthMs: [...foregroundAuthMs], sources: diagnostics?.fabricSources,
      pinnedSources: diagnostics?.sources, deliveryWorker: diagnostics?.deliveryWorker, streams: diagnostics?.streams });
    // Optional synthetic phase diagnostics survive a test deadline, including
    // when a shutdown join itself is the phase that needs investigation.
    if (reportPath) { const snapshot = JSON.stringify(stages, null, 2); reportTask = reportTask.then(async () => { await Bun.write(reportPath, snapshot); }); }
  };
  try {
    await mkdir(join(root, 'app'));
    app = await createApp({
      db: { mode: 'file', path: join(root, 'application.db') },
      systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables,
      resources: Object.keys(tables).map(table => defineResource({ table, exposure: 'all', realm: tenantRealm(), policy: authenticatedOnly() })),
      auth: { bootstrap: 'public', registration: { mode: 'public' }, tenancy: 'multi', accountEmails: { passwordReset: false } },
      databaseTopology: { mode: 'multiple', rootDirectory: join(root, 'fabric'), realm,
        tenantIsolation: 'tenant-database', placement: 'hot', readers: false, sweepIntervalMs: false,
        operationTimeoutMs: 20_000,
        actors: { launch: { kind: 'source', entrypoint: fileURLToPath(new URL('./test-fixtures/auth-admission-hot/actor.ts', import.meta.url)) } },
      },
      appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverEndpointsDir: fileURLToPath(new URL('./test-fixtures/auth-admission-hot/endpoints', import.meta.url)),
      serverRoutesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false,
      workflows: false, email: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false,
      observability: { console: false, endpoint: false, store: nativeDiagnostics.events },
      logging: { preset: 'activity', rootDirectory: join(root, 'logging') },
      serverExtensions: [defineZeroPlugin({ name: 'logging-qualification', setup({ zero }) { logger = zero.logging; } })],
    });
    expect(logger!.config.policy.queue.batchSize).toBe(64);
    mark('constructed');
    // Match the synthetic transport lifetime to its 20s actor operation bound.
    // Bun's socket-idle default may otherwise reset an admitted /proof/work
    // while its hot image is publishing. Auth still has the exact 2s assertion.
    app.listen({ hostname: '127.0.0.1', port: 0, idleTimeout: 60 });
    const origin = `http://127.0.0.1:${app.server!.port}`;
    async function request(path: string, body?: unknown, token?: string) {
      const method = body === undefined ? 'GET' : 'POST';
      nativeDiagnostics.mark('request-start', path, method);
      let response: Response | undefined;
      try {
        response = await fetch(`${origin}${path}`, { method,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body) });
        nativeDiagnostics.mark('response-received', path, method, response.status);
        const value = await response.json() as any;
        expect(response.status, 'Native request status').toBe(200);
        return value;
      } catch (error) {
        nativeDiagnostics.mark('request-failed', path, method, response?.status);
        nativeDiagnostics.capture('request-failed');
        throw error;
      }
    }
    const username = 'hot-proof-owner', password = 'Hot-test-password-123';
    const owner = await request('/auth/register', { username, email: 'hot-proof@example.test', password, organizationName: 'Hot proof' });
    mark('registered');
    expect(await request('/proof/seed', {}, owner.accessToken)).toEqual({
      kind: 'command', name: 'proof.seed', output: { functions: 51, invocations: 768, history: 19_448 },
    });
    mark('seeded');
    // Investigations use the separate log-plane WAL reader while ingestion
    // continues. They must not make the source/auth authority wait on history.
    const investigations = (async () => {
      for (let i = 0; i < 64; i++) { await logger!.page('audit', { kind: 'platform' }, { limit: 100 }); await Bun.sleep(5); }
    })().then(() => null, error => error);

    // Each real actor work item owns shared authority until its reply settles.
    // Release it only after a competing auth request has had time to queue.
    let sequence = 0;
    async function withBusyActor<T>(operation: () => Promise<T>): Promise<T> {
      const key = `busy-${sequence++}`, enteredPath = join(root, `${key}.entered`), releasePath = join(root, `${key}.release`);
      const work = request('/proof/work', { enteredPath, releasePath, key }, owner.accessToken);
      const deadline = Date.now() + 5_000;
      while (!(await Bun.file(enteredPath).exists()) && Date.now() < deadline) await Bun.sleep(5);
      expect(await Bun.file(enteredPath).exists()).toBe(true);
      const release = setTimeout(() => { void writeFile(releasePath, 'release'); }, 200);
      try {
        const started = performance.now();
        const result = await operation();
        const elapsedMs = performance.now() - started;
        foregroundAuthMs.push(Math.round(elapsedMs));
        expect(elapsedMs, 'Auth must not wait for the historical audit backlog.').toBeLessThan(2000);
        return result;
      }
      finally { clearTimeout(release); await writeFile(releasePath, 'release'); await work; }
    }
    for (let i = 0; i < 8; i++) {
      const signedIn = await withBusyActor(() => request('/auth/login', { username, password }));
      expect(signedIn.user.userId).toBe(owner.user.userId);
      const renewed = await withBusyActor(() => request('/auth/refresh', { refreshToken: signedIn.refreshToken }));
      expect(renewed.refreshToken).not.toBe(signedIn.refreshToken);
      await request('/api/resources/functions?limit=1', undefined, renewed.accessToken);
      mark('auth-cycle-' + i);
    }
    const denied = await fetch(`${origin}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'wrong-password' }) });
    expect(denied.status).toBe(401);
    expect((await denied.json() as { code: string }).code).toBe('INVALID_CREDENTIALS');
    const investigationError = await investigations; if (investigationError) throw investigationError; mark('investigation-reads-complete');
    // This case durably captures 20,267 actual source mutations. Once valid
    // dense batches really reach the sink (rather than failing its structural
    // budget), FULL source snapshots and audit commits need a separate bounded
    // drain window. The measured login/refresh deadline above stays at 2s.
    const deadline = Date.now() + 90_000;
    let counts = await request('/proof/counts', undefined, owner.accessToken);
    while (counts.deliveries < 51 && Date.now() < deadline) {
      await Bun.sleep(100); counts = await request('/proof/counts', undefined, owner.accessToken);
    }
    mark('deliveries-checked');
    expect(counts, JSON.stringify(stages)).toEqual({ functions: 51, invocations: 768, history: 19_448, deliveries: 51 });
    mark('audit-drain-started');
    const auditDeadline = Date.now() + 240_000;
    // Let the independent worker finish a genuinely large committed backlog.
    // Do not hold a source.flush IPC call open past its 60s control deadline.
    while (logger!.diagnostics().fabricSources?.queued && Date.now() < auditDeadline) await Bun.sleep(50);
    expect(logger!.diagnostics().fabricSources?.queued).toBe(0);
    await logger!.flush();
    mark('audit-drained');
    expect(logger!.diagnostics().fabricSources).toMatchObject({ queued: 0, failed: 0 });
    expect(logger!.diagnostics().streams.audit).toMatchObject({ failed: 0, pendingEvents: 0 });
    expect((await logger!.page('audit', { kind: 'platform' }, { action: 'record.created', limit: 1 })).total).toBe(20_267);
  } finally {
    nativeDiagnostics.capture('before-stop');
    mark('before-stop');
    try { await app?.stop(true); }
    finally {
      nativeDiagnostics.capture('after-stop-attempt');
      mark('stopped');
      await reportTask;
      await rm(root, { recursive: true, force: true });
    }
  }
}, 420_000);

/** Bounded fixture-only diagnostics; never serialize a raw event or caught error. */
function createNativeDiagnostics() {
  const events = new MemoryEventStore({ maxEvents: 128 });
  const stages: { stage: string; route: string; method: string; status?: number }[] = [];
  const definitions = new Map([
    OBS_CODES.DATABASE_COORDINATOR_STARTED, OBS_CODES.DATABASE_COORDINATOR_FAILED,
    OBS_CODES.DATABASE_RUNTIME_OPENED, OBS_CODES.DATABASE_RUNTIME_OPEN_FAILED,
    OBS_CODES.DATABASE_EXECUTOR_FAILED, OBS_CODES.DATABASE_QUEUE_TIMEOUT,
    OBS_CODES.DATABASE_OPERATION_FAILED, OBS_CODES.DATABASE_OPERATION_OUTCOME_UNKNOWN,
    OBS_CODES.DATABASE_HOT_DURABILITY_FAILED, OBS_CODES.DATABASE_AUTOMATION_DISPATCH_FAILED,
    OBS_CODES.RESOURCE_CRUD_FAILED,
  ].map(definition => [definition.code, definition]));
  const errorCodes: ReadonlySet<string> = new Set(DATABASE_ERROR_CODES);
  const phases: ReadonlySet<string> = new Set(DATABASE_OBSERVABILITY_PHASES);
  const outcomes: ReadonlySet<string> = new Set(['not-started', 'not-committed', 'unknown']);
  function routeFor(path: string): string {
    if (["/auth/register","/auth/login","/auth/refresh","/proof/seed","/proof/work","/proof/counts"].includes(path)) return path;
    if (path.startsWith("/api/resources/functions?")) return "/api/resources/functions";
    return 'other';
  }
  return {
    events,
    mark(stage: 'request-start' | 'response-received' | 'request-failed', path: string, method: string, status?: number) {
      stages.push({ stage, route: routeFor(path), method: ['GET', 'POST', 'PATCH'].includes(method) ? method : 'other',
        ...(status === undefined ? {} : { status }) });
      if (stages.length > 32) stages.shift();
    },
    capture(stage: 'request-failed' | 'before-stop' | 'after-stop-attempt') {
      try {
        const nativeEvents = events.query({ limit: 128 }).events.flatMap(event => {
          const definition = definitions.get(event.code);
          if (!definition) return [];
          const input = event.metadata ?? {}, metadata: Record<string, string | number | boolean> = {};
          for (const key of ['errorCode', 'databaseCode'] as const) {
            const value = input[key];
            if (typeof value === 'string' && errorCodes.has(value)) metadata[key] = value;
          }
          const outcome = input.outcome ?? input.databaseOutcome;
          if (typeof outcome === 'string' && outcomes.has(outcome)) metadata.outcome = outcome;
          if (typeof input.retryable === 'boolean') metadata.retryable = input.retryable;
          if (typeof input.durationMs === 'number' && Number.isSafeInteger(input.durationMs)
            && input.durationMs >= 0 && input.durationMs <= DATABASE_OBSERVABILITY_MAX_DURATION_MS) metadata.durationMs = input.durationMs;
          if (typeof input.phase === 'string' && phases.has(input.phase)) metadata.phase = input.phase;
          if (input.role === 'writer' || input.role === 'reader') metadata.role = input.role;
          if (typeof input.slot === 'number' && Number.isSafeInteger(input.slot)
            && input.slot >= 0 && input.slot <= DATABASE_OBSERVABILITY_MAX_SLOT) metadata.slot = input.slot;
          return [{ name: definition.prefix, code: definition.code, metadata }];
        });
        console.error('Synthetic native database diagnostics', JSON.stringify({
          fixture: 'auth-hot-admission', stage, stages, events: nativeEvents,
        }));
      } catch { /* Diagnostics must not replace the original failure or cleanup. */ }
    },
  };
}
