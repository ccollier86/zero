/** Actual registered writers/queries + tracked ReactiveDB MEMORY commit guards.
 * The owner executor is controlled locally: no actor process, physical file or
 * cross-process DatabaseCommitAuthority qualification is claimed. No outputs. */
import { expect, spyOn, test } from 'bun:test';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { registerReactiveDBCommitGuard } from '../sync/reactive-db';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { seriesMaterializationWriterFixture } from './test-support/series-materialization-writer-fixture';
import { createCalendarSeriesNativeOwner, type CalendarSeriesNativeOwnerDependencies } from './series-runtime-owner';
import { createCalendarSeriesMaterializationController, runCalendarSeriesMaterializationTask, type CalendarSeriesMaterializationWindow } from './series-materialization-controller';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES as t } from './realm-series-materialization-migration';
import { CalendarError, readCalendarRejection } from './error';
import { calendarHash, calendarJson } from './validation';
import { captureCalendarSeriesCompilationSource, compileCalendarSeriesBatch, continueCalendarSeriesCompilationWindow,
  createCalendarSeriesCompilationCursor, restoreCalendarSeriesCompilationCursor } from './series-compilation';
import { createCalendarSeriesPublishedSourceReader, type CalendarSeriesPublishedContinuation, type CalendarSeriesPublishedWindow } from './series-native-source';

