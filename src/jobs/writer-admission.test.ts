/** Native final-writer and actual Jobs/Torrent tests; all storage is MEMORY. */
import { expect, test } from 'bun:test';
import { DatabaseError } from '../databases/database-error';
import { normalizeJobsCapacityPolicy, DEFAULT_JOBS_CAPACITY_POLICY } from './capacity-policy';
import { memoryJobsWriterFixture } from './test-support/memory-writer-fixture';
import { capacityContract, capacityIdentity, capacityNow, capacityDue, capacitySeal } from './test-support/memory-capacity-fixture';
import { jobOccurrenceId } from './model';
import { readJobSettlementSnapshot } from './settlement-model';
import { memorySourceJobsFixture, untilMemoryJobs } from './test-support/memory-source-fixture';
import { DatabaseWriterOperationEngine } from '../databases/database-writer-engine';
import { jobsRealm } from './realm';
import { jobCapacityPolicyData } from './capacity-policy';
import { CoordinatorLease } from '../databases/database-coordinator-capability';
import { inspectJobSourceCapacity } from './capacity-projection';
import type { JobSourceCapacityRows } from './source-model';
import { JobsError } from './error';

function setup(limit = 9) {
  const f = memoryJobsWriterFixture({ transport: { keyLimit: limit } });
  try {
    f.command('jobs.owner.bind', { ownerId: 'synthetic-native-owner', scopeId: 'application' });
    const source = f.command('jobs.source.register', { contract: capacityContract, expectedRevision: 0, requestId: 'register', now: capacityNow });
    const admission = { id: 'one', scopeId: 'application', actorId: null, principal: null, runAs: 'service', definition: capacityContract.definition.name,
      definitionVersion: '1', definitionHash: capacityContract.definition.fingerprint, source: { id: source.id, generation: 1, policyHash: source.policyHash },
      workflow: capacityContract.workflow, input: { synthetic: true }, timing: { kind: 'once', at: new Date(capacityDue).toISOString(), maxLatenessMs: 60000 }, overlap: 'skip' };
    f.command('jobs.source.schedule.create', { identity: capacityIdentity, requestId: 'create', admission, seal: capacitySeal, now: capacityNow });
    f.command('jobs.materialize', { scopeId: 'application', id: 'one', expectedRevision: 1, now: capacityDue });
    const id = jobOccurrenceId('one', 1, capacityDue);
    f.command('jobs.claim', { scopeId: 'application', id, nonce: 'claim-one', leaseMs: 1000, now: capacityDue });
    const receipt = { instanceId: 'synthetic-native-instance', name: capacityContract.workflow.name, definitionVersion: 1, createdAt: new Date(capacityDue).toISOString() };
    return { ...f, id, source, admission, receipt, inspect: () => f.engine.inspectAdmission() };
  } catch (error) { f.close(); throw error; }
}

test('finite policy preserves defaults, rejects unbounded/callback policy, and detaches partial overrides', () => {
  expect(normalizeJobsCapacityPolicy()).toEqual(DEFAULT_JOBS_CAPACITY_POLICY);
  const input = { retained: { schedules: 20000 }, transport: { keyLimit: 100 } }, policy = normalizeJobsCapacityPolicy(input);
  input.retained.schedules = 1;
  expect(policy.retained.schedules).toBe(20000); expect(policy.retained.occurrences).toBe(100000);
  expect(Object.isFrozen(policy.retained)).toBe(true);
  for (const invalid of [null, { retained: null }, { transport: null }, { retained: { schedules: null } }, { transport: { keyLimit: null } },
    { transport: { keyLimit: 1000001 } }, { transport: { keyLimit: Infinity } }, { retained: { intents: 0 } },
    { retained: { schedules: Number.MAX_SAFE_INTEGER + 1 } }, { retained: { schedules() {} } }, { unsafe: true }]) {
    expect(() => normalizeJobsCapacityPolicy(invalid)).toThrow();
  }
});

