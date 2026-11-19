/** Actual realm/read capability and strict native SQLite MEMORY; all handles close in finally. */
import { expect, test } from 'bun:test';
import { calendarHash } from './validation';
import { CALENDAR_INTEGRATION_LIMITS } from './integration-model';
import { calendarInspectionFixture } from './test-support/integration-inspection-fixture';

test('established empty inspection reports zero retained budget use and no invented downstream drain claim', () => {
  const f = calendarInspectionFixture(); try {
    expect(f.inspect()).toEqual({ inspectedAtMs: f.now,
      retained: { policies: { used: 0, limit: CALENDAR_INTEGRATION_LIMITS.policies, remaining: CALENDAR_INTEGRATION_LIMITS.policies },
        intents: { used: 0, limit: CALENDAR_INTEGRATION_LIMITS.intents, remaining: CALENDAR_INTEGRATION_LIMITS.intents } },
      rules: [], dispatch: { pending: false, unknown: false, blocked: false, accepted: false, claimed: false }, effects: { admittedButUnsettled: false } });
    expect(f.queries).toHaveLength(10);
  } finally { f.close(); }
});

test('private inspection uses the source clock, fixed retained usage PKs and safe current rule/control summaries without mutating state', () => {
  const f = calendarInspectionFixture(); try {
    const installed = f.install('observe', 'A', 0, false);
    const control = f.integration('control.prepare', { ruleId: 'observe', epoch: 1, action: 'activate', expectedRegistration: null });
    f.integration('control.fail', { id: control.id, now: f.now, retryAt: f.now + 5000, code: 'JOBS_OUTCOME_UNKNOWN' });
    f.appointment(); const sequence = f.db.currentSeq, before = f.raw.serialize();
    const inspection = f.inspect();
    expect(inspection).toEqual({ inspectedAtMs: f.now,
      retained: { policies: { used: 1, limit: CALENDAR_INTEGRATION_LIMITS.policies, remaining: CALENDAR_INTEGRATION_LIMITS.policies - 1 },
        intents: { used: 1, limit: CALENDAR_INTEGRATION_LIMITS.intents, remaining: CALENDAR_INTEGRATION_LIMITS.intents - 1 } },
      rules: [{ id: installed.id, ruleId: 'observe', epoch: 1, state: 'activating', policyDigest: calendarHash(f.policy()),
        pendingControl: { action: 'activate', epoch: 1, lastFailure: 'JOBS_OUTCOME_UNKNOWN', nextAttemptMs: f.now + 5000 } }],
      dispatch: { pending: true, unknown: false, blocked: false, accepted: false, claimed: false }, effects: { admittedButUnsettled: false } });
    const text = JSON.stringify(inspection);
    for (const secret of ['PRIVATE_', 'jobsKey', 'registration', 'source', 'workflow', 'createKey', 'nonce', 'safeToDisable', 'drained']) expect(text).not.toContain(secret);
    expect(f.inspect()).toEqual(inspection); expect(f.db.currentSeq).toBe(sequence); expect(f.raw.serialize()).toEqual(before);
    f.setNow(f.now + 250); expect(f.inspect().inspectedAtMs).toBe(f.now + 250);
    expect(() => f.inspect({ now: 0 })).toThrow(); expect(() => f.inspect({ limit: 1000 })).toThrow();
  } finally { f.close(); }
});

test('missing owner and forged owner/scope fail closed; established scoped files cannot disclose one another', () => {
  const unbound = calendarInspectionFixture({ bind: false }); try { expect(() => unbound.inspect()).toThrow(); } finally { unbound.close(); }
  for (const scopeId of ['application', 'tenant:synthetic-inspection']) {
    const f = calendarInspectionFixture({ scopeId }); try {
      f.install(); f.appointment();
      expect(() => f.inspect({ expectedOwnerId: 'different-owner' })).toThrow();
      expect(() => f.inspect({ scopeId: scopeId === 'application' ? 'tenant:synthetic-inspection' : 'application' })).toThrow();
      expect(f.inspect().retained.intents.used).toBe(1);
    } finally { f.close(); }
  }
});