function fixture(options: Parameters<typeof seriesMaterializationWriterFixture>[0] = {}) {
  const base = seriesMaterializationWriterFixture(options), stop = new AbortController();
  let owner: ReturnType<typeof createCalendarSeriesNativeOwner> | undefined;
  try {
    let unknownCommand: string | undefined, finalChecks = 0, finalRefusal = false, policyCurrent = true, queryPause: (() => Promise<void>) | undefined;
    const calls: { kind: string; name: string; input: DatabaseSerializableValue }[] = [];
    owner = createCalendarSeriesNativeOwner({ owner: base.ownerRecord, transport: base.transport, signal: stop.signal,
      assertOwnerCurrent(selected) { if (calendarJson(selected) !== calendarJson(base.ownerRecord)) throw new CalendarError('CALENDAR_STATE_INVALID'); },
      assertSeriesPolicyCurrent(_scope, generation) { if (!policyCurrent || generation !== base.snapshot.policyGeneration) throw new CalendarError('CALENDAR_POLICY_STALE'); },
      async execute<T>(...args: Parameters<CalendarSeriesNativeOwnerDependencies['execute']>): Promise<T> {
        const [kind, name, input, operation] = args;
        calls.push({ kind, name, input }); operation.guard();
        if (kind === 'query') {
          if (queryPause) { const selected = queryPause; queryPause = undefined; await selected(); operation.guard(); }
          return base.query(name, input as Record<string, unknown>) as T;
        }
        // This is the actual local ReactiveDB commit edge, not an invented
        // CalendarActor. Its runtime-owned guard wraps the genuine SQL writer.
        const remove = registerReactiveDBCommitGuard(base.reactive, { capture: () => 1, beforeCommit() {
          finalChecks++; operation.guard(); operation.finalCommitGuard?.();
          if (finalRefusal) throw new CalendarError('CALENDAR_FORBIDDEN'); return undefined;
        } });
        try {
          const result = runDatabaseRealmCommand(base.realm, base.reactive, name, input, base.transport.writerPolicy as never) as unknown as { ok: true; value: T };
          if (!result.ok) throw new Error('Canonical writer must return its receipt');
          if (unknownCommand === name) { unknownCommand = undefined; throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
          return result.value;
        } catch (error) { throw readCalendarRejection(error) ?? error; }
        finally { remove(); }
      },
    });
    const window: CalendarSeriesMaterializationWindow = { runId: base.runId, sourcePublicationId: base.beginPayload.sourcePublicationId,
      windowFromMs: base.beginPayload.windowFromMs, windowUntilMs: base.beginPayload.windowUntilMs,
      nominalFrom: base.beginPayload.nominalFrom, nominalUntil: base.beginPayload.nominalUntil };
    const controller = (patch: Partial<CalendarSeriesMaterializationWindow> = {}) => createCalendarSeriesMaterializationController({ owner: owner!, transport: base.transport,
      source: base.source, window: { ...window, ...patch } });
    return { base, owner, window, calls, controller,
      unknown(name: string) { unknownCommand = name; }, refuse(value: boolean) { finalRefusal = value; }, finalChecks: () => finalChecks,
      policy(value: boolean) { policyCurrent = value; },
      pauseNextRead(wait: () => Promise<void>) { queryPause = wait; },
      close() { owner?.close(); base.close(); } };
  } catch (error) { owner?.close(); base.close(); throw error; }
}
function head(f: ReturnType<typeof fixture>): Record<string, any> { return f.base.db.query(`SELECT * FROM ${t.runState} WHERE id=?`).get(f.base.runId) as Record<string, any>; }

test('controller begins an actual run and a new controller resumes its durable projection/COUNT without creating new authored history', async () => {
  const f = fixture();
  try {
    const first = await f.controller().run({ maxCommands: 1 }); expect(first).toMatchObject({ state: 'pending', runId: f.base.runId, commands: 1, revision: 1 });
    expect(head(f).candidate_count).toBe(0); expect(f.finalChecks()).toBe(1);
    const resumed = await f.controller().run({ maxCommands: 1 }); expect(resumed).toMatchObject({ state: 'pending', commands: 1, revision: 2 });
    expect(head(f)).toMatchObject({ candidate_count: 3, resource_count: 3, claim_count: 3, projection_complete: 1 });
    const progress = f.base.db.query(`SELECT * FROM ${t.progress}`).get() as Record<string, any>;
    expect(JSON.parse(progress.checkpoint_json).rruleCount).toBe(3); expect(progress.after_digest).toBe(f.base.batch.evidence.progress.afterDigest);
    expect(f.base.db.query('SELECT count(*) AS n FROM _calendar_series_generations').get()).toEqual({ n: 1 });
    expect(f.base.db.query('SELECT count(*) AS n FROM _calendar_series_receipts').get()).toEqual({ n: 1 });
    expect(f.base.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]);
    expect(f.base.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('controller completes actual atomic020/021 publication and drains only disposable claims/builders while published occupancy stays authoritative', async () => {
  const f = fixture();
  try {
    const result = await f.controller().run({ maxCommands: 32 });
    expect(result).toMatchObject({ state: 'published', runId: f.base.runId, cleanupPending: false }); expect(result.commands).toBeGreaterThanOrEqual(5);
    expect(head(f)).toMatchObject({ state: 'published', phase: 'current', candidate_count: 3, resource_count: 3, member_count: 3, working_member_count: 3 });
    expect(f.base.db.query('SELECT count(*) AS n FROM _calendar_series_publications').get()).toEqual({ n: 1 });
    expect(f.base.db.query(`SELECT count(*) AS n FROM ${t.publications}`).get()).toEqual({ n: 1 });
    expect(f.base.db.query(`SELECT count(*) AS n FROM ${t.continuationHeads}`).get()).toEqual({ n: 1 });
    expect(f.base.db.query(`SELECT * FROM ${t.claims}`).all()).toEqual([]); expect(f.base.db.query(`SELECT * FROM ${t.cellBuilders}`).all()).toEqual([]);
    expect(f.base.query('calendar.seriesOccupancy', { scopeId: f.base.snapshot.scopeId, resourceIds: f.base.resources,
      occupiedStartMs: Date.parse('2030-01-01T10:00:00.000Z'), occupiedEndMs: Date.parse('2030-01-01T11:00:00.000Z'), nowMs: Date.now() })).toEqual({
      currentConflict: true, pendingConflict: false, reconciliationNeeded: false });
    const before = { bytes: f.base.db.serialize(), sequence: f.base.reactive.currentSeq };
    await expect(f.controller().run({ maxCommands: 1 })).resolves.toMatchObject({ state: 'published', commands: 0, cleanupPending: false });
    expect({ bytes: f.base.db.serialize(), sequence: f.base.reactive.currentSeq }).toEqual(before);
    expect(f.base.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('terminal task recovery drains accepted publication after deadline/policy/engine retirement without loading a source and still rejects window collision', async () => {
  const f = fixture(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  let restoreClock: (() => void) | undefined;
  try {
    await expect(f.controller().run({ maxCommands: 4 })).resolves.toMatchObject({ state: 'published', commands: 4, cleanupPending: true });
    const immutableTables = ['_calendar_series_publications', t.publications, t.versions, t.members, t.workingMembers, t.selectors, t.seals, t.progress, t.continuationHeads];
    const acceptedFacts = () => immutableTables.map(table => [table, f.base.db.query(`SELECT * FROM ${table} ORDER BY id`).all()]);
    const before = acceptedFacts(), projection = head(f).projection_cursor_json;
    const clock = spyOn(Date, 'now').mockReturnValue(f.base.snapshot.preparationExpiresAtMs + 1); restoreClock = () => { clock.mockRestore(); };
    f.policy(false); Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('terminal recovery must not load Temporal'); } });
    let loaded = false;
    const task = { owner: f.owner, transport: f.base.transport, seriesId: f.base.snapshot.seriesId, window: f.window,
      async load(): Promise<never> { loaded = true; throw new Error('terminal recovery must not load a source'); } };
    await expect(runCalendarSeriesMaterializationTask(task, { maxCommands: 8 })).resolves.toMatchObject({ state: 'published', cleanupPending: false });
    expect(loaded).toBe(false); expect(acceptedFacts()).toEqual(before); expect(head(f).projection_cursor_json).toBe(projection);
    expect(f.base.db.query(`SELECT * FROM ${t.claims}`).all()).toEqual([]); expect(f.base.db.query(`SELECT * FROM ${t.cellBuilders}`).all()).toEqual([]);
    expect(f.base.query('calendar.seriesOccupancy', { scopeId: f.base.snapshot.scopeId, resourceIds: f.base.resources,
      occupiedStartMs: Date.parse('2030-01-01T10:00:00.000Z'), occupiedEndMs: Date.parse('2030-01-01T11:00:00.000Z'), nowMs: Date.now() })).toMatchObject({ currentConflict: true, pendingConflict: false });
    const quiet = { bytes: f.base.db.serialize(), sequence: f.base.reactive.currentSeq };
    await expect(runCalendarSeriesMaterializationTask({ ...task, window: { ...f.window, windowUntilMs: f.window.windowUntilMs + 1 } }, { maxCommands: 8 }))
      .rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    expect({ bytes: f.base.db.serialize(), sequence: f.base.reactive.currentSeq }).toEqual(quiet); expect(loaded).toBe(false);
  } finally { restoreClock?.(); if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); f.close(); }
}, 30_000);

test('engine-free terminal task drains an aborted large prepared prefix including hidden memberships and empty selectors without deleting immutable evidence', async () => {
  const f = fixture({ resources: 4, count: 100, windowUntil: '2030-04-11' }), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  let restoreClock: (() => void) | undefined;
  try {
    const controller = f.controller();
    for (let turn = 0; ; turn++) {
      expect(turn).toBeLessThan(100); await controller.run({ maxCommands: 1 });
      const current = head(f), publication = JSON.parse(current.publication_cursor_json);
      if (publication.phase === 'ready') break;
    }
    expect(f.base.db.query(`SELECT count(*) AS n FROM ${t.workingMembers}`).get()).toEqual({ n: 400 });
    const immutableTables = [t.versions, t.members, t.cellSeals, t.cellSets], immutable = () => immutableTables.map(table => [table, f.base.db.query(`SELECT count(*) AS n FROM ${table}`).get()]);
    const before = immutable();
    await f.owner.retire({ seriesId: f.base.snapshot.seriesId, runId: f.base.runId, expectedRevision: head(f).revision, logicalKey: 'abort-large-prepared', limit: 1 });
    expect(head(f).state).toBe('aborted'); expect((f.base.db.query(`SELECT count(*) AS n FROM ${t.workingMembers}`).get() as { n: number }).n).toBeGreaterThan(0);
    const clock = spyOn(Date, 'now').mockReturnValue(f.base.snapshot.preparationExpiresAtMs + 1); restoreClock = () => { clock.mockRestore(); };
    f.policy(false); Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('aborted recovery cannot load Temporal'); } });
    let loaded = false;
    await expect(runCalendarSeriesMaterializationTask({ owner: f.owner, transport: f.base.transport, seriesId: f.base.snapshot.seriesId, window: f.window,
      async load(): Promise<never> { loaded = true; throw new Error('aborted recovery cannot load source'); } }, { maxCommands: 8 })).resolves.toMatchObject({ state: 'aborted', cleanupPending: false });
    expect(loaded).toBe(false); expect(immutable()).toEqual(before);
    for (const table of [t.claims, t.cellBuilders, t.workingMembers, t.selectors]) expect(f.base.db.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(f.base.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]); expect(f.base.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { restoreClock?.(); if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); f.close(); }
}, 30_000);

test('actual same-read published continuation advances COUNT in a new durable window after initial expiry and preserves a shared UTC cell union', async () => {
  const f = fixture({ count: 3, start: '2030-01-01T23:30:00.000', windowUntil: '2030-01-02' });
  let restoreClock: (() => void) | undefined;
  try {
    await expect(f.controller().run({ maxCommands: 32 })).resolves.toMatchObject({ state: 'published', cleanupPending: false });
    const createdAtMs = f.base.snapshot.preparationExpiresAtMs + 1, clock = spyOn(Date, 'now').mockReturnValue(createdAtMs); restoreClock = () => { clock.mockRestore(); };
    const retainedWindow: CalendarSeriesPublishedWindow = { runId: 'next-counted-window', seriesId: f.base.snapshot.seriesId,
      sourcePublicationId: f.window.sourcePublicationId, createdAtMs, expiresAtMs: createdAtMs + 60_000 };
    const reader = createCalendarSeriesPublishedSourceReader({ owner: f.base.ownerRecord, policyGeneration: f.base.snapshot.policyGeneration, signal: f.owner.signal,
      assertOwnerCurrent(selected) { expect(selected).toEqual(f.base.ownerRecord); },
      assertSeriesAuthorityCurrent(generation) { expect(generation).toBe(f.base.snapshot.policyGeneration); },
      assertWindowCurrent(selected) { expect(selected).toEqual(retainedWindow); },
    }, retainedWindow);
    const selected = withDatabaseReadQuerySession(createDatabaseReadQuerySession(f.base.db), context => reader(context));
    expect((selected.continuation.checkpoint as any).rruleCount).toBe(1);
    expect(selected.snapshot.preparationExpiresAtMs).toBe(retainedWindow.expiresAtMs);
    const source = captureCalendarSeriesCompilationSource(selected.snapshot, { maxResources: 16, maxParticipants: 100 });
    const controller = createCalendarSeriesMaterializationController({ owner: f.owner, transport: f.base.transport, source, continuation: selected.continuation,
      window: { runId: retainedWindow.runId, sourcePublicationId: retainedWindow.sourcePublicationId, windowFromMs: Date.parse('2030-01-02T00:00:00.000Z'),
        windowUntilMs: Date.parse('2030-01-03T00:00:00.000Z'), nominalFrom: '2030-01-02', nominalUntil: '2030-01-03' } });
    await expect(controller.run({ maxCommands: 2 })).resolves.toMatchObject({ state: 'pending', commands: 2 });
    const progress = f.base.db.query(`SELECT p.* FROM ${t.progress} p JOIN ${t.runState} q ON q.progress_id=p.id WHERE q.id=?`).get(retainedWindow.runId) as Record<string, any>;
    expect(JSON.parse(progress.checkpoint_json).rruleCount).toBe(2); expect(progress.evaluated_candidates).toBe(1);
    await expect(controller.run({ maxCommands: 32 })).resolves.toMatchObject({ state: 'published', cleanupPending: false });
    expect(f.base.db.query('SELECT count(*) AS n FROM _calendar_series_generations').get()).toEqual({ n: 1 });
    expect(f.base.db.query('SELECT count(*) AS n FROM _calendar_series_receipts').get()).toEqual({ n: 1 });
    expect(f.base.db.query('SELECT count(*) AS n FROM _calendar_series_publications').get()).toEqual({ n: 1 });
    expect(f.base.db.query(`SELECT count(*) AS n FROM ${t.publications}`).get()).toEqual({ n: 2 });
    for (const [from, until] of [['2030-01-02T00:00:00.000Z', '2030-01-02T00:15:00.000Z'], ['2030-01-02T23:45:00.000Z', '2030-01-02T23:59:00.000Z']])
      expect(f.base.query('calendar.seriesOccupancy', { scopeId: f.base.snapshot.scopeId, resourceIds: f.base.resources,
        occupiedStartMs: Date.parse(from!), occupiedEndMs: Date.parse(until!), nowMs: Date.now() })).toMatchObject({ currentConflict: true, pendingConflict: false });
    expect(f.base.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { restoreClock?.(); f.close(); }
}, 30_000);

test('unknown stage acknowledgement escapes, and a recreated controller resumes the exact partial resource/cell checkpoint', async () => {
  const f = fixture({ resources: 16, count: 1, durationMs: 31 * 86_400_000, before: 1440, after: 1440, windowUntil: '2030-01-02' });
  try {
    f.unknown('calendar.series.run.stage');
    await expect(f.controller().run({ maxCommands: 2 })).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN' });
    const committed = head(f), before = JSON.parse(committed.projection_cursor_json);
    expect(committed).toMatchObject({ revision: 2, candidate_count: 1, resource_count: 16, claim_count: 16, projection_complete: 0 });
    expect(committed.progress_id).toBeNull();
    const resumed = await f.controller().run({ maxCommands: 1 }); expect(resumed).toMatchObject({ state: 'pending', commands: 1, revision: 3 });
    const after = JSON.parse(head(f).projection_cursor_json); expect(after.instructionCount).toBeGreaterThan(before.instructionCount);
    expect(head(f).candidate_count).toBe(1); expect(f.base.db.query(`SELECT count(*) AS n FROM ${t.runs}`).get()).toEqual({ n: 1 });
    expect(f.base.db.query('SELECT * FROM _calendar_series_publications').all()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('same run/window collision refuses before another command or mutation and final callback refusal rolls back run creation', async () => {
  const f = fixture();
  try {
    await f.controller().run({ maxCommands: 1 }); const before = { bytes: f.base.db.serialize(), sequence: f.base.reactive.currentSeq }, writes = f.calls.filter(call => call.kind === 'command').length;
    await expect(f.controller({ windowUntilMs: f.window.windowUntilMs + 1 }).run({ maxCommands: 1 })).rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    expect({ bytes: f.base.db.serialize(), sequence: f.base.reactive.currentSeq }).toEqual(before); expect(f.calls.filter(call => call.kind === 'command')).toHaveLength(writes);
  } finally { f.close(); }
  const refusal = fixture();
  try {
    refusal.refuse(true); const before = { bytes: refusal.base.db.serialize(), sequence: refusal.base.reactive.currentSeq };
    await expect(refusal.controller().run({ maxCommands: 1 })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect({ bytes: refusal.base.db.serialize(), sequence: refusal.base.reactive.currentSeq }).toEqual(before);
    expect(refusal.base.db.query(`SELECT * FROM ${t.runs}`).all()).toEqual([]);
  } finally { refusal.close(); }
}, 30_000);

test('controller serialization blocks overlapping turns while the durable read waits and releases the gate after completion', async () => {
  const f = fixture();
  try {
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); f.pauseNextRead(() => waiting);
    const controller = f.controller(), first = controller.run({ maxCommands: 1 });
    await expect(controller.run({ maxCommands: 1 })).rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    release(); await expect(first).resolves.toMatchObject({ state: 'pending', revision: 1 });
    await expect(controller.run({ maxCommands: 1 })).resolves.toMatchObject({ state: 'pending', revision: 2 });
  } finally { f.close(); }
}, 30_000);

test('qualified counted continuation does not replay the old prefix and source-complete progress must remain independently verified', async () => {
  const f = fixture({ count: 200, windowUntil: '2030-01-02' });
  try {
    const old = compileCalendarSeriesBatch(f.base.source, createCalendarSeriesCompilationCursor(f.base.source, { from: '2030-01-01', until: '2030-01-02' }));
    expect(old.evidence.progress.checkpoint.rruleCount).toBe(1);
    const source = captureCalendarSeriesCompilationSource({ ...f.base.snapshot, preparationId: 'next-window-run', basePublicationId: 'published-source' }, { maxResources: 16, maxParticipants: 100 });
    const continuation: CalendarSeriesPublishedContinuation = { headId: 'head', headRevision: 1, runId: 'old-run', progressId: 'old-progress',
      progressDigest: old.evidence.progress.afterDigest, checkpoint: old.evidence.progress.checkpoint };
    const restored = restoreCalendarSeriesCompilationCursor(source, { from: '2030-01-01', until: '2030-01-02' }, continuation.checkpoint, continuation.progressDigest);
    const next = compileCalendarSeriesBatch(source, continueCalendarSeriesCompilationWindow(source, restored, { from: '2030-01-02', until: '2030-01-03' }));
    expect(next.evidence.work.evaluatedCandidates).toBe(1); expect(next.evidence.progress.checkpoint.rruleCount).toBe(2);
    expect(next.evidence.candidates.map(value => value.nominalRank)).toEqual([1]);
    // No DB mutation is exercised until the actual horizon publication fixture
    // exists; this source-complete branch should still validate native progress.
    const controller = createCalendarSeriesMaterializationController({ owner: f.owner, transport: f.base.transport, source,
      window: { ...f.window, runId: 'next-window-run', sourcePublicationId: 'published-source', nominalFrom: '2030-01-02', nominalUntil: '2030-01-03' },
      continuation: { ...continuation, progressDigest: calendarHash('tampered'), checkpoint: { ...old.evidence.progress.checkpoint, status: 'source-complete' } } });
    await expect(controller.run({ maxCommands: 1 })).rejects.toBeInstanceOf(Error);
  } finally { f.close(); }
}, 30_000);