test('exact native key boundary rejects fresh materialization/reclaim/defer without spending factual reserve', () => {
  const f = setup();
  try {
    expect(f.inspect().admission).toMatchObject({ ordinaryRemaining: 0, settlementUnits: 4, keyLimit: 9, deficit: 0 });
    const before = f.inspect();
    for (let n = 0; n < 4; n++) {
      expect(() => f.command('jobs.claim', { scopeId: 'application', id: f.id, nonce: 'retry-' + n, leaseMs: 1000, now: capacityDue + 2000 })).toThrow();
      expect(() => f.command('jobs.claim.defer', { scopeId: 'application', id: f.id, nonce: 'claim-one', leaseGeneration: 1, now: capacityDue })).toThrow();
      expect(() => f.command('jobs.materialize', { scopeId: 'application', id: 'one', expectedRevision: 1, now: capacityDue })).toThrow();
    }
    expect(f.inspect()).toEqual(before); expect(f.db.get('_jobs_occurrences', f.id)).toMatchObject({ state: 'claimed', lease_generation: 1 });
  } finally { f.close(); }
});

test('expired normal lease stays fenced; exact original accepted fact reconciles and terminal observation conserve reserved keys', () => {
  const f = setup();
  try {
    const input = { scopeId: 'application', id: f.id, nonce: 'claim-one', leaseGeneration: 1, receipt: f.receipt, now: capacityDue + 2000 };
    expect(() => f.command('jobs.dispatch', input)).toThrow();
    expect(() => f.command('jobs.dispatch.reconcile', { ...input, nonce: 'wrong-claim' })).toThrow();
    expect(() => f.command('jobs.dispatch.reconcile', { ...input, receipt: { ...f.receipt, name: 'other.workflow' } })).toThrow();
    expect(f.inspect().receipts.totalKeys).toBe(5);
    f.command('jobs.dispatch.reconcile', input, 'original-factual-handoff');
    expect(f.inspect().admission).toMatchObject({ ordinaryRemaining: 0, settlementUnits: 3 });
    const terminal = { scopeId: 'application', id: f.id, instanceId: f.receipt.instanceId, status: 'completed', now: capacityDue + 3000 };
    f.command('jobs.complete', terminal, 'original-terminal-fact');
    expect(f.inspect().admission).toMatchObject({ ordinaryRemaining: 1, settlementUnits: 1 });
    expect(f.db.get('_jobs_schedule_work', 'one')).toMatchObject({ occupied: 0 });
    f.command('jobs.owner.bind', { ownerId: 'synthetic-native-owner', scopeId: 'application' });
    const before = f.inspect();
    expect(() => f.command('jobs.complete', terminal)).toThrow();
    expect(f.command<{ completed: true }>('jobs.complete', terminal, 'original-terminal-fact')).toEqual({ completed: true });
    expect(f.inspect()).toEqual(before);
    expect(f.db.list('_jobs_source_intents')).toHaveLength(2); expect(f.db.list('_jobs_admissions')).toHaveLength(1);
  } finally { f.close(); }
});

