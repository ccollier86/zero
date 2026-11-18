/** Real tracked realm + SQLite MEMORY only. No fixture directories, actor processes or generated output. */
import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { jobSourceId, jobSourceScheduleId } from '../jobs/source-model';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { calendarRealm } from './realm';
import { calendarHash } from './validation';
import { readCalendarRejection } from './error';
import { CALENDAR_INTEGRATION_LIMITS, CALENDAR_INTEGRATION_MAX_DUE_MS, type CalendarIntegrationClaim, type CalendarIntegrationIntentView, type CalendarIntegrationPolicySpec } from './integration-model';

function fixture(logging = false) {
  const db = createReactiveDB({ mode: 'memory' }), raw = db.getRawDatabase(), now = Date.now();
  const clock = spyOn(Date, 'now').mockReturnValue(now);
  let source: LoggingActorSource | null = null;
  try {
    raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    const owner = { scopeId: 'application', expectedOwnerId: 'synthetic-calendar-owner' };
    const actor = { scopeId: owner.scopeId, userId: 'synthetic-user', principal: 'synthetic.session', manageAll: true, createOwn: true };
    if (logging) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'synthetic-calendar-integrations', scope: { kind: 'application', tenantId: null }, sourceQueue: { maxEvents: 100 } }));
    const attribution = { ...loggingContext(null), actor: { kind: 'user' as const, id: actor.userId, sessionId: actor.principal, initiatorId: null } };
    const command = (name: string, body: unknown): any => {
      const run = () => runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, body as DatabaseSerializableValue);
      return (source ? source.run(attribution, run) : run() as any).value;
    };
    let sequence = 0;
    const integration = (name: string, body: Record<string, unknown> = {}) => command('integration.' + name, { ...owner, requestId: 'integration-' + ++sequence, ...body });
    const query = (name: string, body: Record<string, unknown> = {}): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context,
        'calendar.integration.' + name, { ...owner, ...body } as DatabaseSerializableValue)); } finally { copy.close(); }
    };
    command('owner.bind', { ownerId: owner.expectedOwnerId, scopeId: owner.scopeId });
    command('resource.create', { actor, id: 'resource', requestId: 'create-resource', label: 'PRIVATE_RESOURCE_LABEL', kind: 'room', ownerId: null, timeZone: 'UTC' });
    const policy = (version = 'A'): CalendarIntegrationPolicySpec => ({ ruleId: 'observe', ruleVersion: '1', adapter: 'observation-v1', dueOffsetMs: -60_000, maxLatenessMs: 60_000,
      source: { identity: { domain: 'calendar.observation', databaseId: 'calendar:' + calendarHash(owner.scopeId), ownerId: owner.expectedOwnerId, scopeId: owner.scopeId, rootHash: '1'.repeat(64) },
        realmFingerprint: calendarRealm.fingerprint, policyVersion: version, semanticsVersion: 'observation-v1', definition: { name: 'calendar.observe', version: '1', fingerprint: '2'.repeat(64) },
        workflow: { name: 'calendar.observe', version: 1, definitionId: 'definition', versionId: 'version', fingerprint: '3'.repeat(64) } } });
    const registration = (spec: CalendarIntegrationPolicySpec, generation = 1) => ({ id: jobSourceId(spec.source.identity), generation, revision: generation, state: 'active' as const, policyHash: calendarHash(spec.source) });
    const install = (version = 'A', expectedEpoch = 0) => {
      const spec = policy(version), selected = integration('policy.install', { policy: spec, expectedEpoch, now, requestId: 'install-' + version + '-' + expectedEpoch });
      integration('policy.activate', { ruleId: spec.ruleId, epoch: selected.epoch, registration: registration(spec, selected.epoch) }); return selected;
    };
    const interval = (offset = 0) => ({ startAt: new Date(now + 60_000 + offset).toISOString(), endAt: new Date(now + 120_000 + offset).toISOString(), timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    const appointment = (id = 'appointment', offset = 0) => command('appointment.create', { actor, id, requestId: 'create-' + id, resourceIds: ['resource'], title: 'PRIVATE_APPOINTMENT_TITLE', ...interval(offset) });
    const rows = (name: string): any[] => raw.query('SELECT * FROM _calendar_integration_' + name + ' ORDER BY rowid').all();
    const intent = (id = rows('intents').at(-1)?.id): CalendarIntegrationIntentView => query('intent', { id });
    const claim = (at = now, nonce = 'claim-1', leaseMs = 1000): CalendarIntegrationClaim[] => integration('claim', { now: at, nonce, leaseMs, limit: 100 });
    const receipt = (id: string, control: 'active' | 'cancelled' = 'active') => {
      const selected = intent(id); return { id: jobSourceScheduleId(selected.policy.source.identity, selected.createKey), sourceId: selected.registration!.id,
        policyGeneration: selected.registration!.generation, control, revision: control === 'active' ? 1 : 2, generation: 1, createdAt: now, updatedAt: now };
    };
    const ack = (claim: CalendarIntegrationClaim, phase: 'create' | 'cancel' = 'create') => integration('ack', { id: claim.id, nonce: claim.nonce, claimGeneration: claim.claimGeneration,
      phase, receipt: receipt(claim.id, phase === 'create' ? 'active' : 'cancelled') });
    return { db, raw, now, owner, actor, source, command, integration, query, policy, registration, install, interval, appointment, rows, intent, claim, receipt, ack,
      setNow: (value: number) => clock.mockReturnValue(value), close: () => { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } } };
  } catch (error) { try { source?.close(); } finally { try { db.dispose(); } finally { clock.mockRestore(); } } throw error; }
}
function rejects(run: () => unknown, code: string) {
  try { run(); throw new Error('Expected rejection'); } catch (error) { expect(readCalendarRejection(error)?.code ?? (error as any).code).toBe(code); }
}

