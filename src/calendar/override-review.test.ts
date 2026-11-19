/** Actual019 realm + readonly MEMORY snapshots. No provider/files/physical claim. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { Migrator } from '../migrations/migrator';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor } from './contracts';
import type { CalendarOverrideReview, CalendarAppointmentOverride } from './override-contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { calendarHash } from './validation';

const authority = { policyVersion: 'appointment-overlap-v1' as const, policyHash: 'a'.repeat(64), use: true, manageGrants: true };
const actor: CalendarActor = { scopeId: 'tenant:synthetic-override-review', userId: 'owner', principal: 'session.owner', manageAll: true, createOwn: true, overrides: authority };
const { overrides: omittedAuthority, ...ordinaryActor } = actor;
const candidate = (resourceIds = ['r'], extra: Record<string, unknown> = {}) => ({ title: 'PRIVATE_PROPOSED_TITLE', resourceIds,
  startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', ...extra });
function exception(review: CalendarOverrideReview, reason = 'PRIVATE_OVERRIDE_REASON'): CalendarAppointmentOverride {
  if (review.status !== 'reviewable') throw new Error('Synthetic candidate was not reviewable');
  return { policyVersion: review.policyVersion, decisionToken: review.decisionToken, reason };
}
function fixture(selected: CalendarActor = actor) {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    if (calendarRealm.version !== '19') throw new Error('Tests require actual registered019, not a prepared clone');
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, table] of Object.entries(calendarRealm.tables)) db.defineTable(name, table);
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations: [...calendarRealm.migrations], createBackups: false, log() {} });
    try { migrator.run(); } finally { migrator.dispose(); }
    const command = (name: string, body: Record<string, unknown>) => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name,
      cloneDatabaseSerializableValue(name === 'owner.bind' ? body : { actor: selected, ...body }));
    command('owner.bind', { scopeId: selected.scopeId, ownerId: 'synthetic-override-owner' });
    const resource = (id = 'r', ownerId = selected.userId) => command('resource.create', { id, ownerId, requestId: calendarHash(['resource', id]), label: 'PRIVATE_RESOURCE', kind: 'person', timeZone: 'UTC' });
    const grant = (id = 'r', userId = selected.userId, enabled = true, as = selected) => command('resource.override-grant', {
      actor: as, id, userId, categories: enabled ? ['appointment-overlap'] : [], requestId: 'exception-grant-' + db.currentSeq,
      expectedRevision: db.get('calendar_resources', id)!.revision });
    const ordinaryGrant = (id: string, userId: string, grants: string[]) => command('resource.grant', { id, userId, grants,
      requestId: 'ordinary-grant-' + db.currentSeq, expectedRevision: db.get('calendar_resources', id)!.revision });
    const plans: string[] = [];
    const query = (name: 'appointmentReviewCreate' | 'appointmentReviewUpdate', body: Record<string, unknown>, observe = false): CalendarOverrideReview => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      const prepare = copy.prepare.bind(copy), observer = observe ? spyOn(copy, 'prepare').mockImplementation(<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, params?: TParams) => {
        plans.push(sql); return prepare<TRow, TParams>(sql, params);
      }) : null;
      try { return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context,
        'calendar.' + name, cloneDatabaseSerializableValue({ actor: selected, ...body }))) as unknown as CalendarOverrideReview; }
      finally { observer?.mockRestore(); copy.close(); }
    };
    const review = (id = 'proposal', requestId = 'proposal-key', input: Record<string, unknown> = candidate(), as = selected, observe = false) => query('appointmentReviewCreate', { actor: as, id, requestId, ...input }, observe);
    const create = (id = 'existing', requestId = 'create-' + id, input: Record<string, unknown> = candidate(), extra: Record<string, unknown> = {}) => command('appointment.create', { id, requestId, ...input, ...extra });
    return { db, raw, command, resource, grant, ordinaryGrant, plans, query, review, create,
      snapshot: () => ({ bytes: raw.serialize(), seq: db.currentSeq }), close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}
function rejected(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) { expect(error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code).toBe(code); }
}

test('fresh readonly review and cancellation write nothing; only an explicit same-key dispatch records exception evidence', () => {
  const f = fixture();
  try {
    f.resource(); f.grant();
    expect(f.review()).toEqual({ status: 'clear' });
    f.create(); const before = f.snapshot(), review = f.review('proposal', 'proposal-key', candidate(), actor, true);
    expect(review.status).toBe('reviewable');
    expect(f.review().status).toBe('reviewable'); expect(f.snapshot()).toEqual(before);
    const occupancyReads = f.plans.filter(sql => sql.includes('FROM main."_calendar_reservations"'));
    expect(occupancyReads).toHaveLength(1);
    expect(occupancyReads[0]).toContain('"scope_id" = ?'); expect(occupancyReads[0]).toContain('"resource_id" = ?');
    expect(occupancyReads[0]).toContain('"active" = ?'); expect(occupancyReads[0]).toContain('"occupied_start_ms" >= ?');
    expect(occupancyReads[0]).toContain('"occupied_end_ms" > ?'); expect(occupancyReads[0]).toContain('LIMIT ? OFFSET ?');
    expect(JSON.stringify(review)).not.toMatch(/PRIVATE|existing|reservation|owner|witness|reason/);
    if (review.status !== 'reviewable') throw new Error('Expected reviewable');
    expect(Object.keys(review).sort()).toEqual(['categories', 'decisionToken', 'expiresAt', 'policyVersion', 'status']);
    expect(review.decisionToken).toMatch(/^co1\.[0-9]{1,16}\.[0-9]{1,16}\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
    const accepted = f.create('proposal', 'proposal-key', candidate(), { override: exception(review) });
    expect(f.db.list('_calendar_override_admissions')).toHaveLength(1);
    expect(f.db.list('_calendar_appointment_override_history')).toHaveLength(1);
    expect(f.db.list('_calendar_override_witnesses')).toHaveLength(1);
    expect(f.db.list('_calendar_receipts').filter(row => row.request_id === 'proposal-key')).toHaveLength(1);
    expect(f.db.list('_calendar_effect_intents').filter(row => row.target_id === 'proposal')).toHaveLength(1);
    const settled = f.snapshot();
    const clock = spyOn(Date, 'now').mockImplementation(() => Date.parse(review.expiresAt) + 1);
    try { expect(f.create('proposal', 'proposal-key', candidate(), { actor: ordinaryActor, override: exception(review) })).toEqual(accepted); }
    finally { clock.mockRestore(); }
    expect(f.snapshot()).toEqual(settled);
    rejected(() => f.review('another', 'proposal-key'), 'CALENDAR_INTENT_CONFLICT');
  } finally { f.close(); }
});

test('owner/manage shortcuts, missing independent capability and missing per-resource grants never disclose conflict status', () => {
  const f = fixture();
  try {
    f.resource(); f.create();
    for (const denied of [ordinaryActor, { ...actor, overrides: { ...authority, use: false } }, actor]) {
      f.plans.length = 0; const before = f.snapshot();
      rejected(() => f.review('proposal', 'proposed-' + f.plans.length, candidate(), denied, true), 'CALENDAR_OVERRIDE_NOT_ALLOWED');
      expect(f.plans.some(sql => /FROM main\."_calendar_reservations"|_calendar_type_history|_calendar_location_history|_calendar_availability_policy/.test(sql))).toBe(false);
      expect(f.snapshot()).toEqual(before);
    }
    f.grant(); f.resource('hidden', 'other');
    const limited = { ...actor, manageAll: false };
    f.plans.length = 0;
    rejected(() => f.review('proposal', 'private-co-resource', candidate(['r', 'hidden']), limited, true), 'CALENDAR_NOT_FOUND');
    expect(f.plans.some(sql => /_calendar_override_grant|_calendar_reservations|_calendar_type_history/.test(sql))).toBe(false);
    f.ordinaryGrant('hidden', actor.userId, ['book']);
    rejected(() => f.review('proposal', 'missing-hidden-grant', candidate(['r', 'hidden']), limited), 'CALENDAR_OVERRIDE_NOT_ALLOWED');
    f.grant('hidden'); expect(f.review('proposal', 'allowed-co-resource', candidate(['r', 'hidden']), limited).status).toBe('reviewable');
  } finally { f.close(); }
});

test('review update uses the shared grandfather/no-op occupancy mask and never manufactures an exception', () => {
  const f = fixture();
  try {
    f.resource(); f.grant(); f.create();
    const review = f.review(); f.create('proposal', 'proposal-key', candidate(), { override: exception(review) });
    const before = f.snapshot();
    for (const patch of [{ title: 'Metadata only' }, { title: 'PRIVATE_PROPOSED_TITLE' }, { resourceIds: ['r'] }]) {
      expect(f.query('appointmentReviewUpdate', { id: 'proposal', requestId: 'metadata-review', expectedRevision: 1, ...patch })).toEqual({ status: 'non-reviewable' });
    }
    expect(f.snapshot()).toEqual(before);
    rejected(() => f.command('appointment.update', { id: 'proposal', requestId: 'inapplicable', expectedRevision: 1, title: 'Metadata only', override: exception(review) }), 'CALENDAR_OVERRIDE_STALE');
    f.command('appointment.update', { id: 'proposal', requestId: 'metadata', expectedRevision: 1, title: 'Metadata only' });
    expect(f.db.list('_calendar_appointment_override_history')).toHaveLength(1);
  } finally { f.close(); }
});

test('hard blocks, active holds, availability and selected type/visit failures share a coarse non-reviewable result', () => {
  const f = fixture();
  try {
    f.resource(); f.grant();
    f.command('block.create', { id: 'hard', requestId: 'hard-block', ...candidate(), title: 'PRIVATE_BLOCK' });
    const before = f.snapshot(); expect(f.review()).toEqual({ status: 'non-reviewable' }); expect(f.snapshot()).toEqual(before);
    f.command('block.cancel', { id: 'hard', requestId: 'cancel-hard', expectedRevision: 1, confirmed: true });
    const { title: unusedTitle, ...holdInput } = candidate();
    f.command('hold.acquire', { id: 'hold', requestId: 'live-hold', ...holdInput, ttlSeconds: 30 });
    expect(f.review()).toEqual({ status: 'non-reviewable' });
    f.command('hold.release', { id: 'hold', requestId: 'release-hold', expectedRevision: 1, confirmed: true });
    f.command('resource.availability', { id: 'r', requestId: 'hours', expectedRevision: f.db.get('calendar_resources', 'r')!.revision,
      mode: 'windows', windows: [{ startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' }] });
    expect(f.review()).toEqual({ status: 'non-reviewable' });
    expect(f.review('type', 'typed', candidate(['r'], { appointmentType: { id: 'hidden-type', revision: 1 } }))).toEqual({ status: 'non-reviewable' });
    expect(f.review('visit', 'visited', candidate(['r'], { visit: { mode: 'in-person', location: { id: 'hidden-location', revision: 1 } } }))).toEqual({ status: 'non-reviewable' });
  } finally { f.close(); }
});

test('same-count changed conflict identity, resource policy, independent grant and expiry all invalidate original review', () => {
  const f = fixture();
  try {
    f.resource(); f.grant(); f.create();
    const reviewed = f.review();
    f.command('appointment.cancel', { id: 'existing', requestId: 'cancel-original', expectedRevision: 1, confirmed: true });
    f.create('replacement');
    const before = f.snapshot();
    rejected(() => f.create('proposal', 'proposal-key', candidate(), { override: exception(reviewed) }), 'CALENDAR_OVERRIDE_STALE');
    expect(f.snapshot()).toEqual(before);
    const policyReview = f.review();
    f.command('resource.availability', { id: 'r', requestId: 'changed-policy', expectedRevision: f.db.get('calendar_resources', 'r')!.revision, mode: 'unrestricted', windows: [] });
    // A real revision change, even when the candidate remains eligible, retires proof.
    f.ordinaryGrant('r', 'other-user', ['busy']);
    rejected(() => f.create('proposal', 'proposal-key', candidate(), { override: exception(policyReview) }), 'CALENDAR_OVERRIDE_STALE');
    const grantReview = f.review(); f.grant('r', actor.userId, false);
    rejected(() => f.create('proposal', 'proposal-key', candidate(), { override: exception(grantReview) }), 'CALENDAR_OVERRIDE_NOT_ALLOWED');
    f.grant(); const expiring = f.review(), now = Date.now, parsed = expiring.status === 'reviewable' ? Number(expiring.decisionToken.split('.')[2]) : 0;
    const clock = spyOn(Date, 'now').mockImplementation(() => parsed + 1);
    try { rejected(() => f.create('proposal', 'proposal-key', candidate(), { override: exception(expiring) }), 'CALENDAR_OVERRIDE_STALE'); }
    finally { clock.mockRestore(); expect(Date.now).toBe(now); }
  } finally { f.close(); }
});

test('64 total reservation witnesses with maximum identities remain legal; the 65th shares coarse hard refusal', () => {
  const maximum: CalendarActor = { ...actor, scopeId: 'tenant:' + 's'.repeat(256), userId: 'u'.repeat(128), principal: 'p'.repeat(256) };
  const f = fixture(maximum);
  try {
    const resources = Array.from({ length: 16 }, (_, index) => ('r' + index + '-').padEnd(128, 'x'));
    for (const id of resources) { f.resource(id); f.grant(id); }
    const input = candidate(resources), id = (prefix: string) => prefix.padEnd(128, 'x');
    f.create(id('base'), 'base', input);
    for (let index = 1; index < 4; index++) {
      const key = 'stack-' + index, target = id(key), review = f.review(target, key, input);
      f.create(target, key, input, { override: exception(review) });
    }
    const before = f.snapshot(), legal = f.review(id('proposal'), 'max-review', input);
    expect(legal.status).toBe('reviewable'); expect(f.snapshot()).toEqual(before);
    const narrow = candidate([resources[0]!]), narrowReview = f.review(id('narrow'), 'narrow', narrow);
    f.create(id('narrow'), 'narrow', narrow, { override: exception(narrowReview) });
    const overflow = f.snapshot(); expect(f.review(id('too-many'), 'too-many', input)).toEqual({ status: 'non-reviewable' });
    expect(f.snapshot()).toEqual(overflow);
  } finally { f.close(); }
});

test('buffers and frozen all-day facts participate in exact fresh review and ordinary views remain private', () => {
  const f = fixture();
  try {
    f.resource(); f.grant(); f.create();
    expect(f.review('buffer', 'buffer', candidate(['r'], { startAt: '2030-01-01T11:10:00.000Z', endAt: '2030-01-01T12:00:00.000Z', bufferBeforeMinutes: 11 })).status).toBe('reviewable');
    expect(f.review('adjacent', 'adjacent', candidate(['r'], { startAt: '2030-01-01T11:10:00.000Z', endAt: '2030-01-01T12:00:00.000Z', bufferBeforeMinutes: 10 }))).toEqual({ status: 'clear' });
    const allDay = { title: 'PRIVATE_DAY', resourceIds: ['r'], interval: { kind: 'all-day-local-v1', startDate: '2030-01-01', endDate: '2030-01-02', timeZone: 'UTC' } };
    const review = f.review('day', 'day', allDay); expect(review.status).toBe('reviewable');
    f.create('day', 'day', allDay, { override: exception(review) });
    expect(f.db.get('calendar_appointments', 'day')?.time_kind).toBe('all-day-local-v1');
    expect(f.db.list('_calendar_override_witnesses')).toHaveLength(1);
  } finally { f.close(); }
});
