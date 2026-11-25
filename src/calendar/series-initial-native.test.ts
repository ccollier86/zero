/** Actual private native realm/Guardian MEMORY evidence. This is not physical
 * actor transport, managed compliance or exact-package release qualification. */
import { expect, test } from 'bun:test';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { admitCalendarRequest } from './authority';
import { readCalendarRejection } from './error';
import { prepareCalendarInitialSeriesRequest, compileCalendarInitialSeriesRequest } from './series-source-writer';
import { createCalendarSeriesNativeSourceReader } from './series-native-source';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { calendarHash, calendarJson } from './validation';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';
import { seriesMaterializationWriterFixture } from './test-support/series-materialization-writer-fixture';

async function fixture() {
  const auth = memoryCalendarServiceFixture(), native = seriesMaterializationWriterFixture();
  try {
    const session = auth.session('synthetic-user', { tenantId: 'synthetic-materialization', manager: true });
    const authority = await admitCalendarRequest(session.authority, auth.config, new AbortController().signal);
    const request = prepareCalendarInitialSeriesRequest(authority, 'real-initial-native-plan', native.snapshot.authoring, auth.config);
    const compiled = compileCalendarInitialSeriesRequest(request);
    const packet = () => native.transport.sealInitial(request, compiled, native.ownerRecord, 60_000);
    const execute = (input: unknown) => runDatabaseRealmCommand(native.realm, native.reactive, 'calendar.series.source.accept',
      cloneDatabaseSerializableValue(input), native.transport.writerPolicy as never) as { ok: true; value: { seriesId: string; preparationId: string; operation: string } };
    return { auth, native, authority, request, compiled, packet, execute, async close() { try { native.close(); } finally { await auth.close(); } } };
  } catch (error) { native.close(); await auth.close(); throw error; }
}

test('real human initial proof crosses the actual private native command and retains one source/grant/effect on exact replay', async () => {
  const f = await fixture();
  try {
    const { native: n } = f, before = n.reactive.currentSeq, first = f.execute(f.packet().envelope);
    expect(first.ok).toBe(true); expect(first.value.operation).toBe('series.plan.accepted'); expect(n.reactive.currentSeq).toBeGreaterThan(before);
    const accepted = n.db.serialize(), seq = n.reactive.currentSeq;
    expect(f.execute(f.packet().envelope)).toEqual(first); expect(n.db.serialize()).toEqual(accepted); expect(n.reactive.currentSeq).toBe(seq);
    expect(n.db.query('SELECT count(*) AS n FROM _calendar_series_effect_intents WHERE series_id=?').get(first.value.seriesId)).toEqual({ n: 1 });
    expect(n.db.query('SELECT count(*) AS n FROM _calendar_series_grants WHERE series_id=?').get(first.value.seriesId)).toEqual({ n: 1 });
    const reader = createCalendarSeriesNativeSourceReader({ owner: n.ownerRecord, policyGeneration: n.snapshot.policyGeneration, signal: f.authority.signal,
      assertOwnerCurrent(owner) { expect(calendarJson(owner)).toBe(calendarJson(n.ownerRecord)); },
      assertSeriesAuthorityCurrent(generation) { expect(generation).toBe(n.snapshot.policyGeneration); } });
    const snapshot = withDatabaseReadQuerySession(createDatabaseReadQuerySession(n.db), context => reader(context, first.value.seriesId));
    expect(snapshot.preparationId).toBe(first.value.preparationId); expect(snapshot.authoringDigest).toBe(calendarHash(n.snapshot.authoring));
    expect(n.db.query('SELECT * FROM _calendar_series_run_publications').all()).toEqual([]);
    expect(n.db.query('SELECT * FROM calendar_appointments').all()).toEqual([]);
  } finally { await f.close(); }
});

test('tampered initial proof and invented runtime handles are rejected without source acceptance or native sequence change', async () => {
  const f = await fixture();
  try {
    const before = f.native.db.serialize(), seq = f.native.reactive.currentSeq;
    const packet = f.packet(), changed = { ...packet.envelope, logicalKey: 'different-key' };
    let error: unknown;
    try { f.execute(changed); } catch (caught) { error = caught; }
    expect(readCalendarRejection(error)?.code).toBe('CALENDAR_FORBIDDEN');
    expect(f.native.db.serialize()).toEqual(before); expect(f.native.reactive.currentSeq).toBe(seq);
    expect(() => f.native.transport.sealInitial({} as never, f.compiled, f.native.ownerRecord, 60_000)).toThrow();
    expect(() => f.native.transport.sealInitial(f.request, {} as never, f.native.ownerRecord, 60_000)).toThrow();
    expect(f.native.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { await f.close(); }
});
