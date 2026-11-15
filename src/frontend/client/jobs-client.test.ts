/** Transport boundaries only. Real managed/Fabric/Torrent behavior has separate native integration coverage. */
import { expect, test } from 'bun:test';
import { createJobsClient } from './jobs-client';
import { JobsMutationError } from './jobs-mutation';
import type { FetchInit } from './sdk';
const accepted = { id: 'job_synthetic', definition: 'synthetic.job', definitionVersion: '1', ownerId: 'synthetic-owner', runAs: 'actor', control: 'active',
  revision: 1, generation: 1, createdAt: 1, updatedAt: 1 } as const;
const allowed = { allowed: true, reason: null } as const;
const summary = { ...accepted, nextDueAt: 100, skipped: false, blockedCode: null, latestOccurrence: null, activeOccurrence: null,
  actions: { pause: allowed, cancel: allowed, resume: allowed, update: allowed, runNow: allowed } };
test('jobs SDK preserves logical request identity, copies inputs and maps native control/read routes', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createJobsClient(async <T>(path: string, init?: FetchInit) => { calls.push({ path, init }); return structuredClone(path.includes('/receipts/') ? { receipt: accepted } : accepted) as T; });
  const input = { kind: 'original' };
  const result = client.enqueue('synthetic.job', input, { idempotencyKey: 'request-one' }); input.kind = 'changed';
  expect(await result).toEqual(accepted); expect(calls[0]).toMatchObject({ path: '/jobs/enqueue', init: { method: 'POST', body: { input: { kind: 'original' }, idempotencyKey: 'request-one' } } });
  expect(await client.receipts.get('request-one')).toEqual(accepted);
  await client.schedules.pause('job_synthetic', { idempotencyKey: 'pause-one', expectedRevision: 1 });
  expect(calls[2]).toMatchObject({ path: '/jobs/schedules/job_synthetic/pause', init: { body: { expectedRevision: 1, idempotencyKey: 'pause-one' } } });
});
test('scope replacement retires pending jobs acknowledgments even when transport ignores abort', async () => {
  let complete!: (value: unknown) => void;
  const pending = new Promise(resolve => { complete = resolve; });
  let signal: AbortSignal | null | undefined;
  const client = createJobsClient(async <T>(_path: string, init?: FetchInit) => { signal = init?.signal; return await pending as T; });
  const result = client.enqueue('synthetic.job', {}, { idempotencyKey: 'request-one' });
  client.clear(); expect(signal!.aborted).toBe(true); complete(accepted);
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});
test('uncertain writes are not retried and private/invalid acknowledgments are never published', async () => {
  let calls = 0;
  const client = createJobsClient(async () => { calls++; throw new Error('Synthetic unknown outcome'); });
  const failed = await client.enqueue('synthetic.job', {}, { idempotencyKey: 'request-one' }).catch(error => error);
  expect(failed).toBeInstanceOf(JobsMutationError);
  expect(failed).toMatchObject({ idempotencyKey: 'request-one', outcome: 'unknown', requiresReconciliation: true, requiresSameIdempotencyKey: true });
  expect(String(failed)).not.toContain('Synthetic unknown outcome'); expect(calls).toBe(1);
  const invalid = createJobsClient(async <T>() => ({ ...accepted, input: 'PRIVATE_INPUT' }) as T);
  await expect(invalid.enqueue('synthetic.job', {}, { idempotencyKey: 'request-one' })).rejects.toMatchObject({ outcome: 'unknown', idempotencyKey: 'request-one' });
  let network = 0;
  const quiet = createJobsClient(async <T>() => { network++; return accepted as T; });
  await expect(quiet.enqueue('synthetic.job', {}, { idempotencyKey: 'bad key' })).rejects.toThrow();
  await expect(quiet.schedules.list({ limit: 101 })).rejects.toThrow(); expect(network).toBe(0);
});

