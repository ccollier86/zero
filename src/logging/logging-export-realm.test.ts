/** Actual SQLite transactions: mutable export state must be bound to retained immutable evidence. */
import { expect, test, setSystemTime } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { runDatabaseRealmCommand, type DatabaseReadQueryContext } from '../databases/database-realm';
import { loggingRealm } from './logging-realm';
import { LOGGING_TABLES } from './logging-schema';
import { LOGGING_GENESIS_HASH } from './logging-evidence-realm';
import { readLoggingExport } from './logging-export-realm';
import { loggingContext } from './test-support/logging-fixture';
import { captureLoggingEvent } from './logging-validation';
import { normalizeLoggingQuery } from './logging-query';
import { loggingDigest } from './logging-hash';
import type { OwnedLoggingExportJob } from './logging-export-realm';

function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  for (const [name, columns] of Object.entries(LOGGING_TABLES)) db.defineTable(name, columns);
  db.createStrict('logging_chain', { id: 'head', ordinal: 0, hash: LOGGING_GENESIS_HASH });
  const scope = { kind: 'tenant' as const, tenantId: 'tenant-a' };
  const query = normalizeLoggingQuery('audit', scope, { highWaterOrdinal: 0, limit: 100 }).query;
  const audit = (action: string) => captureLoggingEvent(loggingContext(), { id: action, family: 'investigations', action, occurredAt: Date.now(),
    outcome: 'succeeded', evidence: 'server-confirmed', target: { type: 'logging.export', id: 'export-fixture' },
    metadata: { queryDigest: loggingDigest(['audit', scope, query]) } }, ['queryDigest']);
  const command = (name: string, value: unknown) => runDatabaseRealmCommand(loggingRealm, db, name, value as any) as unknown as OwnedLoggingExportJob;
  const context = { database: { query: (sql: string) => db.prepare(sql) } } as unknown as DatabaseReadQueryContext;
  const read = () => readLoggingExport(context, { scope, id: 'export-fixture' });
  const reserve = () => command('logging.export.reserve', { id: 'export-fixture', stream: 'audit', scope, query, actorId: 'fixture-user', expiresAt: Date.now() + 60000,
    auditEvent: audit('logging.export.requested') });
  return { db, read, reserve, command, audit };
}

test('export ready state, checksum, expiry and scope cannot be altered independently of its audit proof', () => {
  const f = fixture();
  try {
    f.reserve();
    const ready = f.command('logging.export.transition', { id: 'export-fixture', state: 'ready', count: 0, complete: true, nextBeforeOrdinal: null,
      sha256: 'a'.repeat(64), auditEvent: f.audit('logging.export.artifact.ready') });
    expect(f.read()!.job).toEqual(ready.job);
    for (const [column, value] of [['sha256', 'b'.repeat(64)], ['expires_at', ready.job.expiresAt + 1], ['state', 'pending'], ['actor_id', 'forged-actor']] as const) {
      const original = f.db.get('logging_exports', 'export-fixture')![column];
      f.db.prepare(`UPDATE logging_exports SET ${column}=? WHERE id=?`).run(value, 'export-fixture');
      expect(() => f.read()).toThrow(); expect(() => f.reserve()).toThrow();
      f.db.prepare(`UPDATE logging_exports SET ${column}=? WHERE id=?`).run(original as string | number, 'export-fixture');
    }
    expect(f.read()!.job.sha256).toBe('a'.repeat(64));
  } finally { f.db.dispose(); }
});

test('an invalid ready transition rolls back state and evidence in the same actor transaction', () => {
  const f = fixture();
  try {
    f.reserve(); const before = f.db.list('logging_events').length;
    expect(() => f.command('logging.export.transition', { id: 'export-fixture', state: 'ready', count: 0, complete: true, nextBeforeOrdinal: null,
      sha256: 'a'.repeat(64), auditEvent: f.audit('logging.export.failed') })).toThrow();
    expect(f.read()!.job.state).toBe('pending'); expect(f.db.list('logging_events')).toHaveLength(before);
  } finally { f.db.dispose(); }
});

test('expiry retires download state and artifact cleanup releases capacity exactly once with evidence', () => {
  setSystemTime(new Date('2030-01-01T00:00:00Z')); const f = fixture();
  try {
    const pending = f.reserve(); setSystemTime(new Date(pending.job.expiresAt + 1));
    f.command('logging.export.transition', { id: 'export-fixture', state: 'expired', auditEvent: f.audit('logging.export.expired') });
    expect(f.read()!.job.state).toBe('expired'); expect(f.db.get('logging_state', 'export-capacity')!.ordinal).toBe(1);
    const cleanup = { id: 'export-fixture', state: 'expired', artifactRemoved: true, auditEvent: f.audit('logging.export.artifact.removed') };
    f.command('logging.export.transition', cleanup); f.command('logging.export.transition', cleanup);
    expect(f.db.get('logging_state', 'export-capacity')!.ordinal).toBe(0); expect(f.read()!.artifactRemoved).toBe(true);
    expect(f.db.list('logging_events').map(e => e.action)).toEqual(['logging.export.requested', 'logging.export.expired', 'logging.export.artifact.removed']);
  } finally { f.db.dispose(); setSystemTime(); }
});