test('final authority failure rolls back native domain, obligation, semantic and receipt state together', () => {
  const f = setup();
  try {
    const before = f.inspect(), sequence = f.db.currentSeq;
    expect(() => f.engine.execute({ type: 'command', name: 'jobs.dispatch.reconcile', idempotencyKey: 'late-fenced-fact', input: {
      scopeId: 'application', id: f.id, nonce: 'claim-one', leaseGeneration: 1, receipt: f.receipt, now: capacityDue + 2000,
    } }, undefined, () => { throw new DatabaseError('DATABASE_AUTHORITY_CHANGED', 'Synthetic final authority fence.', { outcome: 'not-committed' }); })).toThrow();
    expect(f.inspect()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
    expect(f.db.get('_jobs_occurrences', f.id)?.state).toBe('claimed');
    expect(readJobSettlementSnapshot(f.db).transportUnits).toBe(4);
  } finally { f.close(); }
});

test('native logical source-control reserve refuses new obligations and new-key no-op reserve spending', () => {
  const f = memoryJobsWriterFixture({ retained: { sourceRecoveryIntents: 2 } });
  try {
    f.command('jobs.owner.bind', { ownerId: 'synthetic-native-owner', scopeId: 'application' });
    const source = f.command('jobs.source.register', { contract: capacityContract, expectedRevision: 0, requestId: 'register', now: capacityNow });
    const admission = { id: 'one', scopeId: 'application', actorId: null, principal: null, runAs: 'service', definition: capacityContract.definition.name,
      definitionVersion: '1', definitionHash: capacityContract.definition.fingerprint, source: { id: source.id, generation: 1, policyHash: source.policyHash },
      workflow: capacityContract.workflow, input: {}, timing: { kind: 'once', at: new Date(capacityDue).toISOString(), maxLatenessMs: 60000 }, overlap: 'skip' };
    const create = (id: string) => f.command('jobs.source.schedule.create', { identity: capacityIdentity, requestId: 'create-' + id, admission: { ...admission, id }, seal: capacitySeal, now: capacityNow });
    create('one'); const before = f.engine.receiptRetentionCounts().totalKeys;
    expect(() => create('two')).toThrow(); expect(f.engine.receiptRetentionCounts().totalKeys).toBe(before);
    f.command('jobs.source.schedule.change', { identity: capacityIdentity, requestId: 'cancel', id: 'one', expectedRevision: 1, action: 'cancel', now: capacityNow });
    f.command('jobs.source.retire', { identity: capacityIdentity, requestId: 'retire', expectedRevision: 1, now: capacityNow });
    expect(f.db.get('_jobs_usage', 'sourceRecoveryIntents')?.count).toBe(2);
    // A new-key metadata no-op uses ordinary logical receipts, never the full reserve.
    f.command('jobs.source.retire', { identity: capacityIdentity, requestId: 'retire-again', expectedRevision: 2, now: capacityNow });
    expect(f.db.get('_jobs_usage', 'sourceRecoveryIntents')?.count).toBe(2);
    expect(f.db.get('_jobs_usage', 'intents')?.count).toBe(3);
  } finally { f.close(); }
});

test('actual native private lease capacity facade requires current binding policy, fences both sides of its wait and never spends a key', async () => {
  const f = setup(); let current = true, checks = 0;
  const check = () => { checks++; if (!current) throw new Error('Synthetic source authority retired.'); };
  const lease = new CoordinatorLease({ assertTenantSyncAuthority() { check(); return undefined; },
    inspectWriterAdmission: async () => f.engine.inspectAdmission(), releaseEntry() {} } as never, {} as never, null);
  try {
    const value = f.engine.execute({ type: 'query', name: 'jobs.source.capacity', input: { identity: capacityIdentity } }).value as unknown as { ok: true; value: JobSourceCapacityRows };
    const before = f.engine.inspectAdmission();
    const projected = await inspectJobSourceCapacity(lease, value.value, f.engine.writerPolicyFingerprint!, check);
    expect(projected).toMatchObject({ version: 3, transport: { ordinaryRemaining: 0, settlementUnits: 4, keyLimit: 9 } });
    expect(checks).toBe(4); expect(f.engine.inspectAdmission()).toEqual(before);
    expect(JSON.stringify(projected)).not.toContain('SYNTHETIC_CAPACITY_SEAL');
    await expect(inspectJobSourceCapacity(lease, value.value, '0'.repeat(64), check)).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
    const pending = inspectJobSourceCapacity(lease, value.value, f.engine.writerPolicyFingerprint!, check); current = false;
    await expect(pending).rejects.toThrow('Synthetic source authority retired.');
    expect(f.engine.inspectAdmission()).toEqual(before);
  } finally { lease.release(); f.close(); }
});

test('actor pause/cancel use finite logical recovery reserve while unknown handoff remains occupied', () => {
  const f = memoryJobsWriterFixture({ retained: { intents: 1, actorRecoveryIntents: 2 } });
  try {
    f.command('jobs.owner.bind', { scopeId: 'application', ownerId: 'synthetic-actor-owner' });
    const actor = { scopeId: 'application', userId: 'synthetic-user', principal: 'synthetic-principal', manageAll: false };
    const admission = { id: 'actor-one', scopeId: 'application', actorId: actor.userId, principal: actor.principal, runAs: 'actor',
      definition: capacityContract.definition.name, definitionVersion: '1', definitionHash: capacityContract.definition.fingerprint,
      workflow: capacityContract.workflow, input: {}, timing: { kind: 'once', at: new Date(capacityDue).toISOString(), maxLatenessMs: 60000 }, overlap: 'skip' };
    f.command('jobs.schedule.create', { actor, requestId: 'actor-create', admission, seal: capacitySeal, now: capacityNow });
    f.command('jobs.materialize', { scopeId: 'application', id: admission.id, expectedRevision: 1, now: capacityDue });
    const id = jobOccurrenceId(admission.id, 1, capacityDue);
    f.command('jobs.claim', { scopeId: 'application', id, nonce: 'actor-unknown', leaseMs: 1000, now: capacityDue });
    expect(readJobSettlementSnapshot(f.db)).toEqual({ actorControlUnits: 2, sourceControlUnits: 0, transportUnits: 4 });
    f.command('jobs.schedule.change', { actor, requestId: 'pause', id: admission.id, expectedRevision: 1, action: 'pause', now: capacityDue });
    expect(f.db.get('_jobs_usage', 'actorRecoveryIntents')?.count).toBe(1);
    f.command('jobs.schedule.change', { actor, requestId: 'cancel', id: admission.id, expectedRevision: 2, action: 'cancel', now: capacityDue });
    expect(f.db.get('_jobs_usage', 'actorRecoveryIntents')?.count).toBe(2); expect(f.db.get('_jobs_usage', 'intents')?.count).toBe(1);
    expect(readJobSettlementSnapshot(f.db)).toEqual({ actorControlUnits: 0, sourceControlUnits: 0, transportUnits: 2 });
    expect(f.db.get('_jobs_schedule_work', admission.id)?.occupied).toBe(1); expect(f.db.get('_jobs_occurrences', id)?.state).toBe('claimed');
  } finally { f.close(); }
});

test('retained history ceiling remains enforced after working closure; explicit rebind changes only configured finite budget', () => {
  const f = setup(100); let rebound: DatabaseWriterOperationEngine | undefined;
  try {
    f.command('jobs.dispatch', { scopeId: 'application', id: f.id, nonce: 'claim-one', leaseGeneration: 1, receipt: f.receipt, now: capacityDue });
    f.command('jobs.complete', { scopeId: 'application', id: f.id, instanceId: f.receipt.instanceId, status: 'completed', now: capacityDue });
    f.engine.close();
    rebound = new DatabaseWriterOperationEngine({ runtime: f.runtime, realm: jobsRealm, writerPolicy: jobCapacityPolicyData(normalizeJobsCapacityPolicy({ retained: { schedules: 1 }, transport: { keyLimit: 100 } })) });
    const create = { type: 'command', name: 'jobs.source.schedule.create', input: { identity: capacityIdentity, requestId: 'create-two',
      admission: { ...f.admission, id: 'two' }, seal: capacitySeal, now: capacityNow }, idempotencyKey: 'new-retained-two' };
    const before = rebound.receiptRetentionCounts(); expect(() => rebound!.execute(create)).toThrow();
    expect(rebound.receiptRetentionCounts()).toEqual(before); expect(f.db.get('_jobs_work_usage', 'schedules')?.count).toBe(0);
    expect(f.db.get('_jobs_usage', 'schedules')?.count).toBe(1); expect(f.db.list('_jobs_source_intents')).toHaveLength(2);
    rebound.close();
    rebound = new DatabaseWriterOperationEngine({ runtime: f.runtime, realm: jobsRealm, writerPolicy: jobCapacityPolicyData(normalizeJobsCapacityPolicy({ retained: { schedules: 2 }, transport: { keyLimit: 100 } })) });
    expect(rebound.execute(create)).toHaveProperty('idempotencyKey', 'new-retained-two');
    expect(f.db.get('_jobs_usage', 'schedules')?.count).toBe(2); expect(f.db.list('job_schedules')).toHaveLength(2);
    expect(f.db.get('_jobs_occurrences', f.id)?.state).toBe('terminal');
  } finally { try { rebound?.close(); } finally { f.close(); } }
});

test('legacy reservation deficit exposes finite pressure, denies fresh work and allows deficit-nonincreasing immutable facts', () => {
  const f = setup(100); let recovery: DatabaseWriterOperationEngine | undefined;
  try {
    f.engine.close();
    recovery = new DatabaseWriterOperationEngine({ runtime: f.runtime, realm: jobsRealm, writerPolicy: jobCapacityPolicyData(normalizeJobsCapacityPolicy({ transport: { keyLimit: 8 } })) });
    expect(recovery.inspectAdmission().admission).toMatchObject({ deficit: 1, ordinaryRemaining: 0, settlementRemaining: 3 });
    expect(() => recovery!.execute({ type: 'command', name: 'jobs.claim', idempotencyKey: 'no-legacy-new-claim', input: {
      scopeId: 'application', id: f.id, nonce: 'new-claim', leaseMs: 1000, now: capacityDue + 2000 } })).toThrow();
    recovery.execute({ type: 'command', name: 'jobs.dispatch.reconcile', idempotencyKey: 'legacy-fact', input: {
      scopeId: 'application', id: f.id, nonce: 'claim-one', leaseGeneration: 1, receipt: f.receipt, now: capacityDue + 2000 } });
    expect(recovery.inspectAdmission().admission).toMatchObject({ deficit: 1, settlementUnits: 3 });
    recovery.execute({ type: 'command', name: 'jobs.complete', idempotencyKey: 'legacy-terminal', input: {
      scopeId: 'application', id: f.id, instanceId: f.receipt.instanceId, status: 'completed', now: capacityDue + 2000 } });
    expect(recovery.inspectAdmission().admission).toMatchObject({ deficit: 0, settlementUnits: 1, ordinaryRemaining: 0 });
  } finally { try { recovery?.close(); } finally { f.close(); } }
});

test('a lowered logical control budget cannot block immutable handoff/terminal evidence that does not increase its deficit', () => {
  const f = setup(100); let recovery: DatabaseWriterOperationEngine | undefined;
  try {
    f.engine.close(); recovery = new DatabaseWriterOperationEngine({ runtime: f.runtime, realm: jobsRealm,
      writerPolicy: jobCapacityPolicyData(normalizeJobsCapacityPolicy({ retained: { sourceRecoveryIntents: 1 } })) });
    expect(() => recovery!.execute({ type: 'command', name: 'jobs.claim', idempotencyKey: 'no-logical-deficit-retry', input: {
      scopeId: 'application', id: f.id, nonce: 'retry', leaseMs: 1000, now: capacityDue + 2000 } })).toThrow();
    recovery.execute({ type: 'command', name: 'jobs.dispatch.reconcile', idempotencyKey: 'logical-deficit-fact', input: {
      scopeId: 'application', id: f.id, nonce: 'claim-one', leaseGeneration: 1, receipt: f.receipt, now: capacityDue + 2000 } });
    recovery.execute({ type: 'command', name: 'jobs.complete', idempotencyKey: 'logical-deficit-terminal', input: {
      scopeId: 'application', id: f.id, instanceId: f.receipt.instanceId, status: 'completed', now: capacityDue + 2000 } });
    expect(f.db.get('_jobs_occurrences', f.id)?.state).toBe('terminal');
    expect(readJobSettlementSnapshot(f.db).sourceControlUnits).toBe(1);
  } finally { try { recovery?.close(); } finally { f.close(); } }
});

test('only the separate known-pending closure command can use pressure headroom; blocked review stays conservative', () => {
  const f = setup(100); let recovery: DatabaseWriterOperationEngine | undefined;
  try {
    f.command('jobs.block', { scopeId: 'application', id: f.id, nonce: 'claim-one', leaseGeneration: 1, code: 'JOBS_NOT_DISPATCHED', now: capacityDue });
    expect(readJobSettlementSnapshot(f.db).transportUnits).toBe(4);
    f.engine.close(); recovery = new DatabaseWriterOperationEngine({ runtime: f.runtime, realm: jobsRealm,
      writerPolicy: jobCapacityPolicyData(normalizeJobsCapacityPolicy({ transport: { keyLimit: 10 } })) });
    expect(recovery.inspectAdmission().admission).toMatchObject({ ordinaryRemaining: 0, settlementUnits: 4 });
    expect(() => recovery!.execute({ type: 'command', name: 'jobs.pending.close', idempotencyKey: 'not-a-pending-proof', input: {
      scopeId: 'application', id: f.id, generation: 1, now: capacityDue + 70000 } })).toThrow();
    expect(f.db.get('_jobs_schedule_work', 'one')?.occupied).toBe(1); expect(readJobSettlementSnapshot(f.db).transportUnits).toBe(4);
  } finally { try { recovery?.close(); } finally { f.close(); } }
});

test('actual native writer, Jobs runner and sealed Torrent complete and expose non-mutating capacity v3', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true, capacity: { transport: { keyLimit: 20 } } });
  try {
    const source = f.source(); await source.api.registration.activate({ expectedRevision: 0, idempotencyKey: 'register-native', pinInput: { synthetic: true } });
    const scheduledAt = f.now() + 1000;
    const created = await source.api.schedules.create({ input: { synthetic: true }, at: new Date(scheduledAt).toISOString() }, { idempotencyKey: 'create-native' });
    const native = f.native(source.scope)!; const keysBeforeRead = native.engine.receiptRetentionCounts().totalKeys;
    const capacity = await source.api.capacity.get();
    expect(capacity).toMatchObject({ version: 3, transport: { keyLimit: 20, settlementUnits: 2 }, retained: { file: { actorRecoveryIntents: { used: 0, limit: 20000 } } } });
    expect(native.engine.receiptRetentionCounts().totalKeys).toBe(keysBeforeRead);
    f.advance(1000); await f.tick(); await untilMemoryJobs(() => ['dispatched', 'terminal'].includes(String(f.rows(source.scope, '_jobs_occurrences')[0]?.state)));
    await untilMemoryJobs(() => f.workflows.getInstance(f.rows(source.scope, '_jobs_occurrences')[0]!.workflow_id as string, source.scope)?.status === 'completed');
    f.advance(1001); await f.tick();
    expect(f.rows(source.scope, '_jobs_occurrences')[0]?.state).toBe('terminal');
    expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(0);
    expect(await source.api.receipts.get('create-native')).toEqual(created);
    expect(await source.api.executions.get(created.id, { generation: 1, scheduledAt })).toMatchObject({ status: 'completed' });
  } finally { await f.close(); }
});

