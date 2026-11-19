/** Actual MEMORY SYSTEM catalog plus explicit private-owner protocol doubles.
 * These qualify bounded residency/lifetimes, not physical file readiness/cost.
 * Native Calendar/Jobs attach qualification lives in integration-coordinator.test. */
import { expect, test } from 'bun:test';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { createReactiveDB } from '../sync/reactive-db';
import { CalendarError } from './error';
import { CalendarIntegrationCoordinator, type CalendarIntegrationWakeScheduler } from './integration-coordinator';
import type { CalendarIntegrationCommand, CalendarIntegrationOwner, CalendarIntegrationQuery, CalendarIntegrationReadOptions } from './integration-runtime';
import { CalendarIntegrationWakeCatalog, installCalendarIntegrationWakeCatalog } from './integration-wake-catalog';
import { installCalendarOwnerSchema, type CalendarOwnerRecord } from './owner-schema';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const capture = <T>(task: Promise<T>) => task.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
async function until(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 0)); } throw new Error('MEMORY condition did not settle.'); }
function scheduler() {
  type Definition = Parameters<CalendarIntegrationWakeScheduler['scheduleAt']>[0];
  const pending = new Map<string, Definition>(); let max = 0;
  return { pending, max: () => max,
    scheduleAt(definition: Definition) { if (pending.has(definition.name)) throw new Error('Duplicate native wake'); pending.set(definition.name, definition); max = Math.max(max, pending.size);
      return { cancel() { if (pending.get(definition.name) === definition) pending.delete(definition.name); } }; },
    async fire(now: number) { const next = [...pending.values()].sort((a, b) => a.at - b.at)[0]; if (!next || next.at > now) return false;
      pending.delete(next.name); await next.run({ signal: new AbortController().signal }); return true; },
  };
}
async function fixture(count: number, maxOwners = 3) {
  const system = createReactiveDB({ mode: 'memory' }), lifetime = new AbortController();
  const controllers: CalendarIntegrationCoordinator[] = [], records: CalendarOwnerRecord[] = [], seen = new Map<string, number>();
  let coordinator: CalendarIntegrationCoordinator | undefined, beforeVerify: ((id: string) => Promise<void>) | undefined;
  let beforeDetach: (() => void) | undefined;
  const refused = new Set<string>(); let detachBusy = false, detachCalls = 0, discoverCalls = 0;
  const now = 1000, root = 'a'.repeat(64);
  try {
    system.getRawDatabase().run('PRAGMA temp_store=MEMORY'); system.getRawDatabase().run('PRAGMA foreign_keys=ON');
    installCalendarOwnerSchema(system, true);
    for (let i = 0; i < count; i++) {
      const record = { id: 'calendar:' + String(i).padStart(5, '0'), owner_id: 'cal_synthetic-' + i,
        scope_id: 'tenant:synthetic-' + i, root_hash: root, realm_fingerprint: 'sha256:' + 'b'.repeat(64), established: 1 };
      system.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,1)')
        .run(record.id, record.scope_id, record.owner_id, record.root_hash, record.realm_fingerprint); records.push(record);
    }
    await installCalendarIntegrationWakeCatalog(system, true); const catalog = new CalendarIntegrationWakeCatalog(system, root);
    let coverage = await catalog.reconcileConfiguration('synthetic-registry-v1', now);
    while (!coverage.complete) coverage = await catalog.seedPage({ generation: coverage.configurationGeneration, now, limit: 100 });
    const scope = (record: CalendarOwnerRecord) => trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: record.scope_id.slice(7) });
    const owner = (record: CalendarOwnerRecord): CalendarIntegrationOwner => ({ owner: record, scope: scope(record), signal: lifetime.signal,
      assertCurrent() { lifetime.signal.throwIfAborted(); },
      async verify(options) { await beforeVerify?.(record.id); options?.signal?.throwIfAborted(); options?.assertCurrent?.();
        if (refused.has(record.id)) throw new CalendarError('CALENDAR_NOT_READY'); },
      async read<T>(name: CalendarIntegrationQuery, _input: unknown, options?: CalendarIntegrationReadOptions): Promise<T> {
        options?.signal?.throwIfAborted(); options?.assertCurrent?.();
        if (name === 'calendar.integration.policies') { seen.set(record.id, (seen.get(record.id) ?? 0) + 1); return [] as T; }
        if (name === 'calendar.integration.nextWake') return { nextWakeAt: null } as T;
        throw new Error('Unexpected protocol query: ' + name);
      },
      async command<T>(name: CalendarIntegrationCommand): Promise<T> {
        if (name !== 'calendar.integration.claim') throw new Error('Unexpected protocol command: ' + name);
        await catalog.markDirty(record, now); coordinator!.hint('nonresident-ref-is-not-looked-up'); return [] as T;
      },
    });
    const make = () => {
      const selected = new CalendarIntegrationCoordinator({ rules: [], maxOwners, batchSize: 16, owner,
        discover() { discoverCalls++; throw new Error('Catalog mode must never enumerate retained owners.'); },
        resolveOwner(selected) { return records.find(record => record.scope_id === (selected.scopeKind === 'tenant' ? 'tenant:' + selected.tenantId : 'application')) ?? null; },
        pin() { throw new Error('Empty rule catalog has no graph pin.'); },
        jobs: { forSource() { throw new Error('Empty rules never create native capabilities.'); },
          tryDetachSources(handles) { expect(handles).toEqual([]); detachCalls++; beforeDetach?.(); return detachBusy ? 'busy' : 'detached'; } },
        inspect() { return null; }, now: () => now, wakeCatalog: () => catalog,
        async refreshWake(record, failure) { const checkpoint = catalog.sample(record);
          const nextWakeAt = failure?.nextWakeAt ?? null;
          return await catalog.publish(record, checkpoint, { classification: failure?.classification ?? 'ready', nextWakeAt }) ? nextWakeAt : 0; },
      });
      controllers.push(selected); coordinator = selected; return selected;
    };
    make();
    return { system, catalog, records, seen, refused, now, scope, make, get coordinator() { return coordinator!; },
      pauseVerify(callback?: typeof beforeVerify) { beforeVerify = callback; }, busy(value: boolean) { detachBusy = value; },
      onDetach(callback?: typeof beforeDetach) { beforeDetach = callback; },
      counts: () => ({ detachCalls, discoverCalls }),
      async close() { beforeVerify = undefined;
        try { for (const item of controllers) { await item.drain(); await item.drainPhysicalIntake(); await item.closeEvidence(); await item.drainPhysicalEvidence(); } }
        finally { lifetime.abort(); system.dispose(); } },
    };
  } catch (error) { lifetime.abort(); system.dispose(); throw error; }
}

