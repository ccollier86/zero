/** Real managed recovery after an injected lost bridge return/inspection outage, not SIGKILL or IPC-death qualification. */
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { resolveDatabaseFile } from '../databases/database-file';
import { createApp } from '../frontend/server/app-factory';
import type { AppConfig } from '../frontend/server/types';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { flow, step } from '../workflows/workflow-dsl';
import { workflowDeferredStarts, type WorkflowDeferredStartBridge } from '../workflows/workflow-deferred-start-bridge';
import type { WorkflowDeferredStartInspection } from '../workflows/workflow-deferred-start-contract';
import type { JobOccurrenceView, JobScheduleView } from './contracts';
import { defineJob } from './definition';
import { JobsError } from './error';
import { jobHash, jobJson } from './validation';

type EnqueueArguments = Parameters<WorkflowDeferredStartBridge['enqueue']>;
type StartReceipt = Awaited<ReturnType<WorkflowDeferredStartBridge['enqueue']>>;
interface StartEvidence {
  authority: EnqueueArguments[0]; pin: EnqueueArguments[1]; key: string; binding: string; receipt: StartReceipt;
}
interface Session { accessToken: string; refreshToken: string; user: { userId: string } }
interface OccurrencePage { items: JobOccurrenceView[]; total: number }
interface RetainedOccurrence {
  id: string; state: string; lease_until: number | null; lease_generation: number;
  workflow_id: string | null; receipt_json: string | null; terminal_status: string | null;
}

