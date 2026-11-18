/** Native source journal protocol only. All state is in SQLite MEMORY; no Jobs/provider/file mutation. */
import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { createReactiveDB } from '../sync/reactive-db';
import type { JobSourceRegistration } from '../jobs/source-model';
import { jobSourceId } from '../jobs/source-model';
import { CalendarError, readCalendarRejection } from './error';
import { calendarIntegrationControlId, calendarIntegrationControlJobsKey, type CalendarIntegrationControlView } from './integration-controls';
import type { CalendarIntegrationPolicySpec } from './integration-model';
import { calendarRealm } from './realm';
import { calendarHash, calendarJson } from './validation';

function fixture() {
  const db = createReactiveDB({ mode: 'memory' }), now = Date.now(), clock = spyOn(Date, 'now').mockReturnValue(now);
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    const owner = { scopeId: 'application', expectedOwnerId: 'synthetic-controls-owner' };
    const command = (name: string, input: Record<string, unknown> = {}): any => (runDatabaseRealmCommand(calendarRealm, db, 'calendar.integration.' + name,
      { ...owner, requestId: 'native-command', ...input } as DatabaseSerializableValue) as any).value;
    runDatabaseRealmCommand(calendarRealm, db, 'calendar.owner.bind', { ownerId: owner.expectedOwnerId, scopeId: owner.scopeId });
    const query = (name: string, input: Record<string, unknown> = {}): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context,
        'calendar.integration.' + name, { ...owner, ...input } as DatabaseSerializableValue)); } finally { copy.close(); }
    };
    const policy = (version = 'A', ruleId = 'observe'): CalendarIntegrationPolicySpec => ({ ruleId, ruleVersion: '1', adapter: 'observation-v1', dueOffsetMs: 0, maxLatenessMs: 60_000,
      source: { identity: { domain: 'calendar.' + ruleId, databaseId: 'calendar:' + calendarHash(owner.scopeId), ownerId: owner.expectedOwnerId, scopeId: owner.scopeId, rootHash: '1'.repeat(64) },
        realmFingerprint: calendarRealm.fingerprint, policyVersion: version, semanticsVersion: 'observation-v1', definition: { name: 'calendar.observe', version: '1', fingerprint: '2'.repeat(64) },
        workflow: { name: 'calendar.observe', version: 1, definitionId: 'definition', versionId: 'version', fingerprint: '3'.repeat(64) } } });
    const registration = (spec = policy(), generation = 1, revision = generation, state: 'active' | 'retired' = 'active'): JobSourceRegistration => ({
      id: jobSourceId(spec.source.identity), generation, revision, state, policyHash: calendarHash(spec.source) });
    const install = (version = 'A', expectedEpoch = 0, ruleId = 'observe') => command('policy.install', { policy: policy(version, ruleId), expectedEpoch, requestId: 'install-' + ruleId + '-' + expectedEpoch });
    const prepare = (action: 'activate' | 'retire' = 'activate', expected: JobSourceRegistration | null = null, epoch = 1, ruleId = 'observe'): CalendarIntegrationControlView =>
      command('control.prepare', { ruleId, epoch, action, expectedRegistration: expected });
    const ack = (control: CalendarIntegrationControlView, registration: JobSourceRegistration) => command('control.ack', { id: control.id, result: { state: 'accepted', registration } });
    const retire = (epoch = 1, ruleId = 'observe') => command('policy.retire', { ruleId, epoch });
    const rows = (table: string): any[] => raw.query('SELECT * FROM _calendar_integration_' + table + ' ORDER BY id').all();
    return { db, raw, now, owner, command, query, policy, registration, install, prepare, ack, retire, rows,
      close() { try { db.dispose(); } finally { clock.mockRestore(); } } };
  } catch (error) { try { db.dispose(); } finally { clock.mockRestore(); } throw error; }
}
function rejected(run: () => unknown, code: CalendarError['code']) {
  try { run(); throw new Error('Expected rejection'); } catch (error) { expect(error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code).toBe(code); }
}

