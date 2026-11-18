/** Synthetic in-memory source qualification only; every DB/read copy/source closes in finally. */
import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor, CalendarParticipantReference } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarParticipantReferences } from './participants-validation';
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';
import { normalizeCalendarTimedInterval } from './time';
import { calendarHash, calendarJson } from './validation';

const manager: CalendarActor = { scopeId: 'tenant:synthetic-participants', userId: 'manager', principal: 'manager-session', manageAll: true, createOwn: true };
const owner: CalendarActor = { ...manager, userId: 'owner', principal: 'owner-session', manageAll: false };
const delegated: CalendarActor = { ...owner, userId: 'delegate', principal: 'delegate-session', createOwn: false };
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
const later = { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC' };
const references: CalendarParticipantReference[] = [{ kind: 'guardian-user', userId: 'PRIVATE_TARGET_A' }, { kind: 'guardian-user', userId: 'PRIVATE_TARGET_Z' }];

function fixture(maxEvents = 10000) {
  const clock = spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T09:00:00.000Z'));
  const db = createReactiveDB({ mode: 'memory' });
  let source: LoggingActorSource | null = null;
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'synthetic-participant-policy', scope: { kind: 'tenant', tenantId: 'synthetic-participants' }, sourceQueue: { maxEvents } }));
    const command = (name: string, input: Record<string, unknown>): any => source!.run(loggingContext('synthetic-participants'), () =>
      runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue));
    const query = (name: string, input: Record<string, unknown>): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context =>
          runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-calendar-owner', scopeId: manager.scopeId });
    const resource = (id = 'person') => command('resource.create', { actor: manager, requestId: 'resource-' + id, id, kind: 'person',
      ownerId: owner.userId, label: 'PRIVATE_RESOURCE_LABEL', timeZone: 'UTC' });
    const appointment = (fields: Record<string, unknown> = {}) => command('appointment.create', { actor: manager, requestId: 'create', id: 'appointment',
      resourceIds: ['person'], title: 'PRIVATE_TITLE', ...timed, ...fields });
    const hold = (fields: Record<string, unknown> = {}) => command('hold.acquire', { actor: manager, requestId: 'acquire', id: 'hold', resourceIds: ['person'], ...timed, ...fields });
    const replace = (fields: Record<string, unknown> = {}) => command('appointment.participants', { actor: manager, requestId: 'replace', id: 'appointment',
      expectedRevision: 1, references, ...fields });
    const confirm = (fields: Record<string, unknown> = {}) => command('hold.confirm', { actor: manager, requestId: 'confirm', id: 'hold',
      expectedRevision: 1, appointmentId: 'confirmed', title: 'PRIVATE_TITLE', ...fields });
    const drain = () => { const page = source!.control({}); source!.control({ acknowledge: page.rows.map(row => row.id) }); };
    const count = (table: string) => Number(raw.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()!.count);
    return { db, raw, source, command, query, resource, appointment, hold, replace, confirm, count, drain,
      close() { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } } };
  } catch (error) { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode) {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect((error instanceof CalendarError ? error : readCalendarRejection(error))?.code).toBe(code); }
}

test('native references detach, sort by opaque user ID and reject duplicate/foreign/extended variants with a hard100 cap', () => {
  const input = references.slice().reverse(), normalized = calendarParticipantReferences(input);
  expect(normalized).toEqual(references); input[0] = { kind: 'guardian-user', userId: 'changed' }; expect(normalized).toEqual(references);
  for (const value of [undefined, null, {}, [references[0], references[0]], [{ kind: 'contact', userId: 'target' }],
    [{ kind: 'guardian-user', userId: 'target', tenantId: 'other' }], [{ kind: 'guardian-user', userId: 'target', eligible: true }],
    [{ kind: 'guardian-user', userId: 'target', name: 'PRIVATE_NAME' }], [{ kind: 'guardian-user', userId: 'bad/id' }],
    Array.from({ length: 101 }, (_, i) => ({ kind: 'guardian-user', userId: 'target-' + i }))]) rejects(() => calendarParticipantReferences(value), 'CALENDAR_INPUT_INVALID');
  expect(calendarParticipantReferences(Array.from({ length: 100 }, (_, i) => ({ kind: 'guardian-user', userId: 'target-' + i })))).toHaveLength(100);
});

