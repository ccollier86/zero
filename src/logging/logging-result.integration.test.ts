/** Complete private Fabric transaction tests with synthetic authorized rows only. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoggingRuntime } from './logging-runtime';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from './logging-managed-config';
import { MemoryEventStore } from '../observability/memory-event-store';
import { captureLoggingEvent } from './logging-validation';
import { captureLoggingResult } from './logging-result-capture';
import { loggingContext } from './test-support/logging-fixture';
import type { LoggingResultReceipt } from './logging-result-contracts';
import { loggingExportHistory } from './logging-export-history';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'logging-results-')), store = new MemoryEventStore();
  const config = resolveManagedLoggingConfig({ preset: 'detailed', rootDirectory: root, retention: { auditDays: 1 }, resources: { records: { fields: { state: { values: ['draft', 'approved'] } } } } }, root) as ResolvedManagedLoggingConfig;
  let runtime = await LoggingRuntime.open(config, { sink: store, store, config: { console: false } });
  return { get runtime() { return runtime; }, restart: async () => { await runtime.close(); runtime = await LoggingRuntime.open(config, { sink: store, store, config: { console: false } }); },
    close: async () => { await runtime.close(); await rm(root, { recursive: true, force: true }); } };
}
const scope = { kind: 'tenant' as const, tenantId: 'tenant-a' };
function observation(sequence: number, action: 'view.opened' | 'view.interval' | 'view.closed' | 'view.result.changed', overrides = {}) {
  return captureLoggingEvent({ ...loggingContext(), sourceId: 'browser:synthetic-one', origin: 'frontend', ...overrides },
    { id: 'result-observation-' + sequence, family: 'views', action, evidence: 'browser-observed', outcome: 'attempted', occurredAt: Date.now(),
      metadata: { viewId: 'synthetic-view-one', sequence, elapsedMs: sequence && action !== 'view.result.changed' ? 1000 : 0,
        visibleMs: sequence && action !== 'view.result.changed' ? 800 : 0, activeMs: sequence && action !== 'view.result.changed' ? 500 : 0, incomplete: false } },
    ['viewId', 'sequence', 'elapsedMs', 'visibleMs', 'activeMs', 'incomplete']);
}
async function prepare(runtime: LoggingRuntime, order = ['one', 'two']): Promise<LoggingResultReceipt> {
  return (await runtime.prepareResult(loggingContext(), { table: 'records', kind: 'list', revision: 'snapshot:42', criteria: { state: 'draft' },
    rows: order.map(id => ({ id, state: 'draft', patientName: 'NEVER RETAIN THIS', body: 'NEVER RETAIN THIS EITHER' })) }))!;
}

test('read manifests retain only approved ordered identities/revisions and remain private before actual display', async () => {
  const f = await fixture();
  try {
    const receipt = await prepare(f.runtime), manifest = (await f.runtime.result(scope, receipt.id))!;
    expect(manifest.records).toEqual(['one', 'two'].map(id => ({ type: 'table.records', id, revision: 'snapshot:42', values: { state: 'draft' } })));
    expect(JSON.stringify(manifest)).not.toContain('NEVER');
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).total).toBe(0);
    expect((await f.runtime.page('audit', scope)).total).toBe(1);
    expect(await f.runtime.result({ kind: 'tenant', tenantId: 'tenant-b' }, receipt.id)).toBeNull();
    expect(await f.runtime.result({ kind: 'application' }, receipt.id)).toBeNull();
    await f.runtime.observeResult(receipt.id, observation(0, 'view.opened'));
    const page = await f.runtime.page('audit', scope, { projection: 'activities' });
    expect(page.total).toBe(1);
    expect(page.events[0]!.activity).toMatchObject({ action: 'record.list.viewed', evidenceCount: 2, resultReceiptId: receipt.id,
      view: { observations: 1, complete: true, closedAt: null } });
    expect((await f.runtime.page('audit', scope, { activityId: page.events[0]!.activity!.id })).events.map(row => row.event.action)).toEqual(['view.opened', 'record.list.prepared']);
  } finally { await f.close(); }
}, 30000);

test('display revisions update a single activity while preserving the original list order and complete view intervals', async () => {
  const f = await fixture();
  try {
    const first = await prepare(f.runtime); await f.runtime.observeResult(first.id, observation(0, 'view.opened'));
    const start = await f.runtime.page('audit', scope, { projection: 'activities' });
    const interval = observation(1, 'view.interval'); await f.runtime.observeResult(first.id, interval);
    const next = await prepare(f.runtime, ['three', 'two']); await f.runtime.observeResult(next.id, observation(2, 'view.result.changed'));
    await f.runtime.observeResult(next.id, observation(3, 'view.closed'));
    expect((await f.runtime.observeResult(first.id, interval))!.duplicate).toBe(true);
    const page = await f.runtime.page('audit', scope, { projection: 'activities' });
    expect(page.total).toBe(1); expect(page.events[0]!.activity).toMatchObject({ id: start.events[0]!.activity!.id, resultReceiptId: next.id,
      evidenceCount: 6, view: { observations: 4, elapsedMs: 2000, visibleMs: 1600, activeMs: 1000, complete: true } });
    expect((await f.runtime.page('audit', scope, { projection: 'activities', highWaterOrdinal: start.highWaterOrdinal })).events[0]!.activity!.resultReceiptId).toBe(first.id);
    expect((await f.runtime.result(scope, first.id))!.records.map(record => record.id)).toEqual(['one', 'two']);
    expect((await f.runtime.result(scope, next.id))!.records.map(record => record.id)).toEqual(['three', 'two']);
    expect((await f.runtime.changes('audit', scope, { projection: 'activities' }, start.highWaterOrdinal)).events).toHaveLength(1);
    await expect(f.runtime.observeResult(next.id, observation(4, 'view.interval'))).rejects.toThrow();
    expect((await f.runtime.page('audit', scope)).total).toBe(6);
  } finally { await f.close(); }
}, 30000);

test('receipts cannot be claimed by another session, actor, policy or tenant and never fabricate a close/open sequence', async () => {
  const f = await fixture();
  try {
    const receipt = await prepare(f.runtime);
    for (const override of [{ actor: { ...loggingContext().actor, id: 'different-user' } }, { actor: { ...loggingContext().actor, sessionId: 'different-session' } },
      { scope: { kind: 'tenant' as const, tenantId: 'tenant-b' } }, { policyVersion: 'different-policy' }])
      await expect(f.runtime.observeResult(receipt.id, observation(0, 'view.opened', override))).rejects.toThrow();
    await expect(f.runtime.observeResult(receipt.id, observation(1, 'view.interval'))).rejects.toThrow();
    expect((await f.runtime.page('audit', scope)).total).toBe(1);
    await f.runtime.observeResult(receipt.id, observation(0, 'view.opened'));
    await expect(f.runtime.observeResult(receipt.id, observation(2, 'view.result.changed'))).rejects.toThrow();
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).events[0]!.activity!.view!.observations).toBe(1);
  } finally { await f.close(); }
}, 30000);

test('explicit copy/print observations bind to a currently displayed receipt and remain browser observations, with exact post-close replay', async () => {
  const f = await fixture();
  try {
    const receipt = (await f.runtime.prepareResult(loggingContext(), { table: 'records', kind: 'record', rows: [{ id: 'one', state: 'draft' }] }))!;
    const copy = captureLoggingEvent({ ...loggingContext(), sourceId: 'browser:synthetic-one', origin: 'frontend' },
      { id: 'copy-one', family: 'clipboard', action: 'clipboard.copy.completed', outcome: 'succeeded', evidence: 'browser-observed', occurredAt: Date.now() });
    await expect(f.runtime.observeResult(receipt.id, copy)).rejects.toMatchObject({ code: 'LOGGING_EVENT_INVALID' });
    await f.runtime.observeResult(receipt.id, observation(0, 'view.opened'));
    await f.runtime.observeResult(receipt.id, copy);
    const page = await f.runtime.page('audit', scope, { projection: 'activities', action: 'clipboard.copy.completed' });
    expect(page.events).toHaveLength(1); expect(page.events[0]!.event).toMatchObject({ evidence: 'browser-observed', outcome: 'succeeded', target: { type: 'table.records', id: 'one' } });
    expect(page.events[0]!.activity!.resultReceiptId).toBe(receipt.id);
    await f.runtime.observeResult(receipt.id, observation(1, 'view.closed'));
    expect((await f.runtime.observeResult(receipt.id, copy))!.duplicate).toBe(true);
    await expect(f.runtime.observeResult(receipt.id, { ...copy, id: 'copy-after-close' })).rejects.toMatchObject({ code: 'LOGGING_EVENT_INVALID' });
    expect((await f.runtime.verify('audit')).checked).toBe(4);
  } finally { await f.close(); }
}, 30000);

test('first display admission expires; an unused preparation is not a successful view', async () => {
  const f = await fixture();
  try {
    const old = captureLoggingResult({ table: 'records', kind: 'record', rows: [{ id: 'one' }] }, {}, 'expired-receipt', Date.now() - 300001);
    const receipt = (await f.runtime.prepareCapturedResult(loggingContext(), old))!;
    await expect(f.runtime.observeResult(receipt.id, observation(0, 'view.opened'))).rejects.toThrow();
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).total).toBe(0);
    expect((await f.runtime.verify('audit')).checked).toBe(1);
  } finally { await f.close(); }
}, 30000);

test('display selections preserve released order/revisions without admitting client record facts or unseen full-list versions', async () => {
  const f = await fixture();
  try {
    const original = await prepare(f.runtime, ['one', 'two', 'three']);
    const input = { id: 'selected-page-one', kind: 'list' as const, sources: [{ receiptId: original.id, positions: [2, 0] }] };
    const selected = (await f.runtime.deriveResult(loggingContext(), input))!;
    const manifest = (await f.runtime.result(scope, selected.id))!;
    expect(manifest.records.map(record => [record.id, record.revision])).toEqual([['three', 'snapshot:42'], ['one', 'snapshot:42']]);
    expect(manifest.sources).toEqual([{ receiptId: original.id, digest: original.digest }]);
    expect(await f.runtime.deriveResult(loggingContext(), input)).toEqual(selected);
    await expect(f.runtime.deriveResult(loggingContext(), { ...input, sources: [{ receiptId: original.id, positions: [0] }] })).rejects.toMatchObject({ code: 'LOGGING_EVENT_INVALID' });
    await expect(f.runtime.deriveResult(loggingContext(), { ...input, id: 'duplicate-rows', sources: [{ receiptId: original.id, positions: [0, 0] }] })).rejects.toThrow();
    await expect(f.runtime.deriveResult(loggingContext(), { ...input, id: 'invented-row', sources: [{ receiptId: original.id, positions: [3] }] })).rejects.toThrow();
    await expect(f.runtime.deriveResult({ ...loggingContext(), actor: { ...loggingContext().actor, sessionId: 'another-session' } }, { ...input, id: 'wrong-owner' })).rejects.toMatchObject({ code: 'LOGGING_EVENT_INVALID' });
    await f.runtime.observeResult(selected.id, observation(0, 'view.opened'));
    const activity = (await f.runtime.page('audit', scope, { projection: 'activities' })).events[0]!.activity!;
    expect(activity.evidenceCount).toBe(3);
    expect((await f.runtime.resultVersions(scope, activity.id)).items.map(item => item.receipt.id)).toEqual([selected.id]);
    const row = (await f.runtime.page('audit', scope, { projection: 'activities' })).events[0]!;
    const exported = await loggingExportHistory(f.runtime, scope, row, row.activity!.revision, 8 * 1024 * 1024);
    expect(exported).toMatchObject({ complete: true, row: { history: { complete: true, results: [{ receipt: { id: selected.id } }], lineage: [{ id: original.id }] } } });
    expect(JSON.stringify(exported)).not.toContain('NEVER');
    // A selected record inherits the historical revision, not the current database or an invented fresh read.
    const record = (await f.runtime.deriveResult(loggingContext(), { id: 'selected-record', kind: 'record', sources: [{ receiptId: selected.id, positions: [1] }] }))!;
    expect((await f.runtime.result(scope, record.id))!.records.map(record => record.id)).toEqual(['one']);
    expect((await f.runtime.result(scope, record.id))!.sources).toHaveLength(2);
    await f.restart();
    expect(await f.runtime.deriveResult(loggingContext(), input)).toEqual(selected);
    expect((await f.runtime.verify('audit')).checked).toBe(4);
  } finally { await f.close(); }
}, 30000);

test('empty displayed subsets and long-lived cached releases are explicit, scoped selections, never a fresh domain read', async () => {
  const f = await fixture();
  try {
    const old = captureLoggingResult({ table: 'records', kind: 'list', rows: [{ id: 'one' }], revision: 'snapshot:old' }, {}, 'cached-release', Date.now() - 300001);
    const source = (await f.runtime.prepareCapturedResult(loggingContext(), old))!;
    const empty = (await f.runtime.deriveResult(loggingContext(), { id: 'empty', kind: 'list', sources: [{ receiptId: source.id, positions: [] }] }))!;
    expect(empty.count).toBe(0);
    expect((await f.runtime.result(scope, empty.id))!.sources).toEqual([{ receiptId: source.id, digest: source.digest }]);
    await f.runtime.observeResult(empty.id, observation(0, 'view.opened'));
    const record = (await f.runtime.deriveResult(loggingContext(), { id: 'cached-record', kind: 'record', sources: [{ receiptId: source.id, positions: [0] }] }))!;
    expect((await f.runtime.result(scope, record.id))!.records[0]!.revision).toBe('snapshot:old');
    await f.runtime.maintain(Date.now() + 86400000 + 5000);
    await expect(f.runtime.deriveResult(loggingContext(), { id: 'after-retention', kind: 'record', sources: [{ receiptId: source.id, positions: [0] }] })).rejects.toMatchObject({ code: 'LOGGING_EVENT_INVALID' });
  } finally { await f.close(); }
}, 30000);

test('retention retires the full displayed history, emits real removals, purges manifests, and survives actor restart without resurrection', async () => {
  const f = await fixture();
  try {
    const receipt = await prepare(f.runtime); await f.runtime.observeResult(receipt.id, observation(0, 'view.opened'));
    await f.runtime.observeResult(receipt.id, observation(1, 'view.closed'));
    const before = await f.runtime.page('audit', scope, { projection: 'activities' }), id = before.events[0]!.activity!.id;
    await f.runtime.maintain(Date.now() + 86400000 + 5000);
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).total).toBe(0);
    expect(await f.runtime.result(scope, receipt.id)).toBeNull();
    expect((await f.runtime.resultVersions(scope, id)).items).toHaveLength(0);
    const changes = await f.runtime.changes('audit', scope, { projection: 'activities' }, before.highWaterOrdinal);
    expect(changes.events).toHaveLength(0); expect(changes.removed?.map(row => row.id)).toEqual([id]);
    expect((await f.runtime.page('audit', scope, { projection: 'activities', highWaterOrdinal: before.highWaterOrdinal })).events).toHaveLength(0);
    expect((await f.runtime.verify('audit')).expired).toBe(3);
    await f.restart();
    expect((await f.runtime.page('audit', scope, { projection: 'activities' })).events).toHaveLength(0);
    expect(await f.runtime.result(scope, receipt.id)).toBeNull();
    await expect(f.runtime.observeResult(receipt.id, observation(0, 'view.opened'))).rejects.toMatchObject({ code: 'LOGGING_EVENT_INVALID' });
  } finally { await f.close(); }
}, 30000);