test('native runner inspects original Torrent acceptance at pressure before any expired-lease recovery claim', async () => {
  let rejectDispatch = true;
  const f = await memorySourceJobsFixture({ nativeWriter: true, capacity: { transport: { keyLimit: 9 } },
    beforeWrite(operation) { if (operation.name === 'jobs.dispatch' && rejectDispatch) { rejectDispatch = false; throw new JobsError('JOBS_OUTCOME_UNKNOWN'); } } });
  try {
    const source = f.source(); await source.api.registration.activate({ expectedRevision: 0, idempotencyKey: 'register-pressure', pinInput: {} });
    const scheduledAt = f.now() + 1000;
    const created = await source.api.schedules.create({ input: {}, at: new Date(scheduledAt).toISOString() }, { idempotencyKey: 'create-pressure' });
    f.advance(1000); await f.tick();
    expect(f.rows(source.scope, '_jobs_occurrences')[0]?.state).toBe('claimed');
    const fact = await source.api.executions.get(created.id, { generation: 1, scheduledAt });
    expect(fact).not.toBeNull(); await untilMemoryJobs(() => f.workflows.getInstance(fact!.instanceId, source.scope)?.status === 'completed');
    expect((await source.api.capacity.get())!.transport).toMatchObject({ ordinaryRemaining: 0, settlementUnits: 4, permanentKeys: 5 });
    source.retireEligibility(); f.advance(61001); await f.tick();
    expect(f.rows(source.scope, '_jobs_occurrences')[0]?.state).toBe('terminal');
    expect(f.commands.filter(operation => operation.name === 'jobs.claim')).toHaveLength(1);
    expect(f.commands.filter(operation => operation.name === 'jobs.dispatch.reconcile')).toHaveLength(1);
    expect(f.calls).toHaveLength(1); expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(0);
  } finally { await f.close(); }
});