test('binding create/acquire/replace/read is scope-manager only even for a resource owner or delegated manage grant', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment(); f.hold({ ...later });
    f.command('resource.grant', { actor: manager, requestId: 'grant', id: 'person', expectedRevision: 1, userId: delegated.userId, grants: ['manage'] });
    for (const actor of [owner, delegated]) {
      rejects(() => f.appointment({ actor, participants: [] }), 'CALENDAR_FORBIDDEN');
      rejects(() => f.hold({ actor, participants: [], ...later }), 'CALENDAR_FORBIDDEN');
      rejects(() => f.replace({ actor }), 'CALENDAR_FORBIDDEN');
      for (const name of ['appointmentParticipants', 'holdParticipants']) rejects(() => f.query(name, { actor, id: name.startsWith('appointment') ? 'appointment' : 'hold' }), 'CALENDAR_FORBIDDEN');
    }
    rejects(() => f.query('appointmentParticipants', { actor: { ...manager, scopeId: 'tenant:foreign' }, id: 'appointment' }), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('ordinary appointment/hold DTOs and busy never carry participant IDs, identity counts or directory metadata', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment({ participants: references.slice().reverse() }); f.hold({ ...later, participants: references });
    expect(f.query('appointmentParticipants', { actor: manager, id: 'appointment' })).toEqual({ id: 'appointment', revision: 1, references });
    expect(f.query('holdParticipants', { actor: manager, id: 'hold' })).toEqual({ id: 'hold', revision: 1, references });
    for (const [name, input] of [['appointment', { id: 'appointment' }], ['hold', { id: 'hold' }], ['busy', { resourceIds: ['person'],
      startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z' }]] as const) {
      const serialized = JSON.stringify(f.query(name, { actor: manager, ...input }));
      expect(serialized).not.toContain('PRIVATE_TARGET'); expect(serialized).not.toContain('participant'); expect(serialized).not.toContain('references');
    }
    for (const table of ['_calendar_appointment_participant_bindings', '_calendar_hold_participant_bindings']) {
      const serialized = JSON.stringify(f.raw.query(`SELECT * FROM ${table}`).all());
      expect(serialized).not.toMatch(/name|avatar|profile|eligib|status|membership/);
    }
  } finally { f.close(); }
});

test('omission preserves exact legacy digest while explicit empty uses normalized participants-v1 intent and cannot replay omission', () => {
  const f = fixture();
  try {
    f.resource(); const original = f.appointment();
    const row = f.db.get('_calendar_receipts', calendarHash([manager.scopeId, manager.principal, 'create']))!;
    expect(row.digest).toBe(calendarHash(['appointment.create', 'appointment', ['person'], 'PRIVATE_TITLE', normalizeCalendarTimedInterval(timed)]));
    expect(f.appointment()).toEqual(original);
    rejects(() => f.appointment({ participants: [] }), 'CALENDAR_INTENT_CONFLICT');
    f.appointment({ requestId: 'explicit', id: 'empty', ...later, participants: [] });
    const explicit = f.db.get('_calendar_receipts', calendarHash([manager.scopeId, manager.principal, 'explicit']))!;
    expect(explicit.digest).toBe(calendarHash(['appointment.create.participants.v1', 'empty', ['person'], 'PRIVATE_TITLE',
      { ...later, bufferBeforeMinutes: null, bufferAfterMinutes: null }, null, null, []]));
    expect(f.count('_calendar_appointment_participant_bindings')).toBe(1);
  } finally { f.close(); }
});

test('participants-v1 composes type buffer defaults and visit normalized wire intent without caching presentation', () => {
  const f = fixture();
  try {
    f.resource(); f.command('type.create', { actor: manager, requestId: 'type', id: 'type', label: 'PRIVATE_TYPE', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 });
    f.command('location.create', { actor: manager, requestId: 'location', id: 'location', label: 'PRIVATE_LOCATION' });
    f.command('resource.locations', { actor: manager, requestId: 'assignment', id: 'person', expectedRevision: 1, locationIds: ['location'] });
    const input = { participants: references, appointmentType: { id: 'type', revision: 1 }, visit: { mode: 'in-person', location: { id: 'location', revision: 1 } } };
    const first = f.appointment(input); const view = f.query('appointment', { actor: manager, id: 'appointment' });
    expect(view.bufferBeforeMinutes).toBe(5); expect(view.bufferAfterMinutes).toBe(10); expect(view.visit.location.label).toBe('PRIVATE_LOCATION');
    expect(f.appointment({ ...input, participants: references.slice().reverse() })).toEqual(first);
    rejects(() => f.appointment({ ...input, bufferBeforeMinutes: 5 }), 'CALENDAR_INTENT_CONFLICT'); // omission is retained wire intent
    f.command('type.replace', { actor: manager, requestId: 'retire', id: 'type', expectedRevision: 1, label: 'changed', durationMinutes: 60,
      bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: null, active: false });
    expect(f.appointment(input)).toEqual(first); // accepted replay precedes fresh type/source policy
  } finally { f.close(); }
});

test('replacement CAS, same-set no-op, exact accepted replay, historical family and terminal ordering are canonical', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment(); const before = f.count('_calendar_effect_intents');
    const accepted = f.replace(); expect(accepted.value).toMatchObject({ operation: 'appointment.participants-changed', revision: 2, changed: true });
    expect(f.count('_calendar_effect_intents')).toBe(before + 1); expect(f.count('_calendar_hold_receipts')).toBe(0);
    expect(f.db.get('_calendar_receipts', calendarHash([manager.scopeId, manager.principal, 'replace']))).toMatchObject({ target_kind: 'appointment', required_right: 'manage' });
    rejects(() => f.replace({ requestId: 'stale', references: [] }), 'CALENDAR_REVISION_CONFLICT');
    const events = f.source!.control({}).rows.length;
    expect(f.replace({ requestId: 'noop', expectedRevision: 2, references: references.slice().reverse() }).value).toMatchObject({ revision: 2, changed: false });
    expect(f.source!.control({}).rows).toHaveLength(events);
    expect(f.count('_calendar_appointment_participant_bindings')).toBe(1);
    f.command('appointment.cancel', { actor: manager, requestId: 'cancel', id: 'appointment', expectedRevision: 2, confirmed: true });
    expect(f.replace()).toEqual(accepted); // replay precedes terminal checks and expected current revision
    rejects(() => f.replace({ references: [] }), 'CALENDAR_INTENT_CONFLICT');
    rejects(() => f.replace({ requestId: 'after-terminal', expectedRevision: 3, references: [] }), 'CALENDAR_TRANSITION_INVALID');
    rejects(() => f.query('receipt', { actor: { ...manager, manageAll: false }, requestId: 'replace' }), 'CALENDAR_FORBIDDEN');
  } finally { f.close(); }
});

test('unrelated reschedule/status operations preserve historical references; explicit replacement can retain opaque refs or remove all', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment({ participants: references });
    f.command('appointment.reschedule', { actor: owner, requestId: 'move', id: 'appointment', expectedRevision: 1, ...later, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    expect(f.query('appointmentParticipants', { actor: manager, id: 'appointment' })).toEqual({ id: 'appointment', revision: 2, references });
    expect(f.count('_calendar_appointment_participant_bindings')).toBe(1);
    f.replace({ expectedRevision: 2, references: references.slice(0, 1) });
    f.replace({ requestId: 'remove', expectedRevision: 3, references: [] });
    expect(f.query('appointmentParticipants', { actor: manager, id: 'appointment' })).toEqual({ id: 'appointment', revision: 4, references: [] });
    expect(f.count('_calendar_appointment_participant_bindings')).toBe(3);
  } finally { f.close(); }
});

test('hold captures exact canonical refs including explicit empty and transfers through canonical writer with manager admission', () => {
  for (const selected of [[], references]) {
    const f = fixture();
    try {
      f.resource();
      f.command('resource.grant', { actor: manager, requestId: 'grant-manager', id: 'person', expectedRevision: 1, userId: manager.userId, grants: ['manage'] });
      f.hold({ participants: selected.slice().reverse() });
      expect(f.query('holdParticipantAdmission', { actor: manager, id: 'hold' })).toEqual({ id: 'hold', revision: 1, references: selected });
      rejects(() => f.query('holdParticipantAdmission', { actor: { ...manager, manageAll: false }, id: 'hold' }), 'CALENDAR_FORBIDDEN');
      rejects(() => f.confirm({ actor: { ...manager, manageAll: false } }), 'CALENDAR_FORBIDDEN');
      const accepted = f.confirm(); expect(f.confirm()).toEqual(accepted);
      expect(f.query('appointmentParticipants', { actor: manager, id: 'confirmed' })).toEqual({ id: 'confirmed', revision: 1, references: selected });
      expect(f.raw.query('SELECT references_json FROM _calendar_hold_participant_bindings').get()).toEqual(f.raw.query('SELECT references_json FROM _calendar_appointment_participant_bindings').get());
    } finally { f.close(); }
  }
});

test('uncaptured ordinary-user holds retain confirmation rights without enabling participant discovery', () => {
  const f = fixture();
  try {
    f.resource(); f.hold({ actor: owner });
    expect(f.query('holdParticipantAdmission', { actor: owner, id: 'hold' })).toEqual({ id: 'hold', revision: 1, references: null });
    expect(f.confirm({ actor: owner }).value.operation).toBe('appointment.created');
    expect(f.count('_calendar_appointment_participant_bindings')).toBe(0);
    expect(f.count('_calendar_hold_participant_bindings')).toBe(0);
  } finally { f.close(); }
});

test('immutable participant evidence rejects delete/update/replace, late generation backfill and pointer rewind', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment({ participants: references }); f.hold({ ...later, participants: [] });
    for (const table of ['_calendar_appointment_participant_bindings', '_calendar_hold_participant_bindings']) {
      expect(() => f.raw.run(`UPDATE ${table} SET references_json=references_json`)).toThrow();
      expect(() => f.raw.run(`DELETE FROM ${table}`)).toThrow();
      expect(() => f.raw.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`)).toThrow();
    }
    const pointer = f.raw.query<{ id: string; binding_id: string }, []>('SELECT id,binding_id FROM _calendar_appointment_participant_current').get()!;
    f.replace({ references: [] });
    expect(() => f.raw.query('UPDATE _calendar_appointment_participant_current SET binding_id=? WHERE id=?').run(pointer.binding_id, pointer.id)).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_appointment_participant_current')).toThrow();
    expect(() => f.raw.run('INSERT OR REPLACE INTO _calendar_appointment_participant_current SELECT * FROM _calendar_appointment_participant_current')).toThrow();
    const insert = f.raw.prepare('INSERT INTO _calendar_appointment_participant_bindings(id,scope_id,appointment_id,appointment_revision,references_json) VALUES(?,?,?,2,?)');
    try { expect(() => insert.run('late', manager.scopeId, 'appointment', '[]')).toThrow(); } finally { insert.finalize(); }
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('native JSON guards reject malformed, duplicate, unsorted and enriched evidence even before source receipts seal a generation', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment();
    const insert = f.raw.prepare('INSERT INTO _calendar_appointment_participant_bindings(id,scope_id,appointment_id,appointment_revision,references_json) VALUES(?,?,?,2,?)');
    try {
      f.raw.transaction(() => {
        f.raw.run("UPDATE calendar_appointments SET revision=2 WHERE id='appointment'");
        for (const value of ['{}', 'not-json', JSON.stringify(references.slice().reverse()), JSON.stringify([references[0], references[0]]),
          JSON.stringify([{ ...references[0], name: 'PRIVATE_NAME' }]), JSON.stringify([{ kind: 'guardian-user', userId: 'bad/id' }]),
          JSON.stringify([{ kind: 'contact', userId: 'target' }]), JSON.stringify(Array.from({ length: 101 }, (_, i) => ({ kind: 'guardian-user', userId: 'target-' + i })))])
          expect(() => insert.run('invalid', manager.scopeId, 'appointment', value)).toThrow();
        throw new Error('synthetic transaction rollback');
      })();
    } catch (error) { expect((error as Error).message).toBe('synthetic transaction rollback'); }
    finally { insert.finalize(); }
    expect(f.db.get('calendar_appointments', 'appointment')!.revision).toBe(1);
  } finally { f.close(); }
});

test('SQL hold confirmation enforces exact transfer in both directions, including absent versus explicit empty', () => {
  for (const [captured, supplied] of [[references, []], [[], references], [undefined, []], [[], undefined]] as const) {
    const f = fixture();
    try {
      f.resource(); f.hold(captured === undefined ? {} : { participants: captured });
      f.resource('second'); f.appointment({ id: 'other', requestId: 'other', resourceIds: ['second'], ...(supplied === undefined ? {} : { participants: supplied }) });
      expect(() => f.raw.run("UPDATE calendar_holds SET status='confirmed',revision=2,appointment_id='other' WHERE id='hold'")).toThrow();
      expect(f.db.get('calendar_holds', 'hold')!.status).toBe('held');
    } finally { f.close(); }
  }
});

test('late participant writes, audit queue pressure and retained history budgets roll back every source fact atomically', () => {
  for (const failure of ['history', 'pointer', 'effect', 'audit', 'budget']) {
    const f = fixture(failure === 'audit' ? 2 : 10000);
    try {
      f.resource(); f.appointment(); const seq = f.db.currentSeq, receiptCount = f.count('_calendar_receipts'), usage = f.db.get('_calendar_usage', 'receipts')!.count;
      if (failure === 'budget') f.db.createStrict('_calendar_usage', { id: 'appointmentParticipantHistory', count: CALENDAR_LIMITS.appointmentParticipantHistory });
      else if (failure !== 'audit') {
        const table = failure === 'history' ? '_calendar_appointment_participant_bindings' : failure === 'pointer' ? '_calendar_appointment_participant_current' : '_calendar_effect_intents';
        f.raw.run(`CREATE TRIGGER synthetic_participant_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic participant failure'); END`);
      }
      const before = f.db.currentSeq;
      expect(() => f.replace()).toThrow();
      expect(f.db.currentSeq).toBe(before); expect(f.db.get('calendar_appointments', 'appointment')!.revision).toBe(1);
      expect(f.count('_calendar_appointment_participant_bindings')).toBe(0); expect(f.count('_calendar_appointment_participant_current')).toBe(0);
      expect(f.count('_calendar_receipts')).toBe(receiptCount); expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(usage);
      expect(f.source!.control({}).rows).toHaveLength(2); expect(seq).toBeLessThanOrEqual(before);
    } finally { f.close(); }
  }
});

