/** Real managed routes, Guardian sessions, private Fabric subprocess and Torrent. Every byte is synthetic and owned. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from '../frontend/server/app-factory';
import { defineEndpoint } from '../frontend/server/server-extensions';
import type { AppConfig } from '../frontend/server/types';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { flow, step } from '../workflows/workflow-dsl';
import { defineJob } from './definition';

async function fixture(multi = false, file = false, restrictedDefinition = false) {
  const owned = await ownedWorkerFixture('jobs-managed');
  const calls: string[] = [], eligible = { value: true, checks: 0 };
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const definition = defineJob({ name: 'synthetic.job', version: '1', workflow: { name: 'synthetic.work', version: 1 }, access: 'user', parseInput: value => value,
    service: { principal: 'synthetic.jobs', scopes: ['application', 'tenant'], isEligible: () => { eligible.checks++; return eligible.value; } } });
  const restricted = defineJob({ name: 'synthetic.restricted', version: '1', workflow: { name: 'synthetic.work', version: 1 }, access: 'admin', parseInput: value => value });
  const running: { app: Awaited<ReturnType<typeof createApp>> | null } = { app: null };
  let url = '', startupRetirementConfirmed = true;
  try {
    const config: AppConfig = { projectRoot: owned.root, db: file ? { mode: 'file', path: join(owned.root, 'application.sqlite') } : { mode: 'memory' },
      ...(file ? { systemDb: { mode: 'file' as const, path: join(owned.root, 'system.sqlite') } } : {}), tables: {},
      auth: { ...(multi ? { tenancy: 'multi' as const } : {}), bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
      jobs: { definitions: restrictedDefinition ? [definition, restricted] : [definition], rootDirectory: join(owned.root, 'jobs') },
      workflows: { register(registry) {
        registry.registerActivity({ name: 'synthetic.work', version: '1', handler: async context => {
          const input = context.input as { kind: string }; calls.push(input.kind);
          if (input.kind === 'slow') await barrier;
          return { completed: true };
        } });
        registry.create({ name: 'synthetic.work', version: 1, flow: flow(step('work', { name: 'synthetic.work', version: '1' })) });
      } },
      appDir: join(owned.root, 'app'), outDir: join(owned.root, 'out'), storageDir: join(owned.root, 'storage'),
      ai: false, email: false, vector: false, kv: false, pdf: false, observability: false, serverResourcesDir: false,
      serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
      serverExtensions: [defineEndpoint({ method: 'POST', path: '/api/synthetic-tick', auth: 'user', async handler({ zero }) { await zero.unsafe.jobs!.tick(); return { accepted: true }; } }),
        defineEndpoint({ method: 'GET', path: '/api/synthetic-jobs', auth: 'user', handler({ zero }) { return { scoped: !!zero.jobs, diagnostics: zero.unsafe.jobs!.diagnostics() }; } })],
    };
    const start = async () => {
      try { running.app = await createApp(config); }
      catch (error) { if (error instanceof AggregateError) startupRetirementConfirmed = false; throw error; }
      running.app.listen(0); url = 'http://127.0.0.1:' + running.app.server!.port;
    };
    await start();
    const registered = await fetch(url + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'jobs-owner', email: 'jobs-owner@example.test', password: 'Synthetic-Jobs-Password-94!', ...(multi ? { organizationName: 'Synthetic Alpha' } : {}) }) });
    expect(registered.status).toBe(200);
    const tokens = await registered.json() as { accessToken: string; refreshToken: string };
    return { root: owned.root, calls, eligible, tokens, release,
      async restart() { const previous = running.app; if (previous) await previous.stop(true); running.app = null; await start(); },
      open(path: string, signal: AbortSignal) { return fetch(url + path, { headers: { Authorization: 'Bearer ' + tokens.accessToken }, signal }); },
      async request(method: string, path: string, body?: unknown, token = tokens.accessToken) {
        const response = await fetch(url + path, { method, headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const value = await response.json() as any;
        return { status: response.status, body: value };
      },
      async close() {
        release(); if (running.app) await running.app.stop(true);
        if (!startupRetirementConfirmed) throw new Error('Managed startup could not confirm resource retirement; preserving ' + owned.root);
        await owned.cleanup();
      },
    };
  } catch (error) {
    release(); if (running.app) await running.app.stop(true);
    if (!startupRetirementConfirmed) throw new AggregateError([error], 'Managed startup could not confirm resource retirement; preserving ' + owned.root);
    await owned.cleanup(); throw error;
  }
}
async function eventually(check: () => boolean, tick: () => Promise<unknown>, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() >= deadline) throw new Error('Synthetic job did not settle.'); await tick(); await Bun.sleep(5); }
}

test('operator discovery and actions follow real current Guardian ownership without leaking policy or invoking service eligibility', async () => {
  const f = await fixture(false, false, true);
  try {
    const other = await f.request('POST', '/auth/register', { username: 'other-job-owner', email: 'other-job-owner@example.test', password: 'Synthetic-Jobs-Password-95!' });
    expect(other.status).toBe(200); const token = String(other.body.accessToken);
    const catalog = await f.request('GET', '/jobs/definitions', undefined, token);
    expect(catalog.status).toBe(200);
    expect(catalog.body).toEqual({ items: [{ name: 'synthetic.job', version: '1', default: true, ownership: { actor: true, service: true } }] });
    expect((await f.request('GET', '/jobs/definitions')).body.items).toHaveLength(2);
    expect(f.eligible.checks).toBe(0);
    const created = await f.request('POST', '/jobs/schedules', { schedule: { definition: 'synthetic.job', input: { kind: 'owned', private: 'NEVER_IN_OPERATOR_METADATA' },
      timing: { kind: 'once', at: new Date(Date.now() + 3_600_000).toISOString() } }, options: { idempotencyKey: 'owned-schedule' } }, token);
    expect(created.status).toBe(202); expect(Object.keys(created.body)).toHaveLength(10);
    const own = await f.request('GET', '/jobs/schedules/' + created.body.id, undefined, token);
    expect(own.body).toMatchObject({ latestOccurrence: null, activeOccurrence: null, blockedCode: null, skipped: false,
      actions: { resume: { allowed: true, reason: null }, update: { allowed: true, reason: null } } });
    const managed = (await f.request('GET', '/jobs/schedules')).body.items.find((row: any) => row.id === created.body.id);
    expect(managed.actions).toMatchObject({ pause: { allowed: true, reason: null }, cancel: { allowed: true, reason: null },
      resume: { allowed: false, reason: 'owner-required' }, update: { allowed: false, reason: 'owner-required' }, runNow: { allowed: true, reason: null } });
    expect(JSON.stringify(managed)).not.toContain('NEVER_IN_OPERATOR_METADATA'); expect(JSON.stringify(catalog.body)).not.toContain('isEligible');
    expect((await f.request('POST', '/jobs/schedules/' + created.body.id + '/resume', { idempotencyKey: 'no-impersonation', expectedRevision: 1 })).status).toBe(403);
    const now = await f.request('POST', '/jobs/schedules/' + created.body.id + '/runNow', { idempotencyKey: 'independent-run', expectedRevision: 1 });
    expect(now.status).toBe(200); expect(now.body.ownerId).not.toBe(created.body.ownerId); expect(Object.keys(now.body)).toHaveLength(10);
    expect((await f.request('GET', '/jobs/schedules/' + now.body.id, undefined, token)).status).toBe(404);
    expect(f.eligible.checks).toBe(0);
  } finally { await f.close(); }
}, 120_000);

test('live operator pages report completion and a real eligibility stop without manufacturing a schedule revision', async () => {
  const f = await fixture(), owner = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const actor = await f.request('POST', '/jobs/enqueue', { definition: 'synthetic.job', input: { kind: 'slow' }, idempotencyKey: 'live-completion' });
    expect(actor.status).toBe(202); await eventually(() => f.calls.includes('slow'), () => f.request('POST', '/api/synthetic-tick'));
    const service = await f.request('POST', '/jobs/schedules', { schedule: { definition: 'synthetic.job', ownership: 'service', input: { kind: 'blocked-live' },
      timing: { kind: 'once', at: new Date(Date.now() + 2000).toISOString() } }, options: { idempotencyKey: 'live-eligibility' } });
    expect(service.status).toBe(202);
    const response = await f.open('/jobs/schedules/live', AbortSignal.any([owner.signal, AbortSignal.timeout(30_000)]));
    expect(response.status).toBe(200); reader = response.body!.getReader();
    const decoder = new TextDecoder(); let buffered = '';
    const packet = async () => {
      for (;;) {
        const end = buffered.indexOf('\n\n');
        if (end >= 0) { const message = buffered.slice(0, end); buffered = buffered.slice(end + 2); return JSON.parse(message.split('\n').find(line => line.startsWith('data:'))!.slice(5)); }
        const next = await reader!.read(); if (next.done) throw new Error('Synthetic live summary ended before expected evidence.'); buffered += decoder.decode(next.value, { stream: true });
      }
    };
    expect((await packet()).value.total).toBe(2);
    f.eligible.value = false; f.release();
    let completed = false, blocked = false;
    while (!completed || !blocked) {
      const result = await packet(); expect(result.error).not.toBe(true);
      const a = result.value.items.find((row: any) => row.id === actor.body.id), b = result.value.items.find((row: any) => row.id === service.body.id);
      if (a?.latestOccurrence?.terminalStatus === 'completed') { completed = true; expect(a.revision).toBe(1); expect(a.activeOccurrence).toBeNull(); }
      if (b?.blockedCode === 'JOBS_AUTHORITY_RETIRED') { blocked = true; expect(b.revision).toBe(1); expect(b.latestOccurrence.state).toBe('blocked'); expect(b.activeOccurrence).toBeNull(); }
    }
    expect(f.calls).not.toContain('blocked-live');
  } finally { owner.abort(); await reader?.cancel().catch(() => {}); reader?.releaseLock(); await f.close(); }
}, 120_000);
test('managed enqueue uses permanent semantic receipts, public views omit secrets, and slow work does not hold unrelated admission', async () => {
  const f = await fixture();
  try {
    const command = { definition: 'synthetic.job', input: { kind: 'slow', private: 'NEVER_PUBLISH' }, idempotencyKey: 'slow-one' };
    const first = await f.request('POST', '/jobs/enqueue', command);
    expect(first.status).toBe(202); expect(first.body).toMatchObject({ runAs: 'actor', control: 'active', revision: 1 });
    await eventually(() => f.calls.includes('slow'), () => f.request('POST', '/api/synthetic-tick'));
    expect(await f.request('POST', '/jobs/enqueue', command)).toEqual(first);
    expect((await f.request('POST', '/jobs/enqueue', { ...command, input: { kind: 'different' } })).body).toMatchObject({ code: 'JOBS_INTENT_CONFLICT', outcome: 'not-started' });
    const fast = await f.request('POST', '/jobs/enqueue', { definition: 'synthetic.job', input: { kind: 'fast' }, idempotencyKey: 'fast-one' });
    expect(fast.status).toBe(202);
    await eventually(() => f.calls.includes('fast'), () => f.request('POST', '/api/synthetic-tick'));
    expect(f.calls.filter(kind => kind === 'slow')).toHaveLength(1);
    const schedules = await f.request('GET', '/jobs/schedules');
    expect(schedules.status).toBe(200); expect(schedules.body.total).toBe(2);
    expect(JSON.stringify(schedules.body)).not.toContain('NEVER_PUBLISH'); expect(JSON.stringify(schedules.body)).not.toContain('authority');
    expect((await f.request('GET', '/jobs/receipts/slow-one')).body.receipt).toEqual(first.body);
    expect((await f.request('POST', '/jobs/enqueue', { ...command, idempotencyKey: 'bad-scope', scopeId: 'tenant:other' })).status).toBe(422);
    const status = await f.request('GET', '/api/synthetic-jobs'); expect(status.body.scoped).toBe(true);
    expect(status.body.diagnostics.persistence.filesBound).toBe(1); expect(existsSync(join(f.root, 'jobs'))).toBe(true);
  } finally { await f.close(); }
}, 120_000);

test('native live pages follow actual committed controls and end on revocation instead of retaining an authorized snapshot', async () => {
  const f = await fixture(), owner = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await f.open('/jobs/schedules/live', AbortSignal.any([owner.signal, AbortSignal.timeout(30_000)]));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/event-stream');
    reader = response.body!.getReader();
    const decoder = new TextDecoder(); let buffered = '';
    const packet = async () => {
      for (;;) {
        const end = buffered.indexOf('\n\n');
        if (end >= 0) { const message = buffered.slice(0, end); buffered = buffered.slice(end + 2); return JSON.parse(message.split('\n').find(line => line.startsWith('data:'))!.slice(5)); }
        const next = await reader!.read(); if (next.done) throw new Error('Synthetic stream closed before its expected projection.'); buffered += decoder.decode(next.value, { stream: true });
      }
    };
    expect((await packet()).value.total).toBe(0);
    const created = await f.request('POST', '/jobs/schedules', { schedule: { definition: 'synthetic.job', input: { kind: 'live', private: 'NEVER_IN_STREAM' },
      timing: { kind: 'once', at: new Date(Date.now() + 3_600_000).toISOString() } }, options: { idempotencyKey: 'live-one' } });
    expect(created.status).toBe(202);
    const changed = await packet(); expect(changed.value.total).toBe(1); expect(changed.value.items[0].id).toBe(created.body.id);
    expect(JSON.stringify(changed)).not.toContain('NEVER_IN_STREAM');
    expect((await f.request('POST', '/auth/logout', { refreshToken: f.tokens.refreshToken })).status).toBe(200);
    expect(await packet()).toMatchObject({ version: 1, error: true });
    expect((await reader.read()).done).toBe(true);
  } finally { owner.abort(); await reader?.cancel().catch(() => {}); reader?.releaseLock(); await f.close(); }
}, 120_000);
test('future controls are revisioned, duplicate-safe, and cancellation prevents a new handoff without deleting history', async () => {
  const f = await fixture();
  try {
    const created = await f.request('POST', '/jobs/schedules', { schedule: { definition: 'synthetic.job', input: { kind: 'future' }, timing: { kind: 'once', at: new Date(Date.now() + 3_600_000).toISOString() } }, options: { idempotencyKey: 'future-one' } });
    expect(created.status).toBe(202);
    const id = created.body.id, pause = { idempotencyKey: 'pause-one', expectedRevision: 1 };
    const paused = await f.request('POST', '/jobs/schedules/' + id + '/pause', pause);
    expect(paused.status).toBe(200); expect(paused.body).toMatchObject({ control: 'paused', revision: 2 });
    expect(await f.request('POST', '/jobs/schedules/' + id + '/pause', pause)).toEqual(paused);
    expect((await f.request('POST', '/jobs/schedules/' + id + '/resume', { idempotencyKey: 'stale', expectedRevision: 1 })).body.code).toBe('JOBS_REVISION_CONFLICT');
    const resumed = await f.request('POST', '/jobs/schedules/' + id + '/resume', { idempotencyKey: 'resume-one', expectedRevision: 2 });
    expect(resumed.body).toMatchObject({ control: 'active', revision: 3, generation: 2 });
    const cancelled = await f.request('POST', '/jobs/schedules/' + id + '/cancel', { idempotencyKey: 'cancel-one', expectedRevision: 3 });
    expect(cancelled.body).toMatchObject({ control: 'cancelled', revision: 4 });
    await f.request('POST', '/api/synthetic-tick'); expect(f.calls).toEqual([]);
    expect((await f.request('GET', '/jobs/schedules/' + id)).body.control).toBe('cancelled');
    expect((await f.request('GET', '/jobs/schedules/' + id + '/occurrences')).body.total).toBe(0);
    expect((await f.request('POST', '/jobs/schedules/' + id + '/resume', { idempotencyKey: 'revive', expectedRevision: 4 })).body.code).toBe('JOBS_STAGE_CONFLICT');
  } finally { await f.close(); }
}, 120_000);
test('explicit service ownership has a live eligibility fence and actor revocation never falls back to SYSTEM', async () => {
  const f = await fixture();
  try {
    f.eligible.value = false;
    const denied = await f.request('POST', '/jobs/enqueue', { definition: 'synthetic.job', input: { kind: 'never' }, ownership: 'service', idempotencyKey: 'denied-service' });
    expect(denied.status).toBe(403); expect(denied.body.code).toBe('JOBS_AUTHORITY_RETIRED');
    expect((await f.request('GET', '/jobs/schedules')).body.total).toBe(0);
    const queued = await f.request('POST', '/jobs/schedules', { schedule: { definition: 'synthetic.job', input: { kind: 'revoked-actor' }, timing: { kind: 'once', at: new Date(Date.now() + 1200).toISOString() } }, options: { idempotencyKey: 'revoke-one' } });
    expect(queued.status).toBe(202);
    expect((await f.request('POST', '/auth/logout', { refreshToken: f.tokens.refreshToken })).status).toBe(200);
    await Bun.sleep(1800);
    expect(f.calls).toEqual([]);
    expect((await f.request('GET', '/jobs/schedules')).status).not.toBe(200);
  } finally { await f.close(); }
}, 120_000);

test('native tenant scope partitions identical logical keys and rejects cross-tenant inspection/control', async () => {
  const f = await fixture(true);
  try {
    const second = await f.request('POST', '/auth/register', { username: 'jobs-other', email: 'jobs-other@example.test', password: 'Synthetic-Jobs-Password-94!', organizationName: 'Synthetic Beta' });
    expect(second.status).toBe(200); const token = String(second.body.accessToken);
    const command = { schedule: { definition: 'synthetic.job', input: { kind: 'scoped' }, timing: { kind: 'once', at: new Date(Date.now() + 3_600_000).toISOString() } }, options: { idempotencyKey: 'same-key' } };
    const a = await f.request('POST', '/jobs/schedules', command), b = await f.request('POST', '/jobs/schedules', command, token);
    expect(a.status).toBe(202); expect(b.status).toBe(202); expect(a.body.id).not.toBe(b.body.id);
    expect((await f.request('GET', '/jobs/schedules')).body.total).toBe(1);
    expect((await f.request('GET', '/jobs/schedules', undefined, token)).body.total).toBe(1);
    expect((await f.request('GET', '/jobs/schedules/' + a.body.id, undefined, token)).status).toBe(404);
    expect((await f.request('POST', '/jobs/schedules/' + a.body.id + '/cancel', { idempotencyKey: 'cross-tenant', expectedRevision: 1 }, token)).status).toBe(404);
    expect((await f.request('GET', '/jobs/schedules/' + a.body.id)).body.control).toBe('active');
    const status = await f.request('GET', '/api/synthetic-jobs'); expect(status.body.diagnostics.persistence.filesBound).toBe(2);
  } finally { await f.close(); }
}, 120_000);

test('a real file-backed managed restart runs the retained future occurrence once through its native timer', async () => {
  const f = await fixture(false, true);
  try {
    const command = { schedule: { definition: 'synthetic.job', input: { kind: 'after-restart' }, timing: { kind: 'once', at: new Date(Date.now() + 10_000).toISOString() } }, options: { idempotencyKey: 'restart-one' } };
    const created = await f.request('POST', '/jobs/schedules', command); expect(created.status).toBe(202);
    expect(f.calls).toEqual([]);
    await f.restart();
    // No synthetic tick endpoint: actual code-registered timer and retained wake catalog discover the occurrence.
    await eventually(() => f.calls.includes('after-restart'), () => Bun.sleep(50), 30_000);
    let page = (await f.request('GET', '/jobs/schedules/' + created.body.id + '/occurrences')).body;
    await eventually(() => page.items[0]?.terminalStatus === 'completed', async () => {
      await Bun.sleep(50); page = (await f.request('GET', '/jobs/schedules/' + created.body.id + '/occurrences')).body;
    });
    expect(page.total).toBe(1); expect(page.items[0]).toMatchObject({ state: 'terminal', terminalStatus: 'completed', generation: 1 });
    expect(page.items[0].workflowId).toBeString();
    expect(await f.request('POST', '/jobs/schedules', command)).toEqual(created);
    await f.restart();
    expect((await f.request('GET', '/jobs/schedules/' + created.body.id + '/occurrences')).body.items).toEqual(page.items);
    expect(f.calls).toEqual(['after-restart']);
  } finally { await f.close(); }
}, 120_000);

test('deliberate service jobs survive creator logout but a changed live eligibility policy prevents the next handoff', async () => {
  const f = await fixture();
  try {
    const create = (kind: string, delay: number) => f.request('POST', '/jobs/schedules', { schedule: { definition: 'synthetic.job', ownership: 'service',
      input: { kind }, timing: { kind: 'once', at: new Date(Date.now() + delay).toISOString() } }, options: { idempotencyKey: kind } });
    const first = await create('service-lifetime', 8000); expect(first.status).toBe(202); expect(first.body.runAs).toBe('service');
    expect((await f.request('POST', '/auth/logout', { refreshToken: f.tokens.refreshToken })).status).toBe(200);
    const signedIn = await f.request('POST', '/auth/login', { username: 'jobs-owner', password: 'Synthetic-Jobs-Password-94!' }); expect(signedIn.status).toBe(200);
    f.tokens.accessToken = signedIn.body.accessToken; f.tokens.refreshToken = signedIn.body.refreshToken;
    await eventually(() => f.calls.includes('service-lifetime'), () => Bun.sleep(50));
    const second = await create('service-retired', 2000); expect(second.status).toBe(202);
    f.eligible.value = false;
    let page: any = { items: [] };
    await eventually(() => page.items[0]?.state === 'blocked', async () => {
      await Bun.sleep(50); page = (await f.request('GET', '/jobs/schedules/' + second.body.id + '/occurrences')).body;
    });
    expect(page.items[0]).toMatchObject({ state: 'blocked', errorCode: 'JOBS_AUTHORITY_RETIRED', workflowId: null });
    expect((await f.request('GET', '/jobs/schedules/' + second.body.id)).body.blockedCode).toBe('JOBS_AUTHORITY_RETIRED');
    expect(f.calls).toEqual(['service-lifetime']);
  } finally { await f.close(); }
}, 120_000);
