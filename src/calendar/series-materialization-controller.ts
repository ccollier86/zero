/** Private source-owned materialization driver. No timer, retained human
 * session, SQL capability or browser-authored compiled facts. Managed Jobs must
 * retain the original window descriptor and load the matching native snapshot
 * before invoking it. All expansion runs between short owner calls/leases.
 * A completed native window is NOT a sparse UTC availability certificate. */
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import type { Row } from '../sync/types';
import { CalendarError } from './error';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';
import type { CalendarRecurrenceCheckpoint } from './recurrence-cursor';
import { compileCalendarSeriesBatch, continueCalendarSeriesCompilationWindow, createCalendarSeriesCompilationCursor,
  inspectCalendarSeriesCompilationSource, restoreCalendarSeriesCompilationCursor, type CalendarSeriesCompilationSource } from './series-compilation';
import { advanceCalendarSeriesProjection, createCalendarSeriesProjection, inspectCalendarSeriesProjection,
  restoreCalendarSeriesProjection, type CalendarSeriesProjectionCheckpoint } from './series-projection';
import type { CalendarSeriesPublishedContinuation } from './series-native-source';
import type { CalendarSeriesNativeOwner } from './series-runtime-owner';
import type { CalendarSeriesNativeTransport } from './series-native-transport';

