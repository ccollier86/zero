/** Tracked native MEMORY writer + actual SYSTEM directory/final ReactiveDB fence.
 * Physical coordinator/actor transport and production series broker are NOT qualified or activated. */
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { defineAuthTables } from '../auth/auth-schema';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { UserStore } from '../auth/user-store';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { registerReactiveDBCommitGuard } from '../sync/reactive-db';
import { createDatabaseWriteCommandSession } from '../databases/database-write-command-capability';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { admitCalendarRequest } from './authority';
import { ManagedCalendarParticipantDirectory } from './participants-directory';
import { resolveCalendarConfig } from './config';
import type { CalendarOwnerRecord } from './owner-schema';
import { CalendarError, readCalendarRejection } from './error';
import { calendarRealm } from './realm';
import { CALENDAR_SERIES_ADDITIONS, CALENDAR_SERIES_CAPACITY, migrateCalendarSeries } from './realm-series-migration';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';
import { calendarHash, calendarJson } from './validation';
import { createCalendarSeriesNativeSourceReader } from './series-native-source';
import { captureCalendarSeriesCompilationSource, createCalendarSeriesCompilationCursor, compileCalendarSeriesBatch } from './series-compilation';
import { prepareCalendarInitialSeriesRequest, compileCalendarInitialSeriesRequest, createCalendarInitialSeriesCommand,
  type CalendarInitialSeriesCommand, type CalendarInitialSeriesCompilation, type CalendarInitialSeriesManagedDependencies } from './series-source-writer';

async function fixture(maxEvents = 1000) {
  const base = memoryCalendarServiceFixture({ tenancy: 'single', config: { participants: { userEligibility: 'user' } } });
  let directory: ManagedCalendarParticipantDirectory | undefined, logging: LoggingActorSource | undefined;
  try {
    const browser = base.session('fixture-user', { manager: true });
    const resource = await browser.api.resources.create({ label: 'PRIVATE_RESOURCE', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource-key' });
    const db = base.sourceDatabase(browser.scope)!; migrateCalendarSeries(db.getRawDatabase());
    for (const [name, schema] of Object.entries(CALENDAR_SERIES_ADDITIONS)) db.defineTable(name, schema);
    defineAuthTables(base.system); installAuthAuthorityRevision(base.system);
    const auth = resolveAuthBehaviorConfig({ tenancy: 'single', userProperties: { staff: { editableBy: 'admin', useInPolicies: true } } });
    const config = resolveCalendarConfig({ timezone: 'UTC', participants: { userEligibility: { properties: { staff: 'yes' } } } }, '/synthetic-series-writer-config', auth);
    if (!config) throw new Error('Synthetic participant policy must be configured');
    const users = new UserStore(base.system, { tenancyMode: 'single' }), kernel = createAuthorizationKernel(auth);
    base.system.prepare("INSERT INTO users(user_id,username,email,role,status,created_at) VALUES('participant','participant','participant@example.test','user','active',1)").run();
    base.system.prepare("INSERT INTO user_properties(user_id,key,value) VALUES('participant','staff','yes')").run();
    directory = new ManagedCalendarParticipantDirectory({ db: base.system, users, tenancy: null, kernel, roles: null, config, assertCurrent: () => users.assertCurrentProfile() });
    logging = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true, policyVersion: 'fixture-policy-1', scope: { kind: 'application', tenantId: null }, sourceQueue: { maxEvents } }));
    const authority = await admitCalendarRequest(browser.authority, base.config, new AbortController().signal);
    const owner = base.system.prepare('SELECT * FROM _calendar_owners WHERE scope_id=?').get(authority.actor.scopeId) as CalendarOwnerRecord;
    let physicalCurrent = true, policyCurrent = true, finalChecks = 0;
    const dependencies: CalendarInitialSeriesManagedDependencies = { owner, scope: browser.scope, config, policyGeneration: calendarHash('trusted-series-policy'), preparationTtlMs: 60_000, participants: directory,
      assertOwnerCurrent(selected) { if (!physicalCurrent || calendarJson(selected) !== calendarJson(owner)) throw new CalendarError('CALENDAR_STATE_INVALID'); },
      assertSeriesAuthorityCurrent(generation) { if (!policyCurrent || generation !== calendarHash('trusted-series-policy')) throw new CalendarError('CALENDAR_FORBIDDEN'); } };
    const input = () => ({ kind: 'timed-series-v1', recurrence: { kind: 'timed-local-v1', localStart: '2030-01-07T10:00:00.000', timeZone: 'UTC', fold: 'earlier', durationMilliseconds: 3_600_000,
      rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } } }, template: { resourceIds: [resource.id], title: 'PRIVATE_SERIES_TITLE', bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
      appointmentType: null, visit: null, participants: [{ kind: 'guardian-user', userId: 'participant' }] } });
    const prepare = (key = 'plan', value: unknown = input()) => prepareCalendarInitialSeriesRequest(authority, key, value, config);
    const execute = (command: CalendarInitialSeriesCommand, late?: () => void) => {
      const remove = registerReactiveDBCommitGuard(db, { capture: () => 1, beforeCommit() { finalChecks++; late?.(); command.assertCommitCurrent(); return undefined; } });
      const session = createDatabaseWriteCommandSession(db);
      try { return logging!.run(loggingContext(null), () => db.transaction(() => { const result = command.run(session.context); session.close(); return result; })); }
      finally { session.close(); remove(); }
    };
    const accept = (key = 'plan', value: unknown = input(), late?: () => void, proof?: CalendarInitialSeriesCompilation) => {
      const request = prepare(key, value), compiled = proof ?? compileCalendarInitialSeriesRequest(request);
      return execute(createCalendarInitialSeriesCommand(dependencies, authority, request, compiled), late);
    };
    const canonical = (name: string, fields: Record<string, unknown>) => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, cloneDatabaseSerializableValue({ actor: authority.actor, ...fields }));
    return { base, browser, db, users, directory, logging, authority, owner, dependencies, resource, input, prepare, execute, accept, canonical,
      snapshot: () => ({ bytes: db.getRawDatabase().serialize(), sequence: db.currentSeq }),
      physical(value: boolean) { physicalCurrent = value; }, policy(value: boolean) { policyCurrent = value; }, checks: () => finalChecks,
      async close() { logging?.close(); directory?.close(); await base.close(); } };
  } catch (error) { logging?.close(); directory?.close(); await base.close(); throw error; }
}
function rejects(run: () => unknown, code?: string) {
  try { run(); throw new Error('Expected private writer refusal'); }
  catch (error) { const actual = error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code ?? (error as { code?: string }).code;
    if (code) expect(actual).toBe(code); else expect(error).toBeInstanceOf(Error); }
}