test('cancelled jobs reconcile the real permanent handoff after creator revocation and restart without replay', async () => {
  const owned = await ownedWorkerFixture('jobs-handoff-recovery');
  // Leave teardown room within the repository's unchanged 120-second test ceiling.
  const deadline = Date.now() + 100_000;
  const systemPath = join(owned.root, 'system.sqlite'), jobsRoot = join(owned.root, 'jobs');
  const jobsPath = resolveDatabaseFile(jobsRoot, 'jobs:' + jobHash('application')).path;
  const committed = deferred<StartEvidence & { inspection: WorkflowDeferredStartInspection | null }>();
  const outageObserved = deferred<void>(), recovered = deferred<StartEvidence>();
  const activityStarts: { instanceId: string; userId: string }[] = [];
  const enqueueCalls = { initial: 0, restarted: 0, system: 0 };
  const injection = { fired: false, outage: false, key: '' };
  const running: { app: Awaited<ReturnType<typeof createApp>> | null; restore: (() => void) | null } = { app: null, restore: null };
  let url = '', startupRetirementConfirmed = true;
  const definition = defineJob({ name: 'synthetic.handoff-recovery', version: '1', access: 'user',
    workflow: { name: 'synthetic.handoff-recovery', version: 1 }, parseInput: value => value });

  const start = async (injectOutage: boolean) => {
    const config: AppConfig = {
      projectRoot: owned.root, db: { mode: 'file', path: join(owned.root, 'application.sqlite') },
      systemDb: { mode: 'file', path: systemPath }, tables: {},
      auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
      jobs: { definitions: [definition], rootDirectory: jobsRoot },
      workflows: {
        register(registry) {
          registry.registerActivity({ name: definition.name, version: '1', handler: async context => {
            context.assertCurrentAuthority();
            if (context.execution.kind !== 'actor') throw new Error('Synthetic job lost its actor authority.');
            activityStarts.push({ instanceId: context.instanceId, userId: context.execution.userId });
            return { completed: true };
          } });
          registry.create({ name: definition.name, version: 1, flow: flow(step('work', { name: definition.name, version: '1' })) });
        },
        onServiceCreated(service) {
          // This is the app-local bridge actually supplied to the managed JobsService.
          // Only observation/return delivery is faulted; every admission, seal,
          // authority check, graph pin, transaction and receipt remains native.
          const bridge = workflowDeferredStarts(service), originalEnqueue = bridge.enqueue, originalInspect = bridge.inspect;
          const enqueue = originalEnqueue.bind(bridge), inspect = originalInspect.bind(bridge);
          bridge.enqueue = async (...args) => {
            enqueueCalls[injectOutage ? 'initial' : 'restarted']++;
            if (args[0].kind === 'system') enqueueCalls.system++;
            const receipt = await enqueue(...args);
            if (injectOutage && !injection.fired) {
              injection.fired = true; injection.key = args[3];
              const inspection = inspect(args[0], args[1], args[2], args[3], args[4]);
              committed.resolve({ authority: args[0], pin: args[1], key: args[3], binding: args[4], receipt, inspection });
              injection.outage = true;
              // The genuine Torrent commit already happened. Its successful
              // return is lost at this injected bridge boundary, not over IPC.
              throw new JobsError('JOBS_OUTCOME_UNKNOWN');
            }
            return receipt;
          };
          bridge.inspect = (...args) => {
            if (injectOutage && injection.outage) {
              outageObserved.resolve();
              // Never forge a null receipt: observation is unavailable, not proof of no start.
              throw new JobsError('JOBS_NOT_READY');
            }
            const inspection = inspect(...args);
            if (!injectOutage && inspection && args[3] === injection.key) recovered.resolve({
              authority: args[0], pin: args[1], key: args[3], binding: args[4], receipt: inspection.receipt,
            });
            return inspection;
          };
          running.restore = () => { bridge.enqueue = originalEnqueue; bridge.inspect = originalInspect; };
        },
      },
      appDir: join(owned.root, 'app'), outDir: join(owned.root, 'out'), storageDir: join(owned.root, 'storage'),
      ai: false, email: false, vector: false, kv: false, pdf: false, observability: false,
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false,
      serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
    };
    try { running.app = await createApp(config); }
    catch (error) {
      if (error instanceof AggregateError) startupRetirementConfirmed = false;
      if (startupRetirementConfirmed) { running.restore?.(); running.restore = null; }
      throw error;
    }
    running.app.listen({ hostname: '127.0.0.1', port: 0 });
    url = 'http://127.0.0.1:' + running.app.server!.port;
  };
  const stop = async () => {
    if (running.app) { await running.app.stop(true); running.app = null; }
    // Keep the outage armed until the first runner is fully drained. Restoring
    // earlier could repair the retained claim during the teardown checkpoint.
    if (startupRetirementConfirmed) { running.restore?.(); running.restore = null; }
  };
  const request = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(url + path, { method, headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now()))) });
    return { status: response.status, body: await response.json() as T };
  };
  const register = async (name: string) => {
    const result = await request<Session>('POST', '/auth/register', {
      username: name, email: name + '@example.test', password: 'Synthetic-Handoff-Password-94!',
    });
    expect(result.status).toBe(200); return result.body;
  };
  const retainedOccurrences = (scheduleId: string) => readOnly(jobsPath, database => database.query(
    'SELECT id,state,lease_until,lease_generation,workflow_id,receipt_json,terminal_status FROM _jobs_occurrences WHERE schedule_id=?',
  ).all(scheduleId) as RetainedOccurrence[]);
  const permanentEvidence = (key: string) => readOnly(systemPath, database => ({
    actors: database.query('SELECT instance_id,name,definition_version FROM _workflow_actor_start_receipts WHERE idempotency_key=?').all(key),
    systems: database.query('SELECT instance_id FROM _workflow_system_start_receipts WHERE idempotency_key=?').all(key),
    workflows: database.query('SELECT instance_id,name,definition_version,status,started_by FROM workflow_instances WHERE name=?').all(definition.name),
  }));

  try {
    await start(true);
    const observer = await register('handoff-observer'), creator = await register('handoff-creator');
    expect(observer.user.userId).not.toBe(creator.user.userId);
    const accepted = await request<JobScheduleView>('POST', '/jobs/enqueue', {
      definition: definition.name, input: { synthetic: true }, idempotencyKey: 'handoff-one', maxLatenessMs: 90_000,
    }, creator.accessToken);
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({ ownerId: creator.user.userId, runAs: 'actor', revision: 1, generation: 1 });
    const original = await bounded(committed.promise, Math.min(deadline, Date.now() + 20_000), 'genuine committed handoff');
    await bounded(outageObserved.promise, Math.min(deadline, Date.now() + 20_000), 'unavailable post-commit inspection');
    expect(original.inspection?.receipt).toEqual(original.receipt);
    expect(original.authority.kind).toBe('actor');
    await until(async () => {
      const result = await request('GET', '/workflows/' + original.receipt.instanceId, undefined, observer.accessToken);
      expect(result.status).toBe(200); return result.body.status === 'completed';
    }, Math.min(deadline, Date.now() + 20_000), 'real activity completion');
    expect(activityStarts).toEqual([{ instanceId: original.receipt.instanceId, userId: creator.user.userId }]);

    const before = await request<OccurrencePage>('GET', '/jobs/schedules/' + accepted.body.id + '/occurrences', undefined, observer.accessToken);
    expect(before.status).toBe(200); expect(before.body.total).toBe(1);
    expect(before.body.items[0]).toMatchObject({ state: 'claimed', workflowId: null });
    const cancelled = await request<JobScheduleView>('POST', '/jobs/schedules/' + accepted.body.id + '/cancel', {
      idempotencyKey: 'handoff-cancel', expectedRevision: accepted.body.revision,
    }, observer.accessToken);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ ownerId: creator.user.userId, control: 'cancelled', revision: 2, generation: 1 });
    expect((await request('POST', '/auth/logout', { refreshToken: creator.refreshToken }, creator.accessToken)).status).toBe(200);
    expect([401, 403]).toContain((await request('GET', '/jobs/receipts/handoff-one', undefined, creator.accessToken)).status);
    await stop();

    // Inspect only this proven synthetic fixture, after all app/actor handles close.
    // No private rows, leases, clock values or receipts are inserted or rewritten.
    const pending = retainedOccurrences(accepted.body.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ state: 'claimed', lease_generation: 1, workflow_id: null, receipt_json: null });
    const leaseUntil = pending[0]!.lease_until;
    if (leaseUntil === null) throw new Error('Synthetic committed handoff did not retain its real claim lease.');
    const durable = permanentEvidence(original.key);
    expect(durable.actors).toEqual([{ instance_id: original.receipt.instanceId, name: definition.name, definition_version: 1 }]);
    expect(durable.systems).toEqual([]);
    expect(durable.workflows).toEqual([{ instance_id: original.receipt.instanceId, name: definition.name,
      definition_version: 1, status: 'completed', started_by: creator.user.userId }]);
    expect(enqueueCalls).toEqual({ initial: 1, restarted: 0, system: 0 });
    expect(Date.now()).toBeLessThan(leaseUntil);

    // Boot overlaps the remaining normal 60-second lease; neither the lease nor
    // the framework clock is shortened/faked to fit the existing test ceiling.
    await start(false);
    expect(Date.now()).toBeLessThan(leaseUntil);
    expect([401, 403]).toContain((await request('GET', '/jobs/receipts/handoff-one', undefined, creator.accessToken)).status);
    while (Date.now() < leaseUntil) {
      if (Date.now() >= deadline) throw new Error('Synthetic real-lease wait exceeded its bounded deadline.');
      await Bun.sleep(Math.max(1, Math.min(500, leaseUntil - Date.now())));
    }
    const recoveryDeadline = Math.min(deadline, leaseUntil + 20_000);
    const reconciled = await bounded(recovered.promise, recoveryDeadline, 'native post-restart receipt reconciliation');
    expect(reconciled).toEqual({ authority: original.authority, pin: original.pin, key: original.key,
      binding: original.binding, receipt: original.receipt });
    let history: OccurrencePage | undefined;
    await until(async () => {
      const result = await request<OccurrencePage>('GET', '/jobs/schedules/' + accepted.body.id + '/occurrences', undefined, observer.accessToken);
      expect(result.status).toBe(200); history = result.body;
      return history.items[0]?.terminalStatus === 'completed';
    }, recoveryDeadline, 'durable occurrence completion');
    expect(history!.total).toBe(1);
    expect(history!.items).toHaveLength(1);
    expect(history!.items[0]).toMatchObject({ id: pending[0]!.id, generation: 1, state: 'terminal',
      workflowId: original.receipt.instanceId, terminalStatus: 'completed', errorCode: null });
    const schedule = await request<JobScheduleView>('GET', '/jobs/schedules/' + accepted.body.id, undefined, observer.accessToken);
    expect(schedule.status).toBe(200);
    expect(schedule.body).toMatchObject({ ownerId: creator.user.userId, runAs: 'actor', control: 'cancelled', revision: 2, generation: 1 });
    expect(activityStarts).toEqual([{ instanceId: original.receipt.instanceId, userId: creator.user.userId }]);
    expect(enqueueCalls).toEqual({ initial: 1, restarted: 0, system: 0 });
    await stop();
    expect(permanentEvidence(original.key)).toEqual(durable);
    expect(retainedOccurrences(accepted.body.id)).toEqual([{ ...pending[0]!, state: 'terminal', lease_until: null,
      lease_generation: 2, workflow_id: original.receipt.instanceId, receipt_json: jobJson(original.receipt), terminal_status: 'completed' }]);
  } finally {
    const failures: unknown[] = [];
    try { await stop(); } catch (error) { failures.push(error); }
    if (!startupRetirementConfirmed || failures.length) {
      throw new AggregateError(failures, 'Handoff recovery fixture retirement was not confirmed; preserving ' + owned.root);
    }
    await owned.cleanup();
  }
}, 120_000);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, deadline: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Synthetic handoff barrier did not settle: ' + label)), Math.max(1, deadline - Date.now()));
  })]); } finally { clearTimeout(timer); }
}
async function until(check: () => Promise<boolean>, deadline: number, label: string): Promise<void> {
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error('Synthetic handoff state did not settle: ' + label);
    await Bun.sleep(250);
  }
}
function readOnly<T>(path: string, read: (database: Database) => T): T {
  const database = new Database(path, { readonly: true });
  try { return read(database); } finally { database.close(); }
}
