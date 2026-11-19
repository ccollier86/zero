/** Source acceptance/receipts only, not native Jobs settlement. Strict SQLite MEMORY with finally-owned teardown. */
import { expect, test } from 'bun:test';
import { CalendarError, readCalendarRejection } from './error';
import { calendarOperatorRequestId } from './integration-operator-request-model';
import { CALENDAR_INTEGRATION_LIMITS } from './integration-model';
import { calendarOperatorRequestFixture } from './test-support/integration-operator-request-fixture';

function rejected(run: () => unknown, code: CalendarError['code']) {
  try { run(); throw new Error('Expected rejection.'); } catch (error) { expect(error instanceof CalendarError ? error.code : readCalendarRejection(error)?.code).toBe(code); }
}

test('source request commits the exact actor-owned local cutoff and replays before changed policy or internal desired catalog parsing', () => {
  const f = calendarOperatorRequestFixture(); try {
    f.install(); const expected = f.selection(), retired = f.retire();
    expect(retired).toEqual({ requestId: 'retire', action: 'retire', ruleId: 'observe', expected, policy: expected, localState: 'retired', changed: true, acceptedAtMs: f.now });
    expect(f.rows('controls')).toEqual([]); expect(f.rows('control_results')).toEqual([]);
    expect(f.receipt('retire')).toEqual(retired); expect(f.db.get('_calendar_usage', 'integrationOperatorRetirements')?.count).toBe(1);
    f.settleRetirement(); const activated = f.reactivate(); expect(activated).toMatchObject({ action: 'reactivate', localState: 'activating', changed: true, policy: { epoch: 2 } });
    const sequence = f.db.currentSeq, usage = f.db.list('_calendar_usage');
    expect(f.retire('retire', expected, { desired: { invalid: true } })).toEqual(retired);
    expect(f.reactivate('reactivate', activated.expected, { desired: null })).toEqual(activated);
    expect(f.db.currentSeq).toBe(sequence); expect(f.db.list('_calendar_usage')).toEqual(usage);
    expect(f.receipt('retire')).toEqual(retired); expect(f.receipt('reactivate')).toEqual(activated);
    rejected(() => f.retire('retire', activated.policy), 'CALENDAR_INTENT_CONFLICT');
    rejected(() => f.retire('stale', expected), 'CALENDAR_POLICY_STALE');
  } finally { f.close(); }
});

test('current management, physical owner scope and original principal/user bind private receipts including replay', () => {
  const f = calendarOperatorRequestFixture({ scopeId: 'tenant:operator-test' }); try {
    f.install('observe', 'A', 0, false); const expected = f.selection(), result = f.retire();
    for (const actor of [{ ...f.actor, manageAll: false }, { ...f.actor, scopeId: 'application' }]) {
      expect(() => f.receipt('retire', { actor })).toThrow(); expect(() => f.retire('retire', expected, { actor })).toThrow();
    }
    expect(f.receipt('retire', { actor: { ...f.actor, principal: 'another-principal' } })).toBeNull();
    expect(f.receipt('retire', { actor: { ...f.actor, userId: 'another-user' } })).toBeNull();
    expect(() => f.receipt('retire', { expectedOwnerId: 'wrong-owner' })).toThrow();
    rejected(() => f.retire('retire', expected, { expectedOwnerId: 'wrong-owner' }), 'CALENDAR_STATE_INVALID');
    expect(f.receipt('retire')).toEqual(result); expect(JSON.stringify(result)).not.toMatch(/principal|userId|ownerId|jobsKey|registration|workflow|safeToDisable/);
  } finally { f.close(); }
});

test('retirement recovery reserve is separate from exhausted ordinary receipts, while no-ops/reactivation cannot consume it', () => {
  const f = calendarOperatorRequestFixture(); try {
    f.install('observe', 'A', 0, false); const expected = f.selection();
    f.db.update('_calendar_usage', 'receipts', { count: 200_000 });
    const first = f.retire(); expect(first.changed).toBe(true); expect(f.db.get('_calendar_usage', 'receipts')?.count).toBe(200_000);
    expect(f.db.get('_calendar_usage', 'integrationOperatorRetirements')?.count).toBe(1); expect(f.retire('retire', expected)).toEqual(first);
    rejected(() => f.retire('noop'), 'CALENDAR_CAPACITY'); rejected(() => f.reactivate(), 'CALENDAR_CAPACITY');
    expect(f.db.get('_calendar_usage', 'integrationOperatorRetirements')?.count).toBe(1); expect(f.rows('operator_requests')).toHaveLength(1);
    f.db.update('_calendar_usage', 'receipts', { count: 1 }); expect(f.retire('noop').changed).toBe(false);
    expect(f.db.get('_calendar_usage', 'receipts')?.count).toBe(2); expect(f.db.get('_calendar_usage', 'integrationOperatorRetirements')?.count).toBe(1);
  } finally { f.close(); }
  const pressure = calendarOperatorRequestFixture(); try {
    pressure.install('observe', 'A', 0, false);
    pressure.db.createStrict('_calendar_usage', { id: 'integrationOperatorRetirements', count: CALENDAR_INTEGRATION_LIMITS.policies });
    const before = pressure.selection(); rejected(() => pressure.retire(), 'CALENDAR_CAPACITY');
    expect(pressure.query('policy', { ruleId: 'observe' }).state).toBe('activating'); expect(pressure.selection()).toEqual(before); expect(pressure.rows('operator_requests')).toEqual([]);
  } finally { pressure.close(); }
});