test('catalog discovery visits more than64 retained owners through bounded pages and resident eviction, then becomes quiet', async () => {
  const f = await fixture(73), wake = scheduler(); try {
    await f.coordinator.start(wake);
    expect(f.seen.size).toBe(3); expect(f.coordinator.diagnostics().residentOwners).toBe(3);
    expect(f.coordinator.diagnostics().retainedOwners).toBeNull();
    for (let turn = 0; turn < 100 && await wake.fire(f.now); turn++) expect(f.coordinator.diagnostics().residentOwners).toBeLessThanOrEqual(3);
    expect(f.seen.size).toBe(73); expect(f.counts().discoverCalls).toBe(0); expect(f.counts().detachCalls).toBe(70);
    expect(f.coordinator.diagnostics().residency).toMatchObject({ mode: 'catalog', queued: 0, physical: 0, evictedOwners: 70 });
    expect(wake.pending.size).toBe(0); expect(wake.max()).toBe(1); expect(f.catalog.nextWakeAt(f.now)).toBeNull();
    await f.coordinator.ready(f.records[0]!); expect(f.seen.get(f.records[0]!.id)).toBeGreaterThan(1);
    expect(f.coordinator.diagnostics().residentOwners).toBe(3);
  } finally { await f.close(); }
});

test('persistent due turns resume beyond a permanently failing prefix after coordinator replacement', async () => {
  const f = await fixture(69, 2), wake = scheduler(); try {
    f.refused.add(f.records[0]!.id); f.refused.add(f.records[1]!.id);
    await f.coordinator.start(wake); expect(f.catalog.coverage().turnCursor).not.toBeNull();
    await f.coordinator.drain(); await f.coordinator.closeEvidence(); const next = f.make();
    await next.start(wake);
    for (let turn = 0; turn < 100 && await wake.fire(f.now); turn++) {}
    expect(f.seen.has(f.records[68]!.id)).toBe(true); expect(f.seen.size).toBe(67);
    expect(f.counts().discoverCalls).toBe(0); expect(next.diagnostics().residentOwners).toBe(2);
    expect(f.catalog.nextWakeAt(f.now)).toBe(f.now + 1000); expect(wake.pending.size).toBe(1);
  } finally { await f.close(); }
});

test('more than64 permanently unreadable staged owners consume no resident slots and cannot hide healthy later owners', async () => {
  const f = await fixture(73), wake = scheduler(); try {
    for (const record of f.records.slice(0, 65)) f.refused.add(record.id);
    await f.coordinator.start(wake);
    for (let turn = 0; turn < 100 && await wake.fire(f.now); turn++) expect(f.coordinator.diagnostics().residentOwners).toBeLessThanOrEqual(3);
    expect(f.seen.size).toBe(8); expect(f.seen.has(f.records[72]!.id)).toBe(true);
    expect(f.coordinator.diagnostics()).toMatchObject({ residentOwners: 3, stagingOwners: 0 });
    expect(f.counts().detachCalls).toBe(5); expect(f.catalog.nextWakeAt(f.now)).toBe(f.now + 1000);
    expect(await wake.fire(f.now)).toBe(false);
  } finally { await f.close(); }
});