test('actual tracked acceptance creates source/grant/evidence once but no appointment, reservation, publication or enabled recurrence', async () => {
  const f = await fixture();
  try {
    const beforeAppointments = f.db.list('calendar_appointments'), beforeReservations = f.db.list('_calendar_reservations'), before = f.db.currentSeq;
    const accepted = f.accept();
    expect(accepted).toEqual({ operation: 'series.plan.accepted', requestId: 'plan', seriesId: calendarHash(['calendar.series.v1', f.authority.actor.scopeId, f.authority.actor.principal, 'plan']),
      controlRevision: 1, preparationId: calendarHash(['calendar.series.preparation.v1', f.authority.actor.scopeId, accepted.seriesId, 1]), basePublicationId: null });
    expect(f.db.currentSeq).toBeGreaterThan(before); expect(f.checks()).toBe(1);
    for (const table of ['calendar_series', '_calendar_series_generations', '_calendar_series_segments', '_calendar_series_grants', '_calendar_series_preparations', '_calendar_series_receipts', '_calendar_series_effect_intents']) expect(f.db.list(table)).toHaveLength(1);
    expect(f.db.list('calendar_appointments')).toEqual(beforeAppointments); expect(f.db.list('_calendar_reservations')).toEqual(beforeReservations);
    expect(f.db.list('_calendar_series_publications')).toEqual([]); expect(f.db.list('_calendar_series_native_receipts')).toEqual([]);
    expect(f.db.list('_calendar_series_grants')[0]).toMatchObject({ resource_ids_json: calendarJson([f.resource.id]), resource_digest: calendarHash([f.resource.id]), owner_id: f.owner.owner_id });
    expect(calendarRealm.version).toBe('19'); expect(Object.keys(calendarRealm.commands).some(name => name.includes('series'))).toBe(false);
    const events = f.logging.control({}).rows.map(row => row.event); expect(events).toHaveLength(1); expect(events[0]!.action).toBe('calendar.series.plan.accepted');
    expect(events[0]!.target).toEqual({ type: 'calendar.series', id: accepted.seriesId }); expect(JSON.stringify(events)).not.toContain('PRIVATE'); expect(JSON.stringify(events)).not.toContain('2030-01-07');
    expect(f.db.getRawDatabase().query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { await f.close(); }
});

test('original acceptance replay is byte/sequence quiet before fresh proof, Temporal, service policy and participant admission', async () => {
  const f = await fixture();
  try {
    const accepted = f.accept(), input = f.input(); f.policy(false); f.users.setProperty('participant', 'staff', 'no');
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal'); let touched = 0;
    try {
      Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { touched++; throw new Error('PRIVATE_ENGINE_UNAVAILABLE'); } });
      const request = f.prepare(), before = f.snapshot();
      expect(f.execute(createCalendarInitialSeriesCommand(f.dependencies, f.authority, request))).toEqual(accepted);
      expect(f.snapshot()).toEqual(before); expect(touched).toBe(0); expect(f.logging.control({}).rows).toHaveLength(1);
      rejects(() => f.execute(createCalendarInitialSeriesCommand(f.dependencies, f.authority, f.prepare('plan', { ...input, template: { ...input.template, title: 'changed' } }))), 'CALENDAR_INTENT_CONFLICT');
    } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); }
  } finally { await f.close(); }
});