test('fresh reactivation requires original retirement settlement and preserves a single generation under competing request keys', () => {
  const f = calendarOperatorRequestFixture(); try {
    f.install(); f.retire(); const expected = f.selection();
    rejected(() => f.reactivate(), 'CALENDAR_POLICY_STALE'); expect(f.rows('operator_requests')).toHaveLength(1);
    f.settleRetirement(); const accepted = f.reactivate(); expect(accepted.policy.epoch).toBe(2);
    rejected(() => f.reactivate('competitor', expected), 'CALENDAR_POLICY_STALE'); expect(f.rows('policy_history')).toHaveLength(2);
    expect(f.rows('operator_requests')).toHaveLength(2);
  } finally { f.close(); }
});

test('fresh selection/owner/root/scope failures and authored routing cannot alter the actual source or manufacture acceptance', () => {
  const f = calendarOperatorRequestFixture(); try {
    f.install('observe', 'A', 0, false); const expected = f.selection(), sequence = f.db.currentSeq;
    rejected(() => f.retire('bad-digest', { ...expected, policyDigest: '0'.repeat(64) }), 'CALENDAR_POLICY_STALE');
    rejected(() => f.retire('bad-id', { ...expected, id: '0'.repeat(64) }), 'CALENDAR_POLICY_STALE');
    for (const extra of [{ scopeId: 'application' }, { rootHash: '0'.repeat(64) }, { now: 0 }, { jobsKey: 'forged' }]) rejected(() => f.retire('routing', expected, extra), 'CALENDAR_INPUT_INVALID');
    expect(f.db.currentSeq).toBe(sequence); expect(f.rows('operator_requests')).toEqual([]); f.retire();
    for (const identity of [{ rootHash: '0'.repeat(64) }, { ownerId: 'wrong-owner' }, { scopeId: 'tenant:other' }, { databaseId: 'calendar:wrong' }]) {
      const policy = f.policy(), desired = { ...policy, source: { ...policy.source, identity: { ...policy.source.identity, ...identity } } };
      expect(() => f.reactivate('bad-desired', f.selection(), { desired })).toThrow();
    }
    expect(f.rows('policy_history')).toHaveLength(1); expect(f.rows('operator_requests')).toHaveLength(1); expect(f.query('policy', { ruleId: 'observe' }).state).toBe('retired');
  } finally { f.close(); }
});

test('ordinary and operator commands share a protected principal/request-key namespace in both source handlers and literal SQL', () => {
  const f = calendarOperatorRequestFixture(); try {
    f.install('observe', 'A', 0, false);
    rejected(() => f.retire('inspection-1'), 'CALENDAR_INTENT_CONFLICT'); // Existing fixture resource request.
    f.retire('operator-key');
    rejected(() => f.command('resource.create', { actor: f.actor, requestId: 'operator-key', id: 'different', label: 'PRIVATE', kind: 'room', ownerId: null, timeZone: 'UTC' }), 'CALENDAR_INTENT_CONFLICT');
    expect(() => f.raw.run("INSERT INTO _calendar_receipts SELECT 'replacement',scope_id,principal,request_id,digest,'{}','resource','resource','manage' FROM _calendar_integration_operator_requests")).toThrow();
    expect(f.db.get('calendar_resources', 'different')).toBeNull(); expect(f.rows('operator_requests')).toHaveLength(1);
  } finally { f.close(); }
});

test('private request SQL guards retain identities, parents and initial-result shape without rewriting original policy/control evidence', () => {
  const f = calendarOperatorRequestFixture(); try {
    f.install('observe', 'A', 0, false); f.retire(); const rows = f.rows('operator_requests'), id = calendarOperatorRequestId(f.actor.scopeId, f.actor.principal, 'retire');
    expect(rows[0]).toMatchObject({ id, principal: f.actor.principal, user_id: f.actor.userId, owner_id: f.owner.expectedOwnerId }); f.raw.run('PRAGMA recursive_triggers=OFF');
    for (const sql of ['UPDATE _calendar_integration_operator_requests SET id=id', 'DELETE FROM _calendar_integration_operator_requests',
      'INSERT OR REPLACE INTO _calendar_integration_operator_requests SELECT * FROM _calendar_integration_operator_requests']) expect(() => f.raw.run(sql)).toThrow();
    for (const patch of [{ scope_id: 'wrong' }, { owner_id: 'wrong' }, { selected_digest: '0'.repeat(64) }, { policy_epoch: 99 }, { local_state: 'activating' }, { action: 'reactivate', changed: 0 }]) {
      expect(() => f.db.createStrict('_calendar_integration_operator_requests', { ...rows[0], id: 'a'.repeat(64), request_id: 'forged', ...patch })).toThrow();
    }
    expect(f.rows('operator_requests')).toEqual(rows); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
    const plan = JSON.stringify(f.raw.query("EXPLAIN QUERY PLAN SELECT * FROM _calendar_integration_operator_requests WHERE id=? AND scope_id=? AND principal=? AND user_id=?").all(id, f.actor.scopeId, f.actor.principal, f.actor.userId));
    expect(plan).not.toContain('SCAN '); expect(plan).not.toContain('TEMP B-TREE');
  } finally { f.close(); }
});
