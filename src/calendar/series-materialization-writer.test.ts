/** Actual native SQLite+tracked ReactiveDB MEMORY. No actor/file/COMMIT or
 * SYSTEM participant qualification is claimed by these local writer tests. */
import { expect, spyOn, test } from 'bun:test';
import { seriesMaterializationWriterFixture as fixture } from './test-support/series-materialization-writer-fixture';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as t } from './realm-series-materialization-migration';
import { createCalendarSeriesNativeTransport } from './series-native-transport';
import { advanceCalendarSeriesProjection, createCalendarSeriesProjection, restoreCalendarSeriesProjection } from './series-projection';
import { compileCalendarSeriesBatch } from './series-compilation';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { registerReactiveDBCommitGuard } from '../sync/reactive-db';
function rejects(run: () => unknown, expected?: CalendarErrorCode) {
  try { run(); throw new Error('Expected native writer refusal'); }
  catch (error) { if (expected) expect(error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code).toBe(expected); else expect(error).toBeInstanceOf(Error); }
}
function snapshot(f: ReturnType<typeof fixture>) { return { bytes: f.db.serialize(), sequence: f.reactive.currentSeq }; }
function booking(id = 'ordinary') { return { id, requestId: id, title: 'Synthetic ordinary', resourceIds: ['r'], startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }; }