test('control preparation durably fixes identity/key/captured Jobs revision before a cross-file operation and exact replay never retargets it', () => {
  const f = fixture(); try {
    f.install(); const control = f.prepare();
    expect(control).toMatchObject({ id: calendarIntegrationControlId(f.owner.scopeId, f.owner.expectedOwnerId, 'observe', 1, 'activate'),
      jobsKey: calendarIntegrationControlJobsKey(control.id, 'activate'), expectedJobsRevision: 0, expectedRegistration: null, result: null, lastFailure: null, nextAttemptMs: f.now });
    expect(f.prepare()).toEqual(control); expect(f.rows('controls')).toHaveLength(1); expect(f.rows('control_attempts')).toHaveLength(1);
    expect(f.query('control', { id: control.id })).toEqual(f.query('control', { ruleId: 'observe', epoch: 1, action: 'activate' }));
    rejected(() => f.prepare('activate', f.registration()), 'CALENDAR_INTENT_CONFLICT');
    rejected(() => f.prepare('retire', f.registration()), 'CALENDAR_POLICY_STALE');
    rejected(() => f.command('control.prepare', { ruleId: 'observe', epoch: 1, action: 'activate', expectedRegistration: null, expectedOwnerId: 'wrong-owner' }), 'CALENDAR_STATE_INVALID');
    f.retire(); expect(f.prepare()).toEqual(control);
    const stopped = f.prepare('retire', f.registration()); expect(stopped.expectedJobsRevision).toBe(1); expect(f.rows('controls')).toHaveLength(2);
  } finally { f.close(); }
});

test('accepted activation atomically publishes immutable result/mapping and activates only its current pointer with exact native transition checks', () => {
  const f = fixture(); try {
    f.install(); const control = f.prepare(), accepted = f.registration();
    for (const forged of [{ ...accepted, generation: 2 }, { ...accepted, revision: 2 }, { ...accepted, state: 'retired' as const }, { ...accepted, policyHash: '0'.repeat(64) }]) {
      expect(() => f.ack(control, forged)).toThrow(); expect(f.rows('control_results')).toHaveLength(0);
    }
    expect(f.ack(control, accepted).result).toEqual({ state: 'accepted', registration: accepted });
    expect(f.query('policy', { ruleId: 'observe' })).toMatchObject({ state: 'active', registration: accepted });
    expect(f.query('controls', { now: f.now })).toEqual([]); expect(f.query('controlEvidence', { ruleId: 'observe' })).toEqual({ registered: true, pending: null });
    expect(f.rows('control_attempts')[0]?.result_id).toBe(control.id);
    f.retire(); expect(f.ack(control, accepted).result).toEqual({ state: 'accepted', registration: accepted });
    expect(f.query('policy', { ruleId: 'observe' }).state).toBe('retired');
    expect(f.rows('control_results')).toHaveLength(1); expect(f.rows('policy_registrations')).toHaveLength(1);
  } finally { f.close(); }
});

test('canonical Jobs registration no-op and readmission evidence must match the captured state/hash, generation and revision exactly', () => {
  for (const state of ['active', 'retired'] as const) {
    const f = fixture(); try {
      f.install(); const previous = f.registration(f.policy(), 5, 8, state), control = f.prepare('activate', previous);
      const result = f.registration(f.policy(), state === 'active' ? 5 : 6, state === 'active' ? 8 : 9);
      rejected(() => f.ack(control, { ...result, revision: state === 'active' ? 9 : 8 }), 'CALENDAR_STATE_INVALID');
      rejected(() => f.ack(control, { ...result, generation: state === 'active' ? 6 : 5 }), 'CALENDAR_STATE_INVALID');
      expect(f.ack(control, result).result).toEqual({ state: 'accepted', registration: result });
    } finally { f.close(); }
  }
});

test('late activation acceptance records the original mapping after local retirement or supersession without reviving either pointer', () => {
  for (const supersede of [false, true]) {
    const f = fixture(); try {
      f.install(); const control = f.prepare(), accepted = f.registration();
      if (supersede) f.install('B', 1); else f.retire();
      f.ack(control, accepted);
      expect(f.rows('policy_registrations')).toHaveLength(1); expect(f.rows('control_results')).toHaveLength(1);
      expect(f.query('policy', { ruleId: 'observe' })).toMatchObject({ epoch: supersede ? 2 : 1, state: supersede ? 'activating' : 'retired', registration: supersede ? null : accepted });
      // The retired same-epoch policy has historical proof; the superseding B does not inherit it.
      if (!supersede) expect(f.query('policy', { ruleId: 'observe' }).registration).toEqual(accepted);
      expect(f.query('controlEvidence', { ruleId: 'observe' }).registered).toBe(true);
    } finally { f.close(); }
  }
});