test('all canonical appointment revision writers capture only installed policy; no-op/replay and terminal history remain exact', () => {
  const f = fixture(); try {
    f.appointment('before-policy', 3_600_000); expect(f.rows('intents')).toHaveLength(0); f.install();
    f.appointment(); const first = f.intent(); expect(first.input).toEqual({ kind: 'calendar-observation-v1', intentId: first.id, appointmentRevision: 1, policyEpoch: 1 });
    expect(JSON.stringify(first)).not.toContain('PRIVATE_'); f.appointment(); expect(f.rows('intents')).toHaveLength(1);
    f.command('appointment.reschedule', { actor: f.actor, requestId: 'noop', id: 'appointment', expectedRevision: 1, ...f.interval() }); expect(f.rows('intents')).toHaveLength(1);
    f.command('appointment.reschedule', { actor: f.actor, requestId: 'move', id: 'appointment', expectedRevision: 1, ...f.interval(600_000) });
    expect(f.intent(first.id).eligibility).toBe('superseded'); expect(f.intent().appointmentRevision).toBe(2);
    f.command('appointment.participants', { actor: f.actor, requestId: 'participants', id: 'appointment', expectedRevision: 2, references: [{ kind: 'guardian-user', userId: 'opaque-subject' }] });
    expect(f.intent().appointmentRevision).toBe(3);
    f.command('lifecycle.replace', { actor: f.actor, requestId: 'extended', expectedRevision: 1, extended: true, cancellationReason: 'optional', noShowReason: 'optional' });
    f.command('appointment.transition', { actor: f.actor, requestId: 'tentative', id: 'appointment', expectedRevision: 3, status: 'tentative', policyRevision: 2 });
    expect(f.intent().appointmentRevision).toBe(4); expect(f.rows('intents')).toHaveLength(4);
    f.command('appointment.cancel', { actor: f.actor, requestId: 'cancel', id: 'appointment', expectedRevision: 4, confirmed: true });
    expect(f.rows('intents')).toHaveLength(4); expect(f.rows('dispatch').every(row => row.eligibility === 'superseded')).toBe(true);
    f.command('hold.acquire', { actor: f.actor, requestId: 'hold', id: 'hold', resourceIds: ['resource'], ttlSeconds: 300, ...f.interval(7_200_000) });
    expect(f.rows('intents')).toHaveLength(4);
    f.command('hold.confirm', { actor: f.actor, requestId: 'confirm-hold', id: 'hold', expectedRevision: 1, appointmentId: 'held-appointment', title: 'PRIVATE_HELD' });
    expect(f.rows('intents')).toHaveLength(5); expect(f.intent()).toMatchObject({ appointmentId: 'held-appointment', appointmentRevision: 1 });
  } finally { f.close(); }
});