test('mutation failures preserve accepted request identity and distinguish explicit native rejection without leaking response bodies', async () => {
  const cases = [
    { status: 409, body: { code: 'JOBS_REVISION_CONFLICT', outcome: 'not-committed' }, outcome: 'not-committed' },
    { status: 429, body: { code: 'JOBS_CAPACITY', outcome: 'not-started' }, outcome: 'not-started' },
    { status: 403, body: { code: 'AUTH_FORBIDDEN' }, outcome: 'not-started' },
    { status: 403, body: { code: 'FORBIDDEN' }, outcome: 'not-started' },
    { status: 401, body: { code: 'UNAUTHORIZED' }, outcome: 'not-started' },
    { status: 428, body: { code: 'LOGGING_ADMISSION_REQUIRED' }, outcome: 'not-started' },
    { status: 503, body: { code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'not-started' }, outcome: 'unknown' },
    { status: 403, body: { code: 'AUTH_FORBIDDEN', outcome: 'unknown' }, outcome: 'unknown' },
    { status: 503, body: { code: 'PRIVATE_OTHER_ERROR', outcome: 'not-started' }, outcome: 'unknown' },
    { status: 403, body: { code: 'AUTH_PRIVATE_RESPONSE_BODY' }, outcome: 'unknown' },
  ];
  for (const scenario of cases) {
    let calls = 0;
    const client = createJobsClient(async () => { calls++; throw Object.assign(new Error('PRIVATE_RESPONSE_MESSAGE'), {
      status: scenario.status, body: { ...scenario.body, error: 'PRIVATE_RESPONSE_BODY', private: 'PRIVATE_CONTENT' },
    }); });
    const failure = await client.schedules.pause('job_synthetic', { expectedRevision: 1, idempotencyKey: 'control-one' }).catch(error => error);
    expect(failure).toBeInstanceOf(JobsMutationError);
    expect(failure).toMatchObject({ idempotencyKey: 'control-one', status: scenario.status, outcome: scenario.outcome, requiresReconciliation: scenario.outcome === 'unknown' });
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_'); expect(String(failure)).not.toContain('PRIVATE_'); expect(calls).toBe(1);
  }
});

test('a late mutation failure keeps the dispatched key even when the caller changes its options', async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise<never>((_resolve, fail) => { reject = fail; });
  const client = createJobsClient(async () => pending);
  const options = { idempotencyKey: 'original-key' };
  const result = client.enqueue('synthetic.job', {}, options);
  options.idempotencyKey = 'changed-key'; reject(new Error('PRIVATE_TRANSPORT_MESSAGE'));
  await expect(result).rejects.toMatchObject({ idempotencyKey: 'original-key', outcome: 'unknown' });
});

test('scope retirement also retires a late rejected response and keeps its mutation identity reconcilable', async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise<never>((_resolve, fail) => { reject = fail; });
  const client = createJobsClient(async () => pending);
  const result = client.enqueue('synthetic.job', {}, { idempotencyKey: 'retired-key' });
  client.clear();
  reject(Object.assign(new Error('PRIVATE_OLD_SCOPE_RESPONSE'), { status: 403, body: { code: 'JOBS_FORBIDDEN', outcome: 'not-started' } }));
  await expect(result).rejects.toMatchObject({ name: 'AbortError', cancelled: true, outcome: 'unknown', idempotencyKey: 'retired-key' });
});

test('live SDK pages stop readers on account replacement and definitive denial does not reconnect', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, cancelled = 0, delivered = 0;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled++; } });
  const client = createJobsClient(async <T>() => accepted as T, async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  const stop = client.schedules.watch(() => { delivered++; });
  try {
    controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value: { items: [summary], total: 1 } }) + '\n\n'));
    const deadline = Date.now() + 1000;
    while (!delivered) { if (Date.now() > deadline) throw new Error('Synthetic jobs stream did not deliver.'); await Bun.sleep(1); }
    client.clear(); await Bun.sleep(5); expect(cancelled).toBe(1); expect(delivered).toBe(1);
  } finally { stop(); }
  let requests = 0, failed = 0;
  const denied = createJobsClient(async <T>() => accepted as T, async () => { requests++; return new Response(null, { status: 403 }); });
  const close = denied.schedules.watch(() => { throw new Error('Denied page must never publish.'); }, { onError() { failed++; } });
  try { await Bun.sleep(15); expect(requests).toBe(1); expect(failed).toBe(1); }
  finally { close(); denied.clear(); }
});

