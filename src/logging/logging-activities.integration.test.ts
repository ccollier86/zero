/** Real private Fabric writers/readers. Synthetic records only; no application or production databases. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoggingRuntime } from './logging-runtime';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from './logging-managed-config';
import { MemoryEventStore } from '../observability/memory-event-store';
import { captureLoggingEvent } from './logging-validation';
import { loggingContext, loggingEvent } from './test-support/logging-fixture';
import type { LoggingEvent } from './logging-contracts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'logging-activities-')), store = new MemoryEventStore();
  const config = resolveManagedLoggingConfig({ preset: 'activity', rootDirectory: root, retention: { auditDays: 1 } }, root) as ResolvedManagedLoggingConfig;
  const runtime = await LoggingRuntime.open(config, { sink: store, store, config: { console: false } });
  return { runtime, close: async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); } };
}
const scope = { kind: 'tenant' as const, tenantId: 'tenant-a' };
test('explicit investigation correlation groups internal criteria admissions without discarding their original evidence', async () => {
  const f = await fixture();
  try {
    for (const id of ['criteria-one', 'criteria-two']) await f.runtime.deliver({ ...loggingEvent(id, 'tenant-a', { family: 'investigations', action: 'logging.query.window' }), correlationId: 'investigation:one' });
    const page = await f.runtime.page('audit', scope, { projection: 'activities' });
    expect(page.total).toBe(1); expect(page.events[0]!.activity!.evidenceCount).toBe(2);
    expect((await f.runtime.page('audit', scope, { activityId: page.events[0]!.activity!.id })).total).toBe(2);
    await f.runtime.deliver({ ...loggingEvent('other-visit', 'tenant-a', { family: 'investigations', action: 'logging.query.window' }), correlationId: 'investigation:two' });
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).total).toBe(2);
  } finally { await f.close(); }
}, 30000);
test('bounded sustained appends and concurrent private investigations preserve exact logical counts without reader saturation', async () => {
  const f = await fixture();
  try {
    const start = performance.now();
    for (let batch = 0; batch < 20; batch++) await Promise.all(Array.from({ length: 100 }, (_, index) =>
      f.runtime.deliver(loggingEvent('burst-' + (batch * 100 + index), 'tenant-a'))));
    const appendMs = performance.now() - start;
    const watermark = (await f.runtime.page('audit', scope, { projection: 'activities', limit: 1 })).highWaterOrdinal;
    const investigations = Array.from({ length: 8 }, async () => {
      const before = performance.now();
      const page = await f.runtime.page('audit', scope, { projection: 'activities', highWaterOrdinal: watermark, limit: 20 });
      expect(page.total).toBe(2000); expect(page.events).toHaveLength(20);
      return performance.now() - before;
    });
    const writes = Promise.all(Array.from({ length: 100 }, (_, index) => f.runtime.deliver(loggingEvent('concurrent-' + index, 'tenant-a'))));
    const readMs = (await Promise.all(investigations)).sort((a, b) => a - b); await writes;
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).total).toBe(2100);
    console.log(JSON.stringify({ fixture: 'private-activity-load', events: 2100, concurrentReaders: 8,
      initialAppendMs: Math.round(appendMs), readP50Ms: Math.round(readMs[4]!), readMaxMs: Math.round(readMs.at(-1)!),
      exactPinnedTotal: 2000, exactFinalTotal: 2100 }));
  } finally { await f.close(); }
}, 90000);
test('person filters include explicit human initiators, field filters use retained changes, and scope remains mandatory', async () => {
  const f = await fixture();
  try {
    const changed = (id: string, initiatorId: string, tenant = 'tenant-a') => captureLoggingEvent({ ...loggingContext(tenant), origin: 'system',
      actor: { kind: 'system', id: 'invoice-workflow', initiatorId, sessionId: null } }, { id, family: 'records', action: 'record.updated', evidence: 'server-confirmed', outcome: 'succeeded', occurredAt: Date.now(),
      target: { type: 'table.invoices', id: 'invoice-one' }, detail: { kind: 'record-change', table: 'invoices', sequence: 42, omittedFields: 0,
        changes: [{ field: 'state', kind: 'value', beforePresent: true, afterPresent: true, before: 'pending', after: 'approved' }] } });
    await f.runtime.deliver(changed('initiated', 'person-a')); await f.runtime.deliver(changed('other-person', 'person-b')); await f.runtime.deliver(changed('other-tenant', 'person-a', 'tenant-b'));
    for (const projection of ['activities', 'events'] as const) {
      const page = await f.runtime.page('audit', scope, { projection, userId: 'person-a', changedField: 'state' });
      expect(page.events.map(row => row.event.id)).toEqual(['initiated']);
      expect((await f.runtime.page('audit', scope, { projection, actorId: 'person-a' })).total).toBe(0);
      expect((await f.runtime.page('audit', scope, { projection, actorId: 'invoice-workflow' })).total).toBe(2);
      expect((await f.runtime.page('audit', scope, { projection, changedField: 'not-retained' })).total).toBe(0);
      expect((await f.runtime.page('audit', scope, { projection, userId: 'person-a', changedField: 'state', highWaterOrdinal: page.highWaterOrdinal })).total).toBe(1);
    }
  } finally { await f.close(); }
}, 30000);
const view = (seq: number, action: 'view.opened' | 'view.interval' | 'view.closed', tenant = 'tenant-a', viewId = 'view-one') => captureLoggingEvent(
  { ...loggingContext(tenant), sourceId: 'browser-one:' + tenant, origin: 'frontend' },
  { id: 'view-event-' + seq, family: 'views', action, evidence: 'browser-observed', outcome: 'attempted', occurredAt: 1000 + seq * 1000,
    target: { type: 'table.records', id: 'record-one' }, metadata: { viewId, sequence: seq, elapsedMs: seq ? 1000 : 0,
      visibleMs: seq ? 800 : 0, activeMs: seq ? 500 : 0, incomplete: false } },
  ['viewId', 'sequence', 'elapsedMs', 'visibleMs', 'activeMs', 'incomplete']);
const read = (terminal: boolean) => captureLoggingEvent({ ...loggingContext(), correlationId: 'read-one' },
  { id: terminal ? 'read-terminal' : 'read-start', family: 'records', action: terminal ? 'record.read.prepared' : 'record.read.admitted',
    outcome: terminal ? 'succeeded' : 'attempted', evidence: 'server-confirmed', occurredAt: terminal ? 2000 : 1000, target: { type: 'table.records', id: 'record-one' } });

test('read stages become one activity and exact activity totals do not count control or evidence stages', async () => {
  const f = await fixture();
  try {
    await f.runtime.deliver(read(false)); await f.runtime.deliver(read(true));
    await f.runtime.deliver(loggingEvent('routine-control', 'tenant-a', { family: 'security', action: 'logging.delivery.acknowledged' }));
    const page = await f.runtime.page('audit', scope, { projection: 'activities' });
    expect(page.total).toBe(1); expect(page.events).toHaveLength(1);
    expect(page.events[0]!.activity).toMatchObject({ action: 'record.read', firstOrdinal: 1, revision: 2, evidenceCount: 2, outcome: 'succeeded' });
    expect(page.events[0]!.event.action).toBe('record.read.prepared');
    expect((await f.runtime.page('audit', scope)).total).toBe(3);
    const raw = await f.runtime.page('audit', scope, { activityId: page.events[0]!.activity!.id });
    expect(raw.events.map(row => row.event.id)).toEqual(['read-terminal', 'read-start']);
    expect((await f.runtime.verify('audit')).checked).toBe(3);
  } finally { await f.close(); }
}, 30000);

test('view summaries are scoped, duplicate-safe, gap-aware and historically pinned without inventing missing time', async () => {
  const f = await fixture();
  try {
    await f.runtime.deliver(view(2, 'view.closed'));
    let page = await f.runtime.page('audit', scope, { projection: 'activities' });
    expect(page.events[0]!.activity!.view).toMatchObject({ openedAt: null, closedAt: 3000, elapsedMs: 1000, complete: false });
    await f.runtime.deliver(view(0, 'view.opened'));
    await f.runtime.deliver(view(1, 'view.interval'));
    expect((await f.runtime.deliver(view(1, 'view.interval'))).duplicate).toBe(true);
    page = await f.runtime.page('audit', scope, { projection: 'activities' });
    expect(page.total).toBe(1);
    expect(page.events[0]!.activity).toMatchObject({ firstOrdinal: 1, revision: 3, evidenceCount: 3,
      view: { openedAt: 1000, closedAt: 3000, elapsedMs: 2000, visibleMs: 1600, activeMs: 1000, observations: 3, complete: true } });
    const pinned = await f.runtime.page('audit', scope, { projection: 'activities', highWaterOrdinal: 1 });
    expect(pinned.events[0]!.activity!.view).toMatchObject({ elapsedMs: 1000, openedAt: null, complete: false });
    await f.runtime.deliver(view(0, 'view.opened', 'tenant-b'));
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).total).toBe(1);
    expect((await f.runtime.page('audit', { kind: 'tenant', tenantId: 'tenant-b' }, { projection: 'activities' })).total).toBe(1);
    const contradictory = { ...view(1, 'view.interval'), id: 'different-event-same-sequence' } as LoggingEvent;
    await expect(f.runtime.deliver(contradictory)).rejects.toThrow();
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).events[0]!.activity!.evidenceCount).toBe(3);
  } finally { await f.close(); }
}, 30000);

test('live cursors report a true update and filter exit rather than a second inserted activity', async () => {
  const f = await fixture();
  try {
    await f.runtime.deliver(read(false));
    const first = await f.runtime.page('audit', scope, { projection: 'activities' });
    await f.runtime.deliver(read(true));
    const update = await f.runtime.changes('audit', scope, { projection: 'activities' }, first.highWaterOrdinal);
    expect(update.events).toHaveLength(1); expect(update.events[0]!.ordinal).toBe(1);
    expect(update.events[0]!.activity).toMatchObject({ firstOrdinal: 1, revision: 2 });
    const removed = await f.runtime.changes('audit', scope, { projection: 'activities', outcome: 'attempted' }, first.highWaterOrdinal);
    expect(removed.events).toHaveLength(0);
    expect(removed.removed).toEqual([{ id: first.events[0]!.activity!.id, revision: 2 }]);
    expect((await f.runtime.changes('audit', scope, { projection: 'activities' }, update.throughOrdinal)).events).toHaveLength(0);
  } finally { await f.close(); }
}, 30000);

test('a later provider success cannot erase an earlier failed or unresolved stage', async () => {
  const f = await fixture();
  try {
    for (const [id, outcome] of [['service-admitted', 'attempted'], ['service-unknown', 'unknown'], ['service-late', 'succeeded']] as const)
      await f.runtime.deliver(loggingEvent(id, 'tenant-a', { family: 'ai', action: outcome === 'attempted' ? 'ai.provider.admitted' : outcome === 'unknown' ? 'ai.provider.unknown' : 'ai.provider.completed',
        outcome, target: { type: 'service.invocation', id: 'one-native-service-operation' } }));
    const page = await f.runtime.page('audit', scope, { projection: 'activities' });
    expect(page.total).toBe(1); expect(page.events[0]!.activity).toMatchObject({ outcome: 'unknown', evidenceCount: 3 });
  } finally { await f.close(); }
}, 30000);

test('retention protects an entire fresh or legally held activity, not only the stage intersecting the hold', async () => {
  const f = await fixture();
  try {
    await f.runtime.deliver(read(false));
    const first = (await f.runtime.page('audit', scope)).events[0]!;
    await Bun.sleep(5); await f.runtime.deliver(read(true));
    await f.runtime.maintain(first.ingestedAt + 1 + 86400000);
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).events[0]!.activity!.evidenceCount).toBe(2);
    const action = (name: string) => captureLoggingEvent(loggingContext(), { id: crypto.randomUUID(), family: 'investigations', action: name,
      outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: Date.now(), target: { type: 'logging.hold', id: 'hold-view' } });
    const hold = { id: 'hold-view', scope, actorId: 'fixture-user', since: 2000, until: 2001, reasonRef: 'synthetic-case' };
    await f.runtime.evidenceCommand('logging.hold', { ...hold, auditEvent: action('logging.hold.created') });
    await f.runtime.maintain(Date.now() + 86400000 + 5000);
    const held = await f.runtime.page('audit', scope, { projection: 'activities' });
    expect(held.events).toHaveLength(1); expect(held.events[0]!.activity!.evidenceCount).toBe(2);
    expect((await f.runtime.page('audit', scope, { activityId: held.events[0]!.activity!.id })).events).toHaveLength(2);
    await f.runtime.evidenceCommand('logging.hold', { id: hold.id, scope, actorId: 'fixture-user', release: true, auditEvent: action('logging.hold.released') });
    await f.runtime.maintain(Date.now() + 86400000 + 5000);
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).events).toHaveLength(0);
  } finally { await f.close(); }
}, 30000);
