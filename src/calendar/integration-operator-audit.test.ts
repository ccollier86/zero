/** Source-atomic initiating audit only. No Jobs, delivery worker, physical fixtures or generated output. */
import { expect, test } from 'bun:test';
import { calendarOperatorRequestFixture } from './test-support/integration-operator-request-fixture';

test('initiating actor, request receipt, local cutoff and safe semantic fact commit exactly once without downstream claims', () => {
  const f = calendarOperatorRequestFixture({ logging: true, scopeId: 'tenant:operator-audit' }); try {
    f.install(); const expected = f.selection(), retired = f.retire();
    expect(f.retire('retire', expected)).toEqual(retired); f.retire('noop'); f.settleRetirement(); const activated = f.reactivate();
    expect(f.reactivate('reactivate', activated.expected, { desired: null })).toEqual(activated);
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.integration.retirement-requested', 'calendar.integration.reactivation-requested']);
    expect(events.every(event => event.actor.kind === 'user' && event.actor.id === f.actor.userId && event.actor.sessionId === 'synthetic-session'
      && event.scope.kind === 'tenant' && event.scope.tenantId === 'operator-audit' && event.family === 'workflow' && event.evidence === 'server-confirmed'
      && event.outcome === 'succeeded' && event.target?.type === 'calendar.integration-rule' && event.target.id === 'observe')).toBe(true);
    expect(events.map(event => event.metadata.policyEpoch)).toEqual([1, 2]); expect(new Set(events.map(event => event.id)).size).toBe(2);
    for (const event of events) expect(Object.keys(event.metadata).sort()).toEqual(['sequence', 'selectedEpoch', 'policyEpoch', 'selectedPolicyId', 'policyId', 'requestRef'].sort());
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_|jobsKey|registration|definitionId|source\.identity|dueOffset|maxLateness|safeToDisable|drained/);
    expect(f.rows('operator_requests')).toHaveLength(3);
  } finally { f.close(); }
});

test('source audit pressure rolls back reactivation history, pointer, receipt and ordinary budget while no-ops remain audit-free', () => {
  const f = calendarOperatorRequestFixture({ logging: true, maxEvents: 1 }); try {
    f.install(); f.retire(); const noop = f.retire('noop'); expect(noop.changed).toBe(false); f.settleRetirement();
    const pointer = f.rows('policy_current'), history = f.rows('policy_history'), receipts = f.rows('operator_requests'), usage = f.db.list('_calendar_usage'), sequence = f.db.currentSeq;
    expect(() => f.reactivate()).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(f.rows('policy_current')).toEqual(pointer); expect(f.rows('policy_history')).toEqual(history); expect(f.rows('operator_requests')).toEqual(receipts);
    expect(f.db.list('_calendar_usage')).toEqual(usage); expect(f.db.currentSeq).toBe(sequence); expect(f.source!.control({}).queued).toBe(1);
  } finally { f.close(); }
});

test('late receipt refusal and explicit rollback undo cutoff, retirement reserve and audit together', () => {
  const f = calendarOperatorRequestFixture({ logging: true }); try {
    f.install(); const before = f.rows('policy_current'), sequence = f.db.currentSeq, usage = f.db.list('_calendar_usage');
    f.raw.run("CREATE TRIGGER synthetic_operator_receipt_refusal BEFORE INSERT ON _calendar_integration_operator_requests BEGIN SELECT RAISE(ABORT,'synthetic late refusal'); END");
    expect(() => f.retire()).toThrow(); expect(f.rows('policy_current')).toEqual(before); expect(f.rows('operator_requests')).toEqual([]);
    expect(f.db.list('_calendar_usage')).toEqual(usage); expect(f.db.currentSeq).toBe(sequence); expect(f.source!.control({}).queued).toBe(0);
    f.raw.run('DROP TRIGGER synthetic_operator_receipt_refusal');
    expect(() => f.db.transaction(() => { f.retire(); throw new Error('synthetic outer rollback'); })).toThrow('synthetic outer rollback');
    expect(f.rows('policy_current')).toEqual(before); expect(f.rows('operator_requests')).toEqual([]); expect(f.db.list('_calendar_usage')).toEqual(usage); expect(f.source!.control({}).queued).toBe(0);
  } finally { f.close(); }
});

test('disabled workflow capture retains private actor receipts without fabricating audit evidence', () => {
  for (const logging of [false, true]) {
    const f = calendarOperatorRequestFixture({ logging, workflow: false }); try {
      f.install('observe', 'A', 0, false); f.retire(); expect(f.rows('operator_requests')).toHaveLength(1);
      if (f.source) expect(f.source.control({}).queued).toBe(0);
      else expect(f.raw.query("SELECT name FROM sqlite_master WHERE name='_zero_logging_outbox'").get()).toBeNull();
    } finally { f.close(); }
  }
});