test('late integration insert and retained-capacity failure roll back business mutation, ordinary receipt/seal and usage', () => {
  const f = fixture(); try {
    f.install(); const seq = f.db.currentSeq;
    f.raw.run("CREATE TRIGGER synthetic_late_integration_failure BEFORE INSERT ON _calendar_integration_intents BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    expect(() => f.appointment()).toThrow(); expect(f.db.currentSeq).toBe(seq); expect(f.db.get('calendar_appointments', 'appointment')).toBeNull();
    expect(f.rows('intents')).toHaveLength(0); expect(f.db.get('_calendar_receipts', calendarHash(['application', f.actor.principal, 'create-appointment']))).toBeNull();
    f.raw.run('DROP TRIGGER synthetic_late_integration_failure');
    f.db.createStrict('_calendar_usage', { id: 'integrationIntents', count: CALENDAR_INTEGRATION_LIMITS.intents });
    rejects(() => f.appointment(), 'CALENDAR_CAPACITY'); expect(f.db.get('calendar_appointments', 'appointment')).toBeNull();
    expect(f.db.get('_calendar_usage', 'integrationIntents')?.count).toBe(CALENDAR_INTEGRATION_LIMITS.intents);
  } finally { f.close(); }
});

test('A to B to A and install replay preserve immutable prior Jobs mapping without reactivating historical epoch', () => {
  const f = fixture(); try {
    f.install(); f.appointment(); const original = f.intent(); f.install('B', 1); f.install('A', 2);
    expect(f.query('policy', { ruleId: 'observe' }).epoch).toBe(3);
    expect(f.intent(original.id)).toMatchObject({ eligibility: 'retired', registration: original.registration });
    const replay = f.integration('policy.install', { policy: f.policy(), expectedEpoch: 0, requestId: 'install-A-0', now: f.now });
    expect(replay).toMatchObject({ epoch: 1, state: 'retired', registration: original.registration });
    rejects(() => f.integration('policy.activate', { ruleId: 'observe', epoch: 1, registration: original.registration }), 'CALENDAR_POLICY_STALE');
    f.integration('policy.retire', { ruleId: 'observe', epoch: 3 });
    rejects(() => f.integration('policy.activate', { ruleId: 'observe', epoch: 3, registration: f.registration(f.policy(), 3) }), 'CALENDAR_POLICY_STALE');
    f.install('A', 3); expect(f.query('policy', { ruleId: 'observe' }).epoch).toBe(4);
  } finally { f.close(); }
});

test('claims are exclusive, expiry advances nonce generation, stale acknowledgment cannot overwrite and unknown never proves absence', () => {
  const f = fixture(); try {
    f.install(); f.appointment(); const first = f.claim()[0]!; expect(first.previouslyAttempted).toBe(false); expect(f.claim(f.now, 'competing')).toHaveLength(0);
    const second = f.claim(f.now + 1001, 'reclaimed')[0]!; expect(second.claimGeneration).toBe(2); expect(second.previouslyAttempted).toBe(true);
    rejects(() => f.ack(first), 'CALENDAR_REVISION_CONFLICT');
    f.integration('defer', { id: second.id, nonce: second.nonce, claimGeneration: second.claimGeneration, now: f.now + 1001, retryAt: f.now + 2002, code: 'JOBS_OUTCOME_UNKNOWN', unknown: true });
    expect(f.intent().state).toBe('unknown'); const third = f.claim(f.now + 2002, 'third')[0]!;
    rejects(() => f.integration('suppress', { id: third.id, nonce: third.nonce, claimGeneration: third.claimGeneration }), 'CALENDAR_STATE_INVALID');
    f.ack(third); expect(f.rows('receipts')).toHaveLength(1); expect(f.intent().state).toBe('accepted');
    expect(f.claim(f.now + 2002, 'healthy')).toHaveLength(0);
  } finally { f.close(); }
});

test('known first-create capacity rejection stays durably blocked but does not manufacture uncertainty or new identities', () => {
  const f = fixture(); try {
    f.install(); f.appointment(); const original = f.intent(), first = f.claim()[0]!;
    f.integration('defer', { id: first.id, nonce: first.nonce, claimGeneration: first.claimGeneration, now: f.now, retryAt: f.now + 1001, code: 'JOBS_CAPACITY', notCommitted: true });
    expect(f.intent()).toMatchObject({ state: 'blocked', createAttempted: false, createKey: original.createKey });
    const retry = f.claim(f.now + 1001, 'retry')[0]!; expect(retry.previouslyAttempted).toBe(false); expect(retry.intent.createKey).toBe(original.createKey);
    rejects(() => f.integration('defer', { id: retry.id, nonce: retry.nonce, claimGeneration: retry.claimGeneration, now: f.now + 1001, retryAt: f.now + 2002, code: 'JOBS_OUTCOME_UNKNOWN', unknown: true, notCommitted: true }), 'CALENDAR_STATE_INVALID');
  } finally { f.close(); }
});

test('fresh pending intents use their trusted writer time and cannot continually jump an older eligible retry in the same ready partition', () => {
  const f = fixture(); try {
    f.install(); f.appointment('older'); const original = f.claim()[0]!;
    f.integration('defer', { id: original.id, nonce: original.nonce, claimGeneration: original.claimGeneration, now: f.now,
      retryAt: f.now + 1000, code: 'JOBS_NOT_READY', notCommitted: true });
    for (let index = 0; index < 3; index++) {
      const current = f.now + 2000 + index * 2000; f.setNow(current); f.appointment('fresh-' + index, 600_000 + index * 60_000);
      const fresh = f.intent(); expect(f.rows('dispatch').find(row => row.id === fresh.id).next_attempt_ms).toBe(current);
      const selected = f.integration('claim', { now: current, nonce: 'fair-' + index, leaseMs: 1000, limit: 1 }) as CalendarIntegrationClaim[];
      expect(selected).toHaveLength(1); expect(selected[0]?.id).toBe(original.id);
      f.integration('defer', { id: original.id, nonce: selected[0]!.nonce, claimGeneration: selected[0]!.claimGeneration,
        now: current, retryAt: current + 1, code: 'JOBS_NOT_READY', notCommitted: true });
      const nextFresh = f.integration('claim', { now: current, nonce: 'drain-fresh-' + index, leaseMs: 1000, limit: 1 }) as CalendarIntegrationClaim[];
      expect(nextFresh[0]?.id).toBe(fresh.id); f.ack(nextFresh[0]!);
    }
  } finally { f.close(); }
});

test('cutoff can beat source Jobs acknowledgment; replay is evidence only and post-cutoff cancellation permits factual observation settlement', () => {
  const f = fixture(); try {
    f.install(); f.appointment(); const intent = f.intent();
    const body = { id: intent.id, executionId: 'workflow-execution', nonce: 'effect-nonce', registration: intent.registration, workflow: intent.policy.source.workflow };
    const admitted = f.integration('effect.admit', body); expect(admitted.admitted).toBe(true); expect(f.rows('receipts')).toHaveLength(0);
    f.command('appointment.cancel', { actor: f.actor, requestId: 'cancel-after-cutoff', id: 'appointment', expectedRevision: 1, confirmed: true });
    f.integration('policy.retire', { ruleId: 'observe', epoch: 1 });
    const replay = f.integration('effect.admit', { ...body, executionId: 'different-execution', nonce: 'different-nonce' });
    expect(replay).toEqual({ admitted: false, effect: admitted.effect });
    expect(f.integration('effect.settle', { id: intent.id, executionId: 'workflow-execution', nonce: 'effect-nonce', outcome: 'observed', now: f.now + 2 }).outcome).toBe('observed');
    expect(f.rows('effect_admissions')).toHaveLength(1); expect(f.rows('effect_outcomes')).toHaveLength(1);
  } finally { f.close(); }
});

test('cutoff rejects before due, past expiry, terminal effective lifecycle, wrong owner and forged registration/pin', () => {
  const f = fixture(); try {
    f.install(); f.appointment('future', 600_000); let current = f.intent();
    const admit = (extra: Record<string, unknown> = {}) => {
      const { now = f.now + 600_000, ...body } = extra; f.setNow(now as number);
      return f.integration('effect.admit', { id: current.id, executionId: 'execution', nonce: 'effect', registration: current.registration,
        workflow: current.policy.source.workflow, ...body });
    };
    rejects(() => admit({ now: f.now }), 'CALENDAR_POLICY_STALE'); rejects(() => admit({ now: f.now + 660_001 }), 'CALENDAR_POLICY_STALE');
    rejects(() => admit({ registration: { ...current.registration, generation: 999 } }), 'CALENDAR_POLICY_STALE');
    rejects(() => admit({ workflow: { ...current.policy.source.workflow, fingerprint: '0'.repeat(64) } }), 'CALENDAR_POLICY_STALE');
    rejects(() => admit({ expectedOwnerId: 'wrong-owner' }), 'CALENDAR_STATE_INVALID');
    f.command('lifecycle.replace', { actor: f.actor, requestId: 'extended', expectedRevision: 1, extended: true, cancellationReason: 'optional', noShowReason: 'optional' });
    f.command('appointment.transition', { actor: f.actor, requestId: 'completed', id: 'future', expectedRevision: 1, status: 'completed', policyRevision: 2 });
    rejects(() => admit(), 'CALENDAR_POLICY_STALE'); expect(f.rows('effect_admissions')).toHaveLength(0);
  } finally { f.close(); }
});

test('source evidence is immutable and no-replace guards survive recursive_triggers off; dispatch cannot revive or forge acceptance', () => {
  const f = fixture(); try {
    f.install(); f.appointment(); const claim = f.claim()[0]!; f.ack(claim); const id = claim.id;
    f.raw.run('PRAGMA recursive_triggers=OFF');
    for (const table of ['policy_history', 'policy_registrations', 'intents', 'receipts']) {
      const name = '_calendar_integration_' + table;
      expect(() => f.raw.run(`UPDATE ${name} SET id=id`)).toThrow(); expect(() => f.raw.run(`DELETE FROM ${name}`)).toThrow();
      expect(() => f.raw.run(`INSERT OR REPLACE INTO ${name} SELECT * FROM ${name}`)).toThrow();
    }
    f.command('appointment.cancel', { actor: f.actor, requestId: 'cancel', id: 'appointment', expectedRevision: 1, confirmed: true });
    expect(() => f.raw.run("UPDATE _calendar_integration_dispatch SET eligibility='current' WHERE id=?", [id])).toThrow();
    expect(() => f.raw.run("UPDATE _calendar_integration_dispatch SET state='cancelled' WHERE id=?", [id])).toThrow();
    expect(() => f.raw.run("UPDATE _calendar_integration_policy_current SET state='active' WHERE id='observe'")).toThrow();
  } finally { f.close(); }
});

test('ready, expired-claim and retirement probes use bounded equality/range indexes without retained-history sorts', () => {
  const f = fixture(); try {
    for (const [sql, index] of [
      ["SELECT id FROM _calendar_integration_dispatch WHERE scope_id='application' AND claim_nonce IS NULL AND state='pending' AND next_attempt_ms<=1 ORDER BY next_attempt_ms,id LIMIT 100", 'calendar_integration_ready'],
      ["SELECT id FROM _calendar_integration_dispatch WHERE scope_id='application' AND claim_nonce IS NOT NULL AND claim_until_ms<=1 ORDER BY claim_until_ms,id LIMIT 100", 'calendar_integration_expired_claim'],
      ["SELECT id FROM _calendar_integration_dispatch WHERE scope_id='application' AND rule_id='observe' AND state='accepted' AND claim_nonce IS NULL AND blocked_code IS NULL AND policy_epoch<2 ORDER BY policy_epoch,next_attempt_ms,id LIMIT 100", 'calendar_integration_retired_policy'],
    ]) {
      const plan = JSON.stringify(f.raw.query('EXPLAIN QUERY PLAN ' + sql).all()); expect(plan).toContain(index); expect(plan).not.toContain('SCAN '); expect(plan).not.toContain('TEMP B-TREE');
    }
  } finally { f.close(); }
});

test('four-digit Jobs due boundary and maximal lateness retain exact expiry; expanded unsupported due fails before appointment commit', () => {
  const f = fixture(); try {
    const policy = { ...f.policy(), maxLatenessMs: CALENDAR_INTEGRATION_LIMITS.horizonMs };
    f.integration('policy.install', { policy, expectedEpoch: 0, now: f.now });
    f.integration('policy.activate', { ruleId: policy.ruleId, epoch: 1, registration: f.registration(policy) });
    const due = CALENDAR_INTEGRATION_MAX_DUE_MS;
    f.command('appointment.create', { actor: f.actor, id: 'last-due', requestId: 'last-due', resourceIds: ['resource'], title: 'Opaque',
      startAt: new Date(due + 60_000).toISOString(), endAt: new Date(due + 120_000).toISOString(), timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    const intent = f.intent(); expect(intent.at).toBe('9999-12-31T23:59:59.999Z'); expect(intent.maxLatenessMs).toBe(CALENDAR_INTEGRATION_LIMITS.horizonMs);
    f.ack(f.claim()[0]!); expect(f.rows('dispatch')[0].next_attempt_ms).toBe(due + CALENDAR_INTEGRATION_LIMITS.horizonMs + 1);
    rejects(() => f.command('appointment.create', { actor: f.actor, id: 'expanded-due', requestId: 'expanded-due', resourceIds: ['resource'], title: 'Opaque',
      startAt: new Date(8_640_000_000_000_000 - 120_000).toISOString(), endAt: new Date(8_640_000_000_000_000 - 60_000).toISOString(), timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }), 'CALENDAR_INPUT_INVALID');
    expect(f.db.get('calendar_appointments', 'expanded-due')).toBeNull(); expect(f.rows('intents')).toHaveLength(1);
  } finally { f.close(); }
});

test('installed integration and transactional semantic audit coexist without false human business facts from controls, claims or receipt replay', () => {
  const f = fixture(true); try {
    f.install(); f.appointment(); f.appointment();
    f.command('appointment.reschedule', { actor: f.actor, requestId: 'audit-noop', id: 'appointment', expectedRevision: 1, ...f.interval() });
    f.ack(f.claim()[0]!);
    const move = { actor: f.actor, requestId: 'audit-move', id: 'appointment', expectedRevision: 1, ...f.interval(600_000) };
    f.command('appointment.reschedule', move); f.command('appointment.reschedule', move);
    f.command('appointment.reschedule', { ...move, requestId: 'audit-move-noop', expectedRevision: 2 });
    for (const claim of f.claim(f.now, 'after-move')) f.ack(claim, claim.intent.eligibility === 'current' ? 'create' : 'cancel');
    f.install('B', 1);
    for (const claim of f.claim(f.now, 'after-policy')) f.ack(claim, 'cancel');
    f.integration('policy.retire', { ruleId: 'observe', epoch: 2 });
    const cancel = { actor: f.actor, requestId: 'audit-cancel', id: 'appointment', expectedRevision: 2, confirmed: true };
    f.command('appointment.cancel', cancel); f.command('appointment.cancel', cancel);
    const page = f.source!.control({}), events = page.rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['calendar.resource.created', 'calendar.appointment.created', 'calendar.appointment.rescheduled', 'calendar.appointment.cancelled']);
    expect(new Set(events.map(event => event.id)).size).toBe(4);
    expect(events.every(event => event.family === 'workflow' && event.evidence === 'server-confirmed' && event.outcome === 'succeeded'
      && event.scope.kind === 'application' && event.scope.tenantId === null && event.actor.kind === 'user' && event.actor.id === f.actor.userId)).toBe(true);
    expect(events.every(event => Object.keys(event.metadata).every(key => ['sequence', 'revision', 'resourceCount', 'status'].includes(key)))).toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('PRIVATE_'); expect(serialized).not.toContain(f.interval().startAt); expect(serialized).not.toContain(f.interval().endAt);
    expect(events.some(event => event.action.startsWith('record.') || event.action.startsWith('calendar.integration.'))).toBe(false);
    expect(f.rows('receipts')).toHaveLength(4); expect(page.queued).toBe(4);
  } finally { f.close(); }
});

test('late integration admission failure atomically rolls back business mutation and semantic source/outbox/context accounting', () => {
  const f = fixture(true); try {
    f.install();
    const tables = ['_zero_logging_source', '_zero_logging_outbox', '_zero_logging_contexts', '_calendar_usage'];
    const snapshot = () => Object.fromEntries(tables.map(name => [name, f.raw.query('SELECT * FROM ' + name + ' ORDER BY rowid').all()]));
    const before = snapshot(), page = f.source!.control({}), seq = f.db.currentSeq;
    expect(page.rows.map(row => row.event.action)).toEqual(['calendar.resource.created']);
    f.raw.run("CREATE TRIGGER synthetic_late_integration_failure BEFORE INSERT ON _calendar_integration_intents BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    expect(() => f.appointment()).toThrow();
    expect(snapshot()).toEqual(before); expect(f.source!.control({})).toEqual(page); expect(f.db.currentSeq).toBe(seq);
    expect(f.db.get('calendar_appointments', 'appointment')).toBeNull(); expect(f.db.list('_calendar_reservations')).toEqual([]);
    expect(f.db.list('_calendar_receipts')).toHaveLength(1); expect(f.db.list('_calendar_effect_intents')).toHaveLength(1);
    expect(f.rows('intents')).toEqual([]); expect(f.rows('dispatch')).toEqual([]);
    f.raw.run('DROP TRIGGER synthetic_late_integration_failure');
    f.appointment(); f.appointment();
    const final = f.source!.control({});
    expect(final.queued).toBe(2); expect(final.rows.map(row => row.event.action)).toEqual(['calendar.resource.created', 'calendar.appointment.created']);
    expect(f.rows('intents')).toHaveLength(1); expect(f.rows('dispatch')).toHaveLength(1);
  } finally { f.close(); }
});
