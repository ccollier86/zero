/** Real Guardian and CalendarRuntime/realm in MEMORY. The existing fixture's
 * physical coordinator/transport is an explicit double; no file/actor claim. */
import { expect, test } from 'bun:test';
import { admitCalendarRequest } from './authority';
import { CalendarError } from './error';
import { CALENDAR_OBSERVATION_WORKFLOW, calendarObservationPolicy } from './integration-catalog';
import type { CalendarIntegrationPolicyView } from './integration-model';
import { calendarIntegrationPolicySelection } from './integration-operator';
import { calendarIntegrationOperatorRequestsForAuthority } from './integration-operator-request-service';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

async function fixture() {
  let before: ((name: string) => void) | null = null, after: ((name: string) => void) | null = null;
  const calendar = memoryCalendarServiceFixture({ tenancy: 'multi', beforeDispatch(operation) {
    if (operation.type === 'command') before?.(operation.name);
  }, afterCommand(operation) { if (operation.type === 'command') after?.(operation.name); } });
  const closing = new AbortController();
  try {
    const session = calendar.session('manager', { tenantId: 'first', manager: true });
    await session.api.resources.create({ label: 'Synthetic resource', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'seed' });
    const record = calendar.runtime.integrationOwnerForScope(session.scope)!, owner = calendar.runtime.forIntegrationOwner(record);
    const rule = { id: 'observe', version: '1', dueOffsetMs: 0, maxLatenessMs: 60_000 };
    const pin = { name: CALENDAR_OBSERVATION_WORKFLOW, version: 1, definitionId: 'synthetic-definition', versionId: 'synthetic-version', fingerprint: '1'.repeat(64) };
    let policy = calendarObservationPolicy(owner, rule, pin), compilation = 0, accepts = 0;
    let compileFailure = false;
    await owner.command('calendar.integration.policy.install', { policy, expectedEpoch: 0 }, { idempotencyKey: 'synthetic-capture' });
    const native = { async inspect() { return null; }, reactivationPolicy() { compilation++; if (compileFailure) throw new CalendarError('CALENDAR_NOT_READY'); return policy; } };
    const view = calendarIntegrationOperatorRequestsForAuthority(session.authority, calendar.config, closing.signal, { native,
      broker: calendar.runtime, async accept(_authority, operation) { accepts++; return operation(); } });
    return { calendar, session, record, owner, view, closing,
      async selected() { return calendarIntegrationPolicySelection(await owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: rule.id })); },
      changePolicy() { policy = calendarObservationPolicy(owner, { ...rule, version: '2' }, pin); },
      failCompilation() { compileFailure = true; }, counters: () => ({ compilation, accepts }),
      before(callback: typeof before) { before = callback; }, after(callback: typeof after) { after = callback; },
      installRefusingReadiness() {
        let calls = 0;
        (calendar.runtime as unknown as { source: unknown }).source = { prepare() {}, async ready() { calls++; throw new Error('Ordinary readiness refused.'); }, wake() {}, async close() {} };
        return () => calls;
      },
      async close() { closing.abort(); await calendar.close(); },
    };
  } catch (error) { closing.abort(); await calendar.close(); throw error; }
}

test('real existing-only operator writer bypasses retired readiness and returns original acceptance across pointer/config changes', async () => {
  const f = await fixture();
  try {
    const readiness = f.installRefusingReadiness(), first = await f.selected();
    const retired = await f.view.retire('observe', { idempotencyKey: 'human-retire', expected: first });
    expect(retired).toMatchObject({ action: 'retire', localState: 'retired', changed: true, policy: first });
    expect(readiness()).toBe(0);
    const activated = await f.view.reactivate('observe', { idempotencyKey: 'human-reactivate', expected: first });
    expect(activated).toMatchObject({ localState: 'activating', changed: true, policy: { epoch: first.epoch + 1 } });
    const before = f.counters(); f.failCompilation();
    expect(await f.view.reactivate('observe', { idempotencyKey: 'human-reactivate', expected: first })).toEqual(activated);
    expect(await f.view.retire('observe', { idempotencyKey: 'human-retire', expected: first })).toEqual(retired);
    expect(f.counters()).toEqual(before); expect(readiness()).toBe(0);
    expect(await f.view.requests.get('human-retire')).toEqual(retired);
    await expect(f.view.retire('observe', { idempotencyKey: 'human-reactivate', expected: first })).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
  } finally { await f.close(); }
});