test('proof handles are exact native identity, detached from mutable input, and never reconstructed from JSON or another request', async () => {
  const f = await fixture();
  try {
    const input = f.input(), request = f.prepare('first', input), proof = compileCalendarInitialSeriesRequest(request), before = f.snapshot();
    input.template.title = 'MUTATED_AFTER_ADMISSION'; input.template.resourceIds.push('forged-resource');
    for (const compiled of [{}, { ...proof }, JSON.parse(JSON.stringify(proof))]) rejects(() => f.execute(createCalendarInitialSeriesCommand(f.dependencies, f.authority, request, compiled as CalendarInitialSeriesCompilation)), 'CALENDAR_FORBIDDEN');
    rejects(() => f.execute(createCalendarInitialSeriesCommand(f.dependencies, f.authority, f.prepare('second'), proof)), 'CALENDAR_FORBIDDEN'); expect(f.snapshot()).toEqual(before);
    const accepted = f.execute(createCalendarInitialSeriesCommand(f.dependencies, f.authority, request, proof));
    expect(f.db.get('_calendar_series_generations', calendarHash(['calendar.series.generation.v1', f.authority.actor.scopeId, accepted.seriesId, 1]))!.authoring_json).not.toContain('MUTATED');
    rejects(() => compileCalendarInitialSeriesRequest({} as never), 'CALENDAR_FORBIDDEN');
  } finally { await f.close(); }
});

test('fresh actual-COMMIT participant suspension rolls back all source/effect/audit facts and the tracked sequence', async () => {
  const f = await fixture();
  try {
    const request = f.prepare(), proof = compileCalendarInitialSeriesRequest(request), before = f.snapshot();
    rejects(() => f.execute(createCalendarInitialSeriesCommand(f.dependencies, f.authority, request, proof), () => f.users.setProperty('participant', 'staff', 'no')), 'CALENDAR_NOT_FOUND');
    expect(f.snapshot()).toEqual(before); expect(f.logging.control({}).rows).toEqual([]); expect(f.db.list('calendar_series')).toEqual([]);
    f.users.setProperty('participant', 'staff', 'yes'); expect(f.accept().operation).toBe('series.plan.accepted');
  } finally { await f.close(); }
});

test('real final writer fence rejects human revocation, owner retirement, native policy retirement and engine replacement', async () => {
  for (const kind of ['human', 'owner', 'policy', 'engine'] as const) {
    const f = await fixture(); const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
    try {
      const request = f.prepare(), proof = compileCalendarInitialSeriesRequest(request), before = f.snapshot();
      rejects(() => f.execute(createCalendarInitialSeriesCommand(f.dependencies, f.authority, request, proof), () => {
        if (kind === 'human') f.browser.revoke(); else if (kind === 'owner') f.physical(false); else if (kind === 'policy') f.policy(false);
        else Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('PRIVATE_ENGINE_REPLACED'); } });
      }));
      expect(f.snapshot()).toEqual(before); expect(f.logging.control({}).rows).toEqual([]);
    } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); await f.close(); }
  }
}, 20_000);

test('configured unavailable participant dependency and asynchronous/value-returning guard callbacks fail closed', async () => {
  const f = await fixture();
  try {
    const request = f.prepare(), proof = compileCalendarInitialSeriesRequest(request), before = f.snapshot();
    const variants: CalendarInitialSeriesManagedDependencies[] = [
      { ...f.dependencies, participants: undefined }, { ...f.dependencies, assertOwnerCurrent: async () => {} },
      { ...f.dependencies, assertSeriesAuthorityCurrent: async () => {} }, { ...f.dependencies, participants: { assertBindable: async () => {} } },
      { ...f.dependencies, participants: { assertBindable: (() => 1) as never } },
    ];
    for (const dependencies of variants) { rejects(() => f.execute(createCalendarInitialSeriesCommand(dependencies, f.authority, request, proof))); expect(f.snapshot()).toEqual(before); }
  } finally { await f.close(); }
});