test('a durable dirty hint for an evicted owner wakes catalog discovery without a resident ref', async () => {
  const f = await fixture(5, 1), wake = scheduler(); try {
    await f.coordinator.start(wake); for (let turn = 0; turn < 20 && await wake.fire(f.now); turn++) {}
    expect(wake.pending.size).toBe(0); const visits = f.seen.get(f.records[0]!.id)!;
    await f.catalog.markDirty(f.records[0]!, f.now); f.coordinator.hint('this-ref-does-not-exist-in-resident-map');
    expect(wake.pending.size).toBe(1); expect(await wake.fire(f.now)).toBe(true);
    expect(f.seen.get(f.records[0]!.id)).toBeGreaterThan(visits); expect(wake.pending.size).toBe(0);
  } finally { await f.close(); }
});

test('shared queued readiness pins one actual task; all-busy refusal never evicts or aborts its late body', async () => {
  const f = await fixture(2, 1), entered = deferred(), held = deferred(); let pending: Promise<void> | undefined;
  try {
    f.pauseVerify(async id => { if (id === f.records[0]!.id) { entered.resolve(); await held.promise; } });
    pending = f.coordinator.ready(f.records[0]!); await entered.promise;
    expect(f.coordinator.ready(f.records[0]!)).toBe(pending);
    await expect(f.coordinator.ready({ ...f.records[0]!, owner_id: 'different-owner' })).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.coordinator.diagnostics()).toMatchObject({ residentOwners: 0, stagingOwners: 1, residency: { ownerActivity: 1 } });
    await expect(f.coordinator.ready(f.records[1]!)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.counts().detachCalls).toBe(0); held.resolve(); await pending;
    f.pauseVerify(); await f.coordinator.ready(f.records[1]!);
    expect(f.counts().detachCalls).toBe(1); expect(f.coordinator.diagnostics().residentOwners).toBe(1);
  } finally { held.resolve(); await pending?.catch(() => {}); await f.close(); }
});

test('a cancelled transient evidence caller retains its owner activity pin until the actual proof body exits', async () => {
  const f = await fixture(2, 1), entered = deferred(), held = deferred(), cancelled = new AbortController();
  let inspecting: ReturnType<typeof capture> | undefined;
  try {
    await f.coordinator.ready(f.records[0]!);
    f.pauseVerify(async id => { if (id === f.records[0]!.id) { entered.resolve(); await held.promise; } });
    inspecting = capture(f.coordinator.inspect(f.scope(f.records[0]!), { signal: cancelled.signal })); await entered.promise;
    cancelled.abort(new Error('synthetic-evidence-cancel')); expect((await inspecting).ok).toBe(false);
    await expect(f.coordinator.ready(f.records[1]!)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    held.resolve(); await until(() => f.coordinator.diagnostics().evidence.active === 0);
    f.pauseVerify(); await f.coordinator.ready(f.records[1]!); expect(f.counts().detachCalls).toBe(1);
  } finally { held.resolve(); await inspecting; await f.close(); }
});

test('a native batch refusal leaves the exact resident intact and a later admitted release permits revisit', async () => {
  const f = await fixture(2, 1); try {
    await f.coordinator.ready(f.records[0]!); f.busy(true);
    await expect(f.coordinator.ready(f.records[1]!)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await f.coordinator.ready(f.records[0]!); expect(f.coordinator.diagnostics().residentOwners).toBe(1);
    f.busy(false); await f.coordinator.ready(f.records[1]!); await f.coordinator.ready(f.records[0]!);
    expect(f.coordinator.diagnostics().residency.evictedOwners).toBe(2);
  } finally { await f.close(); }
});

test('unsettled uninvoked dispatcher cleanup blocks resident removal before any native detach attempt', async () => {
  const f = await fixture(2, 1); let cleanup: Map<string, string> | undefined;
  try {
    await f.coordinator.ready(f.records[0]!);
    const cells = (f.coordinator as unknown as { cells: Map<string, { dispatcher: { cleanupFailures: Map<string, string> } }> }).cells;
    cleanup = cells.get(f.records[0]!.id)!.dispatcher.cleanupFailures; cleanup.set('synthetic-uninvoked', 'CALENDAR_NOT_READY');
    await expect(f.coordinator.ready(f.records[1]!)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.counts().detachCalls).toBe(0); expect(f.coordinator.diagnostics().residency.unsettledUninvokedClaims).toBe(1);
    cleanup.clear(); await f.coordinator.ready(f.records[1]!); expect(f.counts().detachCalls).toBe(1);
  } finally { cleanup?.clear(); await f.close(); }
});

test('evicting phase refuses reentrant owner evidence admission during the native detach guard boundary', async () => {
  const f = await fixture(2, 1); let reentrant: ReturnType<typeof capture> | undefined;
  try {
    await f.coordinator.ready(f.records[0]!);
    f.onDetach(() => { reentrant = capture(f.coordinator.inspect(f.scope(f.records[0]!))); });
    await f.coordinator.ready(f.records[1]!);
    const outcome = await reentrant!; expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.coordinator.diagnostics()).toMatchObject({ residentOwners: 1, evidence: { active: 0, queued: 0 }, residency: { ownerActivity: 0 } });
  } finally { f.onDetach(); await reentrant; await f.close(); }
});
