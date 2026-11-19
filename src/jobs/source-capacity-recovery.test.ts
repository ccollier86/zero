/** Native broker/realm/Torrent in memory only. No file fixture, actor, build or generated output. */
import { expect, test } from 'bun:test';
import type { SQLQueryBindings } from 'bun:sqlite';
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { readSourceJobCapacity } from './realm-source-queries';
import { JOB_LIMITS } from './realm-model';
import { JOB_WORK_LIMITS } from './realm-capacity';
import { JOB_SOURCE_LIMITS, JOB_SOURCE_RECOVERY_INTENTS_LIMIT, sourceIntentId } from './source-realm-model';
import type { TrustedJobSource } from './source-authority';
import { jobSourceId, type JobSourceIdentity, type JobSourceRegistration, type JobSourceScheduleReceipt } from './source-model';
import { jobHash, jobJson } from './validation';
import { memorySourceJobsFixture, untilMemoryJobs } from './test-support/memory-source-fixture';

const activate = { expectedRevision: 0, idempotencyKey: 'capacity-register', pinInput: { value: 'PRIVATE_CAPACITY_INPUT' } };
type Fixture = Awaited<ReturnType<typeof memorySourceJobsFixture>>;
type Source = ReturnType<Fixture['source']>;
function accounting(f: Fixture, source: Source, key: string, count: number): void {
  const db = f.plane(source.scope);
  if (!db) throw new Error('Synthetic memory plane must already exist.');
  if (db.get('_jobs_usage', key)) db.update('_jobs_usage', key, { count });
  else db.createStrict('_jobs_usage', { id: key, count });
}
function usage(f: Fixture, source: Source, key: string): unknown { return f.plane(source.scope)?.get('_jobs_usage', key)?.count; }
function once(f: Fixture) { return { input: { value: 'PRIVATE_CAPACITY_INPUT' }, at: new Date(f.now() + 5000).toISOString() }; }

test('ordinary receipt exhaustion preserves native cancel/retire headroom and exact original-key replay', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source(), registered = await source.api.registration.activate(activate);
    const first = await source.api.schedules.create(once(f), { idempotencyKey: 'first' });
    const second = await source.api.schedules.create(once(f), { idempotencyKey: 'second' });
    accounting(f, source, 'intents', JOB_LIMITS.intents);
    await expect(source.api.schedules.create(once(f), { idempotencyKey: 'blocked-create' })).rejects.toMatchObject({ code: 'JOBS_CAPACITY' });
    await expect(source.api.schedules.replace(first.id, once(f), { expectedRevision: 1, idempotencyKey: 'blocked-readmit' })).rejects.toMatchObject({ code: 'JOBS_CAPACITY' });
    await expect(source.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'blocked-register' })).rejects.toMatchObject({ code: 'JOBS_CAPACITY' });
    const replacement = f.source({ policyVersion: 'B' });
    await expect(replacement.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'blocked-policy' })).rejects.toMatchObject({ code: 'JOBS_CAPACITY' });
    expect(usage(f, source, 'intents')).toBe(JOB_LIMITS.intents); expect(usage(f, source, 'sourceRecoveryIntents')).toBeUndefined();
    expect(f.rows(source.scope, 'job_schedules')).toHaveLength(2); expect(f.rows(source.scope, '_jobs_admissions')).toHaveLength(2);
    expect(f.rows(source.scope, '_jobs_source_policies')).toHaveLength(1);
    const cancelOptions = { expectedRevision: 1, idempotencyKey: 'recover-cancel' };
    const cancelled = await source.api.schedules.cancel(first.id, cancelOptions);
    expect(cancelled).toMatchObject({ control: 'cancelled', revision: 2, generation: 1 });
    const retireOptions = { expectedRevision: 1, idempotencyKey: 'recover-retire' };
    const retired = await source.api.registration.retire(retireOptions); source.retireEligibility();
    expect(retired).toMatchObject({ state: 'retired', revision: 2, generation: 1 });
    expect(await source.api.schedules.cancel(first.id, cancelOptions)).toEqual(cancelled);
    expect(await source.api.registration.retire(retireOptions)).toEqual(retired);
    expect(await source.api.receipts.get(activate.idempotencyKey)).toEqual(registered);
    expect(await source.api.receipts.get('first')).toEqual(first);
    expect(await source.api.registration.reconcile(retireOptions.idempotencyKey)).toEqual(retired);
    expect(usage(f, source, 'intents')).toBe(JOB_LIMITS.intents); expect(usage(f, source, 'sourceRecoveryIntents')).toBe(2);
    // Retirement does not consume/release schedule capacity, nor prevent owner-only cancellation.
    await source.api.schedules.cancel(second.id, { expectedRevision: 1, idempotencyKey: 'cancel-after-retire' });
    expect(usage(f, source, 'sourceRecoveryIntents')).toBe(3); expect(usage(f, source, 'schedules')).toBe(2);
    expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
  } finally { await f.close(); }
});

