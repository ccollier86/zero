/** Real file/WAL subprocess actors, disposable databases and synthetic events only. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseCoordinator, type DatabaseCoordinatorLease } from '../databases/database-coordinator';
import { createAsyncDatabaseClient } from '../databases/database-client';
import type { AsyncDatabaseOperationExecutor } from '../databases/database-operations';
import { createSubprocessDatabaseExecutorFactory } from '../databases/subprocess-database-executor-factory';
import { loggingRealm } from './logging-realm';
import { LoggingFabricStore } from './logging-fabric-store';
import { LoggingWriter } from './logging-writer';
import { resolveLoggingConfig } from './logging-config';
import { loggingEvent } from './test-support/logging-fixture';
import { loggingContext } from './test-support/logging-fixture';
import { captureLoggingEvent } from './logging-validation';
import { executeCoordinatorLoggingDeliveryProbe } from '../databases/database-coordinator-capability';
import { resolveDatabaseFile } from '../databases/database-file';
import { Database as SQLiteDatabase } from 'bun:sqlite';
import type { DatabaseRealm } from '../databases/database-realm';
import { loggingV6Realm } from './test-support/logging-v6-realm.fixture';
import { loggingDigest } from './logging-hash';

async function fixture(afterWrite?: () => void, initialRealm: DatabaseRealm = loggingRealm) {
  const root = await mkdtemp(join(tmpdir(), 'logging-fabric-'));
  let realm = initialRealm;
  let coordinator: DatabaseCoordinator; const leases = new Set<DatabaseCoordinatorLease>(), bound = new Map<LoggingFabricStore['stream'], DatabaseCoordinatorLease>();
  const start = () => {
    coordinator = new DatabaseCoordinator({ rootDirectory: join(root, 'databases'), realm, sqlite: { synchronous: 'FULL' },
      maxDatabases: 2, readers: true, sweepIntervalMs: false,
      createExecutor: createSubprocessDatabaseExecutorFactory({ launch: { kind: 'source', entrypoint: new URL(realm.version === '6' ? './test-support/logging-v6-actor.fixture.ts' : './test-support/logging-actor.fixture.ts', import.meta.url) }, env: {},
        executor: { startupTimeoutMs: 5000, operationTimeoutMs: 10000, shutdownAckTimeoutMs: 2000, shutdownExitTimeoutMs: 2000 } }),
    }); coordinator.start();
  };
  start();
  const stores = async () => {
    const bind = async (stream: 'audit' | 'operational') => {
      const lease = await coordinator.acquire('logging:' + stream); leases.add(lease);
      bound.set(stream, lease);
      return new LoggingFabricStore(createAsyncDatabaseClient({ executor: { execute: async (operation: any, options: any) => {
        const result = await lease.execute(operation, options); if (operation.type === 'command') afterWrite?.(); return result;
      } } as AsyncDatabaseOperationExecutor }), stream);
    };
    return { audit: await bind('audit'), operational: await bind('operational') };
  };
  const closeOwner = async () => { for (const lease of leases) lease.release(); leases.clear(); bound.clear(); await coordinator.close(); };
  return { stores,
    async legacyAppend(events: Parameters<LoggingFabricStore['append']>[0]) {
      return bound.get('audit')!.execute({ type: 'command', name: 'logging.append', input: { stream: 'audit', events } as any,
        idempotencyKey: 'logging:append:' + loggingDigest(events) });
    },
    probe: (nonce: string, stream: LoggingFabricStore['stream'] = 'audit') => executeCoordinatorLoggingDeliveryProbe(bound.get(stream)!, nonce),
    controlCounts() {
      const database = new SQLiteDatabase(resolveDatabaseFile(join(root, 'databases'), 'logging:audit').path, { readonly: true });
      try { return { receipts: database.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM _zero_database_operation_receipts').get()!.n,
        controls: database.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM logging_delivery_control').get()!.n }; }
      finally { database.close(); }
    }, async restart() { await closeOwner(); start(); return stores(); },
    async upgrade() { await closeOwner(); realm = loggingRealm; start(); return stores(); },
    async close() { try { await closeOwner(); } finally { await rm(root, { recursive: true, force: true }); } } };
}

test('retained v6 source replay upgrades through real actors without changing old evidence or reusing expired command receipts', async () => {
  const f = await fixture(undefined, loggingV6Realm);
  try {
    let { audit } = await f.stores(); const event = loggingEvent('legacy-ack-lost');
    await f.legacyAppend([event]);
    const checkpoint = (await audit.verify()).checkpoint;
    const before = await audit.page({ kind: 'platform' });
    ({ audit } = await f.upgrade());
    expect(await audit.page({ kind: 'platform' })).toEqual(before);
    expect((await audit.append([event])).receipts[0]?.duplicate).toBe(true);
    await f.probe(crypto.randomUUID());
    expect((await audit.verify(0, checkpoint)).checkpoint).toEqual(checkpoint);
    expect((await audit.page({ kind: 'platform' })).events).toHaveLength(1);
    await audit.append([loggingEvent('new-generation')]);
    expect((await audit.verify(0, checkpoint)).checked).toBe(2);
  } finally { await f.close(); }
}, 30000);

test('private delivery challenges force fresh commits without changing activity totals or evidence heads', async () => {
  const f = await fixture();
  try {
    let { audit, operational } = await f.stores();
    await audit.append([loggingEvent('meaningful')]);
    const before = await audit.verify(), page = await audit.page({ kind: 'platform' });
    const beforeCounts = f.controlCounts();
    const nonce = crypto.randomUUID();
    await f.probe(nonce);
    await expect(f.probe(nonce)).rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
    await expect(f.probe(crypto.randomUUID(), 'operational')).rejects.toMatchObject({ code: 'DATABASE_OPERATION_UNSUPPORTED' });
    await expect(f.probe('invalid')).rejects.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
    for (let i = 0; i < 256; i++) await f.probe(crypto.randomUUID());
    expect(f.controlCounts()).toEqual({ receipts: beforeCounts.receipts, controls: 1 });
    expect(await audit.page({ kind: 'platform' })).toEqual(page);
    expect(await audit.verify()).toEqual(before);
    ({ audit, operational } = await f.restart());
    await f.probe(crypto.randomUUID());
    expect(f.controlCounts()).toEqual({ receipts: beforeCounts.receipts, controls: 1 });
    expect(await audit.verify()).toEqual(before);
    expect((await operational.page({ kind: 'platform' })).events).toHaveLength(0);
  } finally { await f.close(); }
}, 30000);

test('Fabric logging stores are physically independent, survive restart and isolate tenant/application queries', async () => {
  const f = await fixture();
  try {
    let { audit, operational } = await f.stores();
    await Promise.all([
      audit.append([loggingEvent('a', 'tenant-a'), loggingEvent('b', 'tenant-b'), loggingEvent('app', null)]),
      operational.append([loggingEvent('operational', null, { family: 'operational', action: 'app.warning', level: 'warn' })]),
    ]);
    expect((await audit.page({ kind: 'tenant', tenantId: 'tenant-a' })).events.map(row => row.event.id)).toEqual(['a']);
    expect((await audit.page({ kind: 'tenant', tenantId: 'tenant-b' })).events.map(row => row.event.id)).toEqual(['b']);
    expect((await audit.page({ kind: 'application' })).events.map(row => row.event.id)).toEqual(['app']);
    expect((await audit.page({ kind: 'platform' })).events).toHaveLength(3);
    expect((await operational.page({ kind: 'platform' })).events.map(row => row.event.id)).toEqual(['operational']);
    ({ audit, operational } = await f.restart());
    expect((await audit.page({ kind: 'tenant', tenantId: 'tenant-a' })).events[0]?.event.id).toBe('a');
    expect((await operational.page({ kind: 'platform' })).events).toHaveLength(1);
  } finally { await f.close(); }
}, 30000);

test('cursor helper reads can omit counts while ordinary scoped page totals remain exact', async () => {
  const f = await fixture();
  try {
    const { audit } = await f.stores(); await audit.append([loggingEvent('a'), loggingEvent('b'), loggingEvent('foreign', 'tenant-b')]);
    const scope = { kind: 'tenant' as const, tenantId: 'tenant-a' };
    const counted = await audit.page(scope, { limit: 1 }), helper = await audit.page(scope, { limit: 1, includeTotal: false });
    expect(counted.total).toBe(2); expect(helper).not.toHaveProperty('total');
    expect(helper.events).toEqual(counted.events); expect(helper.hasMore).toBe(true);
    expect((await audit.page(scope, { limit: 1, beforeOrdinal: counted.nextBeforeOrdinal! })).total).toBe(2);
    expect((await audit.page(scope, { includeTotal: true, actorId: 'absent' })).total).toBe(0);
    await expect(audit.page(scope, { includeTotal: 'false' } as any)).rejects.toMatchObject({ code: 'LOGGING_QUERY_INVALID' });
  } finally { await f.close(); }
}, 30000);

test('event identity prevents duplicates across regrouped batches; conflicting content rolls back the whole batch', async () => {
  const f = await fixture();
  try {
    const { audit } = await f.stores(), a = loggingEvent('a'), b = loggingEvent('b');
    const first = await audit.append([a]); expect(first.receipts[0]?.duplicate).toBe(false);
    expect((await audit.append([a])).receipts[0]?.duplicate).toBe(true);
    const regrouped = await audit.append([a, b, b]); expect(regrouped.receipts.map(item => item.duplicate)).toEqual([true, false, true]);
    await expect(audit.append([loggingEvent('must-not-commit'), loggingEvent('a', 'tenant-a', { outcome: 'denied' })])).rejects.toMatchObject({ code: 'LOGGING_EVENT_CONFLICT', outcome: 'not-committed' });
    expect((await audit.page({ kind: 'platform' })).events.map(row => row.event.id)).toEqual(['b', 'a']);
    const reopened = await f.restart();
    expect((await reopened.audit.append([a, b])).receipts.every(item => item.duplicate)).toBe(true);
  } finally { await f.close(); }
}, 30000);

test('holds fence pruning, retained proofs prevent expired event resurrection, and independent checkpoints remain comparable', async () => {
  const f = await fixture();
  try {
    const { audit } = await f.stores(), a = loggingEvent('held', 'tenant-a'), b = loggingEvent('expired', 'tenant-b');
    await audit.append([a, b]);
    const action = (name: string, id: string) => captureLoggingEvent(loggingContext('tenant-a'), { id: crypto.randomUUID(), family: 'investigations', action: name, outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: Date.now(), target: { type: 'logging.hold', id } });
    const hold = { id: 'hold-a', actorId: 'fixture-user', scope: { kind: 'tenant', tenantId: 'tenant-a' }, since: 1700000000000, until: 1700000000001, reasonRef: 'case-opaque' };
    await audit.evidenceCommand('logging.hold', { ...hold, auditEvent: action('logging.hold.created', 'hold-a') });
    const checkpoint = (await audit.verify()).checkpoint;
    expect(await audit.prune(Date.now() + 1000)).toBe(2);
    expect((await audit.page({ kind: 'platform' })).events.map(e => e.event.id)).toEqual(['held']);
    const replay = await audit.append([b]); expect(replay.receipts[0]?.duplicate).toBe(true);
    expect((await audit.page({ kind: 'tenant', tenantId: 'tenant-b' })).events).toHaveLength(0);
    await expect(audit.append([loggingEvent('expired', 'tenant-b', { outcome: 'failed' })])).rejects.toMatchObject({ code: 'LOGGING_EVENT_CONFLICT' });
    expect((await audit.verify(0, checkpoint)).expired).toBe(2);
    await expect(audit.evidenceCommand('logging.hold', { id: 'hold-a', actorId: 'fixture-user', scope: { kind: 'tenant', tenantId: 'tenant-b' }, release: true, auditEvent: action('logging.hold.released', 'hold-a') })).rejects.toThrow();
    await audit.evidenceCommand('logging.hold', { id: 'hold-a', actorId: 'fixture-user', scope: hold.scope, release: true, auditEvent: action('logging.hold.released', 'hold-a') });
    await audit.prune(Date.now() + 1000);
    expect((await audit.page({ kind: 'platform' })).events).toHaveLength(0);
    const final = await audit.verify(0, checkpoint); expect(final.expired).toBe(4);
    await expect(audit.verify(0, { ...checkpoint, hash: '0'.repeat(64) })).rejects.toThrow();
    const reopened = await f.restart(); expect((await reopened.audit.append([b])).receipts[0]?.duplicate).toBe(true);
    expect((await reopened.audit.verify()).expired).toBe(4);
  } finally { await f.close(); }
}, 30000);

test('review records are separate, scoped, idempotent and atomically accompanied by audit evidence', async () => {
  const f = await fixture();
  try {
    const { audit } = await f.stores(); await audit.append([loggingEvent('reviewed-event')]);
    const auditEvent = captureLoggingEvent(loggingContext('tenant-a'), { id: 'review-audit', family: 'investigations', action: 'logging.review.recorded', outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: Date.now(), target: { type: 'logging.review', id: 'review-a' } });
    const input = { id: 'review-a', actorId: 'fixture-user', scope: { kind: 'tenant', tenantId: 'tenant-a' }, query: { family: 'records' }, highWaterOrdinal: 1, result: 'follow-up', reference: 'ticket-opaque', auditEvent };
    await audit.evidenceCommand('logging.review', input); await audit.evidenceCommand('logging.review', input);
    expect((await audit.page({ kind: 'platform' })).events).toHaveLength(2);
    expect((await audit.evidence({ kind: 'tenant', tenantId: 'tenant-a' }) as any).reviews).toHaveLength(1);
    expect((await audit.evidence({ kind: 'tenant', tenantId: 'tenant-b' }) as any).reviews).toHaveLength(0);
    await expect(audit.evidenceCommand('logging.review', { ...input, id: 'not-recorded', auditEvent: { ...auditEvent, action: 'forged' } })).rejects.toThrow();
    expect((await audit.evidence({ kind: 'platform' }) as any).reviews).toHaveLength(1);
  } finally { await f.close(); }
}, 30000);

test('investigation pages keep a fixed high-water snapshot while new events arrive and obey date/actor/target filters', async () => {
  const f = await fixture();
  try {
    const { audit } = await f.stores();
    await audit.append([loggingEvent('one'), loggingEvent('two'), loggingEvent('three')]);
    const first = await audit.page({ kind: 'tenant', tenantId: 'tenant-a' }, { limit: 1 });
    expect(first.events[0]?.event.id).toBe('three'); expect(first.hasMore).toBe(true); expect(first.total).toBe(3);
    await audit.append([loggingEvent('four')]);
    const second = await audit.page({ kind: 'tenant', tenantId: 'tenant-a' }, { limit: 10, highWaterOrdinal: first.highWaterOrdinal, beforeOrdinal: first.nextBeforeOrdinal! });
    expect(second.events.map(row => row.event.id)).toEqual(['two', 'one']);
    expect(second.total).toBe(3);
    const liveOlder = await audit.page({ kind: 'tenant', tenantId: 'tenant-a' }, { limit: 1, beforeOrdinal: first.nextBeforeOrdinal! });
    expect(liveOlder.total).toBe(4); expect(liveOlder.events[0]!.event.id).toBe('two');
    expect((await audit.page({ kind: 'tenant', tenantId: 'no-matching-tenant' })).total).toBe(0);
    expect((await audit.page({ kind: 'tenant', tenantId: 'tenant-a' }, { since: 1700000000000, until: 1700000000001, actorId: 'fixture-user', targetId: 'record-1' })).events).toHaveLength(4);
    expect((await audit.page({ kind: 'tenant', tenantId: 'tenant-a' }, { until: 1700000000000 })).events).toHaveLength(0);
  } finally { await f.close(); }
}, 30000);

test('bounded writer acknowledgments reflect actual Fabric commits and preserve immutable event inputs', async () => {
  const f = await fixture(); let writer: LoggingWriter | undefined;
  try {
    const { audit } = await f.stores(); writer = new LoggingWriter(audit, resolveLoggingConfig(true).queue);
    const input = JSON.parse(JSON.stringify(loggingEvent('captured')));
    const result = writer.write(input); input.actor.id = 'mutated'; input.target.id = 'mutated';
    const receipt = await result; expect(receipt.id).toBe('captured'); await writer.stop();
    expect((await audit.page({ kind: 'tenant', tenantId: 'tenant-a' })).events[0]?.event).toMatchObject({ actor: { id: 'fixture-user' }, target: { id: 'record-1' } });
  } finally { await writer?.stop().catch(() => undefined); await f.close(); }
}, 30000);

test('a lost acknowledgment after the real actor commit is safely replayed with the original event identity', async () => {
  let lost = true;
  const f = await fixture(() => { if (lost) { lost = false; throw new Error('Synthetic response lost after commit'); } });
  try {
    const { audit } = await f.stores(), event = loggingEvent('lost-ack');
    await expect(audit.append([event])).rejects.toMatchObject({ code: 'LOGGING_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect((await audit.append([event])).receipts[0]?.duplicate).toBe(true);
    expect((await audit.page({ kind: 'platform' })).events.map(row => row.event.id)).toEqual(['lost-ack']);
  } finally { await f.close(); }
}, 30000);

test('large valid evidence is split into bounded actor batches and paged without exceeding Fabric result limits', async () => {
  const f = await fixture(); let writer: LoggingWriter | undefined;
  try {
    const { audit } = await f.stores(); writer = new LoggingWriter(audit, resolveLoggingConfig({ queue: { batchSize: 100 } }).queue);
    const metadata = Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['field' + i, 'x'.repeat(256)]));
    const events = Array.from({ length: 90 }, (_, i) => captureLoggingEvent(loggingContext(), {
      id: 'large-' + i, family: 'records', action: 'record.read', outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: 1, metadata,
    }, Object.keys(metadata)));
    await Promise.all(events.map(event => writer!.write(event))); await writer.stop();
    const first = await audit.page({ kind: 'tenant', tenantId: 'tenant-a' }, { limit: 100 });
    expect(first.events.length).toBeGreaterThan(0); expect(first.events.length).toBeLessThan(90); expect(first.hasMore).toBe(true);
    const second = await audit.page({ kind: 'tenant', tenantId: 'tenant-a' }, { limit: 100, highWaterOrdinal: first.highWaterOrdinal, beforeOrdinal: first.nextBeforeOrdinal! });
    expect(first.events.length + second.events.length).toBe(90); expect(second.hasMore).toBe(false);
    expect(new Set([...first.events, ...second.events].map(row => row.event.id)).size).toBe(90);
  } finally { await writer?.stop().catch(() => undefined); await f.close(); }
}, 30000);
