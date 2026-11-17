/** Actual native writer receipt ledger, in-memory SQLite only; no actor, file or bundled deployment qualification. */
import { expect, test } from 'bun:test';
import { createPlatformSQLiteService } from '../persistence';
import { DatabaseError } from '../databases/database-error';
import { DatabaseRuntime } from '../databases/database-runtime';
import { DatabaseWriterOperationEngine } from '../databases/database-writer-engine';
import { defineDatabaseRealm } from '../databases/database-realm';
import type { DatabaseCommitResult } from '../databases/database-operations';
import type { CalendarActor } from './contracts';
import { calendarRealm } from './realm';
import { calendarHash } from './validation';

test('actual native receipt fingerprints include the entire command input, not only its transport key', () => {
  const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
  let runtime: DatabaseRuntime | undefined, engine: DatabaseWriterOperationEngine | undefined;
  try {
    sqlite.raw.run('PRAGMA temp_store=MEMORY');
    runtime = DatabaseRuntime.open({ id: 'synthetic-native-calendar', role: 'service', sqlite, ownsSQLite: true, tables: calendarRealm.tables });
    for (const migration of calendarRealm.migrations) migration.up(sqlite.raw);
    engine = new DatabaseWriterOperationEngine({ runtime, realm: calendarRealm });
    const actor: CalendarActor = { scopeId: 'application', userId: 'owner', principal: 'session:owner', manageAll: true, createOwn: true };
    engine.execute({ type: 'command', name: 'calendar.owner.bind', input: { ownerId: 'synthetic-owner', scopeId: actor.scopeId }, idempotencyKey: 'synthetic-owner-bind' });
    const input = { actor, requestId: 'synthetic-request', id: 'synthetic-resource', label: 'Original', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' };
    const operation = { type: 'command' as const, name: 'calendar.resource.create', input,
      idempotencyKey: 'calendar-command:' + calendarHash([calendarRealm.fingerprint, actor, input.requestId, 'calendar.resource.create']) };
    const first = engine.execute(operation) as DatabaseCommitResult, seq = runtime.db.currentSeq;
    expect(first.replayed).toBe(false);
    const exact = engine.execute(operation) as DatabaseCommitResult;
    expect(exact.replayed).toBe(true); expect(exact.value).toEqual(first.value); expect(runtime.db.currentSeq).toBe(seq);
    let failure: unknown;
    try { engine.execute({ ...operation, input: { ...input, label: 'Different body with the same key' } }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(DatabaseError);
    expect(failure).toMatchObject({ code: 'DATABASE_CONFLICT', outcome: 'not-committed', retryable: false,
      details: { conflictType: 'idempotency-key-reused' } });
    expect(runtime.db.currentSeq).toBe(seq);
    expect(runtime.db.get('calendar_resources', input.id)!.label).toBe('Original');
    expect(runtime.db.prepare('SELECT count(*) AS count FROM _calendar_receipts').get()).toEqual({ count: 1 });
    // Model an admitted same-schema realm generation change in memory. The
    // domain receipt remains canonical, but native receipts are realm-bound.
    const upgraded = defineDatabaseRealm({ name: calendarRealm.name, version: 'synthetic-next', tables: calendarRealm.tables,
      migrations: calendarRealm.migrations, commands: calendarRealm.commands, queries: calendarRealm.queries });
    expect(upgraded.fingerprint).not.toBe(calendarRealm.fingerprint);
    engine.close(); engine = new DatabaseWriterOperationEngine({ runtime, realm: upgraded });
    expect(() => engine!.execute(operation)).toThrow(expect.objectContaining({ code: 'DATABASE_CONFLICT', outcome: 'not-committed' }));
    const reconciled = engine.execute({ ...operation,
      idempotencyKey: 'calendar-command:' + calendarHash([upgraded.fingerprint, actor, input.requestId, operation.name]) }) as DatabaseCommitResult;
    expect(reconciled.replayed).toBe(false); expect(reconciled.value).toEqual(first.value);
    expect(runtime.db.currentSeq).toBe(seq);
    expect(runtime.db.prepare('SELECT count(*) AS count FROM _calendar_receipts').get()).toEqual({ count: 1 });
  } finally {
    try { engine?.close(); }
    finally { if (runtime) runtime.close(); else sqlite.close(); }
  }
});