export interface CalendarSeriesMaterializationWindow {
  readonly runId: string;
  readonly sourcePublicationId: string;
  readonly windowFromMs: number;
  readonly windowUntilMs: number;
  readonly nominalFrom: string;
  readonly nominalUntil: string;
}
export interface CalendarSeriesMaterializationWork {
  readonly state: 'pending' | 'published' | 'aborted' | 'source-complete';
  readonly runId: string;
  readonly commands: number;
  readonly revision: number | null;
  readonly cleanupPending: boolean;
}
export interface CalendarSeriesMaterializationSettlement {
  readonly state: 'unknown' | 'active' | 'published' | 'aborted';
  readonly runId: string;
  readonly commands: number;
  readonly revision: number | null;
  readonly cleanupPending: boolean;
}
interface NativeRead {
  readonly status: 'known' | 'unknown'; readonly run?: Row; readonly state?: Row;
  readonly progress?: Row | null; readonly cleanupPending?: boolean;
}
function invalid(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function hash(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid(); return value; }
function parsed(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return invalid();
  try { return calendarRecord(cloneDatabaseSerializableValue(JSON.parse(value))); } catch { return invalid(); }
}

/** Read accepted native history and drain only its disposable working rows.
 * This boundary deliberately requires NO source/compiler handle, Temporal,
 * unexpired job deadline or fresh booking/participant policy. Actual owner and
 * physical scope remain mandatory; published occupancy is never withdrawn. */
export async function settleCalendarSeriesMaterialization(owner: CalendarSeriesNativeOwner, input: {
  readonly seriesId: string; readonly runId: string; readonly maxCommands?: number; readonly window?: CalendarSeriesMaterializationWindow;
}): Promise<CalendarSeriesMaterializationSettlement> {
  const r = calendarRecord(cloneDatabaseSerializableValue(input), ['seriesId', 'runId', 'maxCommands', 'window']);
  const seriesId = calendarKey(r.seriesId), runId = calendarKey(r.runId), maximum = calendarInteger(r.maxCommands ?? 32, 0, 256);
  const window = r.window === undefined ? undefined : calendarRecord(r.window,
    ['runId', 'sourcePublicationId', 'windowFromMs', 'windowUntilMs', 'nominalFrom', 'nominalUntil']);
  if (window && calendarKey(window.runId) !== runId) return invalid();
  let commands = 0;
  for (;;) {
    owner.assertCurrent();
    const observed = await owner.read<NativeRead>('calendar.series.run', { seriesId, runId });
    if (observed.status === 'unknown') {
      if (commands !== 0) return invalid();
      return Object.freeze({ state: 'unknown', runId, commands, revision: null, cleanupPending: false });
    }
    if (observed.status !== 'known') return invalid();
    const run = calendarRecord(observed.run), head = calendarRecord(observed.state), revision = calendarInteger(head.revision, 1);
    if (run.id !== runId || run.series_id !== seriesId || run.scope_id !== owner.owner.scope_id || run.owner_id !== owner.owner.owner_id
      || head.id !== runId || head.scope_id !== owner.owner.scope_id || typeof observed.cleanupPending !== 'boolean') return invalid();
    if (window && (run.source_publication_id !== window.sourcePublicationId || run.window_from_ms !== window.windowFromMs
      || run.window_until_ms !== window.windowUntilMs || run.nominal_from !== window.nominalFrom || run.nominal_until !== window.nominalUntil)) {
      throw new CalendarError('CALENDAR_REVISION_CONFLICT');
    }
    if (head.state !== 'published' && head.state !== 'aborted') {
      if (!['preparing', 'blocked', 'sealed'].includes(String(head.state))) return invalid();
      return Object.freeze({ state: 'active', runId, commands, revision, cleanupPending: observed.cleanupPending });
    }
    if (!observed.cleanupPending || commands >= maximum) return Object.freeze({ state: head.state, runId, commands, revision, cleanupPending: observed.cleanupPending });
    await owner.retire({ seriesId, runId, expectedRevision: revision, limit: 128,
      logicalKey: calendarHash(['calendar-series-cleanup-step-v1', runId, revision]), ...(head.state === 'published' ? { cleanupOnly: true } : {}) });
    commands++;
  }
}

/** Managed worker entry: reconcile terminal work BEFORE asking for a source or
 * loading a timezone engine. Jobs supplies the original durable window and a
 * fixed native loader. This is not a new scheduler or an application callback
 * endpoint. Publication/abort recovery can therefore finish after deadline,
 * policy, participant or engine retirement without granting fresh bookings. */
export async function runCalendarSeriesMaterializationTask(dependencies: {
  readonly owner: CalendarSeriesNativeOwner;
  readonly transport: CalendarSeriesNativeTransport;
  readonly seriesId: string;
  readonly window: CalendarSeriesMaterializationWindow;
  load(): Promise<{ readonly source: CalendarSeriesCompilationSource; readonly continuation?: CalendarSeriesPublishedContinuation }>;
}, options: { readonly maxCommands?: number } = {}): Promise<CalendarSeriesMaterializationWork> {
  const seriesId = calendarKey(dependencies.seriesId), maximum = calendarInteger(options.maxCommands ?? 32, 1, 256);
  const settled = await settleCalendarSeriesMaterialization(dependencies.owner, { seriesId, runId: dependencies.window.runId,
    window: dependencies.window, maxCommands: maximum });
  if (settled.state === 'published' || settled.state === 'aborted') return Object.freeze({ ...settled, state: settled.state });
  const loaded = await dependencies.load(); dependencies.owner.assertCurrent();
  if (inspectCalendarSeriesCompilationSource(loaded.source).seriesId !== seriesId) return invalid();
  return createCalendarSeriesMaterializationController({ owner: dependencies.owner, transport: dependencies.transport,
    source: loaded.source, window: dependencies.window, ...(loaded.continuation ? { continuation: loaded.continuation } : {}) }).run({ maxCommands: maximum });
}

/** One facade per original native run. It may execute many short physical steps
 * in a worker turn, then return pending for the EXISTING durable Jobs runner.
 * Errors (especially unknown settlement) escape: no new run/key or blind retry
 * is invented. A later invocation reads durable native progress first. */
export function createCalendarSeriesMaterializationController(dependencies: {
  readonly owner: CalendarSeriesNativeOwner;
  readonly transport: CalendarSeriesNativeTransport;
  readonly source: CalendarSeriesCompilationSource;
  readonly window: CalendarSeriesMaterializationWindow;
  /** Must come from the SAME native snapshot as a published source, never a
   * caller supplied cursor paired with a caller supplied expected digest. */
  readonly continuation?: CalendarSeriesPublishedContinuation;
}) {
  const { owner, transport, source } = dependencies, binding = inspectCalendarSeriesCompilationSource(source);
  const supplied = calendarRecord(cloneDatabaseSerializableValue(dependencies.window),
    ['runId', 'sourcePublicationId', 'windowFromMs', 'windowUntilMs', 'nominalFrom', 'nominalUntil']);
  const runId = calendarKey(supplied.runId), sourcePublicationId = calendarKey(supplied.sourcePublicationId);
  const windowFromMs = calendarInteger(supplied.windowFromMs, -8640000000000000, 8640000000000000);
  const windowUntilMs = calendarInteger(supplied.windowUntilMs, windowFromMs + 1, 8640000000000000);
  const range = Object.freeze({ from: String(supplied.nominalFrom), until: String(supplied.nominalUntil) });
  const kind = binding.basePublicationId === null ? 'cutover' : 'horizon';
  if (binding.ownerId !== owner.owner.owner_id || binding.scopeId !== owner.owner.scope_id || binding.rootHash !== owner.owner.root_hash
    || binding.realmFingerprint !== owner.owner.realm_fingerprint || transport.writerPolicy.rootHash !== binding.rootHash
    || transport.writerPolicy.realmFingerprint !== binding.realmFingerprint || kind === 'horizon'
      && (sourcePublicationId !== binding.basePublicationId || binding.preparationId !== runId || !dependencies.continuation)) return invalid();
  const continuation = dependencies.continuation === undefined ? undefined
    : cloneDatabaseSerializableValue(dependencies.continuation) as unknown as CalendarSeriesPublishedContinuation;
  if (kind === 'cutover' && continuation) return invalid();
  let running = false;
  let batchCache: { readonly baseProgressId: string | null; readonly compiled: ReturnType<typeof compileCalendarSeriesBatch>;
    readonly projection: ReturnType<typeof createCalendarSeriesProjection> } | undefined;
  const status = (state: CalendarSeriesMaterializationWork['state'], commands: number, revision: number | null, cleanupPending = false): CalendarSeriesMaterializationWork =>
    Object.freeze({ state, runId, commands, revision, cleanupPending });
  const initialCursor = () => {
    if (!continuation) return createCalendarSeriesCompilationCursor(source, range);
    const checkpoint = calendarRecord(cloneDatabaseSerializableValue(continuation.checkpoint)), previousRange = calendarRecord(checkpoint.range, ['from', 'until']);
    const restored = restoreCalendarSeriesCompilationCursor(source, { from: String(previousRange.from), until: String(previousRange.until) }, checkpoint, hash(continuation.progressDigest));
    if (checkpoint.status === 'source-complete') return null;
    return continueCalendarSeriesCompilationWindow(source, restored, range);
  };
  return Object.freeze({
    runId,
    async run(options: { readonly maxCommands?: number } = {}): Promise<CalendarSeriesMaterializationWork> {
      if (running) throw new CalendarError('CALENDAR_REVISION_CONFLICT');
      const maxCommands = calendarInteger(options.maxCommands ?? 32, 1, 256);
      running = true; let commands = 0;
      try {
        for (;;) {
          owner.assertCurrent();
          const observed = await owner.read<NativeRead>('calendar.series.run', { seriesId: binding.seriesId, runId });
          if (observed.status !== 'known' && observed.status !== 'unknown') return invalid();
          const head = observed.status === 'known' ? calendarRecord(observed.state) : null;
          const revision = head === null ? null : calendarInteger(head.revision, 1);
          if (head) {
            const retainedRun = calendarRecord(observed.run);
            if (retainedRun.id !== runId || retainedRun.series_id !== binding.seriesId || retainedRun.scope_id !== binding.scopeId
              || retainedRun.owner_id !== binding.ownerId || retainedRun.source_publication_id !== sourcePublicationId
              || retainedRun.window_from_ms !== windowFromMs || retainedRun.window_until_ms !== windowUntilMs
              || retainedRun.nominal_from !== range.from || retainedRun.nominal_until !== range.until
              || retainedRun.source_binding_json !== calendarJson(binding)) throw new CalendarError('CALENDAR_REVISION_CONFLICT');
            if (head.state === 'published' || head.state === 'aborted') {
              if (!observed.cleanupPending) return status(head.state, commands, revision);
              if (commands >= maxCommands) return status(head.state, commands, revision, true);
              await owner.retire({ seriesId: binding.seriesId, runId, expectedRevision: revision!, limit: 128,
                logicalKey: calendarHash(['calendar-series-cleanup-step-v1', runId, revision]), ...(head.state === 'published' ? { cleanupOnly: true } : {}) });
              commands++; continue;
            }
            if (!['preparing', 'blocked', 'sealed'].includes(String(head.state))) return invalid();
          }
          if (commands >= maxCommands) return status('pending', commands, revision);
          const publication = head ? parsed(head.publication_cursor_json ?? '{}') : {};
          if (head && Object.keys(publication).length) {
            if (publication.kind !== 'calendar-series-publication-cursor-v1') return invalid();
            const complete = publication.phase === 'ready';
            await owner.command(transport.sealSource(source, complete ? 'calendar.series.run.publish' : 'calendar.series.run.seal',
              calendarHash(['calendar-series-publication-step-v1', runId, complete ? 'publish' : 'seal', revision]),
              { runId, expectedRevision: revision!, ...(complete ? {} : { limit: 256 }) }));
            commands++; continue;
          }
          if (head?.projection_complete === 1 && observed.progress && observed.progress.completion !== 'incomplete') {
            await owner.command(transport.sealSource(source, 'calendar.series.run.seal',
              calendarHash(['calendar-series-publication-step-v1', runId, 'seal', revision]), { runId, expectedRevision: revision!, limit: 256 }));
            commands++; continue;
          }
          const previous = observed.progress;
          const baseProgressId = previous ? calendarKey(previous.id) : null;
          if (!batchCache || batchCache.baseProgressId !== baseProgressId) {
            const compilerCursor = previous ? restoreCalendarSeriesCompilationCursor(source, range,
              parsed(previous.checkpoint_json) as unknown as CalendarRecurrenceCheckpoint, hash(previous.after_digest)) : initialCursor();
            if (compilerCursor === null) {
              if (head) return invalid();
              return status('source-complete', commands, null);
            }
            const compiled = compileCalendarSeriesBatch(source, compilerCursor, { candidateLimit: 4096, occurrenceLimit: 100 });
            batchCache = { baseProgressId, compiled, projection: createCalendarSeriesProjection(source, compiled.contribution, compiled.evidence.batchDigest, { runId }) };
          }
          const { compiled, projection } = batchCache;
          if (!head) {
            await owner.command(transport.sealSource(source, 'calendar.series.run.begin', calendarHash(['calendar-series-begin-v1', runId]), cloneDatabaseSerializableValue({
              runId, kind, sourcePublicationId, windowFromMs, windowUntilMs, nominalFrom: range.from, nominalUntil: range.until,
              initialProgressDigest: continuation?.progressDigest ?? compiled.evidence.progress.beforeDigest,
              initialProjectionCheckpoint: inspectCalendarSeriesProjection(projection).checkpoint,
            })));
            commands++; continue;
          }
          const checkpoint = parsed(head.projection_cursor_json) as unknown as CalendarSeriesProjectionCheckpoint;
          const cursor = head.projection_complete === 1 ? projection : restoreCalendarSeriesProjection(source, compiled.contribution,
            compiled.evidence.batchDigest, { runId }, checkpoint, calendarHash(['calendar-series-projection-progress-v1', checkpoint]));
          const step = advanceCalendarSeriesProjection(cursor);
          await owner.command(transport.sealProjection(source, step.cursor, step.stepDigest));
          commands++;
        }
      } finally { running = false; }
    },
  });
}