test('dispatch existence includes claimed states, known capacity blockage and unknown outcomes without inventing totals or readiness', () => {
  const f = calendarInspectionFixture(); try {
    f.install(); f.appointment(); const claim = f.claim();
    expect(f.inspect().dispatch).toEqual({ pending: true, claimed: true, unknown: false, blocked: false, accepted: false });
    f.integration('defer', { id: claim.id, nonce: claim.nonce, claimGeneration: claim.claimGeneration, now: f.now, retryAt: f.now + 1001, code: 'JOBS_OUTCOME_UNKNOWN', unknown: true });
    expect(f.inspect().dispatch).toEqual({ pending: false, claimed: false, unknown: true, blocked: false, accepted: false });
    f.setNow(f.now + 1001); f.ack(f.claim(f.now + 1001)); expect(f.inspect().dispatch.accepted).toBe(true);
    f.appointment('blocked', 180_000); const blocked = f.claim(f.now + 1001);
    f.integration('defer', { id: blocked.id, nonce: blocked.nonce, claimGeneration: blocked.claimGeneration, now: f.now + 1001, retryAt: f.now + 2002, code: 'JOBS_CAPACITY', notCommitted: true });
    expect(f.inspect().dispatch).toEqual({ pending: false, claimed: false, unknown: false, blocked: true, accepted: true });
    expect(f.inspect().retained.intents.used).toBe(2);
  } finally { f.close(); }
});

test('pending controls retain older unresolved epochs and future backoff; inspection lists no more than eight permanent rules', () => {
  const f = calendarInspectionFixture(); try {
    f.install('observe', 'A', 0, false);
    const control = f.integration('control.prepare', { ruleId: 'observe', epoch: 1, action: 'activate', expectedRegistration: null });
    f.install('observe', 'B', 1, false);
    for (let i = 1; i < 8; i++) f.install('rule-' + i, 'A', 0, false);
    expect(f.inspect().rules).toHaveLength(8);
    expect(f.queries.length).toBeLessThanOrEqual(34);
    expect(f.inspect().rules.find(rule => rule.ruleId === 'observe')).toMatchObject({ epoch: 2, pendingControl: { action: 'activate', epoch: 1 } });
    f.integration('control.ack', { id: control.id, result: { state: 'accepted', registration: f.registration() } });
    expect(f.inspect().rules.find(rule => rule.ruleId === 'observe')?.pendingControl).toBeNull();
    expect(() => f.install('ninth', 'A', 0, false)).toThrow(); expect(f.inspect().retained.policies.used).toBe(9);
  } finally { f.close(); }
});

test('admission and settlement atomically maintain the derived unsettled presence through retirement and late failures', () => {
  const f = calendarInspectionFixture(); try {
    f.install(); const id = f.appointment(), sequence = f.db.currentSeq;
    f.raw.run("CREATE TRIGGER synthetic_pending_refusal BEFORE INSERT ON _calendar_integration_pending_effects BEGIN SELECT RAISE(ABORT,'synthetic pending refusal'); END");
    expect(() => f.admit(id)).toThrow(); expect(f.rows('effect_admissions')).toEqual([]); expect(f.rows('pending_effects')).toEqual([]); expect(f.db.currentSeq).toBe(sequence);
    f.raw.run('DROP TRIGGER synthetic_pending_refusal'); expect(f.admit(id).admitted).toBe(true); expect(f.inspect().effects.admittedButUnsettled).toBe(true);
    expect(f.rows('pending_effects')).toEqual([{ id, scope_id: f.owner.scopeId }]);
    f.integration('policy.retire', { ruleId: 'observe', epoch: 1 }); const before = f.db.currentSeq;
    f.raw.run("CREATE TRIGGER synthetic_settlement_refusal BEFORE DELETE ON _calendar_integration_pending_effects BEGIN SELECT RAISE(ABORT,'synthetic settlement refusal'); END");
    expect(() => f.settle(id)).toThrow(); expect(f.rows('effect_outcomes')).toEqual([]); expect(f.inspect().effects.admittedButUnsettled).toBe(true); expect(f.db.currentSeq).toBe(before);
    f.raw.run('DROP TRIGGER synthetic_settlement_refusal'); expect(f.settle(id).outcome).toBe('observed');
    expect(f.inspect().effects.admittedButUnsettled).toBe(false); expect(f.rows('pending_effects')).toEqual([]);
    expect(f.admit(id).admitted).toBe(false); expect(f.settle(id).outcome).toBe('observed'); expect(f.rows('effect_outcomes')).toHaveLength(1);
  } finally { f.close(); }
});