test('hold participant capture and confirmation failures leave no partial binding, appointment or consumed hold', () => {
  for (const failure of ['hold-capture', 'hold-budget', 'appointment-capture', 'hold-consumption']) {
    const f = fixture();
    try {
      f.resource();
      if (failure.startsWith('hold-') && failure !== 'hold-consumption') {
        if (failure === 'hold-budget') f.db.createStrict('_calendar_usage', { id: 'holdParticipantBindings', count: CALENDAR_LIMITS.holdParticipantBindings });
        else f.raw.run("CREATE TRIGGER synthetic_capture_failure BEFORE INSERT ON _calendar_hold_participant_bindings BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
        const before = f.db.currentSeq;
        expect(() => f.hold({ participants: references })).toThrow();
        expect(f.db.currentSeq).toBe(before); expect(f.count('calendar_holds')).toBe(0); expect(f.count('_calendar_hold_participant_bindings')).toBe(0);
      } else {
        f.hold({ participants: references });
        f.raw.run(failure === 'appointment-capture'
          ? "CREATE TRIGGER synthetic_capture_failure BEFORE INSERT ON _calendar_appointment_participant_bindings BEGIN SELECT RAISE(ABORT,'synthetic failure'); END"
          : "CREATE TRIGGER synthetic_capture_failure BEFORE UPDATE ON calendar_holds WHEN NEW.status='confirmed' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
        const before = f.db.currentSeq, receiptUsage = f.db.get('_calendar_usage', 'receipts')!.count;
        expect(() => f.confirm()).toThrow();
        expect(f.db.currentSeq).toBe(before); expect(f.db.get('calendar_holds', 'hold')!.status).toBe('held');
        expect(f.count('calendar_appointments')).toBe(0); expect(f.count('_calendar_appointment_participant_bindings')).toBe(0);
        expect(f.count('_calendar_appointment_participant_current')).toBe(0); expect(f.count('_calendar_hold_participant_bindings')).toBe(1);
        expect(f.db.get('_calendar_usage', 'receipts')!.count).toBe(receiptUsage);
      }
      expect(f.count('_calendar_reservations')).toBe(0); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { f.close(); }
  }
});

test('participant workflow evidence includes only bounded count/change facts and emits once for replay/no-op', () => {
  const f = fixture();
  try {
    f.resource(); f.appointment({ participants: references }); const accepted = f.replace({ references: references.slice(0, 1) });
    expect(f.replace({ references: references.slice(0, 1) })).toEqual(accepted);
    f.replace({ requestId: 'noop', expectedRevision: 2, references: references.slice(0, 1) });
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.resource.created', 'calendar.appointment.created', 'calendar.appointment.participants-changed']);
    expect(events[2]!.target).toEqual({ type: 'calendar.appointment', id: 'appointment' });
    expect(events[2]!.metadata).toMatchObject({ revision: 2, participantCount: 1, participantsChanged: true });
    expect(events[1]!.metadata.participantCount).toBe(2);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_TARGET'); expect(JSON.stringify(events)).not.toContain('PRIVATE_TITLE');
    expect(Object.keys(events[2]!.metadata).sort()).toEqual(['participantCount', 'participantsChanged', 'revision', 'sequence']);
    expect(calendarJson(references)).not.toContain('name');
  } finally { f.close(); }
});
