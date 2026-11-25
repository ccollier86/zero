/** Actual unregistered022 realm +SQLite MEMORY only. No actor/file/SYSTEM
 * qualification, public activation or sparse coverage is claimed. */
import { expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { Migrator } from '../migrations/migrator';
import { registerReactiveDBCommitGuard } from '../sync/reactive-db';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession, type DatabaseReadQueryContext } from '../databases/database-read-query-capability';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { defineDatabaseRealm } from '../databases/database-realm';
import { seriesMaterializationWriterFixture } from './test-support/series-materialization-writer-fixture';
import { calendarSeriesChildrenRealm as realm } from './series-children-realm';
import { CALENDAR_SERIES_CHILD_TABLES as c } from './realm-series-children-migration';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as n } from './realm-series-materialization-migration';
import { CALENDAR_SERIES_SELECTED_PROJECTION_ROW_LIMIT } from './series-materialization-derivation';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarHash as h, calendarJson } from './validation';
import { readCalendarSeriesChild, queryCalendarSeriesChildren } from './series-child-reader';
import { createCalendarSeriesPublishedSourceReader } from './series-native-source';
import { captureCalendarSeriesCompilationSource, compileCalendarSeriesBatch, continueCalendarSeriesCompilationWindow, restoreCalendarSeriesCompilationCursor } from './series-compilation';
import { advanceCalendarSeriesProjection, createCalendarSeriesProjection, inspectCalendarSeriesProjection } from './series-projection';
import { stageCalendarSeriesMaterialization } from './series-materialization-writer';

function fixture(options: Parameters<typeof seriesMaterializationWriterFixture>[0] = {}, qualifiedRealm: typeof realm = realm) {
  const base = seriesMaterializationWriterFixture(options, { realm: qualifiedRealm, install(database: Database) {
    const migrator = new Migrator({ database, dbPath: ':memory:', createBackups: false, log() {}, migrations: qualifiedRealm.migrations, migrationTableStages: qualifiedRealm.migrationTableStages });
    try { migrator.run('022'); } finally { migrator.dispose(); }
  } });
  return { ...base, stage(cursor = base.projection, rowLimit = CALENDAR_SERIES_SELECTED_PROJECTION_ROW_LIMIT) { return base.stage(cursor, rowLimit); } };
}
function rejects(run: () => unknown, expected: CalendarErrorCode) {
  try { run(); throw new Error('Expected selected-native refusal'); }
  catch (error) { expect(error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code).toBe(expected); }
}
function snapshot(f: ReturnType<typeof fixture>) { return { bytes: f.db.serialize(), sequence: f.reactive.currentSeq }; }
function drain(f: ReturnType<typeof fixture>) {
  let cursor = f.projection;
  for (let steps = 0; steps < 10000; steps++) { const next = f.stage(cursor); cursor = next.step.cursor; if (next.step.progress.checkpoint.phase === 'complete') return steps + 1; }
  throw new Error('Owned selected projection did not finish');
}
function view(f: ReturnType<typeof fixture>) { return f.db.query(`SELECT * FROM ${c.views} ORDER BY id LIMIT 1`).get() as Record<string, unknown>; }
function read<T>(f: ReturnType<typeof fixture>, action: (context: DatabaseReadQueryContext) => T): T {
  return withDatabaseReadQuerySession(createDatabaseReadQuerySession(f.db), action);
}