test('full recovery accounting fails closed atomically without borrowing ordinary admission', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    accounting(f, source, 'sourceRecoveryIntents', JOB_SOURCE_RECOVERY_INTENTS_LIMIT);
    const created = await source.api.schedules.create(once(f), { idempotencyKey: 'ordinary-create' });
    const replaced = await source.api.schedules.replace(created.id, once(f), { expectedRevision: 1, idempotencyKey: 'ordinary-readmit' });
    const registration = await source.api.registration.activate({ ...activate, expectedRevision: 1, idempotencyKey: 'ordinary-register' });
    expect(replaced).toMatchObject({ revision: 2, generation: 2 }); expect(usage(f, source, 'intents')).toBe(4);
    await expect(source.api.schedules.cancel(created.id, { expectedRevision: 2, idempotencyKey: 'full-recovery-cancel' })).rejects.toMatchObject({ code: 'JOBS_CAPACITY' });
    await expect(source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'full-recovery-retire' })).rejects.toMatchObject({ code: 'JOBS_CAPACITY' });
    expect(await source.api.schedules.get(created.id)).toMatchObject({ receipt: replaced, schedule: { control: 'active', revision: 2 } });
    expect(await source.api.registration.get()).toEqual(registration);
    expect(await source.api.receipts.get('full-recovery-cancel')).toBeNull(); expect(await source.api.receipts.get('full-recovery-retire')).toBeNull();
    expect(usage(f, source, 'intents')).toBe(4); expect(usage(f, source, 'sourceRecoveryIntents')).toBe(JOB_SOURCE_RECOVERY_INTENTS_LIMIT);
    expect(f.rows(source.scope, '_jobs_source_intents')).toHaveLength(4); expect(f.rows(source.scope, '_jobs_admissions')).toHaveLength(2);
  } finally { await f.close(); }
});

test('legacy ordinary-accounted recovery receipts retain their exact namespace, digest and result under both full budgets', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source(), registered = await source.api.registration.activate(activate), created = await source.api.schedules.create(once(f), { idempotencyKey: 'legacy-create' });
    const db = f.plane(source.scope); if (!db) throw new Error('Synthetic memory plane missing.');
    const cancelled: JobSourceScheduleReceipt = { ...created, control: 'cancelled', revision: 2 };
    const retired: JobSourceRegistration = { ...registered, state: 'retired', revision: 2 };
    // Exact pre-recovery-accounting row format, generated from retained canonical
    // identity/results. Only synthetic mutable state is advanced to its matching state.
    const legacyReceipt = (key: string, intent: unknown, result: JobSourceScheduleReceipt | JobSourceRegistration) => {
      db.createStrict('_jobs_source_intents', { id: sourceIntentId(source.identity, key), scope_id: source.identity.scopeId,
        source_id: registered.id, policy_generation: 1, digest: jobHash(intent), result_json: jobJson(result), created_at: f.now() });
    };
    legacyReceipt('legacy-cancel', ['change', created.id, 1, 'cancel', null], cancelled);
    legacyReceipt('legacy-retire', ['retire', source.identity, 1], retired);
    db.update('job_schedules', created.id, { control: 'cancelled', revision: 2 }); db.update('_jobs_cursors', created.id, { next_due_at: null });
    db.update('_jobs_sources', registered.id, { state: 'retired', revision: 2 });
    accounting(f, source, 'intents', JOB_LIMITS.intents); accounting(f, source, 'sourceRecoveryIntents', JOB_SOURCE_RECOVERY_INTENTS_LIMIT);
    const retained = f.rows(source.scope, '_jobs_source_intents');
    expect(await source.api.schedules.cancel(created.id, { expectedRevision: 1, idempotencyKey: 'legacy-cancel' })).toEqual(cancelled);
    expect(await source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'legacy-retire' })).toEqual(retired);
    await expect(source.api.schedules.cancel(created.id, { expectedRevision: 2, idempotencyKey: 'legacy-cancel' })).rejects.toMatchObject({ code: 'JOBS_INTENT_CONFLICT' });
    await expect(source.api.schedules.cancel(created.id, { expectedRevision: 1, idempotencyKey: 'legacy-retire' })).rejects.toMatchObject({ code: 'JOBS_INTENT_CONFLICT' });
    await expect(source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'legacy-cancel' })).rejects.toMatchObject({ code: 'JOBS_INTENT_CONFLICT' });
    await expect(source.api.schedules.create(once(f), { idempotencyKey: 'legacy-cancel' })).rejects.toMatchObject({ code: 'JOBS_INTENT_CONFLICT' });
    expect(await source.api.receipts.get('legacy-cancel')).toEqual(cancelled); expect(await source.api.registration.reconcile('legacy-retire')).toEqual(retired);
    await expect(source.api.schedules.cancel(created.id, { expectedRevision: 1, idempotencyKey: activate.idempotencyKey })).rejects.toMatchObject({ code: 'JOBS_INTENT_CONFLICT' });
    expect(f.rows(source.scope, '_jobs_source_intents')).toEqual(retained);
    expect(usage(f, source, 'intents')).toBe(JOB_LIMITS.intents); expect(usage(f, source, 'sourceRecoveryIntents')).toBe(JOB_SOURCE_RECOVERY_INTENTS_LIMIT);
  } finally { await f.close(); }
});