test('live frames expose only a closed invalidation bit and accept older frames without it', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const updates: unknown[] = [];
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const client = createJobsClient(async <T>() => accepted as T,
    async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  const stop = client.schedules.watch((_page, update) => { updates.push(update); });
  try {
    for (const extra of [{}, { invalidated: true }, { invalidated: false }]) controller.enqueue(new TextEncoder().encode(
      'data: ' + JSON.stringify({ version: 1, value: { items: [summary], total: 1 }, ...extra }) + '\n\n'));
    const deadline = Date.now() + 1000;
    while (updates.length < 3) { if (Date.now() > deadline) throw new Error('Synthetic jobs invalidation did not deliver.'); await Bun.sleep(1); }
    expect(updates).toEqual([{ invalidated: false }, { invalidated: true }, { invalidated: false }]);
    expect(updates.every(Object.isFrozen)).toBe(true);
  } finally { stop(); client.clear(); }
});

test('malformed or private live invalidation metadata cannot publish and retires the connection', async () => {
  for (const extra of [{ invalidated: 'PRIVATE_DETAIL' }, { invalidated: null }, { invalidated: { input: 'PRIVATE_INPUT' } },
    { invalidated: true, privateInput: 'PRIVATE_INPUT' }]) {
    let opened = 0, delivered = 0;
    const errors: unknown[] = [];
    const client = createJobsClient(async <T>() => accepted as T, async () => {
      opened++;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(
        'data: ' + JSON.stringify({ version: 1, value: { items: [summary], total: 1 }, ...extra }) + '\n\n')); } }),
      { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const stop = client.schedules.watch(() => { delivered++; }, { onError(error) { errors.push(error); } });
    try {
      const deadline = Date.now() + 1000;
      while (!errors.length) { if (Date.now() > deadline) throw new Error('Synthetic malformed jobs frame did not retire.'); await Bun.sleep(1); }
      await Bun.sleep(5);
      expect(delivered).toBe(0); expect(opened).toBe(1); expect(errors).toHaveLength(1);
      expect(String(errors[0])).not.toContain('PRIVATE_');
    } finally { stop(); client.clear(); }
  }
});

test('operator definition discovery and list/detail summaries use the native wire contract without changing receipt acknowledgments', async () => {
  const definition = { name: 'synthetic.job', version: '1', default: true, ownership: { actor: true, service: false } } as const;
  const client = createJobsClient(async <T>(path: string) => (path === '/jobs/definitions' ? { items: [definition] }
    : path.includes('/receipts/') ? { receipt: accepted }
      : path === '/jobs/schedules' ? { items: [summary], total: 1 }
        : { ...summary, timing: { kind: 'once', at: '2026-12-01T00:00:00.000Z', maxLatenessMs: 60_000 }, overlap: 'skip' }) as T);
  expect(await client.definitions.list()).toEqual({ items: [definition] });
  expect(await client.schedules.list()).toEqual({ items: [summary], total: 1 });
  expect(await client.schedules.get(accepted.id)).toMatchObject({ ...summary, overlap: 'skip' });
  expect(await client.receipts.get('original-key')).toEqual(accepted);
});

test('operator parsing rejects private metadata, malformed action policy and an invalid active-work summary', async () => {
  const variants = [
    { ...summary, privateInput: 'NEVER_PUBLISH' },
    { ...summary, blockedCode: 'PRIVATE_DETAIL' },
    { ...summary, actions: { ...summary.actions, pause: { allowed: true, reason: 'access-denied' } } },
    { ...summary, activeOccurrence: { id: 'occ_one', generation: 1, scheduledAt: 1, state: 'terminal', workflowId: null,
      terminalStatus: 'completed', errorCode: null, createdAt: 1, updatedAt: 1 } },
  ];
  for (const row of variants) {
    const client = createJobsClient(async <T>() => ({ items: [row], total: 1 }) as T);
    await expect(client.schedules.list()).rejects.toThrow('Invalid jobs');
  }
  const privateCatalog = createJobsClient(async <T>() => ({ items: [{ name: 'synthetic.job', version: '1', default: true,
    ownership: { actor: true, service: false }, parser: 'PRIVATE_PARSER' }] }) as T);
  await expect(privateCatalog.definitions.list()).rejects.toThrow('Invalid jobs');
});