test('native pressure retry cannot drain unknown settlement reserve or reinterpret missing receipt as absence', async () => {
  let loseClaimReply = true;
  const f = await memorySourceJobsFixture({ nativeWriter: true, capacity: { transport: { keyLimit: 9 } },
    afterWrite(operation) { if (operation.name === 'jobs.claim' && loseClaimReply) { loseClaimReply = false; throw new Error('Synthetic committed claim reply lost.'); } } });
  try {
    const source = f.source(); await source.api.registration.activate({ expectedRevision: 0, idempotencyKey: 'register-unknown', pinInput: {} });
    const scheduledAt = f.now() + 1000;
    const created = await source.api.schedules.create({ input: {}, at: new Date(scheduledAt).toISOString() }, { idempotencyKey: 'create-unknown' });
    f.advance(1000); await f.tick(); const native = f.native(source.scope)!;
    const before = native.engine.inspectAdmission(); expect(before.admission).toMatchObject({ ordinaryRemaining: 0, settlementUnits: 4 });
    for (let n = 0; n < 5; n++) { f.advance(61001); await f.tick(); }
    expect(native.engine.inspectAdmission()).toEqual(before); expect(f.calls).toHaveLength(0);
    expect(f.rows(source.scope, '_jobs_occurrences')[0]).toMatchObject({ state: 'claimed', lease_generation: 1 });
    expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(1);
    expect(await source.api.executions.get(created.id, { generation: 1, scheduledAt })).toBeNull();
    expect(native.engine.inspectAdmission()).toEqual(before);
  } finally { await f.close(); }
});

