/** Native SQLite MEMORY source/status reads. Not package, actor or browser qualification. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { Migrator } from '../migrations/migrator';
import { createReactiveDB } from '../sync/reactive-db';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import type { CalendarActor } from './contracts';
import { CalendarError, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { CALENDAR_SERIES_MIGRATION, calendarSeriesTables } from './realm-series-migration';
import { normalizeCalendarTimedSeriesAuthoring } from './series-authoring';
import { readCalendarSeriesPlan, readCalendarTimedSeriesSource } from './series-read-model';
import { createCalendarSeriesNativeSourceReader, type CalendarSeriesNativeSourceDependencies } from './series-native-source';
import { calendarRecurrenceTraversal } from './recurrence-engine';
import { captureCalendarSeriesCompilationSource, createCalendarSeriesCompilationCursor, compileCalendarSeriesBatch } from './series-compilation';
import { calendarHash, calendarJson } from './validation';

type TestRow = Record<string, SQLQueryBindings>;
const actor: CalendarActor = { scopeId: 'tenant:synthetic-series-reader', userId: 'synthetic-manager', principal: 'synthetic-session', manageAll: true, createOwn: true };
const ownerId = 'synthetic-physical-owner', requestId = 'series-plan-key', seriesId = 'synthetic-series';
const sourceId = 'series-source:' + calendarHash([actor.scopeId, ownerId, seriesId]);
const nativeOwner = { id: 'calendar:' + calendarHash(actor.scopeId), scope_id: actor.scopeId, owner_id: ownerId,
  root_hash: calendarHash('synthetic-root'), realm_fingerprint: calendarRealm.fingerprint, established: 1 };
const policyGeneration = calendarHash('synthetic-policy');
const authoring = normalizeCalendarTimedSeriesAuthoring({ kind: 'timed-series-v1', recurrence: {
  kind: 'timed-local-v1', localStart: '2030-01-01T10:00:00.000', timeZone: 'UTC', fold: 'earlier', durationMilliseconds: 3_600_000,
  rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } },
}, template: { resourceIds: ['r'], title: 'PRIVATE_APPOINTMENT_TITLE', bufferBeforeMinutes: 0, bufferAfterMinutes: 0, appointmentType: null, visit: null, participants: [] } }, { maxResources: 16, maxParticipants: 100 });
const acceptance = { operation: 'series.plan.accepted', requestId, seriesId, controlRevision: 1, preparationId: 'preparation', basePublicationId: null } as const;
function insert(db: Database, table: string, row: TestRow) {
  return db.run(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`, Object.values(row));
}
function fixture() {
  const raw = new Database(':memory:');
  let reactive: ReturnType<typeof createReactiveDB> | undefined;
  try {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', createBackups: false, log() {},
      migrations: [...calendarRealm.migrations, CALENDAR_SERIES_MIGRATION], migrationTableStages: [...calendarRealm.migrationTableStages!, { version: '020', tables: calendarSeriesTables() }] });
    try { migrator.run(); } finally { migrator.dispose(); }
    reactive = createReactiveDB({ database: raw, ownsDatabase: false });
    for (const [table, definition] of Object.entries(calendarRealm.tables)) reactive.defineTable(table, definition);
    const command = (name: string, input: Record<string, unknown>) => runDatabaseRealmCommand(calendarRealm, reactive!, 'calendar.' + name,
      cloneDatabaseSerializableValue(name === 'owner.bind' ? input : { actor, ...input }));
    command('owner.bind', { scopeId: actor.scopeId, ownerId });
    command('resource.create', { requestId: 'resource-key', id: 'r', label: 'PRIVATE_RESOURCE_LABEL', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    const receiptId = calendarHash([actor.scopeId, actor.principal, requestId]);
    raw.transaction(() => {
      insert(raw, 'calendar_series', { id: seriesId, scope_id: actor.scopeId, owner_id: ownerId, source_id: sourceId, created_by: actor.userId,
        control_revision: 1, initial_acceptance_receipt_id: receiptId, lifecycle: 'active', grant_epoch: 1, current_grant_id: 'grant', published_generation_id: null, published_publication_id: null, active_preparation_id: 'preparation' });
      insert(raw, '_calendar_series_generations', { id: 'generation', scope_id: actor.scopeId, series_id: seriesId, generation: 1, predecessor_id: null, base_publication_id: null,
        kind: authoring.kind, authoring_json: calendarJson(authoring), authoring_digest: calendarHash(authoring), engine_generation: calendarHash(calendarRecurrenceTraversal(authoring.recurrence).engine), policy_generation: policyGeneration, acceptance_receipt_id: receiptId });
      insert(raw, '_calendar_series_segments', { id: 'segment', scope_id: actor.scopeId, series_id: seriesId, generation_id: 'generation', segment_key: 'original', predecessor_segment_id: null, nominal_cut: null,
        local_from: '2030-01-01', local_until: null, start_json: calendarJson({ localStart: authoring.recurrence.localStart, timeZone: authoring.recurrence.timeZone,
          fold: authoring.recurrence.fold, durationMilliseconds: authoring.recurrence.durationMilliseconds }), rule_json: calendarJson(authoring.recurrence.rule), template_json: calendarJson(authoring.template), source_digest: calendarHash(authoring) });
      insert(raw, '_calendar_series_grants', { id: 'grant', scope_id: actor.scopeId, series_id: seriesId, generation_id: 'generation', grant_revision: 1, issued_epoch: 1,
        owner_id: ownerId, source_id: sourceId, source_generation: 1, operations_json: calendarJson(['series.coverage.commit', 'series.coverage.prepare', 'series.coverage.reconcile']),
        resource_ids_json: calendarJson(['r']), authority_digest: calendarHash(['calendar.series.authority.v1', nativeOwner, policyGeneration]), resource_digest: calendarHash(['r']), issuance_receipt_id: receiptId, issued_ms: 1000 });
      insert(raw, '_calendar_series_preparations', { id: 'preparation', scope_id: actor.scopeId, series_id: seriesId, generation_id: 'generation', grant_id: 'grant', grant_epoch: 1,
        acceptance_receipt_id: receiptId, base_publication_id: null, manifest_digest: calendarHash('synthetic-manifest'), revision: 1, state: 'preparing', created_ms: 1000,
        expires_ms: 10_000, claim_generation: 0, claim_nonce: null, claim_until_ms: null, blocked_code: null, publication_id: null });
      insert(raw, '_calendar_series_receipts', { id: receiptId, scope_id: actor.scopeId, principal: actor.principal, request_id: requestId, digest: calendarHash('synthetic-intent'), series_id: seriesId,
        generation_id: 'generation', control_revision: 1, preparation_id: 'preparation', base_publication_id: null, accepted_ms: 1001, operation: 'series.plan.accepted' });
    })();
    const queries: string[] = [];
    function read<T>(fn: Parameters<typeof withDatabaseReadQuerySession<T>>[1]): T {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      const prepare = copy.prepare.bind(copy);
      const observed = spyOn(copy, 'prepare').mockImplementation(<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, params?: TParams) => {
        queries.push(sql); return prepare<TRow, TParams>(sql, params);
      });
      try { return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), fn); }
      finally { observed.mockRestore(); copy.close(); }
    }
    return { raw, reactive, receiptId, queries,
      plan: (as = actor, key = requestId) => read(context => readCalendarSeriesPlan(context, { actor: as, requestId: key })),
      source: (as = actor) => read(context => readCalendarTimedSeriesSource(context, { actor: as, id: seriesId })),
      read, snapshot: () => ({ bytes: raw.serialize(), sequence: reactive!.currentSeq }),
      close() { try { reactive?.dispose(); } finally { raw.close(); } } };
  } catch (error) { try { reactive?.dispose(); } finally { raw.close(); } throw error; }
}
function reject(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Synthetic expected rejection'); }
  catch (error) { expect(error instanceof CalendarError ? error.code : null).toBe(code); }
}
function publish(f: ReturnType<typeof fixture>) {
  const nativeId = calendarHash(['calendar-series-native-v1', actor.scopeId, ownerId, sourceId, 1, 'commit', 'synthetic-final']);
  f.raw.transaction(() => {
    insert(f.raw, '_calendar_series_native_receipts', { id: nativeId, domain: 'calendar-series-native-v1', scope_id: actor.scopeId, owner_id: ownerId,
      source_id: sourceId, series_id: seriesId, generation_id: 'generation', source_generation: 1, grant_id: 'grant', grant_epoch: 1, preparation_id: 'preparation',
      phase: 'commit', logical_key: 'synthetic-final', candidate_digest: calendarHash('synthetic-manifest'), cursor_digest: calendarHash('synthetic-progress'), policy_digest: calendarHash('synthetic-policy'), outcome: 'publication.ready', accepted_ms: 2000 });
    insert(f.raw, '_calendar_series_publications', { id: 'publication', scope_id: actor.scopeId, series_id: seriesId, preparation_id: 'preparation', generation_id: 'generation', base_publication_id: null,
      owner_id: ownerId, source_id: sourceId, source_generation: 1, grant_id: 'grant', grant_epoch: 1, manifest_digest: calendarHash('synthetic-manifest'), native_receipt_id: nativeId, published_ms: 2001, operation: 'series.publication.applied' });
  })();
}

test('original acceptance is not applied; readonly reconciliation and desired-source inspection cannot mutate or issue authority', () => {
  const f = fixture(), clock = spyOn(Date, 'now').mockReturnValue(2000);
  try {
    const before = f.snapshot(), plan = f.plan(), desired = f.source();
    if (plan === null) throw new Error('Synthetic source must have its accepted plan');
    expect(plan).toEqual({ acceptance, state: 'preparing', blockedCode: null, publication: null });
    expect(desired.authoring).toEqual(authoring); expect(desired.publishedGenerationId).toBeNull();
    expect(desired.publishedPublicationId).toBeNull(); expect(desired.plan).toEqual(plan);
    expect(Object.isFrozen(desired)).toBe(true); expect(Object.isFrozen(desired.authoring.template.resourceIds)).toBe(true);
    expect(f.plan(actor, 'never-accepted')).toBeNull(); expect(f.snapshot()).toEqual(before);
    expect(JSON.stringify(plan)).not.toMatch(/PRIVATE|owner|authority|source_id|grant|native|credential/);
    expect(f.queries.some(sql => /COUNT\(|OFFSET|UNION|SELECT.*FROM.*_calendar_series_segments/i.test(sql))).toBe(false);
    expect(f.queries.filter(sql => sql.includes('FROM calendar_resources'))).toHaveLength(2);
  } finally { clock.mockRestore(); f.close(); }
});

test('blocked, expired and aborted plans remain accepted facts, never false applied/rollback/retry outcomes', () => {
  const f = fixture(), clock = spyOn(Date, 'now').mockReturnValue(2000);
  try {
    f.raw.run("UPDATE _calendar_series_preparations SET state='blocked',blocked_code='CALENDAR_BOOKING_CONFLICT',revision=revision+1 WHERE id='preparation'");
    expect(f.plan()).toEqual({ acceptance, state: 'blocked', blockedCode: 'CALENDAR_BOOKING_CONFLICT', publication: null });
    clock.mockReturnValue(10_000);
    expect(f.plan()?.state).toBe('expired'); expect(f.plan()?.acceptance).toEqual(acceptance);
    f.raw.run("UPDATE _calendar_series_preparations SET state='aborted',blocked_code=NULL,revision=revision+1 WHERE id='preparation'");
    expect(f.plan()).toEqual({ acceptance, state: 'aborted', blockedCode: null, publication: null });
  } finally { clock.mockRestore(); f.close(); }
});

test('publication is separate exact native evidence; later expiry and source retirement do not rewrite it', () => {
  const f = fixture(), clock = spyOn(Date, 'now').mockReturnValue(3000);
  try {
    publish(f); const plan = f.plan();
    expect(plan?.acceptance).toEqual(acceptance); expect(plan?.state).toBe('published');
    expect(plan?.publication).toEqual({ operation: 'series.publication.applied', id: 'publication', generationId: 'generation', manifestDigest: calendarHash('synthetic-manifest'), publishedAtMs: 2001 });
    expect(f.source().publishedGenerationId).toBe('generation'); expect(f.source().publishedPublicationId).toBe('publication');
    clock.mockReturnValue(100_000);
    f.raw.run("UPDATE calendar_series SET lifecycle='retired',control_revision=2,grant_epoch=2,active_preparation_id=NULL WHERE id=?", [seriesId]);
    expect(f.plan()).toEqual(plan); expect(f.source().lifecycle).toBe('retired');
    expect(f.source().plan.acceptance.controlRevision).toBe(1); expect(f.source().controlRevision).toBe(2);
  } finally { clock.mockRestore(); f.close(); }
});

test('current administration, scope, owner and original principal are enforced before private history disclosure', () => {
  const f = fixture();
  try {
    f.queries.length = 0;
    reject(() => f.source({ ...actor, manageAll: false }), 'CALENDAR_FORBIDDEN');
    reject(() => f.plan({ ...actor, manageAll: false }), 'CALENDAR_FORBIDDEN');
    expect(f.queries.some(sql => sql.includes('calendar_series'))).toBe(false);
    expect(f.plan({ ...actor, principal: 'other-session' })).toBeNull();
    reject(() => f.source({ ...actor, scopeId: 'tenant:other' }), 'CALENDAR_STATE_INVALID');
    // Deliberate corruption in this isolated synthetic database only.
    f.raw.run('DROP TRIGGER _calendar_owner_update');
    f.raw.run("UPDATE _calendar_owner SET owner_id='replaced-owner' WHERE id='application'");
    reject(() => f.source(), 'CALENDAR_STATE_INVALID'); reject(() => f.plan(), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('corrupted source and accepted evidence are refused rather than converted to successful publication', () => {
  const f = fixture();
  try {
    // This is explicitly damaged synthetic evidence, never a supported mutation path.
    f.raw.run('DROP TRIGGER _calendar_series_generations_series_update');
    f.raw.run("UPDATE _calendar_series_generations SET authoring_digest=? WHERE id='generation'", ['a'.repeat(64)]);
    reject(() => f.source(), 'CALENDAR_STATE_INVALID');
    f.raw.run("UPDATE _calendar_series_generations SET authoring_digest=? WHERE id='generation'", [calendarHash(authoring)]);
    f.raw.run('DROP TRIGGER calendar_series_source_cas');
    f.raw.run('UPDATE calendar_series SET published_generation_id=?,published_publication_id=? WHERE id=?', ['generation', 'missing-publication', seriesId]);
    reject(() => f.source(), 'CALENDAR_STATE_INVALID'); reject(() => f.plan(), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('stored publication cannot predate its source acceptance or preparation', () => {
  const f = fixture();
  try {
    publish(f);
    f.raw.run('DROP TRIGGER _calendar_series_native_receipts_series_update');
    f.raw.run("UPDATE _calendar_series_native_receipts SET accepted_ms=0");
    reject(() => f.plan(), 'CALENDAR_STATE_INVALID'); reject(() => f.source(), 'CALENDAR_STATE_INVALID');
    f.raw.run('DROP TRIGGER _calendar_series_publications_series_update');
    f.raw.run("UPDATE _calendar_series_publications SET published_ms=0");
    reject(() => f.plan(), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

function nativeDependencies(): CalendarSeriesNativeSourceDependencies {
  return { owner: nativeOwner, policyGeneration, signal: new AbortController().signal,
    assertOwnerCurrent(owner) { if (calendarJson(owner) !== calendarJson(nativeOwner)) throw new CalendarError('CALENDAR_NOT_READY'); },
    assertSeriesAuthorityCurrent(generation) { if (generation !== policyGeneration) throw new CalendarError('CALENDAR_NOT_READY'); } };
}

test('native source read is bounded, readonly and Temporal-free; detached compilation starts only after the read session closes', () => {
  const f = fixture(), clock = spyOn(Date, 'now').mockReturnValue(2000), nativeRead = createCalendarSeriesNativeSourceReader(nativeDependencies());
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    const before = f.snapshot(); let temporalReads = 0;
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { temporalReads++; throw new Error('PRIVATE_TEMPORAL_READ_DURING_SQL'); } });
    const snapshot = f.read(context => nativeRead(context, seriesId));
    expect(temporalReads).toBe(0); expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.resourceRevisions)).toBe(true);
    if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal');
    const source = captureCalendarSeriesCompilationSource(snapshot, { maxResources: 16, maxParticipants: 100 });
    const cursor = createCalendarSeriesCompilationCursor(source, { from: '2030-01-01', until: '2030-01-04' });
    const compiled = compileCalendarSeriesBatch(source, cursor, { candidateLimit: 10, occurrenceLimit: 10 });
    expect(compiled.evidence.candidates).toHaveLength(3); expect(compiled.evidence.work.completion).toBe('nominal-source-complete');
    expect(compiled.evidence.binding).toMatchObject({ scopeId: actor.scopeId, ownerId, sourceId, seriesId, generationId: 'generation', sourceGeneration: 1,
      preparationId: 'preparation', preparationExpiresAtMs: 10_000, basePublicationId: null, planManifestDigest: calendarHash('synthetic-manifest'),
      resourceRevisions: [{ id: 'r', revision: 1 }] });
    expect(f.snapshot()).toEqual(before); expect(f.plan()?.state).toBe('preparing');
    expect(f.queries.some(sql => /COUNT\(|OFFSET|UNION/.test(sql))).toBe(false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal');
    clock.mockRestore(); f.close();
  }
});

test('native source admission fences current owner/policy/lifetime before and after every read, without inventing a human session', () => {
  const f = fixture(), clock = spyOn(Date, 'now').mockReturnValue(2000);
  try {
    let checks = 0;
    const revoked = createCalendarSeriesNativeSourceReader({ ...nativeDependencies(), assertSeriesAuthorityCurrent() {
      if (++checks === 2) throw new CalendarError('CALENDAR_FORBIDDEN');
    } });
    reject(() => f.read(context => revoked(context, seriesId)), 'CALENDAR_FORBIDDEN'); expect(checks).toBe(2);
    const abort = new AbortController(), closed = createCalendarSeriesNativeSourceReader({ ...nativeDependencies(), signal: abort.signal });
    abort.abort(new CalendarError('CALENDAR_NOT_READY'));
    reject(() => f.read(context => closed(context, seriesId)), 'CALENDAR_NOT_READY');
    const dependencies = nativeDependencies(), stable = createCalendarSeriesNativeSourceReader(dependencies);
    Object.assign(dependencies, { assertOwnerCurrent: () => { throw new Error('REPLACED_CALLBACK'); } });
    expect(f.read(context => stable(context, seriesId)).ownerId).toBe(ownerId);
    clock.mockReturnValue(10_000); reject(() => f.read(context => stable(context, seriesId)), 'CALENDAR_NOT_READY');
  } finally { clock.mockRestore(); f.close(); }
});

test('native snapshot does not reinterpret a retired/published source or changed policy as fresh materialization authority', () => {
  const f = fixture(), clock = spyOn(Date, 'now').mockReturnValue(2000);
  try {
    const dependencies = nativeDependencies(), changed = createCalendarSeriesNativeSourceReader({ ...dependencies, policyGeneration: 'b'.repeat(64), assertSeriesAuthorityCurrent() {} });
    reject(() => f.read(context => changed(context, seriesId)), 'CALENDAR_POLICY_STALE');
    const nativeRead = createCalendarSeriesNativeSourceReader(dependencies);
    publish(f); reject(() => f.read(context => nativeRead(context, seriesId)), 'CALENDAR_NOT_READY');
    f.raw.run("UPDATE calendar_series SET lifecycle='retired',control_revision=2,grant_epoch=2,active_preparation_id=NULL WHERE id=?", [seriesId]);
    reject(() => f.read(context => nativeRead(context, seriesId)), 'CALENDAR_NOT_READY');
  } finally { clock.mockRestore(); f.close(); }
});

test('native source rejects a borrowed initial acceptance and invalid initial grant/acceptance time evidence', () => {
  const f = fixture(), clock = spyOn(Date, 'now').mockReturnValue(2000), nativeRead = createCalendarSeriesNativeSourceReader(nativeDependencies());
  try {
    f.raw.run('DROP TRIGGER _calendar_series_grants_series_update');
    f.raw.run("UPDATE _calendar_series_grants SET issued_ms=0 WHERE id='grant'");
    reject(() => f.read(context => nativeRead(context, seriesId)), 'CALENDAR_STATE_INVALID');
    f.raw.run("UPDATE _calendar_series_grants SET issued_ms=1000 WHERE id='grant'");
    clock.mockReturnValue(1000);
    reject(() => f.read(context => nativeRead(context, seriesId)), 'CALENDAR_STATE_INVALID');
    clock.mockReturnValue(2000);
    // Deliberately broken synthetic FK/anchor only; never an upgrade/adoption path.
    f.raw.run('PRAGMA foreign_keys=OFF'); f.raw.run('DROP TRIGGER calendar_series_source_cas');
    f.raw.run('UPDATE calendar_series SET initial_acceptance_receipt_id=? WHERE id=?', ['f'.repeat(64), seriesId]);
    reject(() => f.read(context => nativeRead(context, seriesId)), 'CALENDAR_STATE_INVALID');
  } finally { clock.mockRestore(); f.close(); }
});