test('literal SQL cannot fabricate, replace, relabel or erase unsettled presence and source evidence remains immutable', () => {
  const f = calendarInspectionFixture(); try {
    f.install(); const id = f.appointment(); f.admit(id); f.raw.run('PRAGMA recursive_triggers=OFF');
    for (const [candidate, scope] of [['missing', f.owner.scopeId], [id, 'wrong-scope']]) expect(() => f.raw.run('INSERT INTO _calendar_integration_pending_effects(id,scope_id) VALUES(?,?)', [candidate!, scope!])).toThrow();
    expect(() => f.raw.run('INSERT OR REPLACE INTO _calendar_integration_pending_effects SELECT * FROM _calendar_integration_pending_effects')).toThrow();
    expect(() => f.raw.run("UPDATE _calendar_integration_pending_effects SET scope_id='wrong-scope'")).toThrow();
    expect(() => f.raw.run('UPDATE _calendar_integration_pending_effects SET id=id')).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_integration_pending_effects')).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_integration_effect_admissions')).toThrow();
    f.settle(id); expect(() => f.raw.run('INSERT INTO _calendar_integration_pending_effects(id,scope_id) VALUES(?,?)', [id, f.owner.scopeId])).toThrow();
    expect(() => f.raw.run('DELETE FROM _calendar_integration_effect_outcomes')).toThrow(); expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('inspection executes only bounded indexed probes, independent of settled retained effect history', () => {
  const f = calendarInspectionFixture(); try {
    f.install(); const control = f.integration('control.prepare', { ruleId: 'observe', epoch: 1, action: 'activate', expectedRegistration: null });
    const id = f.appointment(); f.admit(id); f.settle(id); f.inspect();
    const queries = f.queries;
    expect(queries).toHaveLength(13);
    for (const sql of queries) {
      expect(sql).not.toMatch(/count\s*\(|\bJOIN\b|\bNOT EXISTS\b|effect_admissions|effect_outcomes|policy_json|registration_json|jobs_key/i);
      if (!sql.includes('WHERE id=')) expect(sql).toContain('LIMIT');
    }
    for (const [sql, expected] of [
      ["SELECT count FROM _calendar_usage WHERE id='integrationPolicies'", 'sqlite_autoindex__calendar_usage_1'],
      ["SELECT id,rule_id,policy_id,epoch,state FROM _calendar_integration_policy_current WHERE scope_id='application' ORDER BY rule_id LIMIT 9", 'calendar_integration_current_rule'],
      ["SELECT id,last_failure,next_attempt_ms FROM _calendar_integration_control_attempts WHERE scope_id='application' AND rule_id='observe' AND result_id IS NULL ORDER BY next_attempt_ms,id LIMIT 1", 'calendar_integration_control_rule_pending'],
      ["SELECT action,epoch,rule_id FROM _calendar_integration_controls WHERE id='" + control.id + "' AND scope_id='application' AND owner_id='synthetic-inspection-owner'", 'sqlite_autoindex__calendar_integration_controls_1'],
      ["SELECT id FROM _calendar_integration_dispatch WHERE scope_id='application' AND state='pending' LIMIT 1", 'calendar_integration_inspection_state'],
      ["SELECT id FROM _calendar_integration_dispatch WHERE scope_id='application' AND claim_nonce IS NOT NULL ORDER BY claim_until_ms,id LIMIT 1", 'calendar_integration_expired_claim'],
      ["SELECT id FROM _calendar_integration_pending_effects WHERE scope_id='application' LIMIT 1", 'calendar_integration_pending_effect_scope'],
    ]) {
      const plan = JSON.stringify(f.raw.query('EXPLAIN QUERY PLAN ' + sql).all()); expect(plan).toContain(expected); expect(plan).not.toContain('SCAN '); expect(plan).not.toContain('TEMP B-TREE');
    }
  } finally { f.close(); }
});
