/** Native memory Guardian/calendar tests. Only physical coordinator/path probes
 * are simulated; no app, process, file, fixture directory or build is created.
 * Deferred hooks always settle in finally before their memory owners close.
 */
import { expect, test } from 'bun:test';
import type { DatabaseCoordinator } from '../databases/database-coordinator';
import type { DatabaseOperation } from '../databases/database-operations';
import { CalendarError } from './error';
import type { CalendarOwnerRecord } from './owner-schema';
import type { CalendarRuntime, CalendarRuntimeSource } from './runtime';
import { composeCalendarRuntimeSources } from './runtime-sources';
import { eventuallyCalendar, memoryCalendarServiceFixture, type MemoryCalendarSession } from './test-support/memory-service-fixture';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function installSource(runtime: CalendarRuntime, callbacks: Partial<CalendarRuntimeSource>) {
  const source: CalendarRuntimeSource = { prepare() {}, wake() {}, async close() {}, ...callbacks };
  (runtime as unknown as { source: CalendarRuntimeSource }).source = source;
  return source;
}
function create(session: MemoryCalendarSession, key: string, label = key) {
  return session.api.resources.create({ label, kind: 'person', timeZone: 'UTC' }, { idempotencyKey: key });
}
const captured = <T>(task: Promise<T>) => task.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));

test('new and established owners await policy readiness before each new canonical write, without a lease or recursive native readiness', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' });
  let calls = 0;
  const prepared: number[] = [];
  installSource(f.runtime, { prepare(owner) { prepared.push(owner.established); }, async ready(owner) {
    calls++;
    expect(Object.isFrozen(owner)).toBe(true); expect(owner.established).toBe(1);
    expect(f.stats().activeLeases).toBe(0);
    expect(f.sourceRows(session.scope, 'calendar_resources')).toHaveLength(calls - 1);
    const native = f.runtime.forIntegrationOwner(owner);
    expect(await native.read<unknown[]>('calendar.integration.policies', {})).toEqual([]);
    expect(await native.command<unknown[]>('calendar.integration.claim', { nonce: 'native-ready-' + calls, leaseMs: 1000, limit: 1 }, { idempotencyKey: 'native-ready-' + calls })).toEqual([]);
    expect(f.stats().activeLeases).toBe(0);
  } });
  const session = f.session('owner', { manager: true });
  try {
    expect(f.stats().ownerRows).toBe(0);
    await create(session, 'first');
    expect(calls).toBe(1); expect(prepared).toEqual([0, 1]);
    await session.api.resources.list(); expect(calls).toBe(1); // Reads never invoke policy readiness.
    await create(session, 'second');
    expect(calls).toBe(2); expect(prepared).toEqual([0, 1]);
    expect(f.runtime.diagnostics()).toMatchObject({ readyingOwners: 0, activeOperations: 0 });
  } finally { await f.close(); }
});

test('logging-only sources do not add receipt preflight or readiness acquisition overhead', async () => {
  const operations: DatabaseOperation[] = [];
  const f = memoryCalendarServiceFixture({ tenancy: 'single', beforeDispatch(operation) { operations.push(operation); } });
  installSource(f.runtime, {});
  try {
    await create(f.session('owner', { manager: true }), 'logging-only');
    expect(operations.filter(operation => operation.type === 'query' && operation.name === 'calendar.receipt')).toHaveLength(1);
    const composite = await composeCalendarRuntimeSources(() => ({ prepare() {}, wake() {}, async close() {} }))({} as DatabaseCoordinator);
    expect(composite.ready).toBeUndefined(); await composite.close();
  } finally { await f.close(); }
});

test('same-owner readiness is single-flight and survives the first requesting user logging out', async () => {
  const f = memoryCalendarServiceFixture(), entered = deferred(), gate = deferred();
  const first = f.session('first', { manager: true }), second = f.session('second', { manager: true });
  let calls = 0;
  try {
    await create(first, 'seed');
    installSource(f.runtime, { async ready(owner) {
      calls++; expect(f.stats().activeLeases).toBe(0); entered.resolve(); await gate.promise;
      f.runtime.forIntegrationOwner(owner).assertCurrent(); // Not the first user's authority.
    } });
    const a = captured(create(first, 'first-waiter'));
    await entered.promise;
    const b = captured(create(second, 'second-waiter'));
    await eventuallyCalendar(() => f.runtime.diagnostics().activeOperations >= 3);
    first.revoke(); expect(f.runtime.diagnostics().readyingOwners).toBe(1); expect(calls).toBe(1);
    gate.resolve();
    const [one, two] = await Promise.all([a, b]);
    expect(one.ok).toBe(false); expect(two.ok).toBe(true);
    if (!one.ok) expect(one.error).not.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN' });
    expect(calls).toBe(1);
    expect(f.sourceRows(second.scope, 'calendar_resources').map(row => row.label)).toEqual(['seed', 'second-waiter']);
    expect(f.runtime.diagnostics()).toMatchObject({ readyingOwners: 0, activeOperations: 0 });
  } finally { gate.resolve(); await f.close(); }
});