test('versioned capacity separates working occupancy from factual retained history without provisioning', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source(), untouched = f.stats();
    expect(await source.api.capacity.get()).toBeNull(); expect(f.stats().planes).toBe(untouched.planes); expect(f.commands).toHaveLength(0);
    await source.api.registration.activate(activate);
    const created = await source.api.schedules.create(once(f), { idempotencyKey: 'capacity-once' });
    await source.api.schedules.cancel(created.id, { expectedRevision: 1, idempotencyKey: 'capacity-cancel' });
    const result = await source.api.capacity.get();
    expect(result).toEqual({ version: 2, source: { id: created.sourceId, registered: true },
      working: { sourceSchedules: { used: 0, limit: JOB_WORK_LIMITS.schedulesPerSource, remaining: JOB_WORK_LIMITS.schedulesPerSource },
        fileSchedules: { used: 0, limit: JOB_WORK_LIMITS.schedules, remaining: JOB_WORK_LIMITS.schedules },
        fileOccurrences: { used: 0, limit: JOB_WORK_LIMITS.occurrences, remaining: JOB_WORK_LIMITS.occurrences } },
      retained: { sourceSchedules: { used: 1 }, file: { schedules: { used: 1, limit: JOB_LIMITS.schedules, remaining: JOB_LIMITS.schedules - 1 },
        intents: { used: 2, limit: JOB_LIMITS.intents, remaining: JOB_LIMITS.intents - 2 },
        sourceRecoveryIntents: { used: 1, limit: 21_024, remaining: 21_023 },
        occurrences: { used: 0, limit: JOB_LIMITS.occurrences, remaining: JOB_LIMITS.occurrences },
        sources: { used: 1, limit: JOB_SOURCE_LIMITS.sources, remaining: JOB_SOURCE_LIMITS.sources - 1 },
        sourcePolicies: { used: 1, limit: JOB_SOURCE_LIMITS.policies, remaining: JOB_SOURCE_LIMITS.policies - 1 } } } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_CAPACITY_INPUT|authority|contract|principal|workflow|rootHash|ownerId|databaseId/);
    const other = f.source({ identity: { databaseId: 'another-synthetic-source' } }), otherResult = await other.api.capacity.get();
    expect(otherResult?.source).toMatchObject({ registered: false });
    expect(otherResult?.working.sourceSchedules).toMatchObject({ used: 0, remaining: JOB_WORK_LIMITS.schedulesPerSource });
    expect(otherResult?.retained.sourceSchedules).toEqual({ used: 0 });
    expect(otherResult?.retained.file).toEqual(result?.retained.file);
    const tenant = f.source({ scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'absent' }) });
    expect(await tenant.api.capacity.get()).toBeNull(); expect(f.stats().planes).toBe(1);
    accounting(f, source, 'intents', JOB_LIMITS.intents + 1);
    expect((await source.api.capacity.get())?.retained.file.intents).toEqual({ used: JOB_LIMITS.intents + 1, limit: JOB_LIMITS.intents, remaining: 0 });
    source.retireEligibility(); expect((await source.api.capacity.get())?.source.registered).toBe(true);
    expect('capacity' in f.request()).toBe(false);
  } finally { await f.close(); }
});

