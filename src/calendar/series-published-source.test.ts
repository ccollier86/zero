/** Actual native private realm MEMORY reads after canonical publication. No
 * physical actor, durable Jobs installation or UTC coverage qualification. */
import { expect, spyOn, test } from 'bun:test';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { captureCalendarSeriesCompilationSource, compileCalendarSeriesBatch, continueCalendarSeriesCompilationWindow,
  restoreCalendarSeriesCompilationCursor } from './series-compilation';
import { createCalendarSeriesPublishedSourceReader, type CalendarSeriesPublishedWindow } from './series-native-source';
import { calendarJson } from './validation';
import { CalendarError, type CalendarErrorCode } from './error';
import { seriesMaterializationWriterFixture as fixture } from './test-support/series-materialization-writer-fixture';

function publish(f: ReturnType<typeof fixture>) {
  f.begin(); let cursor = f.projection;
  for (let step = 0; ; step++) {
    if (step > 1000) throw new Error('Synthetic projection budget exceeded');
    const next = f.stage(cursor); cursor = next.step.cursor;
    if (next.step.progress.checkpoint.phase === 'complete') break;
  }
  f.prepare(); f.publish(); f.cleanup();
}
function rejects(read: () => unknown, code: CalendarErrorCode) {
  try { read(); throw new Error('Expected native snapshot refusal'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); }
}

test('published source resumes original COUNT through one native head read after human preparation expires, without extending the native job deadline', () => {
  const f = fixture({ count: 20 }); let clock: ReturnType<typeof spyOn<typeof Date, 'now'>> | undefined;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    publish(f);
    const later = f.snapshot.preparationExpiresAtMs + 1000, nativeWindow: CalendarSeriesPublishedWindow = {
      runId: 'next-native-run', seriesId: f.snapshot.seriesId, sourcePublicationId: f.beginPayload.sourcePublicationId,
      createdAtMs: later, expiresAtMs: later + 60_000,
    };
    clock = spyOn(Date, 'now').mockReturnValue(later); const stop = new AbortController(); let checks = 0;
    const reader = createCalendarSeriesPublishedSourceReader({ owner: f.ownerRecord, policyGeneration: f.snapshot.policyGeneration, signal: stop.signal,
      assertOwnerCurrent(owner) { expect(calendarJson(owner)).toBe(calendarJson(f.ownerRecord)); },
      assertSeriesAuthorityCurrent(policy) { expect(policy).toBe(f.snapshot.policyGeneration); },
      assertWindowCurrent(window) { checks++; expect(window).toEqual(nativeWindow); },
    }, nativeWindow);
    const before = f.db.serialize();
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('PRIVATE_ENGINE_NOT_LOADED'); } });
    const result = withDatabaseReadQuerySession(createDatabaseReadQuerySession(f.db), context => reader(context));
    if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal');
    expect(result.snapshot.preparationId).toBe(nativeWindow.runId);
    expect(result.snapshot.preparationExpiresAtMs).toBe(nativeWindow.expiresAtMs);
    expect(result.snapshot.basePublicationId).toBe(nativeWindow.sourcePublicationId);
    expect(result.snapshot.generationId).toBe(f.snapshot.generationId); expect(result.snapshot.grant).toEqual(f.snapshot.grant);
    expect(checks).toBe(2); expect(f.db.serialize()).toEqual(before);
    const source = captureCalendarSeriesCompilationSource(result.snapshot, { maxResources: 16, maxParticipants: 100 });
    const checkpoint = result.continuation.checkpoint as { range: { from: string; until: string } };
    const restored = restoreCalendarSeriesCompilationCursor(source, checkpoint.range, checkpoint, result.continuation.progressDigest);
    const next = compileCalendarSeriesBatch(source, continueCalendarSeriesCompilationWindow(source, restored, { from: '2030-01-04', until: '2030-01-07' }));
    expect(next.evidence.candidates).toHaveLength(3); expect(next.evidence.progress.checkpoint.rruleCount).toBe(6);
    expect(next.evidence.progress.continuation?.previousDigest).toBe(result.continuation.progressDigest);
    clock.mockReturnValue(later + 1000);
    expect(withDatabaseReadQuerySession(createDatabaseReadQuerySession(f.db), context => reader(context)).snapshot.preparationExpiresAtMs).toBe(nativeWindow.expiresAtMs);
    expect(f.db.query('SELECT count(*) AS n FROM _calendar_series_receipts').get()).toEqual({ n: 1 });
    clock.mockReturnValue(nativeWindow.expiresAtMs);
    rejects(() => withDatabaseReadQuerySession(createDatabaseReadQuerySession(f.db), context => reader(context)), 'CALENDAR_NOT_READY');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal');
    clock?.mockRestore(); f.close();
  }
}, 30_000);

test('a retained native window cannot read an unpublished source, foreign publication or a retired durable-window authority', () => {
  const f = fixture({ count: 20 });
  try {
    const now = Date.now(), window: CalendarSeriesPublishedWindow = { runId: 'next-native-run', seriesId: f.snapshot.seriesId,
      sourcePublicationId: f.beginPayload.sourcePublicationId, createdAtMs: now, expiresAtMs: now + 60_000 };
    let permitted = true;
    const dependencies = { owner: f.ownerRecord, policyGeneration: f.snapshot.policyGeneration, signal: new AbortController().signal,
      assertOwnerCurrent(owner: typeof f.ownerRecord) { if (calendarJson(owner) !== calendarJson(f.ownerRecord)) throw new CalendarError('CALENDAR_STATE_INVALID'); },
      assertSeriesAuthorityCurrent(policy: string) { if (policy !== f.snapshot.policyGeneration) throw new CalendarError('CALENDAR_FORBIDDEN'); },
      assertWindowCurrent() { if (!permitted) throw new CalendarError('CALENDAR_FORBIDDEN'); } };
    const reader = createCalendarSeriesPublishedSourceReader(dependencies, window);
    const read = (selected = reader) => withDatabaseReadQuerySession(createDatabaseReadQuerySession(f.db), context => selected(context));
    rejects(() => read(), 'CALENDAR_NOT_READY'); publish(f); expect(read().continuation.progressDigest).toHaveLength(64);
    rejects(() => read(createCalendarSeriesPublishedSourceReader(dependencies, { ...window, sourcePublicationId: 'foreign-publication' })), 'CALENDAR_NOT_READY');
    permitted = false; const before = f.db.serialize(); rejects(() => read(), 'CALENDAR_FORBIDDEN'); expect(f.db.serialize()).toEqual(before);
  } finally { f.close(); }
}, 30_000);