test('settled absence is activation-only, requires durable local retirement/supersession and cannot be replaced by a later accepted story', () => {
  const f = fixture(); try {
    f.install(); const control = f.prepare();
    rejected(() => f.command('control.ack', { id: control.id, result: { state: 'absent' } }), 'CALENDAR_POLICY_STALE');
    f.retire(); const absent = f.command('control.ack', { id: control.id, result: { state: 'absent' } });
    expect(absent.result).toEqual({ state: 'absent' }); expect(f.rows('policy_registrations')).toHaveLength(0);
    expect(f.query('controlEvidence', { ruleId: 'observe' })).toEqual({ registered: false, pending: null });
    rejected(() => f.ack(control, f.registration()), 'CALENDAR_INTENT_CONFLICT');
    rejected(() => f.prepare('retire', null), 'CALENDAR_POLICY_STALE');
    const retired = f.prepare('retire', f.registration());
    rejected(() => f.command('control.ack', { id: retired.id, result: { state: 'absent' } }), 'CALENDAR_POLICY_STALE');
  } finally { f.close(); }
});

test('retire captures the actual owned prior Jobs epoch even when current local policy never applied; results cannot retarget a newer generation', () => {
  const f = fixture(); try {
    f.install(); const original = f.registration(); f.ack(f.prepare(), original);
    f.install('B', 1); f.retire(2); const control = f.prepare('retire', original, 2);
    expect(control.policy.source.policyVersion).toBe('B'); expect(control.expectedRegistration?.policyHash).toBe(original.policyHash);
    const stopped = { ...original, state: 'retired' as const, revision: 2 };
    rejected(() => f.ack(control, { ...stopped, policyHash: calendarHash(f.policy('B').source) }), 'CALENDAR_STATE_INVALID');
    rejected(() => f.ack(control, { ...stopped, generation: 2 }), 'CALENDAR_STATE_INVALID');
    rejected(() => f.ack(control, { ...stopped, revision: 1 }), 'CALENDAR_STATE_INVALID');
    expect(f.ack(control, stopped).result).toEqual({ state: 'accepted', registration: stopped });
    f.install('C', 2); f.retire(3); const alreadyStopped = f.prepare('retire', stopped, 3);
    rejected(() => f.ack(alreadyStopped, { ...stopped, revision: 3 }), 'CALENDAR_STATE_INVALID');
    expect(f.ack(alreadyStopped, stopped).result).toEqual({ state: 'accepted', registration: stopped });
    expect(f.query('controlEvidence', { ruleId: 'observe' }).registered).toBe(true);
  } finally { f.close(); }
});

test('bounded retry rows preserve original command identity and a per-rule pending proof includes future backoff without scanning historical outcomes', () => {
  const f = fixture(); try {
    f.install(); f.install('A', 0, 'other'); const a = f.prepare(), b = f.prepare('activate', null, 1, 'other');
    const failed = f.command('control.fail', { id: a.id, code: 'JOBS_OUTCOME_UNKNOWN', retryAt: f.now + 5000, now: f.now });
    expect(failed).toMatchObject({ jobsKey: a.jobsKey, expectedJobsRevision: 0, lastFailure: 'JOBS_OUTCOME_UNKNOWN', nextAttemptMs: f.now + 5000 });
    expect(f.query('controls', { now: f.now }).map((row: CalendarIntegrationControlView) => row.id)).toEqual([b.id]);
    expect(f.query('controlEvidence', { ruleId: 'observe' }).pending.id).toBe(a.id);
    expect(f.command('control.fail', { id: a.id, code: 'JOBS_NOT_READY', retryAt: f.now + 1000, now: f.now }).nextAttemptMs).toBe(f.now + 5000);
    f.ack(b, f.registration(f.policy('A', 'other')));
    expect(f.query('controls', { now: f.now + 5000 }).map((row: CalendarIntegrationControlView) => row.id)).toEqual([a.id]);
    expect(f.query('controls', { now: f.now + 5000, after: { nextAttemptMs: f.now + 5000, id: a.id } })).toEqual([]);
    expect(f.rows('control_attempts')).toHaveLength(2); expect(f.rows('controls')).toHaveLength(2);
    const plan = JSON.stringify(f.raw.query("EXPLAIN QUERY PLAN SELECT id FROM _calendar_integration_control_attempts WHERE scope_id='application' AND rule_id='observe' AND result_id IS NULL ORDER BY next_attempt_ms,id LIMIT 1").all());
    expect(plan).toContain('calendar_integration_control_rule_pending'); expect(plan).not.toContain('SCAN '); expect(plan).not.toContain('TEMP B-TREE');
  } finally { f.close(); }
});