test('a waiting owner does not block another owner while readiness concurrency is available', async () => {
  const f = memoryCalendarServiceFixture({ config: { maxActiveDatabases: 2 } }), entered = deferred(), gate = deferred();
  const a = f.session('a', { tenantId: 'a', manager: true }), b = f.session('b', { tenantId: 'b', manager: true });
  const scopes: string[] = [];
  try {
    await create(a, 'seed-a'); await create(b, 'seed-b');
    installSource(f.runtime, { async ready(owner) { scopes.push(owner.scope_id); expect(f.stats().activeLeases).toBe(0);
      if (owner.scope_id === 'tenant:a') { entered.resolve(); await gate.promise; }
    } });
    const first = captured(create(a, 'wait-a')); await entered.promise;
    let secondDone = false;
    const second = captured(create(b, 'progress-b')).then(result => { secondDone = true; return result; });
    await eventuallyCalendar(() => secondDone);
    expect((await second).ok).toBe(true); expect(scopes).toEqual(['tenant:a', 'tenant:b']);
    expect(f.runtime.diagnostics().readyingOwners).toBe(1);
    gate.resolve(); expect((await first).ok).toBe(true);
    expect(f.runtime.diagnostics().readyingOwners).toBe(0);
  } finally { gate.resolve(); await f.close(); }
});

test('pending owner readiness is bounded and capacity failures leave no cached refusal', async () => {
  const f = memoryCalendarServiceFixture({ config: { maxActiveDatabases: 1 } }), entered = deferred(), gate = deferred();
  const a = f.session('a', { tenantId: 'a', manager: true }), b = f.session('b', { tenantId: 'b', manager: true });
  const scopes: string[] = [];
  try {
    await create(a, 'seed-a'); await create(b, 'seed-b');
    installSource(f.runtime, { async ready(owner) { scopes.push(owner.scope_id);
      if (owner.scope_id === 'tenant:a') { entered.resolve(); await gate.promise; }
    } });
    const pending = captured(create(a, 'pending-a')); await entered.promise;
    await expect(create(b, 'retry-b')).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY', outcome: 'not-started' });
    expect(scopes).toEqual(['tenant:a']); expect(f.runtime.diagnostics().readyingOwners).toBe(1);
    gate.resolve(); expect((await pending).ok).toBe(true);
    await create(b, 'retry-b');
    expect(scopes).toEqual(['tenant:a', 'tenant:b']); expect(f.runtime.diagnostics().readyingOwners).toBe(0);
  } finally { gate.resolve(); await f.close(); }
});

test('uncertain policy preparation is a not-started business rejection and the original business key can retry', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' });
  const session = f.session('owner', { manager: true }); let calls = 0;
  installSource(f.runtime, { async ready() { calls++; if (calls === 1) throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); } });
  try {
    await expect(create(session, 'retry-business')).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY', outcome: 'not-started' });
    expect(f.sourceRows(session.scope, 'calendar_resources')).toHaveLength(0);
    expect(f.sourceRows(session.scope, '_calendar_receipts')).toHaveLength(0);
    expect(f.runtime.diagnostics()).toMatchObject({ readyingOwners: 0, activeOperations: 0 });
    expect(f.stats().activeLeases).toBe(0);
    await create(session, 'retry-business'); expect(calls).toBe(2);
    expect(f.sourceRows(session.scope, 'calendar_resources')).toHaveLength(1);
  } finally { await f.close(); }
});

test('current authorized receipt replay bypasses failed readiness but changed canonical intent still rejects', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' });
  const owner = f.session('owner'); let calls = 0;
  try {
    const accepted = await create(owner, 'replay-key', 'original');
    installSource(f.runtime, { async ready() { calls++; throw new Error('Policy currently unavailable.'); } });
    expect(await create(owner, 'replay-key', 'original')).toEqual(accepted);
    // Same principal/key with changed capabilities selects a NEW transport
    // namespace. The real calendar handler, not a cached native replay, must
    // still reject a different digest after readiness was bypassed.
    const manager = f.session('owner', { manager: true });
    await expect(create(manager, 'replay-key', 'changed')).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    expect(f.sourceRows(owner.scope, 'calendar_resources').map(row => row.label)).toEqual(['original']); expect(calls).toBe(0);
    owner.revoke(); await expect(create(owner, 'replay-key', 'original')).rejects.toBeDefined(); expect(calls).toBe(0);
  } finally { await f.close(); }
});