test('native begin and bounded stage reserve complete resources before projecting any cells', () => {
  const f = fixture({ resources: 2 });
  try {
    const original = f.db.query('SELECT * FROM _calendar_series_receipts').all(); f.begin();
    const first = f.stage(f.projection, 8);
    expect(f.db.query(`SELECT candidate_count,resource_count,claim_count,member_count FROM ${t.runState}`).get()).toEqual({ candidate_count: 1, resource_count: 2, claim_count: 2, member_count: 0 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.claims}`).get()).toEqual({ n: 2 });
    expect(f.db.query('SELECT * FROM calendar_appointments').all()).toEqual([]); expect(f.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]);
    expect(f.db.query('SELECT * FROM _calendar_series_receipts').all()).toEqual(original);
    rejects(() => f.command('calendar.appointment.create', booking()), 'CALENDAR_BOOKING_CONFLICT');
    const version = f.db.query(`SELECT * FROM ${t.versions}`).get() as Record<string, unknown>;
    expect(JSON.parse(String(version.booking_json))).toMatchObject({ title: 'PRIVATE_NATIVE_TITLE', participants: [], admittedType: null, admittedVisit: null });
    expect(first.result.ok).toBe(true); expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('all-resource candidate conflicts roll back the entire native step against ordinary bookings, holds and blocks', () => {
  for (const kind of ['appointment', 'hold', 'block'] as const) {
    const f = fixture({ resources: 2 });
    try {
      f.begin(); const input = booking(kind);
      f.command('calendar.' + (kind === 'appointment' ? 'appointment.create' : kind === 'hold' ? 'hold.acquire' : 'block.create'), kind === 'block'
        ? { id: input.id, requestId: input.requestId, title: input.title, resourceIds: ['r01'], startAt: input.startAt, endAt: input.endAt, timeZone: input.timeZone }
        : kind === 'hold' ? { id: input.id, requestId: input.requestId, resourceIds: ['r01'], startAt: input.startAt, endAt: input.endAt, timeZone: input.timeZone }
          : { ...input, resourceIds: ['r01'] });
      const before = snapshot(f); rejects(() => f.stage(), 'CALENDAR_BOOKING_CONFLICT'); expect(snapshot(f)).toEqual(before);
      expect(f.db.query(`SELECT * FROM ${t.claims}`).all()).toEqual([]); expect(f.db.query(`SELECT * FROM ${t.versions}`).all()).toEqual([]);
    } finally { f.close(); }
  }
}, 30_000);

test('projection resumes through actual SQLite receipts, retains whole-run roots and advances COUNT only after full batch staging', () => {
  const f = fixture();
  try {
    f.begin(); let cursor = f.projection, steps = 0;
    while (true) {
      const current = f.stage(cursor, 4); cursor = current.step.cursor; steps++;
      if (current.step.progress.checkpoint.phase === 'complete') break;
      expect(f.db.query(`SELECT progress_id FROM ${t.runState}`).get()).toEqual({ progress_id: null });
      const persisted = JSON.parse(String((f.db.query(`SELECT projection_cursor_json FROM ${t.runState}`).get() as Record<string, unknown>).projection_cursor_json));
      cursor = restoreCalendarSeriesProjection(f.source, f.batch.contribution, f.batch.evidence.batchDigest, { runId: f.runId }, persisted, current.step.progress.afterDigest);
      expect(steps).toBeLessThan(100);
    }
    expect(steps).toBeGreaterThan(1);
    const head = f.db.query(`SELECT * FROM ${t.runState}`).get() as Record<string, unknown>;
    expect(head).toMatchObject({ candidate_count: 3, resource_count: 3, claim_count: 3, member_count: 3, projection_complete: 1, state: 'preparing' });
    expect(head.candidate_root).toMatch(/^[a-f0-9]{64}$/); expect(head.projection_root).toMatch(/^[a-f0-9]{64}$/); expect(head.cell_root).toMatch(/^[a-f0-9]{64}$/);
    const progress = f.db.query(`SELECT * FROM ${t.progress}`).get() as Record<string, unknown>;
    expect(progress.after_digest).toBe(f.batch.evidence.progress.afterDigest); expect(JSON.parse(String(progress.checkpoint_json)).rruleCount).toBe(3);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('original native receipts replay quietly across signing-key rotation before fresh resource/policy checks', () => {
  const f = fixture(); let other: ReturnType<typeof createCalendarSeriesNativeTransport> | undefined;
  try {
    const accepted = f.begin(), begun = snapshot(f); expect(f.begin()).toEqual(accepted); expect(snapshot(f)).toEqual(begun);
    const staged = f.stage(f.projection, 4), packet = f.transport.sealProjection(f.source, staged.step.cursor, staged.step.stepDigest);
    f.command('calendar.resource.availability', { id: 'r', requestId: 'change', expectedRevision: 1, mode: 'windows', windows: [] });
    other = createCalendarSeriesNativeTransport({ rootHash: f.snapshot.rootHash, realmFingerprint: f.snapshot.realmFingerprint, policyGeneration: f.snapshot.policyGeneration });
    const before = snapshot(f), replay = other.sealProjection(f.source, staged.step.cursor, staged.step.stepDigest);
    expect(f.execute(replay, other)).toEqual(staged.result); expect(snapshot(f)).toEqual(before);
    const next = advanceCalendarSeriesProjection(staged.step.cursor, { rowLimit: 4 });
    rejects(() => f.execute(f.transport.sealProjection(f.source, next.cursor, next.stepDigest)), 'CALENDAR_REVISION_CONFLICT');
    rejects(() => f.execute({ ...packet, envelope: { ...packet.envelope, payload: { forged: true } } } as never), 'CALENDAR_FORBIDDEN');
    expect(snapshot(f)).toEqual(before);
  } finally { other?.close(); f.close(); }
}, 30_000);

test('native abort releases only its bounded owned working projections and original-key replay is quiet', () => {
  const f = fixture();
  try {
    f.begin(); f.stage(); const head = f.db.query(`SELECT revision FROM ${t.runState}`).get() as { revision: number };
    const packet = f.transport.sealSource(f.source, 'calendar.series.run.abort', 'abort', { runId: f.runId, expectedRevision: head.revision, limit: 1 });
    const accepted = f.execute(packet); expect(f.db.query(`SELECT state FROM ${t.runState}`).get()).toEqual({ state: 'aborted' });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.claims}`).get()).toEqual({ n: 2 });
    const before = snapshot(f); expect(f.execute(packet)).toEqual(accepted); expect(snapshot(f)).toEqual(before);
    for (let index = 0; index < 3; index++) {
      const row = f.db.query(`SELECT revision FROM ${t.runState}`).get() as { revision: number };
      f.execute(f.transport.sealSource(f.source, 'calendar.series.run.abort', 'cleanup-' + index, { runId: f.runId, expectedRevision: row.revision, limit: 1 }));
    }
    expect(f.db.query(`SELECT * FROM ${t.claims}`).all()).toEqual([]); expect(f.db.query(`SELECT * FROM ${t.cellBuilders}`).all()).toEqual([]);
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.versions}`).get()).toEqual({ n: 3 });
    const request = { scopeId: f.snapshot.scopeId, ownerId: f.snapshot.ownerId, seriesId: f.snapshot.seriesId, runId: f.runId };
    expect(f.query('calendar.series.run.receipt', { ...request, phase: 'reconcile', logicalKey: 'abort' })).toMatchObject({ status: 'accepted' });
    expect(f.query('calendar.series.run.receipt', { ...request, phase: 'batch', logicalKey: 'never-submitted' })).toEqual({ status: 'unknown' });
    expect(f.query('calendar.series.run', request)).toMatchObject({ status: 'known', state: { state: 'aborted' } });
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('one maximum legal544-cell footprint stages over repeated short commits without partial publication', () => {
  const f = fixture({ resources: 16, durationMs: 31 * 86_400_000, before: 1440, after: 1440, count: 1, start: '2030-01-01T00:30:00.000', windowUntil: '2030-01-02' });
  try {
    f.begin(); let cursor = f.projection, commits = 0;
    while (true) { const next = f.stage(cursor); cursor = next.step.cursor; commits++; if (next.step.progress.checkpoint.phase === 'complete') break; expect(commits).toBeLessThan(20); }
    expect(commits).toBeGreaterThan(1); expect(f.db.query(`SELECT count(*) AS n FROM ${t.members}`).get()).toEqual({ n: 544 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.claims}`).get()).toEqual({ n: 16 });
    expect(f.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('bounded compiler batches persist independent COUNT checkpoints and whole-run roots without new source generations', () => {
  const f = fixture({ compilerLimit: 1 });
  try {
    f.begin(); f.stage(); let cursor = f.batch.cursor;
    for (let index = 0; index < 2; index++) {
      const batch = compileCalendarSeriesBatch(f.source, cursor, { occurrenceLimit: 1 }); cursor = batch.cursor;
      const projection = createCalendarSeriesProjection(f.source, batch.contribution, batch.evidence.batchDigest, { runId: f.runId });
      const step = advanceCalendarSeriesProjection(projection); f.execute(f.transport.sealProjection(f.source, step.cursor, step.stepDigest));
    }
    expect(f.db.query(`SELECT candidate_count,resource_count,claim_count FROM ${t.runState}`).get()).toEqual({ candidate_count: 3, resource_count: 3, claim_count: 3 });
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.progress}`).get()).toEqual({ n: 3 });
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_generations').get()).toEqual({ n: 1 });
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_receipts').get()).toEqual({ n: 1 });
  } finally { f.close(); }
}, 30_000);

test('zero-output batches durably advance examined COUNT progress without inventing a reservation or publication', () => {
  const f = fixture({ count: 1, windowFrom: '2030-02-01', windowUntil: '2030-02-02' });
  try {
    expect(f.batch.evidence.candidates).toEqual([]); f.begin(); f.stage();
    expect(f.db.query(`SELECT candidate_count,projection_complete FROM ${t.runState}`).get()).toEqual({ candidate_count: 0, projection_complete: 1 });
    const progress = f.db.query(`SELECT * FROM ${t.progress}`).get() as Record<string, unknown>;
    expect(progress.after_digest).toBe(f.batch.evidence.progress.afterDigest); expect(progress.before_digest).not.toBe(progress.after_digest);
    expect(JSON.parse(String(progress.checkpoint_json)).rruleCount).toBe(1);
    expect(f.db.query(`SELECT * FROM ${t.claims}`).all()).toEqual([]); expect(f.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('a final native MEMORY commit refusal rolls back claims, immutable evidence, roots, receipt and tracked sequence together', () => {
  const f = fixture(); let remove: (() => void) | undefined;
  try {
    f.begin(); const before = snapshot(f);
    remove = registerReactiveDBCommitGuard(f.reactive, { capture: () => 0, beforeCommit() { throw new CalendarError('CALENDAR_FORBIDDEN'); } });
    rejects(() => f.stage(), 'CALENDAR_FORBIDDEN'); expect(snapshot(f)).toEqual(before);
    remove(); remove = undefined; f.stage();
    expect(f.db.query(`SELECT candidate_count FROM ${t.runState}`).get()).toEqual({ candidate_count: 3 });
  } finally { remove?.(); f.close(); }
}, 30_000);

test('changed original native step intent cannot reuse its receipt key or mutate already accepted facts', () => {
  const f = fixture();
  try {
    f.begin(); const accepted = f.stage(f.projection, 4), before = snapshot(f);
    const changed = advanceCalendarSeriesProjection(f.projection, { rowLimit: 256 });
    expect(changed.originalStepKey).toBe(accepted.step.originalStepKey);
    rejects(() => f.execute(f.transport.sealProjection(f.source, changed.cursor, changed.stepDigest)), 'CALENDAR_INTENT_CONFLICT');
    expect(snapshot(f)).toEqual(before);
  } finally { f.close(); }
}, 30_000);

test('retained owner-bound abort survives expired source preparation, retired grant/policy and unavailable Temporal', () => {
  const f = fixture(); let retirement: ReturnType<typeof createCalendarSeriesNativeTransport> | undefined;
  const temporal = Object.getOwnPropertyDescriptor(globalThis, 'Temporal'); let restoreClock: (() => void) | undefined;
  try {
    f.begin(); f.stage(); const run = f.db.query(`SELECT * FROM ${t.runs}`).get() as Record<string, unknown>;
    const retained = JSON.parse(String(run.source_binding_json)), head = f.db.query(`SELECT revision FROM ${t.runState}`).get() as { revision: number };
    f.db.transaction(() => {
      f.db.run("UPDATE _calendar_series_preparations SET state='aborted',revision=revision+1 WHERE id=?", [f.snapshot.preparationId]);
      f.db.run("UPDATE calendar_series SET lifecycle='retired',control_revision=control_revision+1,grant_epoch=grant_epoch+1,active_preparation_id=NULL WHERE id=?", [f.snapshot.seriesId]);
    })();
    retirement = createCalendarSeriesNativeTransport({ rootHash: f.snapshot.rootHash, realmFingerprint: f.snapshot.realmFingerprint, policyGeneration: 'a'.repeat(64) });
    const clock = spyOn(Date, 'now').mockReturnValue(Number(run.expires_ms) + 1); restoreClock = () => clock.mockRestore();
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('Synthetic unavailable time engine'); } });
    const packet = retirement.sealRetirement(retained, 'retire-expired', { runId: f.runId, expectedRevision: head.revision, limit: 128 });
    f.execute(packet, retirement);
    expect(f.db.query(`SELECT state FROM ${t.runState}`).get()).toEqual({ state: 'aborted' });
    expect(f.db.query(`SELECT * FROM ${t.claims}`).all()).toEqual([]); expect(f.db.query(`SELECT * FROM ${t.cellBuilders}`).all()).toEqual([]);
    expect(f.db.query(`SELECT count(*) AS n FROM ${t.versions}`).get()).toEqual({ n: 3 });
  } finally {
    restoreClock?.(); if (temporal) Object.defineProperty(globalThis, 'Temporal', temporal); else Reflect.deleteProperty(globalThis, 'Temporal');
    retirement?.close(); f.close();
  }
}, 30_000);