test('result, retry projection, historical mapping and registration-presence marker roll back together on late source failure', () => {
  const f = fixture(); try {
    f.install(); const control = f.prepare(), sequence = f.db.currentSeq, before = f.rows('control_attempts');
    f.raw.run("CREATE TRIGGER synthetic_late_registration_failure BEFORE INSERT ON _calendar_integration_policy_registrations BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    expect(() => f.ack(control, f.registration())).toThrow(); expect(f.db.currentSeq).toBe(sequence);
    expect(f.rows('control_results')).toEqual([]); expect(f.rows('registered_sources')).toEqual([]); expect(f.rows('policy_registrations')).toEqual([]); expect(f.rows('control_attempts')).toEqual(before);
    expect(f.query('controlEvidence', { ruleId: 'observe' })).toEqual({ registered: false, pending: control });
    f.raw.run('DROP TRIGGER synthetic_late_registration_failure'); f.ack(control, f.registration());
    f.raw.run('PRAGMA recursive_triggers=OFF');
    for (const suffix of ['controls', 'control_results', 'registered_sources']) {
      const table = '_calendar_integration_' + suffix;
      expect(() => f.raw.run('UPDATE ' + table + ' SET id=id')).toThrow(); expect(() => f.raw.run('DELETE FROM ' + table)).toThrow();
      expect(() => f.raw.run('INSERT OR REPLACE INTO ' + table + ' SELECT * FROM ' + table)).toThrow();
    }
    expect(() => f.raw.run('UPDATE _calendar_integration_control_attempts SET result_id=NULL')).toThrow();
    expect(f.command('control.fail', { id: control.id, code: 'JOBS_CAPACITY', retryAt: f.now + 1000, now: f.now }).result?.state).toBe('accepted');
  } finally { f.close(); }
});

test('literal SQL result guards reject invented native generations/revisions and unproved registration-presence or late mappings', () => {
  const f = fixture(); try {
    f.install(); const control = f.prepare(), accepted = f.registration();
    const rawResult = (target: CalendarIntegrationControlView, registration: JobSourceRegistration) => f.db.createStrict('_calendar_integration_control_results', {
      id: target.id, scope_id: f.owner.scopeId, control_id: target.id, state: 'accepted', registration_json: calendarJson(registration), settled_ms: f.now });
    for (const forged of [{ ...accepted, generation: 2 }, { ...accepted, revision: 2 }, { ...accepted, policyHash: '0'.repeat(64) }]) expect(() => rawResult(control, forged)).toThrow();
    expect(f.rows('control_results')).toEqual([]); expect(f.rows('registered_sources')).toEqual([]); expect(f.rows('control_attempts')[0]?.result_id).toBeNull();
    expect(() => f.db.createStrict('_calendar_integration_registered_sources', { id: accepted.id, scope_id: f.owner.scopeId, rule_id: 'observe' })).toThrow();
    f.retire(); const policyId = f.query('policy', { ruleId: 'observe' }).id;
    const lateMap = () => f.db.createStrict('_calendar_integration_policy_registrations', { id: policyId, scope_id: f.owner.scopeId, policy_id: policyId, registration_json: calendarJson(accepted) });
    expect(lateMap).toThrow(); f.command('control.ack', { id: control.id, result: { state: 'absent' } }); expect(lateMap).toThrow();
    const retirement = f.prepare('retire', accepted);
    for (const forged of [{ ...accepted, state: 'retired' as const }, { ...accepted, state: 'retired' as const, revision: 3 },
      { ...accepted, state: 'retired' as const, revision: 2, generation: 2 }, { ...accepted, state: 'retired' as const, revision: 2, policyHash: '0'.repeat(64) }]) {
      expect(() => rawResult(retirement, forged)).toThrow();
    }
    expect(f.rows('control_results')).toHaveLength(1); // Only the immutable original activation absence.
    expect(() => f.raw.run("UPDATE _calendar_integration_control_attempts SET rule_id='foreign-rule' WHERE id=?", [retirement.id])).toThrow();
  } finally { f.close(); }
});