test('readiness physically verifies owner scope on its own lease, while preflight storage failures preserve their domain error', async () => {
  for (const failProof of [1, 2]) {
    const f = memoryCalendarServiceFixture({ tenancy: 'single' }); const session = f.session('owner', { manager: true }); let calls = 0;
    try {
      await create(session, 'seed');
      const record = f.runtime.integrationOwners()[0]!;
      const physical = (f.runtime as unknown as { owner: Pick<DatabaseCoordinator, 'acquireExisting'> }).owner;
      const acquire = physical.acquireExisting.bind(physical); let proofs = 0;
      physical.acquireExisting = async (id, options) => {
        const lease = await acquire(id, options); if (!lease) return lease;
        const execute = lease.execute.bind(lease);
        return { ...lease, execute: async (operation, execution) => {
          const physicalOperation = operation as DatabaseOperation;
          if (physicalOperation.type === 'get' && physicalOperation.table === '_calendar_owner' && ++proofs === failProof) {
            return { value: { owner_id: record.owner_id, scope_id: 'tenant:wrong-physical-scope' }, sequence: { seq: 0 } };
          }
          return execute(operation, execution);
        } };
      };
      installSource(f.runtime, { async ready() { calls++; } });
      await expect(create(session, 'blocked')).rejects.toMatchObject({ code: failProof === 1 ? 'CALENDAR_STATE_INVALID' : 'CALENDAR_NOT_READY', outcome: 'not-started' });
      expect(calls).toBe(0); expect(f.stats().activeLeases).toBe(0); expect(f.runtime.diagnostics().readyingOwners).toBe(0);
      expect(f.sourceRows(session.scope, 'calendar_resources')).toHaveLength(1);
    } finally { await f.close(); }
  }
});

test('close retires caller/owner admission but waits for physical readiness settlement before closing sources and actors', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' }), entered = deferred(), gate = deferred();
  const session = f.session('owner', { manager: true }); let settled = false, sourceClosed = 0;
  installSource(f.runtime, { async ready() { expect(f.stats().activeLeases).toBe(0); entered.resolve(); await gate.promise; settled = true; },
    async close() { expect(settled).toBe(true); expect(f.runtime.diagnostics().readyingOwners).toBe(0); sourceClosed++; } });
  try {
    const pending = captured(create(session, 'never-committed')); await entered.promise;
    const owner = f.runtime.forIntegrationOwner(f.runtime.integrationOwners()[0]!);
    const closing = f.runtime.close();
    expect(owner.signal.aborted).toBe(true); expect(sourceClosed).toBe(0); expect(settled).toBe(false);
    expect(f.runtime.diagnostics()).toMatchObject({ state: 'closing', readyingOwners: 1 }); expect(f.stats().planes).toBe(1);
    gate.resolve(); const rejected = await pending; expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toMatchObject({ code: 'CALENDAR_NOT_READY', outcome: 'not-started' });
    await closing;
    expect(sourceClosed).toBe(1); expect(f.stats().planes).toBe(0);
    expect(f.runtime.diagnostics()).toMatchObject({ state: 'closed', activeOperations: 0, readyingOwners: 0 });
  } finally { gate.resolve(); await f.close(); }
});

test('composed readiness is sequential, retryable, and retains full independent source cleanup', async () => {
  const events: string[] = [], entered = deferred(), gate = deferred(); let fail = true;
  const logging: CalendarRuntimeSource = { prepare() { events.push('prepare:logging'); }, wake() {}, async close() { events.push('close:logging'); } };
  const first: CalendarRuntimeSource = { prepare() {}, wake() {}, async ready() { events.push('ready:first'); entered.resolve(); await gate.promise; if (fail) throw new Error('not ready'); },
    async close() { events.push('close:first'); throw new Error('close first'); } };
  const second: CalendarRuntimeSource = { prepare() {}, wake() {}, async ready() { events.push('ready:second'); }, async close() { events.push('close:second'); } };
  const source = await composeCalendarRuntimeSources(() => logging, () => first, () => second)({} as DatabaseCoordinator);
  try {
    source.prepare({} as CalendarOwnerRecord);
    const preparation = captured(source.ready!({} as CalendarOwnerRecord)); await entered.promise;
    expect(events).toEqual(['prepare:logging', 'ready:first']); gate.resolve(); expect((await preparation).ok).toBe(false);
    expect(events).not.toContain('ready:second'); fail = false; await source.ready!({} as CalendarOwnerRecord);
    expect(events).toEqual(['prepare:logging', 'ready:first', 'ready:first', 'ready:second']);
  } finally { gate.resolve(); await expect(source.close()).rejects.toBeInstanceOf(AggregateError); }
  expect(events.slice(-3)).toEqual(['close:second', 'close:first', 'close:logging']);
  await expect(source.ready!({} as CalendarOwnerRecord)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
});
