/** Actual private realm/native SQLite MEMORY; physical latency, actor transport,
 * real SYSTEM final admission and sparse UTC certificates remain separate gates. */
import { expect, test } from 'bun:test';
import { seriesMaterializationWriterFixture as fixture } from './test-support/series-materialization-writer-fixture';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as t } from './realm-series-materialization-migration';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { registerReactiveDBCommitGuard } from '../sync/reactive-db';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { createCalendarSeriesPublishedSourceReader } from './series-native-source';
import { captureCalendarSeriesCompilationSource, restoreCalendarSeriesCompilationCursor, continueCalendarSeriesCompilationWindow, compileCalendarSeriesBatch } from './series-compilation';
import { createCalendarSeriesProjection, advanceCalendarSeriesProjection, inspectCalendarSeriesProjection } from './series-projection';
import { calendarHash as h, calendarJson } from './validation';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
function rejects(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected publication refusal'); }
  catch (error) { expect(error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code).toBe(code); }
}
function snapshot(f: ReturnType<typeof fixture>) { return { bytes: f.db.serialize(), sequence: f.reactive.currentSeq }; }
function drain(f: ReturnType<typeof fixture>) {
  let cursor = f.projection;
  for (let index = 0; index < 1000; index++) { const next = f.stage(cursor); cursor = next.step.cursor; if (next.step.progress.checkpoint.phase === 'complete') return; }
  throw new Error('Synthetic projection did not complete');
}
function occupancy(f: ReturnType<typeof fixture>) {
  return f.query('calendar.seriesOccupancy', { scopeId: f.snapshot.scopeId, resourceIds: ['r'], occupiedStartMs: Date.parse('2030-01-01T10:00:00.000Z'), occupiedEndMs: Date.parse('2030-01-01T11:00:00.000Z'), nowMs: Date.now() });
}