test('bound dependency limits and participant method cannot be replaced after native command construction', async () => {
  const f = await fixture();
  try {
    const request = f.prepare(), proof = compileCalendarInitialSeriesRequest(request), config = { ...f.dependencies.config }, participants = { assertBindable: f.directory.assertBindable.bind(f.directory) };
    const dependencies = { ...f.dependencies, config, participants }, command = createCalendarInitialSeriesCommand(dependencies, f.authority, request, proof), before = f.snapshot();
    participants.assertBindable = () => {}; rejects(() => f.execute(command), 'CALENDAR_POLICY_STALE'); expect(f.snapshot()).toEqual(before);
    const next = createCalendarInitialSeriesCommand(dependencies, f.authority, request, proof); config.maxParticipants = 1; rejects(() => f.execute(next), 'CALENDAR_POLICY_STALE'); expect(f.snapshot()).toEqual(before);
  } finally { await f.close(); }
});

test('current resource activity and canonical hard availability are enforced but plan acceptance does not claim an occupancy reservation', async () => {
  const f = await fixture();
  try {
    f.canonical('appointment.create', { requestId: 'existing-booking', id: 'one-off', resourceIds: [f.resource.id], title: 'PRIVATE_EXISTING', startAt: '2030-01-07T10:00:00.000Z', endAt: '2030-01-07T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    expect(f.accept('source-plan-not-booked').operation).toBe('series.plan.accepted'); expect(f.db.list('_calendar_reservations')).toHaveLength(1);
    f.canonical('resource.availability', { id: f.resource.id, requestId: 'closed-hours', expectedRevision: f.db.get('calendar_resources', f.resource.id)!.revision, mode: 'windows', windows: [] });
    const before = f.snapshot(); rejects(() => f.accept('outside-hard-policy'), 'CALENDAR_AVAILABILITY_CONFLICT'); expect(f.snapshot()).toEqual(before);
  } finally { await f.close(); }
});

test('ordinary/series human keys reject reuse both ways and original accepted outcome survives a simulated lost acknowledgement', async () => {
  const f = await fixture();
  try {
    const before = f.snapshot(); rejects(() => f.accept('resource-key'), 'CALENDAR_INTENT_CONFLICT'); expect(f.snapshot()).toEqual(before);
    const accepted = f.accept('accepted-key');
    rejects(() => f.canonical('resource.create', { requestId: 'accepted-key', id: 'another-resource', label: 'Private', kind: 'person', ownerId: f.authority.actor.userId, timeZone: 'UTC' }), 'CALENDAR_INTENT_CONFLICT');
    const retained = f.snapshot(), request = f.prepare('accepted-key');
    expect(f.execute(createCalendarInitialSeriesCommand(f.dependencies, f.authority, request))).toEqual(accepted); expect(f.snapshot()).toEqual(retained);
    expect(f.db.list('_calendar_series_receipts')).toHaveLength(1); expect(f.logging.control({}).rows.filter(row => row.event.action === 'calendar.series.plan.accepted')).toHaveLength(1);
  } finally { await f.close(); }
});

test('actual native LoggingActorSource backpressure rolls back the complete next acceptance, effect and sequence', async () => {
  const f = await fixture(1);
  try {
    f.accept('first'); const before = f.snapshot();
    rejects(() => f.accept('second'), 'DATABASE_BACKPRESSURE'); expect(f.snapshot()).toEqual(before);
    expect(f.db.list('calendar_series')).toHaveLength(1); expect(f.db.list('_calendar_series_effect_intents')).toHaveLength(1); expect(f.logging.control({}).rows).toHaveLength(1);
  } finally { await f.close(); }
});

test('actual accepted source loads through the fixed native readonly owner and compiles only after the native snapshot closes', async () => {
  const f = await fixture();
  try {
    const accepted = f.accept(), before = f.snapshot(), reader = createCalendarSeriesNativeSourceReader({ owner: f.owner, policyGeneration: f.dependencies.policyGeneration,
      signal: f.authority.signal, assertOwnerCurrent: f.dependencies.assertOwnerCurrent, assertSeriesAuthorityCurrent: f.dependencies.assertSeriesAuthorityCurrent });
    const copy = Database.deserialize(f.db.getRawDatabase().serialize(), { readonly: true, strict: true });
    let snapshot: ReturnType<typeof reader>;
    try { snapshot = withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => reader(context, accepted.seriesId)); }
    finally { copy.close(); }
    const source = captureCalendarSeriesCompilationSource(snapshot, { maxResources: 16, maxParticipants: 100 });
    const cursor = createCalendarSeriesCompilationCursor(source, { from: '2030-01-07', until: '2030-01-10' });
    const batch = compileCalendarSeriesBatch(source, cursor, { candidateLimit: 4, occurrenceLimit: 3 });
    expect(batch.evidence.candidates).toHaveLength(3); expect(batch.evidence.binding.preparationId).toBe(accepted.preparationId);
    expect(batch.evidence.candidates.every(candidate => candidate.booking.resourceIds[0] === f.resource.id)).toBe(true);
    expect(batch.evidence.binding.grant.resourceDigest).toBe(calendarHash([f.resource.id])); expect(f.snapshot()).toEqual(before);
    expect(f.db.list('calendar_appointments')).toEqual([]); expect(f.db.list('_calendar_series_publications')).toEqual([]);
  } finally { await f.close(); }
});

test('initial source uses canonical type and visit intersections rather than accepting untyped or unassigned native templates', async () => {
  const f = await fixture();
  try {
    f.canonical('type.create', { requestId: 'type', id: 'type', label: 'Private type', durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null, active: true });
    f.canonical('resource.types', { requestId: 'required-type', id: f.resource.id, expectedRevision: f.db.get('calendar_resources', f.resource.id)!.revision, mode: 'required', typeIds: ['type'] });
    const before = f.snapshot(); rejects(() => f.accept('missing-required-type'), 'CALENDAR_TYPE_CONFLICT'); expect(f.snapshot()).toEqual(before);
    const input = f.input(), typed = { ...input, template: { ...input.template, appointmentType: { id: 'type', revision: 1 } } };
    expect(f.accept('typed-source', typed).operation).toBe('series.plan.accepted');
    const after = f.snapshot(); rejects(() => f.accept('wrong-duration', { ...typed, recurrence: { ...typed.recurrence, durationMilliseconds: 45 * 60_000 } }), 'CALENDAR_TYPE_CONFLICT'); expect(f.snapshot()).toEqual(after);
    f.canonical('location.create', { requestId: 'office', id: 'office', label: 'Private office', region: null });
    f.canonical('resource.locations', { requestId: 'office-assignment', id: f.resource.id, expectedRevision: f.db.get('calendar_resources', f.resource.id)!.revision, locationIds: ['office'] });
    const assigned = f.snapshot(); rejects(() => f.accept('wrong-visit', { ...typed, template: { ...typed.template, visit: { mode: 'in-person', location: { id: 'unassigned-office', revision: 1 } } } }), 'CALENDAR_VISIT_CONFLICT'); expect(f.snapshot()).toEqual(assigned);
  } finally { await f.close(); }
});

test('an accepted replay refuses damaged original effect evidence instead of converting partial retained state into success', async () => {
  const f = await fixture();
  try {
    f.accept();
    // Explicitly damaged synthetic MEMORY evidence only, never a repair route.
    f.db.getRawDatabase().run('DROP TRIGGER _calendar_series_effect_intents_series_update');
    f.db.getRawDatabase().run("UPDATE _calendar_series_effect_intents SET child_version_id='fabricated-child'");
    const before = f.snapshot(); rejects(() => f.execute(createCalendarInitialSeriesCommand(f.dependencies, f.authority, f.prepare())), 'CALENDAR_STATE_INVALID'); expect(f.snapshot()).toEqual(before);
  } finally { await f.close(); }
});

test('finite retained source capacity is a canonical atomic rejection with bounded counter point reads', async () => {
  const f = await fixture();
  try {
    const increment = f.db.getRawDatabase().prepare("UPDATE _calendar_series_capacity SET count=count+1 WHERE id='calendar_series'");
    try { f.db.getRawDatabase().transaction(() => { for (let index = 0; index < CALENDAR_SERIES_CAPACITY.calendar_series; index++) increment.run(); })(); }
    finally { increment.finalize(); }
    const before = f.snapshot(); rejects(() => f.accept('capacity-refusal'), 'CALENDAR_CAPACITY'); expect(f.snapshot()).toEqual(before);
    expect(f.db.list('calendar_series')).toEqual([]); expect(f.logging.control({}).rows).toEqual([]);
  } finally { await f.close(); }
});