test('operator request/read never provisions a never-owned tenant and actor routes stay outside ordinary/native allowlists', async () => {
  const f = await fixture();
  try {
    const other = f.calendar.session('other', { tenantId: 'empty', manager: true }), stats = f.calendar.stats();
    const authority = await admitCalendarRequest(other.authority, f.calendar.config, f.closing.signal);
    expect(await f.calendar.runtime.integrationOperatorReceipt(other.scope, { actor: authority.actor, requestId: 'absent' }, authority.guard)).toBeNull();
    await expect(f.calendar.runtime.integrationOperatorRequest(other.scope,
      { actor: authority.actor, requestId: 'absent', action: 'retire', ruleId: 'observe', expected: await f.selected() }, authority.guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(f.calendar.stats().planes).toBe(stats.planes); expect(f.calendar.stats().ownerRows).toBe(stats.ownerRows);
    await expect(f.owner.command('calendar.integration.operator.request' as never, {}, { idempotencyKey: 'no-native-actor' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(f.calendar.runtime.read(f.session.scope, 'calendar.integration.operator.receipt', {}, () => {})).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    const own = await admitCalendarRequest(f.session.authority, f.calendar.config, f.closing.signal);
    await expect(f.calendar.runtime.integrationOperatorReceipt(other.scope, { actor: own.actor, requestId: 'absent' }, own.guard)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
  } finally { await f.close(); }
});

test('final writer revocation refuses operator acceptance without local transition, receipt or recovery-budget usage', async () => {
  const f = await fixture();
  try {
    const expected = await f.selected(), rows = f.calendar.sourceRows(f.session.scope, '_calendar_integration_operator_requests');
    f.before(name => { if (name === 'calendar.integration.operator.request') f.session.revoke(); });
    expect(await f.view.retire('observe', { idempotencyKey: 'revoked', expected }).catch(error => ({ code: error.code, outcome: error.outcome })))
      .toEqual({ code: 'CALENDAR_FORBIDDEN', outcome: 'not-started' });
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' })).state).toBe('activating');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_operator_requests')).toEqual(rows);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_usage').some(row => row.id === 'integrationOperatorRetirements')).toBe(false);
  } finally { await f.close(); }
});

test('accepted source write followed by session loss is unknown and remains privately reconcilable after fresh authorization', async () => {
  const f = await fixture();
  try {
    const expected = await f.selected();
    f.after(name => { if (name === 'calendar.integration.operator.request') f.session.revoke(); });
    await expect(f.view.retire('observe', { idempotencyKey: 'lost-ack', expected })).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN' });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_operator_requests')).toHaveLength(1);
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' })).state).toBe('retired');
    f.after(null);
    const renewed = f.calendar.session('manager', { tenantId: 'first', manager: true });
    const authority = await admitCalendarRequest(renewed.authority, f.calendar.config, f.closing.signal);
    const receipt = await f.calendar.runtime.integrationOperatorReceipt(renewed.scope, { actor: authority.actor, requestId: 'lost-ack' }, authority.guard);
    expect(receipt).toMatchObject({ requestId: 'lost-ack', localState: 'retired', changed: true });
    await expect(f.view.requests.get('lost-ack')).rejects.toBeDefined();
  } finally { await f.close(); }
});

test('SYSTEM owner replacement while the actor command waits cannot commit into the old physical owner', async () => {
  const f = await fixture();
  try {
    const expected = await f.selected();
    f.before(name => { if (name === 'calendar.integration.operator.request') {
      f.calendar.system.prepare('UPDATE _calendar_owners SET owner_id=? WHERE id=?').run('synthetic-replaced-owner', f.record.id);
    } });
    expect(await f.view.retire('observe', { idempotencyKey: 'owner-replaced', expected }).catch(error => ({ code: error.code, outcome: error.outcome })))
      .toEqual({ code: 'CALENDAR_FORBIDDEN', outcome: 'not-started' });
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_operator_requests')).toEqual([]);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_policy_current')[0]!.state).toBe('activating');
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_usage').some(row => row.id === 'integrationOperatorRetirements')).toBe(false);
  } finally { await f.close(); }
});

test('new reactivation policy is fenced at the writer edge and wrong physical contracts are not admitted', async () => {
  const f = await fixture();
  try {
    const expected = await f.selected(); await f.view.retire('observe', { idempotencyKey: 'retire', expected });
    const authority = await admitCalendarRequest(f.session.authority, f.calendar.config, f.closing.signal);
    const retained = await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' });
    const wrong = { ...retained.policy, source: { ...retained.policy.source,
      identity: { ...retained.policy.source.identity, rootHash: 'f'.repeat(64) } } };
    await expect(f.calendar.runtime.integrationOperatorRequest(f.session.scope,
      { actor: authority.actor, requestId: 'wrong-root', action: 'reactivate', ruleId: 'observe', expected, desired: wrong }, authority.guard))
      .rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    f.before(name => { if (name === 'calendar.integration.operator.request') f.changePolicy(); });
    expect(await f.view.reactivate('observe', { idempotencyKey: 'moved-catalog', expected }).catch(error => ({ code: error.code, outcome: error.outcome })))
      .toEqual({ code: 'CALENDAR_FORBIDDEN', outcome: 'not-started' });
    expect((await f.owner.read<CalendarIntegrationPolicyView>('calendar.integration.policy', { ruleId: 'observe' })).epoch).toBe(expected.epoch);
    expect(f.calendar.sourceRows(f.session.scope, '_calendar_integration_operator_requests')).toHaveLength(1);
  } finally { await f.close(); }
});
