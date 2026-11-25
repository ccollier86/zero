/** Actual private022 realm/controller on synthetic SQLite MEMORY. No actor
 * process, physical database, browser or archive qualification is implied. */
import { expect, test } from 'bun:test';
import { Migrator } from '../migrations/migrator';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { registerReactiveDBCommitGuard } from '../sync/reactive-db';
import { seriesMaterializationWriterFixture } from './test-support/series-materialization-writer-fixture';
import { calendarSeriesChildrenRealm as realm } from './series-children-realm';
import { createCalendarSeriesNativeOwner, type CalendarSeriesNativeOwnerDependencies } from './series-runtime-owner';
import { createCalendarSeriesMaterializationController } from './series-materialization-controller';
import { CALENDAR_SERIES_CHILD_TABLES as c } from './realm-series-children-migration';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as n } from './realm-series-materialization-migration';
import { CalendarError, readCalendarRejection } from './error';
import { calendarJson } from './validation';

test('selected native owner/controller automatically budgets same-transaction child derivation and resumes without duplicate publication', async () => {
  const base = seriesMaterializationWriterFixture({ resources: 16, count: 10, windowUntil: '2030-01-11' }, {
    realm, install(database) {
      const migrator = new Migrator({ database, dbPath: ':memory:', createBackups: false, log() {}, migrations: realm.migrations, migrationTableStages: realm.migrationTableStages });
      try { migrator.run('022'); } finally { migrator.dispose(); }
    },
  });
  let owner: ReturnType<typeof createCalendarSeriesNativeOwner> | undefined;
  const stop = new AbortController(); let finalChecks = 0;
  try {
    owner = createCalendarSeriesNativeOwner({ profile: 'selected-children-v1', owner: base.ownerRecord, transport: base.transport, signal: stop.signal,
      assertOwnerCurrent(value) { if (calendarJson(value) !== calendarJson(base.ownerRecord)) throw new CalendarError('CALENDAR_FORBIDDEN'); },
      assertSeriesPolicyCurrent(_scope, generation) { if (generation !== base.snapshot.policyGeneration) throw new CalendarError('CALENDAR_POLICY_STALE'); },
      async execute<T>(...args: Parameters<CalendarSeriesNativeOwnerDependencies['execute']>): Promise<T> {
        const [kind, name, input, operation] = args; operation.guard();
        if (kind === 'query') return base.query(name, input as Record<string, unknown>) as T;
        const remove = registerReactiveDBCommitGuard(base.reactive, { capture() { return 1; }, beforeCommit() {
          operation.guard(); operation.finalCommitGuard?.(); finalChecks++; return undefined;
        } });
        try {
          const result = runDatabaseRealmCommand(realm, base.reactive, name, input, base.transport.writerPolicy as never) as unknown as { ok: true; value: T };
          if (!result.ok) throw new Error('Expected actual native receipt'); return result.value;
        } catch (error) { throw readCalendarRejection(error) ?? error; }
        finally { remove(); }
      },
    });
    expect(owner.profile).toBe('selected-children-v1');
    const window = { runId: base.runId, sourcePublicationId: base.beginPayload.sourcePublicationId, windowFromMs: base.beginPayload.windowFromMs,
      windowUntilMs: base.beginPayload.windowUntilMs, nominalFrom: base.beginPayload.nominalFrom, nominalUntil: base.beginPayload.nominalUntil };
    // Recreate the controller every turn: only its durable cursor/progress may
    // determine what has been accepted; no long-lived in-process cache required.
    let result;
    for (let turn = 0; turn < 100; turn++) {
      result = await createCalendarSeriesMaterializationController({ owner, transport: base.transport, source: base.source, window }).run({ maxCommands: 4 });
      if (result.state === 'published' && !result.cleanupPending) break;
      expect(['pending', 'published']).toContain(result.state);
    }
    expect(result).toMatchObject({ state: 'published', cleanupPending: false }); expect(finalChecks).toBeGreaterThan(5);
    expect(base.db.query(`SELECT count(*) AS n FROM ${c.heads}`).get()).toEqual({ n: 10 });
    expect(base.db.query(`SELECT count(*) AS n FROM ${c.resources}`).get()).toEqual({ n: 160 });
    expect(base.db.query(`SELECT count(*) AS n FROM ${c.viewPublications}`).get()).toEqual({ n: 1 });
    expect(base.db.query(`SELECT max(row_count) AS n FROM ${n.receipts}`).get()).toMatchObject({ n: expect.any(Number) });
    expect(Number((base.db.query(`SELECT max(row_count) AS n FROM ${n.receipts}`).get() as { n: number }).n)).toBeLessThanOrEqual(256);
    const before = { bytes: base.db.serialize(), sequence: base.reactive.currentSeq };
    await expect(createCalendarSeriesMaterializationController({ owner, transport: base.transport, source: base.source, window }).run())
      .resolves.toMatchObject({ state: 'published', commands: 0, cleanupPending: false });
    expect({ bytes: base.db.serialize(), sequence: base.reactive.currentSeq }).toEqual(before);
    // Legacy writes cannot treat a recurring child as a copied ordinary row or
    // silently choose a recurrence edit scope. Hidden objects stay hidden.
    const child = base.db.query<{ appointment_id: string }, []>(`SELECT appointment_id FROM ${c.heads} ORDER BY appointment_id LIMIT 1`).get()!;
    for (const [name, fields] of Object.entries({
      'calendar.appointment.cancel': { confirmed: true }, 'calendar.appointment.update': { title: 'Changed' },
      'calendar.appointment.reschedule': { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
      'calendar.appointment.transition': { status: 'cancelled', policyRevision: 1, reason: null },
      'calendar.appointment.participants': { references: [] },
    })) {
      const write = (actor = base.actor) => runDatabaseRealmCommand(realm, base.reactive, name, cloneDatabaseSerializableValue({
        actor, id: child.appointment_id, expectedRevision: 1, requestId: 'legacy-refusal', ...fields,
      }), base.transport.writerPolicy as never);
      try { write(); throw new Error('Expected canonical-series action requirement'); }
      catch (error) { expect(readCalendarRejection(error)?.code).toBe('CALENDAR_SERIES_ACTION_REQUIRED'); }
      try { write({ ...base.actor, userId: 'unrelated-user', principal: 'unrelated', manageAll: false }); throw new Error('Expected hidden target'); }
      catch (error) { expect(readCalendarRejection(error)?.code).toBe('CALENDAR_NOT_FOUND'); }
    }
    expect({ bytes: base.db.serialize(), sequence: base.reactive.currentSeq }).toEqual(before);
    base.command('calendar.appointment.create', { id: 'ordinary', requestId: 'ordinary-create', resourceIds: ['r'], title: 'ORDINARY_TITLE',
      startAt: '2030-01-01T07:00:00.000Z', endAt: '2030-01-01T08:00:00.000Z', timeZone: 'UTC' });
    expect(base.command('calendar.appointment.cancel', { id: 'ordinary', requestId: 'ordinary-cancel', expectedRevision: 1, confirmed: true }))
      .toEqual({ ok: true, value: { requestId: 'ordinary-cancel', operation: 'appointment.cancelled', id: 'ordinary', revision: 2, changed: true } });
    expect(base.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { owner?.close(); stop.abort(); base.close(); }
}, 60_000);