test('022 derives exact immutable21-backed child/resource facts in the same receipts and atomically selects them at publication', () => {
  const f = fixture({ resources: 2 });
  try {
    const human = f.db.query('SELECT * FROM _calendar_series_receipts').all(); f.begin();
    expect(view(f)).toMatchObject({ phase: 'pending', child_count: 0, resource_count: 0, directory_count: 2 });
    expect(f.db.query(`SELECT current_view_id FROM ${c.current}`).get()).toEqual({ current_view_id: null });
    drain(f);
    expect(view(f)).toMatchObject({ child_count: 3, resource_count: 6, directory_count: 2 });
    const heads = f.db.query<Record<string, unknown>, []>(`SELECT * FROM ${c.heads} ORDER BY appointment_id`).all();
    expect(heads).toHaveLength(3); expect(f.db.query(`SELECT count(*) AS n FROM ${c.resources}`).get()).toEqual({ n: 6 });
    for (const child of heads) {
      const version = f.db.query<Record<string, unknown>, [string]>(`SELECT * FROM ${n.versions} WHERE id=?`).get(String(child.native_version_id))!;
      expect(child).toMatchObject({ origin_kind: 'native21', version_id: version.id, native_run_id: f.runId, variant_version_id: null,
        child_revision: 1, selection_revision: 1, child_exception_revision: 0, created_by: f.actor.userId,
        binding_digest: version.binding_digest, authority_resource_ids_json: version.resource_ids_json, occupied_from_ms: version.occupied_from_ms, occupied_until_ms: version.occupied_until_ms });
      rejects(() => read(f, context => readCalendarSeriesChild(context, { actor: f.actor, id: child.appointment_id })), 'CALENDAR_NOT_FOUND');
    }
    f.prepare(8); f.publish();
    expect(view(f)).toMatchObject({ phase: 'current', child_count: 3, resource_count: 6 });
    expect(f.db.query(`SELECT current_view_id,pointer_revision,content_revision,exception_revision FROM ${c.current}`).get()).toEqual({ current_view_id: view(f).id, pointer_revision: 1, content_revision: 1, exception_revision: 0 });
    const detail = read(f, context => readCalendarSeriesChild(context, { actor: f.actor, id: heads[0]!.appointment_id }));
    expect(detail).toMatchObject({ id: heads[0]!.appointment_id, revision: 1, createdBy: f.actor.userId, title: 'PRIVATE_NATIVE_TITLE', resourceIds: f.resources,
      series: { kind: 'series-child-v1', seriesId: f.snapshot.seriesId, sourceGeneration: 1, exceptionRevision: 0 } });
    expect(Object.hasOwn(detail, 'participants')).toBe(false);
    const page = read(f, context => queryCalendarSeriesChildren(context, { actor: f.actor, resourceIds: f.resources, startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-04T00:00:00.000Z', limit: 100 }));
    expect(page.items.map(item => item.id).sort()).toEqual(heads.map(item => String(item.appointment_id)).sort()); expect(page.truncated).toBe(false);
    const before = snapshot(f); f.publish(); expect(snapshot(f)).toEqual(before);
    f.cleanup(); expect(f.db.query('SELECT * FROM _calendar_series_receipts').all()).toEqual(human);
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.viewPublications}`).get()).toEqual({ n: 1 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.batches} b LEFT JOIN ${n.receipts} r ON r.id=b.origin21_receipt_id WHERE r.id IS NULL`).get()).toEqual({ n: 0 });
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 40_000);

test('actual022 SQL refuses a legacy stage handler that omits its required same-transaction derivation', () => {
  // Deliberately install the wrong supported command implementation to prove
  // the REAL migration guard, not an assertion in the derivation callback.
  const wrongHandler = defineDatabaseRealm({ name: realm.name, version: realm.version, tables: realm.tables, migrations: realm.migrations,
    migrationTableStages: realm.migrationTableStages, writerAdmission: realm.writerAdmission, queries: realm.queries,
    commands: { ...realm.commands, 'calendar.series.run.stage': stageCalendarSeriesMaterialization } });
  expect(wrongHandler.fingerprint).toBe(realm.fingerprint);
  const f = fixture({}, wrongHandler);
  try {
    f.begin(); const before = snapshot(f);
    expect(() => f.stage()).toThrow('Private native materialization needs complete selected-child derivation');
    expect(snapshot(f)).toEqual(before);
    expect(f.db.query(`SELECT count(*) AS n FROM ${n.versions}`).get()).toEqual({ n: 0 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.heads}`).get()).toEqual({ n: 0 });
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('022 refuses an oversized signed base step and rolls back both families on a late native commit failure', () => {
  const f = fixture({ resources: 16 }); let remove: (() => void) | undefined;
  try {
    f.begin(); const before = snapshot(f);
    rejects(() => f.stage(f.projection, 256), 'CALENDAR_CAPACITY'); expect(snapshot(f)).toEqual(before);
    remove = registerReactiveDBCommitGuard(f.reactive, { capture() { return 0; }, beforeCommit() { throw new CalendarError('CALENDAR_FORBIDDEN'); } });
    rejects(() => f.stage(), 'CALENDAR_FORBIDDEN'); expect(snapshot(f)).toEqual(before);
    remove(); remove = undefined;
    const first = f.stage(); expect(first.result.ok).toBe(true);
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.heads}`).get()).toEqual({ n: 1 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.resources}`).get()).toEqual({ n: 16 });
    expect(f.db.query(`SELECT max(row_count) AS n FROM ${n.receipts} WHERE phase='batch'`).get()).toMatchObject({ n: expect.any(Number) });
    expect(Number((f.db.query(`SELECT max(row_count) AS n FROM ${n.receipts} WHERE phase='batch'`).get() as { n: number }).n)).toBeLessThanOrEqual(256);
  } finally { remove?.(); f.close(); }
}, 30_000);

test('022 abort drains only its owned hidden projections and restores finite working counts across bounded cleanup', () => {
  const f = fixture({ resources: 4, count: 20, windowUntil: '2030-01-21' });
  try {
    f.begin(); drain(f); f.prepare();
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.heads}`).get()).toEqual({ n: 20 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.resources}`).get()).toEqual({ n: 80 });
    f.execute(f.transport.sealRetirement(JSON.parse(String((f.db.query(`SELECT source_binding_json FROM ${n.runs} WHERE id=?`).get(f.runId) as { source_binding_json: string }).source_binding_json)), 'abort',
      { runId: f.runId, expectedRevision: Number(f.head().revision), limit: 128 }));
    const after = snapshot(f); f.cleanup(1); expect(f.head().state).toBe('aborted');
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.heads}`).get()).toEqual({ n: 0 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.resources}`).get()).toEqual({ n: 0 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.directory}`).get()).toEqual({ n: 0 });
    expect(view(f)).toMatchObject({ phase: 'aborted', child_count: 0, resource_count: 0, directory_count: 0 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${n.versions}`).get()).toEqual({ n: 20 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${n.members}`).get()).toEqual({ n: 80 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${n.receipts} WHERE row_count>256 AND phase<>'publish'`).get()).toEqual({ n: 0 });
    expect(snapshot(f).sequence).toBeGreaterThanOrEqual(after.sequence); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 50_000);

test('legal544-cell base footprint derives one child and16 resource rows, never a cell-multiplied child projection', () => {
  const f = fixture({ resources: 16, durationMs: 31 * 86400000, before: 1440, after: 1440, count: 1, start: '2030-01-01T00:30:00.000', windowUntil: '2030-01-02' });
  try {
    f.begin(); expect(drain(f)).toBeGreaterThan(1); f.prepare(); f.publish(); f.cleanup();
    expect(f.db.query(`SELECT count(*) AS n FROM ${n.members}`).get()).toEqual({ n: 544 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.heads}`).get()).toEqual({ n: 1 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.resources}`).get()).toEqual({ n: 16 });
    expect(view(f)).toMatchObject({ child_count: 1, resource_count: 16, directory_count: 16 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${n.receipts} WHERE row_count>256 AND phase<>'publish'`).get()).toEqual({ n: 0 });
    const page = read(f, context => queryCalendarSeriesChildren(context, { actor: f.actor, resourceIds: f.resources, startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z', limit: 100 }));
    expect(page.items).toHaveLength(1); expect(page.truncated).toBe(false); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 60_000);

function horizon(f: ReturnType<typeof fixture>, from: string, until: string) {
  const runId = 'horizon-' + from, descriptor = Object.freeze({ runId, seriesId: f.snapshot.seriesId, sourcePublicationId: f.beginPayload.sourcePublicationId, createdAtMs: Date.now(), expiresAtMs: Date.now() + 600_000 });
  const reader = createCalendarSeriesPublishedSourceReader({ owner: f.ownerRecord, policyGeneration: f.snapshot.policyGeneration, signal: new AbortController().signal,
    assertOwnerCurrent(owner) { expect(owner).toEqual(f.ownerRecord); }, assertSeriesAuthorityCurrent(generation) { expect(generation).toBe(f.snapshot.policyGeneration); },
    assertWindowCurrent(found) { expect(calendarJson(found)).toBe(calendarJson(descriptor)); } }, descriptor);
  const observed = read(f, reader); if (!observed.continuation) throw new Error('Owned current source lacks COUNT continuation');
  const source = captureCalendarSeriesCompilationSource(observed.snapshot, { maxResources: 16, maxParticipants: 100 }), previous = observed.continuation;
  const oldRange = (previous.checkpoint as { range: { from: string; until: string } }).range;
  const restored = restoreCalendarSeriesCompilationCursor(source, oldRange, previous.checkpoint, previous.progressDigest);
  const batch = compileCalendarSeriesBatch(source, continueCalendarSeriesCompilationWindow(source, restored, { from, until }));
  let cursor = createCalendarSeriesProjection(source, batch.contribution, batch.evidence.batchDigest, { runId });
  const state = () => f.db.query<Record<string, unknown>, [string]>(`SELECT * FROM ${n.runState} WHERE id=?`).get(runId)!;
  f.execute(f.transport.sealSource(source, 'calendar.series.run.begin', 'begin', cloneDatabaseSerializableValue({ runId, kind: 'horizon', sourcePublicationId: descriptor.sourcePublicationId,
    windowFromMs: Date.parse(from + 'T00:00:00.000Z'), windowUntilMs: Date.parse(until + 'T00:00:00.000Z'), nominalFrom: from, nominalUntil: until,
    initialProgressDigest: previous.progressDigest, initialProjectionCheckpoint: inspectCalendarSeriesProjection(cursor).checkpoint })));
  for (let steps = 0; steps < 1000; steps++) {
    const next = advanceCalendarSeriesProjection(cursor, { rowLimit: CALENDAR_SERIES_SELECTED_PROJECTION_ROW_LIMIT }); cursor = next.cursor;
    f.execute(f.transport.sealProjection(source, cursor, next.stepDigest)); if (next.progress.checkpoint.phase === 'complete') break;
    if (steps === 999) throw new Error('Owned horizon failed to finish');
  }
  for (let steps = 0; steps < 1000; steps++) {
    const q = state(); if (JSON.parse(String(q.publication_cursor_json)).phase === 'ready') break;
    f.execute(f.transport.sealSource(source, 'calendar.series.run.seal', h(['seal', runId, q.revision]), { runId, expectedRevision: Number(q.revision), limit: 256 }));
    if (steps === 999) throw new Error('Owned horizon preparation failed to finish');
  }
  f.execute(f.transport.sealSource(source, 'calendar.series.run.publish', 'publish', { runId, expectedRevision: Number(state().revision) }));
  return { runId, state: state(), batch };
}

test('normal022 horizon and zero-output COUNT progress append to the unchanged view without duplicating children or human authoring', () => {
  const f = fixture({ count: 3, start: '2030-01-01T23:30:00.000', windowUntil: '2030-01-02' });
  try {
    f.begin(); drain(f); f.prepare(); f.publish(); f.cleanup(); const initial = view(f), humans = f.db.query('SELECT * FROM _calendar_series_receipts').all();
    const next = horizon(f, '2030-01-02', '2030-01-03'); expect(next.state.candidate_count).toBe(1);
    expect(view(f)).toMatchObject({ id: initial.id, child_count: 2, resource_count: 2, directory_count: 1, phase: 'current' });
    expect(f.db.query(`SELECT count(*) AS n FROM ${c.viewPublications}`).get()).toEqual({ n: 1 });
    expect(f.db.query(`SELECT DISTINCT child_revision,selection_revision FROM ${c.heads}`).all()).toEqual([{ child_revision: 1, selection_revision: 1 }]);
    expect(f.db.query('SELECT * FROM _calendar_series_receipts').all()).toEqual(humans); expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_generations').get()).toEqual({ n: 1 });
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
  const empty = fixture({ count: 2, frequency: 'monthly', start: '2030-01-31T10:00:00.000', windowUntil: '2030-02-01' });
  try {
    empty.begin(); drain(empty); empty.prepare(); empty.publish(); empty.cleanup(); const before = view(empty);
    const next = horizon(empty, '2030-02-01', '2030-03-01'); expect(next.state).toMatchObject({ candidate_count: 0, state: 'published' });
    expect(view(empty)).toMatchObject({ id: before.id, child_count: 1, resource_count: 1, directory_count: 1 });
    expect(empty.db.query(`SELECT count(*) AS n FROM ${c.heads}`).get()).toEqual({ n: 1 });
    expect(empty.db.query(`SELECT child_delta,resource_delta FROM ${c.batches} WHERE run_id=? AND phase='stage'`).all(next.runId)).toEqual([{ child_delta: 0, resource_delta: 0 }]);
    expect(empty.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { empty.close(); }
}, 60_000);