test('capacity uses bounded primary-key reads without policy/admission scans and rejects scope/owner loss', async () => {
  let revoked: (() => void) | undefined;
  const f = await memorySourceJobsFixture({ beforeRead(operation) { if (operation.name === 'jobs.source.capacity') revoked?.(); } });
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    const created = await source.api.schedules.create(once(f), { idempotencyKey: 'owner-protected-create' });
    accounting(f, source, 'intents', JOB_LIMITS.intents);
    const db = f.plane(source.scope); if (!db) throw new Error('Synthetic memory plane missing.');
    const statements: string[] = [], raw = db.getRawDatabase();
    const context: DatabaseReadQueryContext = { database: {
      query<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string) { statements.push(sql); return raw.query<TRow, TParams>(sql); },
      prepare<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, params?: TParams) { statements.push(sql); return raw.prepare<TRow, TParams>(sql, params); },
    } };
    expect(readSourceJobCapacity(context, { identity: source.identity }).source.registered).toBe(true);
    expect(statements).toEqual(["SELECT scope_id FROM _jobs_owner WHERE id='application'", 'SELECT * FROM _jobs_sources WHERE id=? AND scope_id=?',
      'SELECT count FROM _jobs_usage WHERE id=?', 'SELECT count FROM _jobs_work_usage WHERE id=?']);
    for (const [sql, args] of [[statements[1]!, [jobSourceId(source.identity), 'application']], [statements[2]!, ['intents']], [statements[3]!, ['schedules']]] as const) {
      const plan = raw.query<{ detail: string }, string[]>('EXPLAIN QUERY PLAN ' + sql).all(...args).map(row => row.detail).join('\n');
      expect(plan).toContain('SEARCH'); expect(plan).not.toContain('SCAN');
    }
    const foreign: JobSourceIdentity = { ...source.identity, scopeId: 'tenant:foreign' };
    expect(() => readSourceJobCapacity(context, { identity: foreign })).toThrow(expect.objectContaining({ code: 'JOBS_STATE_INVALID' }));
    expect(() => f.service.forSource({ ...source.capability } as TrustedJobSource)).toThrow(expect.objectContaining({ code: 'JOBS_FORBIDDEN' }));
    revoked = () => source.revokeOwner();
    await expect(source.api.capacity.get()).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    await expect(source.api.schedules.cancel(created.id, { expectedRevision: 1, idempotencyKey: 'owner-rejected-cancel' })).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    await expect(source.api.registration.retire({ expectedRevision: 1, idempotencyKey: 'owner-rejected-retire' })).rejects.toMatchObject({ code: 'JOBS_AUTHORITY_RETIRED' });
    expect(f.stats()).toMatchObject({ activeLeases: 0, backendLeases: 0 });
  } finally { await f.close(); }
});

test('the actual Jobs runner and sealed Torrent completion release working quota but retain original source execution evidence', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const source = f.source(); await source.api.registration.activate(activate);
    const created = await source.api.schedules.create(once(f), { idempotencyKey: 'real-completion' });
    expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(1);
    f.advance(5000); await f.tick();
    await untilMemoryJobs(() => {
      const occurrence = f.rows(source.scope, '_jobs_occurrences')[0];
      return typeof occurrence?.workflow_id === 'string' && f.workflows.getInstance(occurrence.workflow_id, source.scope)?.status === 'completed';
    });
    await f.tick();
    const after = await source.api.capacity.get();
    expect(after!.working.sourceSchedules.used).toBe(0); expect(after!.working.fileSchedules.used).toBe(0); expect(after!.working.fileOccurrences.used).toBe(0);
    expect(after!.retained.sourceSchedules.used).toBe(1); expect(after!.retained.file.occurrences.used).toBe(1);
    const evidence = await source.api.executions.get(created.id, { generation: 1, scheduledAt: f.now() });
    expect(evidence?.status).toBe('completed'); expect(await source.api.receipts.get('real-completion')).toEqual(created);
    await source.api.schedules.cancel(created.id, { expectedRevision: 1, idempotencyKey: 'cancel-completed' });
    expect((await source.api.capacity.get())!.working.sourceSchedules.used).toBe(0);
    expect(await source.api.receipts.get('real-completion')).toEqual(created); expect(f.calls).toHaveLength(1);
  } finally { await f.close(); }
});