test('native known-pending expiry closes using owed settlement headroom without a fresh claim or Torrent effect', async () => {
  const f = await memorySourceJobsFixture({ nativeWriter: true, capacity: { transport: { keyLimit: 8 } } });
  try {
    const source = f.source(); await source.api.registration.activate({ expectedRevision: 0, idempotencyKey: 'register-pending', pinInput: {} });
    await source.api.schedules.create({ input: {}, at: new Date(f.now() + 1000).toISOString(), maxLatenessMs: 1000 }, { idempotencyKey: 'create-pending' });
    f.advance(1000); await f.tick();
    expect(f.rows(source.scope, '_jobs_occurrences')[0]?.state).toBe('pending');
    expect((await source.api.capacity.get())!.transport).toMatchObject({ ordinaryRemaining: 0, settlementUnits: 4, permanentKeys: 4 });
    f.advance(5001); await f.tick();
    expect(f.rows(source.scope, '_jobs_occurrences')[0]).toMatchObject({ state: 'terminal', terminal_status: 'expired' });
    expect(f.commands.filter(operation => operation.name === 'jobs.claim')).toHaveLength(0);
    expect(f.commands.filter(operation => operation.name === 'jobs.pending.close')).toHaveLength(1);
    expect(f.calls).toHaveLength(0); expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(0);
  } finally { await f.close(); }
});
