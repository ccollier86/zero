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

async function fixture(afterWrite?: () => void) {
  const root = await mkdtemp(join(tmpdir(), 'logging-fabric-'));
  let coordinator: DatabaseCoordinator; const leases = new Set<DatabaseCoordinatorLease>();
  const start = () => {
    coordinator = new DatabaseCoordinator({ rootDirectory: join(root, 'databases'), realm: loggingRealm, sqlite: { synchronous: 'FULL' },
      maxDatabases: 2, readers: true, sweepIntervalMs: false,
      createExecutor: createSubprocessDatabaseExecutorFactory({ launch: { kind: 'source', entrypoint: new URL('./test-support/logging-actor.fixture.ts', import.meta.url) }, env: {},
        executor: { startupTimeoutMs: 5000, operationTimeoutMs: 10000, shutdownAckTimeoutMs: 2000, shutdownExitTimeoutMs: 2000 } }),
    }); coordinator.start();
  };
  start();
  const stores = async () => {
    const bind = async (stream: 'audit' | 'operational') => {
      const lease = await coordinator.acquire('logging:' + stream); leases.add(lease);
      return new LoggingFabricStore(createAsyncDatabaseClient({ executor: { execute: async (operation: any, options: any) => {
        const result = await lease.execute(operation, options); if (operation.type === 'command') afterWrite?.(); return result;
      } } as AsyncDatabaseOperationExecutor }), stream);
    };
    return { audit: await bind('audit'), operational: await bind('operational') };
  };
  const closeOwner = async () => { for (const lease of leases) lease.release(); leases.clear(); await coordinator.close(); };
  return { stores, async restart() { await closeOwner(); start(); return stores(); },
    async close() { try { await closeOwner(); } finally { await rm(root, { recursive: true, force: true }); } } };
}

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

test('investigation pages keep a fixed high-water snapshot while new events arrive and obey date/actor/target filters', async () => {
  const f = await fixture();
  try {
    const { audit } = await f.stores();
    await audit.append([loggingEvent('one'), loggingEvent('two'), loggingEvent('three')]);
    const first = await audit.page({ kind: 'tenant', tenantId: 'tenant-a' }, { limit: 1 });
    expect(first.events[0]?.event.id).toBe('three'); expect(first.hasMore).toBe(true);
    await audit.append([loggingEvent('four')]);
    const second = await audit.page({ kind: 'tenant', tenantId: 'tenant-a' }, { limit: 10, highWaterOrdinal: first.highWaterOrdinal, beforeOrdinal: first.nextBeforeOrdinal! });
    expect(second.events.map(row => row.event.id)).toEqual(['two', 'one']);
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
