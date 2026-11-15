/** Real managed jobs → pinned Torrent activity → code-owned native AI adapter. All provider bytes and file-backed state are synthetic. */
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AIService } from '../ai/ai-service';
import { AIDecision } from '../ai/ai-decision-types';
import { resolveAIConfig } from '../ai/ai-env';
import { createApp } from '../frontend/server/app-factory';
import { defineEndpoint } from '../frontend/server/server-extensions';
import type { WorkflowExecutionServerServices } from '../frontend/server/workflow-execution-services';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { DEFAULT_WORK_POOL_CAPACITY, WorkPool } from '../workers/work-pool';
import { flow, step } from '../workflows/workflow-dsl';
import type { JobOccurrenceView, JobScheduleView } from './contracts';
import { defineJob } from './definition';

type Case = 'held' | 'fast' | 'cancelled' | 'successor';
interface Input { kind: Case }
interface Session { accessToken: string; refreshToken: string; user: { userId: string } }
interface Mark { id: string; value: string }
const cases: readonly Case[] = ['held', 'fast', 'cancelled', 'successor'];

test('managed jobs retain bounded native-service occupancy while independent work progresses and retired actors cannot publish late output', async () => {
  const fixture = await ownedWorkerFixture('jobs-native-service'), root = fixture.root;
  const heldRelease = deferred<void>(), cancelledRelease = deferred<void>();
  const probes = Object.fromEntries(cases.map(kind => [kind, {
    submitted: deferred<{ instanceId: string; userId: string; signal: AbortSignal }>(),
    providerEntered: deferred<void>(), lateFence: deferred<string | null>(),
    published: deferred<void>(), settled: deferred<{ code: string | null; aborted: boolean }>(), providerStarted: false,
  }])) as Record<Case, {
    submitted: ReturnType<typeof deferred<{ instanceId: string; userId: string; signal: AbortSignal }>>;
    providerEntered: ReturnType<typeof deferred<void>>; lateFence: ReturnType<typeof deferred<string | null>>;
    published: ReturnType<typeof deferred<void>>; settled: ReturnType<typeof deferred<{ code: string | null; aborted: boolean }>>;
    providerStarted: boolean;
  }>;
  const pools: WorkPool[] = [], providerCalls: Case[] = [], activityCalls: Case[] = [];
  let app: Awaited<ReturnType<typeof createApp>> | null = null, ai: AIService | null = null;
  let startupRetirementConfirmed = true, observerToken = '', wrongActivityVersion = 0, url = '';
  try {
    // Both omitted and "max" settings have a finite native ceiling, not Infinity.
    const defaults = new WorkPool(), maximum = new WorkPool({ concurrency: 'max' });
    pools.push(defaults, maximum);
    expect(defaults.capacity).toBe(DEFAULT_WORK_POOL_CAPACITY);
    expect(maximum.capacity).toBe(DEFAULT_WORK_POOL_CAPACITY);
    expect(Number.isFinite(maximum.capacity)).toBe(true);
    const pool = new WorkPool({ concurrency: 2, maxConcurrentPerKey: 1, maxQueued: 4, maxQueuedPerKey: 2 });
    pools.push(pool);
    const aiConfig = resolveAIConfig({ autoDetect: false, providers: { fixture: {
      type: 'laya', baseURL: 'http://127.0.0.1:1', apiKey: null, decisionLocality: 'local',
      async fetch(endpoint, init) {
        // A startup-captured transport mock: this cannot perform external HTTP or acquire credentials.
        expect(String(endpoint)).toBe('http://127.0.0.1:1/v1/systemone');
        expect(new Headers(init?.headers).has('authorization')).toBe(false);
        const body = JSON.parse(String(init?.body)) as { model: string; state: Input };
        expect(body.model).toBe('native-model');
        const kind = body.state.kind, probe = probes[kind];
        providerCalls.push(kind); probe.providerStarted = true; probe.providerEntered.resolve();
        if (kind === 'held') await heldRelease.promise;
        if (kind === 'cancelled') await cancelledRelease.promise;
        return Response.json({ model: 'synthetic-native-checkpoint', answers: { ready: { type: 'noul', noul: 0.99 } } });
      },
    } }, aliases: { decisions: 'fixture/native-model' } }, {});
    if (!aiConfig) throw new Error('Synthetic native decision configuration did not resolve.');
    const nativeAI = ai = new AIService(aiConfig, { emitCode: () => {} });
    const questions = { ready: AIDecision.yesNo('Is this synthetic record ready?') };
    const definition = defineJob({ name: 'synthetic.native-service', version: '1', access: 'user',
      workflow: { name: 'synthetic.native-service', version: 1 }, parseInput(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1
          || !('kind' in value) || !cases.includes(value.kind as Case)) throw new Error('Invalid synthetic case.');
        return { kind: value.kind as Case };
      } });
    const applicationPath = join(root, 'application.sqlite');
    try {
      app = await createApp({ projectRoot: root,
        db: { mode: 'file', path: applicationPath }, systemDb: { mode: 'file', path: join(root, 'system.sqlite') },
        tables: { native_service_marks: { id: 'TEXT PRIMARY KEY', value: 'TEXT NOT NULL' } },
        auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
        jobs: { definitions: [definition], rootDirectory: join(root, 'jobs') },
        workflows: { register(registry) {
          registry.registerActivity<Input, WorkflowExecutionServerServices>({ name: 'synthetic.native-service', version: '1',
            capabilities: ['ai', 'database'], handler: async context => {
              const kind = context.input.kind, probe = probes[kind]; activityCalls.push(kind);
              let failure: string | null = null;
              try {
                context.assertCurrentAuthority();
                if (context.execution.kind !== 'actor' || !context.signal || !context.zero?.data) throw new Error('Native actor services were not provided.');
                // The fixed adapter captures its model/questions/contract in application code.
                // Raw workflow zero.ai/email/privateObjects remain intentionally unavailable.
                const pending = pool.run(async () => {
                  context.assertCurrentAuthority();
                  // Deliberately uncooperative provider operation: it owns a finite deadline,
                  // but does not receive the attempt abort. WorkPool must retain its physical
                  // slot after cancelling the caller wait until this actual callback settles.
                  const decision = await nativeAI.decisions.evaluate({ state: { kind }, questions,
                    contract: 'synthetic-native-service@1', locality: 'local-only', timeoutMs: 30_000, maxRetries: 0 });
                  try { context.assertCurrentAuthority(); }
                  catch (error) { probe.lateFence.resolve(errorCode(error)); throw error; }
                  return decision.answers.ready.noul >= 0.5 ? 'ready' : 'not-ready';
                }, { signal: context.signal, key: 'native-service:' + context.execution.userId });
                probe.submitted.resolve({ instanceId: context.instanceId, userId: context.execution.userId, signal: context.signal });
                const decision = await pending;
                context.assertCurrentAuthority();
                await context.zero.data.mutate({ type: 'create', table: 'native_service_marks', row: { id: kind, value: decision } },
                  { idempotencyKey: 'native-service:publish:' + kind });
                probe.published.resolve();
                return { decision };
              } catch (error) { failure = errorCode(error); throw error; }
              finally { probe.settled.resolve({ code: failure, aborted: context.signal?.aborted === true }); }
            } });
          // A newer default must not replace the graph's explicit activity pin.
          registry.registerActivity({ name: 'synthetic.native-service', version: '2', default: true,
            handler: async () => { wrongActivityVersion++; throw new Error('Unpinned activity version executed.'); } });
          registry.create({ name: 'synthetic.native-service', version: 1,
            flow: flow(step('decide', { name: 'synthetic.native-service', version: '1' }, { retries: 1 })) });
        } },
        appDir: join(root, 'app'), outDir: join(root, 'out'), storageDir: join(root, 'storage'),
        ai: false, email: false, vector: false, kv: false, pdf: false, observability: false,
        serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false,
        serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
        serverExtensions: [
          defineEndpoint({ method: 'POST', path: '/api/native-service-tick', auth: 'user', async handler({ zero }) {
            zero.access.requirePlatformAdmin(); await zero.unsafe.jobs!.tick(); return { ticked: true };
          } }),
          defineEndpoint({ method: 'POST', path: '/api/native-service-proof', auth: 'user', async handler({ zero }) {
            zero.access.requirePlatformAdmin();
            await zero.data!.mutate({ type: 'create', table: 'native_service_marks', row: { id: 'proof', value: 'independent' } },
              { idempotencyKey: 'native-service:proof' });
            return (await zero.data!.get('native_service_marks', 'proof')).value;
          } }),
          defineEndpoint({ method: 'GET', path: '/api/native-service-marks', auth: 'user', async handler({ zero }) {
            zero.access.requirePlatformAdmin();
            return Object.fromEntries(await Promise.all([...cases, 'proof'].map(async id =>
              [id, (await zero.data!.get('native_service_marks', id)).value])));
          } }),
        ],
      });
    } catch (error) { if (error instanceof AggregateError) startupRetirementConfirmed = false; throw error; }
    app.listen(0); url = 'http://127.0.0.1:' + app.server!.port;
    expect(existsSync(applicationPath)).toBe(true);
    const request = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token = observerToken) => {
      const response = await fetch(url + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as T };
    };
    const register = async (name: string) => {
      const result = await request<Session>('POST', '/auth/register', { username: name, email: name + '@example.test', password: 'Synthetic-Native-Service-94!' });
      expect(result.status).toBe(200); return result.body;
    };
    const observer = await register('native-service-admin'); observerToken = observer.accessToken;
    const heldActor = await register('native-service-held');
    const enqueue = async (kind: Case, token = observerToken) => {
      const result = await request<JobScheduleView>('POST', '/jobs/enqueue', { definition: definition.name, input: { kind },
        idempotencyKey: 'native-service:' + kind }, token);
      expect(result.status).toBe(202);
      expect((await request('POST', '/api/native-service-tick', {})).status).toBe(200);
      return result.body;
    };
    const terminal = async (id: string, expected: string) => {
      // Poll only real durable reads; barriers, not timer sleeps or speed windows, establish ordering.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const result = await request('GET', '/workflows/' + id); expect(result.status).toBe(200);
        if (result.body.status === expected) return result.body;
        await Bun.sleep(10); // Bounded read cadence only; deferred entry/release barriers establish concurrency ordering.
      }
      throw new Error('Synthetic workflow did not reach ' + expected + '.');
    };
    const occurrence = async (scheduleId: string, expected: string) => {
      // Completion reconciliation intentionally polls dispatched work on the native
      // one-second scheduler. A request-count limit would accidentally be a host-speed assertion.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        await request('POST', '/api/native-service-tick', {});
        const result = await request<{ items: JobOccurrenceView[] }>('GET', '/jobs/schedules/' + scheduleId + '/occurrences');
        expect(result.status).toBe(200);
        if (result.body.items[0]?.terminalStatus === expected) return result.body.items[0]!;
        await Bun.sleep(10); // Do not spin HTTP/SQL while waiting for the native completion wake.
      }
      throw new Error('Synthetic occurrence did not reconcile to ' + expected + '.');
    };

    const held = await enqueue('held', heldActor.accessToken);
    await bounded(probes.held.providerEntered.promise, 'held provider entry');
    const heldRun = await bounded(probes.held.submitted.promise, 'held native activity');
    expect(heldRun.userId).toBe(heldActor.user.userId);
    expect(pool.status()).toMatchObject({ capacity: 2, active: 1, queued: 0 });
    const fast = await enqueue('fast');
    await bounded(probes.fast.published.promise, 'independent job publication');
    const fastRun = await bounded(probes.fast.submitted.promise, 'independent native activity');
    expect(fastRun.userId).toBe(observer.user.userId);
    expect((await terminal(fastRun.instanceId, 'completed')).definition_version).toBe(1);
    expect(pool.status()).toMatchObject({ active: 1, queued: 0 });
    const proof = await request<Mark>('POST', '/api/native-service-proof', {});
    expect(proof).toEqual({ status: 200, body: { id: 'proof', value: 'independent' } });
    expect(pool.status().active).toBe(1); // The actual first provider call is still held.

    expect((await request('POST', '/auth/logout', { refreshToken: heldActor.refreshToken }, heldActor.accessToken)).status).toBe(200);
    expect((await request('GET', '/jobs/schedules/' + held.id, undefined, heldActor.accessToken)).status).not.toBe(200);
    heldRelease.resolve();
    expect(await bounded(probes.held.lateFence.promise, 'revoked actor late-output fence')).toBe('WORKFLOW_AUTHORITY_CHANGED');
    expect((await bounded(probes.held.settled.promise, 'revoked actor settlement')).code).toBe('WORKFLOW_AUTHORITY_CHANGED');
    await terminal(heldRun.instanceId, 'failed');
    expect(pool.status()).toMatchObject({ active: 0, queued: 0 });

    const cancelled = await enqueue('cancelled');
    await bounded(probes.cancelled.providerEntered.promise, 'cancellable provider entry');
    const cancelledRun = await bounded(probes.cancelled.submitted.promise, 'cancellable native activity');
    expect((await request('POST', '/workflows/' + cancelledRun.instanceId + '/cancel', {})).status).toBe(200);
    expect(await bounded(probes.cancelled.settled.promise, 'cancelled caller settlement')).toMatchObject({ aborted: true });
    expect(cancelledRun.signal.aborted).toBe(true);
    expect(pool.status()).toMatchObject({ active: 1, queued: 0 });
    const successor = await enqueue('successor');
    const successorRun = await bounded(probes.successor.submitted.promise, 'same-actor queued successor');
    expect(successorRun.userId).toBe(cancelledRun.userId);
    expect(pool.status()).toMatchObject({ capacity: 2, active: 1, queued: 1 });
    expect(probes.successor.providerStarted).toBe(false);
    cancelledRelease.resolve();
    expect(await bounded(probes.cancelled.lateFence.promise, 'cancelled physical callback fence')).toBe('WORKFLOW_AUTHORITY_CHANGED');
    await bounded(probes.successor.published.promise, 'successor after actual callback settlement');
    await terminal(successorRun.instanceId, 'completed');
    await terminal(cancelledRun.instanceId, 'cancelled');
    expect(pool.status()).toMatchObject({ active: 0, queued: 0 });
    expect((await occurrence(held.id, 'failed')).workflowId).toBe(heldRun.instanceId);
    expect((await occurrence(fast.id, 'completed')).workflowId).toBe(fastRun.instanceId);
    expect((await occurrence(cancelled.id, 'cancelled')).workflowId).toBe(cancelledRun.instanceId);
    expect((await occurrence(successor.id, 'completed')).workflowId).toBe(successorRun.instanceId);
    const marks = await request<Record<Case | 'proof', Mark | null>>('GET', '/api/native-service-marks');
    expect(marks.body).toEqual({ held: null, fast: { id: 'fast', value: 'ready' }, cancelled: null,
      successor: { id: 'successor', value: 'ready' }, proof: { id: 'proof', value: 'independent' } });
    // Verify actual application-file bytes, not an observer Map or the redacted public workflow output.
    const evidence = new Database(applicationPath, { readonly: true });
    try { expect(evidence.query('SELECT id,value FROM native_service_marks ORDER BY id').all()).toEqual([
      { id: 'fast', value: 'ready' }, { id: 'proof', value: 'independent' }, { id: 'successor', value: 'ready' },
    ]); } finally { evidence.close(); }
    expect(activityCalls).toEqual([...cases]);
    expect(providerCalls).toEqual([...cases]);
    expect(wrongActivityVersion).toBe(0);
  } finally {
    heldRelease.resolve(); cancelledRelease.resolve();
    const failures: unknown[] = [];
    // Release barriers, then confirm physical callback/app/database/server retirement before deleting only this owned run.
    for (const pool of pools) { try { await pool.close(); } catch (error) { failures.push(error); } }
    try { ai?.decisions.dispose(); } catch (error) { failures.push(error); }
    if (app) { try { await app.stop(true); } catch (error) { failures.push(error); } }
    if (!startupRetirementConfirmed || failures.length) {
      throw new AggregateError(failures, 'Native-service fixture retirement was not confirmed; preserving ' + root);
    }
    await fixture.cleanup();
  }
}, 120_000);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Synthetic barrier did not settle: ' + label)), 20_000);
  })]); } finally { clearTimeout(timer); }
}
function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
}