test('complete native preparation publishes021 and initial020 atomically, then bounded cleanup preserves published occupancy and replay', () => {
  const f = fixture();
  try {
    f.begin(); drain(f); expect(f.prepare(8)).toBeGreaterThan(1);
    expect(f.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]);
    expect(f.db.query(`SELECT * FROM ${t.publications}`).all()).toEqual([]);
    expect(occupancy(f)).toMatchObject({ currentConflict: false, pendingConflict: true });
    const accepted = f.publish(); expect(accepted.ok).toBe(true);
    expect(f.head()).toMatchObject({ state: 'published', phase: 'current', working_member_count: 3 });
    expect(f.db.query('SELECT published_generation_id,published_publication_id,active_preparation_id FROM calendar_series').get()).toEqual({ published_generation_id: f.snapshot.generationId, published_publication_id: f.beginPayload.sourcePublicationId, active_preparation_id: null });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.continuationHeads}`).get()).toEqual({ n: 1 });
    const before = snapshot(f); expect(f.publish()).toEqual(accepted); expect(snapshot(f)).toEqual(before);
    expect(f.cleanup(1)).toBe(3); expect(f.db.query(`SELECT * FROM ${t.claims}`).all()).toEqual([]);
    expect(occupancy(f)).toEqual({ currentConflict: true, pendingConflict: false, reconciliationNeeded: false });
    const afterCleanup = snapshot(f); expect(f.publish()).toEqual(accepted); expect(snapshot(f)).toEqual(afterCleanup);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('late publication commit failure rolls back020/021 markers, selectors, head, effects, receipts and tracked sequence together', () => {
  const f = fixture(); let remove: (() => void) | undefined;
  try {
    f.begin(); drain(f); f.prepare(); const before = snapshot(f);
    remove = registerReactiveDBCommitGuard(f.reactive, { capture: () => 0, beforeCommit() { throw new CalendarError('CALENDAR_FORBIDDEN'); } });
    rejects(() => f.publish(), 'CALENDAR_FORBIDDEN'); expect(snapshot(f)).toEqual(before);
    remove(); remove = undefined; f.publish(); expect(f.head().state).toBe('published');
  } finally { remove?.(); f.close(); }
}, 30_000);

test('publication rejects incomplete preparation and a late shared catalog retirement that does not change resource revisions', () => {
  const f = fixture({ typed: true });
  try {
    f.begin(); drain(f);
    const unprepared = f.transport.sealSource(f.source, 'calendar.series.run.publish', 'too-early', { runId: f.runId, expectedRevision: Number(f.head().revision) });
    rejects(() => f.execute(unprepared), 'CALENDAR_NOT_READY'); f.prepare();
    f.command('calendar.type.replace', { id: 'consult', requestId: 'retire-type', expectedRevision: 1, label: 'Retired synthetic type', durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null, active: false });
    expect(f.db.query('SELECT revision FROM calendar_resources WHERE id=\'r\'').get()).toEqual({ revision: 1 });
    const before = snapshot(f); rejects(() => f.publish(), 'CALENDAR_TYPE_STALE'); expect(snapshot(f)).toEqual(before);
    expect(f.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('maximum544-cell occurrence prepares bounded projections, publishes the entire manifest and keeps reservations after cleanup', () => {
  const f = fixture({ resources: 16, durationMs: 31 * 86_400_000, before: 1440, after: 1440, count: 1, start: '2030-01-01T00:30:00.000', windowUntil: '2030-01-02' });
  try {
    f.begin(); drain(f); const steps = f.prepare(); expect(steps).toBeGreaterThan(1); expect(steps).toBeLessThan(30);
    f.publish(); f.cleanup();
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.selectors}`).get()).toEqual({ n: 544 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.workingMembers}`).get()).toEqual({ n: 544 });
    expect(occupancy(f)).toEqual({ currentConflict: true, pendingConflict: false, reconciliationNeeded: false });
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 60_000);

test('repeated native horizons preserve shared UTC cells and qualified COUNT under the same authored generation, grant and publication', () => {
  const f = fixture({ count: 5, start: '2030-01-01T23:30:00.000', windowUntil: '2030-01-02' });
  try {
    f.begin(); drain(f); f.prepare(); f.publish(); f.cleanup();
    for (let day = 2; day <= 3; day++) {
      const runId = 'native-horizon-' + day, from = '2030-01-0' + day, until = '2030-01-0' + (day + 1);
      const window = Object.freeze({ runId, seriesId: f.snapshot.seriesId, sourcePublicationId: f.beginPayload.sourcePublicationId, createdAtMs: Date.now(), expiresAtMs: Date.now() + 600_000 });
      const reader = createCalendarSeriesPublishedSourceReader({ owner: f.ownerRecord, policyGeneration: f.snapshot.policyGeneration, signal: new AbortController().signal,
        assertOwnerCurrent(selected) { expect(selected).toEqual(f.ownerRecord); }, assertSeriesAuthorityCurrent(generation) { expect(generation).toBe(f.snapshot.policyGeneration); },
        assertWindowCurrent(selected) { expect(calendarJson(selected)).toBe(calendarJson(window)); } }, window);
      const observed = withDatabaseReadQuerySession(createDatabaseReadQuerySession(f.db), reader), source = captureCalendarSeriesCompilationSource(observed.snapshot, { maxResources: 16, maxParticipants: 100 });
      if (!observed.continuation) throw new Error('Synthetic published source lacks current continuation');
      const previous = observed.continuation, oldRange = (previous.checkpoint as { range: { from: string; until: string } }).range;
      const restored = restoreCalendarSeriesCompilationCursor(source, oldRange, previous.checkpoint, previous.progressDigest);
      const batch = compileCalendarSeriesBatch(source, continueCalendarSeriesCompilationWindow(source, restored, { from, until }));
      let projection = createCalendarSeriesProjection(source, batch.contribution, batch.evidence.batchDigest, { runId });
      const head = () => f.db.query(`SELECT * FROM ${t.runState} WHERE id=?`).get(runId) as Record<string, unknown>;
      f.execute(f.transport.sealSource(source, 'calendar.series.run.begin', 'begin-' + day, cloneDatabaseSerializableValue({ runId, kind: 'horizon', sourcePublicationId: window.sourcePublicationId,
        windowFromMs: Date.parse(from + 'T00:00:00.000Z'), windowUntilMs: Date.parse(until + 'T00:00:00.000Z'), nominalFrom: from, nominalUntil: until,
        initialProgressDigest: previous.progressDigest, initialProjectionCheckpoint: inspectCalendarSeriesProjection(projection).checkpoint })));
      for (let steps = 0; steps < 20; steps++) {
        const step = advanceCalendarSeriesProjection(projection); projection = step.cursor; f.execute(f.transport.sealProjection(source, step.cursor, step.stepDigest));
        if (step.progress.checkpoint.phase === 'complete') break;
      }
      for (let steps = 0; steps < 100; steps++) {
        const q = head(); if (JSON.parse(String(q.publication_cursor_json)).phase === 'ready') break;
        f.execute(f.transport.sealSource(source, 'calendar.series.run.seal', h(['prepare', runId, q.revision]), { runId, expectedRevision: Number(q.revision), limit: 16 }));
      }
      f.execute(f.transport.sealSource(source, 'calendar.series.run.publish', 'publish-' + day, { runId, expectedRevision: Number(head().revision) }));
      const binding = JSON.parse(String((f.db.query(`SELECT source_binding_json FROM ${t.runs} WHERE id=?`).get(runId) as Record<string, unknown>).source_binding_json));
      f.execute(f.transport.sealRetirement(binding, 'cleanup-' + day, { runId, expectedRevision: Number(head().revision), cleanupOnly: true, limit: 128 }));
      expect(f.query('calendar.seriesOccupancy', { scopeId: f.snapshot.scopeId, resourceIds: ['r'], occupiedStartMs: Date.parse(from + 'T00:15:00.000Z'), occupiedEndMs: Date.parse(from + 'T00:20:00.000Z'), nowMs: Date.now() }))
        .toEqual({ currentConflict: true, pendingConflict: false, reconciliationNeeded: false });
    }
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_generations').get()).toEqual({ n: 1 });
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_grants').get()).toEqual({ n: 1 });
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_receipts').get()).toEqual({ n: 1 });
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_publications').get()).toEqual({ n: 1 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.publications}`).get()).toEqual({ n: 3 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.workingMembers}`).get()).toEqual({ n: 6 });
    expect(f.db.query(`SELECT working_count,current_count,pending_count,retiring_count FROM ${t.capacity} WHERE id=?`).get(t.workingMembers))
      .toEqual({ working_count: 6, current_count: 6, pending_count: 0, retiring_count: 0 });
    expect(f.db.query(`SELECT * FROM ${t.claims}`).all()).toEqual([]);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 60_000);

test('aborting fully prepared unpublished cells drains only owned hidden working rows and headers while retaining immutable proof', () => {
  const f = fixture();
  try {
    f.begin(); drain(f); f.prepare();
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.workingMembers}`).get()).toEqual({ n: 3 });
    f.execute(f.transport.sealRetirement(JSON.parse(String((f.db.query(`SELECT source_binding_json FROM ${t.runs}`).get() as Record<string, unknown>).source_binding_json)),
      'abort-prepared', { runId: f.runId, expectedRevision: Number(f.head().revision), limit: 1 }));
    f.cleanup(1);
    expect(f.db.query(`SELECT * FROM ${t.workingMembers}`).all()).toEqual([]); expect(f.db.query(`SELECT * FROM ${t.selectors}`).all()).toEqual([]);
    expect(f.db.query(`SELECT * FROM ${t.claims}`).all()).toEqual([]);
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.members}`).get()).toEqual({ n: 3 });
    expect(f.db.query(`SELECT working_count,current_count,pending_count,retiring_count FROM ${t.capacity} WHERE id=?`).get(t.workingMembers))
      .toEqual({ working_count: 0, current_count: 0, pending_count: 0, retiring_count: 0 });
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);
