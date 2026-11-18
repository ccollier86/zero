/** Synthetic :memory: transactions only. Every query/database closes in finally; no file fixture or generated output. */
import { expect, test } from 'bun:test';
import { defineDatabaseRealm, runDatabaseRealmCommand, type DatabaseReadQueryContext } from '../databases/database-realm';
import { createDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { createReactiveDB } from '../sync/reactive-db';
import { jobsRealm } from './realm';
import { CURRENT_JOB_TABLES } from './realm-source-schema';
import { JOB_SOURCE_MIGRATION } from './realm-source-migration';
import { readJobRejection } from './error';
import { changeSourceJobSchedule, createSourceJobSchedule, registerJobSource, retireJobSource } from './realm-source-control';
import { getJobSource, readJobSourceDispatch, readSourceJobIntent, readSourceJobSchedule } from './realm-source-queries';
import { listJobSchedules, readJobSchedule, readJobScheduleContext } from './realm-queries';
import { jobSourceId, type JobSourceContract, type JobSourceRegistration } from './source-model';
import { sourceIntentId } from './source-realm-model';
import { jobHash } from './validation';

const now = Date.parse('2026-12-01T00:00:00Z'), due = now + 60_000;
const identity = { domain: 'synthetic.calendar', databaseId: 'calendar:fixture', ownerId: 'native-owner', rootHash: '1'.repeat(64), scopeId: 'application' };
const contract: JobSourceContract = { identity, realmFingerprint: 'sha256:' + '2'.repeat(64), policyVersion: 'policy-a', semanticsVersion: 'semantics-a',
  definition: { name: 'synthetic.calendar.reminder', version: '1', fingerprint: '3'.repeat(64) },
  workflow: { name: 'synthetic.calendar.reminder', version: 1, definitionId: 'synthetic-definition', versionId: 'synthetic-version', fingerprint: '4'.repeat(64) } };
const nextContract = { ...contract, policyVersion: 'policy-b', workflow: { ...contract.workflow, version: 2, versionId: 'synthetic-version-b' } };
const seal = { authorityJson: 'PRIVATE_SOURCE_AUTHORITY', authorityMac: '5'.repeat(64) };
const actor = { scopeId: 'application', userId: 'human-owner', principal: 'human-session', manageAll: true };

function admission(registration: JobSourceRegistration, id: string, policy = contract, at = due) {
  return { id, scopeId: policy.identity.scopeId, actorId: null, principal: null, runAs: 'service',
    source: { id: registration.id, generation: registration.generation, policyHash: registration.policyHash }, initiatedBy: 'factual-human',
    definition: policy.definition.name, definitionVersion: policy.definition.version, definitionHash: policy.definition.fingerprint,
    workflow: policy.workflow, input: { secret: 'PRIVATE_SOURCE_INPUT' }, timing: { kind: 'once', at: new Date(at).toISOString(), maxLatenessMs: 60_000 }, overlap: 'skip' };
}
function fixture(audit = false) {
  const db = createReactiveDB({ mode: 'memory' }), raw = db.getRawDatabase();
  let source: LoggingActorSource | null = null;
  try {
    raw.run('PRAGMA foreign_keys=ON');
    const migrations = jobsRealm.migrations.some(migration => migration.version === '002') ? jobsRealm.migrations : [...jobsRealm.migrations, JOB_SOURCE_MIGRATION];
    for (const migration of migrations) raw.transaction(() => migration.up(raw))();
    for (const [table, schema] of Object.entries(CURRENT_JOB_TABLES)) db.defineTable(table, schema);
    const realm = defineDatabaseRealm({ name: 'synthetic-source-memory', version: '1', tables: CURRENT_JOB_TABLES,
      commands: { ...jobsRealm.commands, 'source.register': registerJobSource, 'source.retire': retireJobSource,
        'source.create': createSourceJobSchedule, 'source.change': changeSourceJobSchedule } });
    if (audit) source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true,
      policyVersion: 'synthetic-source-audit', scope: { kind: 'application', tenantId: null } }));
    const command = (name: string, input: unknown): any => {
      try { return (runDatabaseRealmCommand(realm, db, name, input as DatabaseSerializableValue) as any).value; }
      catch (error) { throw readJobRejection(error) ?? error; }
    };
    command('jobs.owner.bind', { scopeId: 'application', ownerId: 'jobs-owner-distinct-from-native-owner' });
    return { db, raw, source, command,
      register(policy = contract, expectedRevision = 0, requestId = 'register-a'): JobSourceRegistration {
        return command('source.register', { contract: policy, expectedRevision, requestId, now });
      },
      create(registration: JobSourceRegistration, id: string, extra: Record<string, unknown> = {}) {
        const input = { identity, requestId: 'create-' + id, admission: admission(registration, id), seal, now, ...extra };
        return { input, receipt: command('source.create', input) };
      },
      query<T>(handler: (context: DatabaseReadQueryContext, input: unknown) => T, input: unknown): T {
        const session = createDatabaseReadQuerySession(raw);
        try { return handler(session.context, input); } finally { session.close(); }
      },
      close() { source?.close(); db.dispose(); },
    };
  } catch (error) { source?.close(); db.dispose(); throw error; }
}

test('first source lookup/receipt are non-provisioning and verify established Jobs scope', () => {
  const f = fixture();
  try {
    expect(f.query(getJobSource, { identity })).toBeNull();
    expect(f.query(readSourceJobIntent, { identity, requestId: 'first-source-request' })).toBeNull();
    expect(f.db.list('_jobs_sources')).toHaveLength(0); expect(f.db.list('_jobs_source_intents')).toHaveLength(0);
    expect(() => f.query(getJobSource, { identity: { ...identity, scopeId: 'tenant:other' } })).toThrow(expect.objectContaining({ code: 'JOBS_STATE_INVALID' }));
    expect(() => f.query(readSourceJobIntent, { identity: { ...identity, scopeId: 'tenant:other' }, requestId: 'first-source-request' })).toThrow(expect.objectContaining({ code: 'JOBS_STATE_INVALID' }));
    expect(() => f.command('source.register', { contract: { ...contract, identity: { ...identity, scopeId: 'tenant:other' } }, requestId: 'foreign-scope', expectedRevision: 0, now })).toThrow(expect.objectContaining({ code: 'JOBS_STATE_INVALID' }));
    expect(f.db.list('_jobs_sources')).toHaveLength(0);
  } finally { f.close(); }
});

test('registry policy epochs retain A -> B -> A and require CAS even for new no-op keys; exact receipts replay first', () => {
  const f = fixture();
  try {
    const a = f.register(); expect(a).toEqual({ id: jobSourceId(identity), generation: 1, revision: 1, state: 'active', policyHash: jobHash(contract) });
    expect(f.register(contract, 1, 'same-a')).toEqual(a);
    expect(() => f.register(contract, 0, 'stale-noop-a')).toThrow(expect.objectContaining({ code: 'JOBS_REVISION_CONFLICT' }));
    expect(() => f.register(nextContract, 7, 'stale-b')).toThrow(expect.objectContaining({ code: 'JOBS_REVISION_CONFLICT' }));
    const b = f.register(nextContract, 1, 'register-b'); expect(b).toMatchObject({ generation: 2, revision: 2 });
    const againA = f.register(contract, 2, 'register-a-again'); expect(againA).toMatchObject({ generation: 3, revision: 3, policyHash: a.policyHash });
    expect(() => f.register(contract, 0, 'aba-old-cas')).toThrow(expect.objectContaining({ code: 'JOBS_REVISION_CONFLICT' }));
    const retired = f.command('source.retire', { identity, expectedRevision: 3, requestId: 'retire-a', now: now + 10 });
    expect(retired).toMatchObject({ generation: 3, revision: 4, state: 'retired', policyHash: a.policyHash });
    expect(f.command('source.retire', { identity, expectedRevision: 4, requestId: 'retire-noop', now: now + 11 })).toEqual(retired);
    expect(() => f.command('source.retire', { identity, expectedRevision: 3, requestId: 'stale-retire-noop', now })).toThrow(expect.objectContaining({ code: 'JOBS_REVISION_CONFLICT' }));
    expect(f.register()).toEqual(a); // Original request survives the current retired pointer and stale CAS.
    expect(f.query(readSourceJobIntent, { identity, requestId: 'register-a', intentDigest: jobHash(['register', contract, 0]) })).toEqual({ ...a });
    expect(() => f.query(readSourceJobIntent, { identity, requestId: 'register-a', intentDigest: '0'.repeat(64) })).toThrow(expect.objectContaining({ code: 'JOBS_INTENT_CONFLICT' }));
    const reactivated = f.register(contract, 4, 'reactivate-a'); expect(reactivated).toMatchObject({ generation: 4, revision: 5, state: 'active', policyHash: a.policyHash });
    expect(f.db.list('_jobs_source_policies')).toHaveLength(4);
    expect(() => f.raw.run("UPDATE _jobs_source_policies SET digest='changed'")).toThrow();
    expect(() => f.raw.run('DELETE FROM _jobs_source_intents')).toThrow();
    expect(() => f.raw.run("UPDATE _jobs_sources SET identity_json='{}',revision=revision+1")).toThrow();
  } finally { f.close(); }
});

test('one-shot source work preserves original past due, exact expiry boundary and immutable source ownership', () => {
  const f = fixture();
  try {
    const registration = f.register(), created = f.create(registration, 'late-once', { now: due + 60_000 });
    expect(created.receipt).toMatchObject({ sourceId: registration.id, policyGeneration: 1, revision: 1, generation: 1, createdAt: due + 60_000 });
    expect(f.db.get('_jobs_cursors', 'late-once')!.next_due_at).toBe(due);
    expect(f.command('source.create', { ...created.input, now: due + 60_001 })).toEqual(created.receipt);
    f.command('jobs.materialize', { scopeId: 'application', id: 'late-once', expectedRevision: 1, now: due + 60_000 });
    expect(f.db.list('_jobs_occurrences')).toHaveLength(1); expect(f.db.list('_jobs_occurrences')[0]!.scheduled_at).toBe(due);
    expect(() => f.create(registration, 'expired-once', { now: due + 60_001 })).toThrow(expect.objectContaining({ code: 'JOBS_INPUT_INVALID' }));
    expect(f.db.get('job_schedules', 'expired-once')).toBeNull();
    const view = f.query(readSourceJobSchedule, { identity, id: 'late-once' });
    expect(view.schedule).toMatchObject({ actor_id: null, principal: null, updated_by: null, run_as: 'service', source_id: registration.id });
    expect(view.receipt).toEqual(created.receipt);
    expect(() => f.raw.run("UPDATE job_schedules SET source_id=NULL,actor_id='forged',principal='forged',updated_by='forged',revision=revision+1 WHERE id='late-once'")).toThrow();
    expect(() => f.create(registration, 'cron', { admission: { ...admission(registration, 'cron'), timing: { kind: 'cron', pattern: '* * * * *', timezone: 'UTC' } } })).toThrow(expect.objectContaining({ code: 'JOBS_INPUT_INVALID' }));
  } finally { f.close(); }
});

test('source intents conflict on changed due/input and replay original receipt after retirement', () => {
  const f = fixture();
  try {
    const registration = f.register(), created = f.create(registration, 'permanent-once');
    const same = { ...created.input, now: now + 100, seal: { ...seal, authorityMac: '6'.repeat(64) } };
    expect(f.command('source.create', same)).toEqual(created.receipt);
    for (const altered of [{ ...created.input.admission, input: { changed: true } }, { ...created.input.admission, timing: { kind: 'once', at: new Date(due + 1).toISOString(), maxLatenessMs: 60_000 } }]) {
      expect(() => f.command('source.create', { ...created.input, admission: altered })).toThrow(expect.objectContaining({ code: 'JOBS_INTENT_CONFLICT' }));
    }
    f.command('source.retire', { identity, expectedRevision: 1, requestId: 'retire-after-create', now: now + 1 });
    expect(f.command('source.create', { ...created.input, now: due + 60_001 })).toEqual(created.receipt);
    expect(f.query(readSourceJobIntent, { identity, requestId: created.input.requestId })).toEqual(created.receipt);
    expect(() => f.create(registration, 'new-after-retire')).toThrow(expect.objectContaining({ code: 'JOBS_AUTHORITY_RETIRED' }));
    expect(() => f.query(readJobSourceDispatch, { scopeId: 'application', source: created.input.admission.source })).toThrow(expect.objectContaining({ code: 'JOBS_AUTHORITY_RETIRED' }));
  } finally { f.close(); }
});

test('current policy readmission preserves stable source, old epoch dispatch retires, cancellation works after retirement and stays terminal', () => {
  const f = fixture();
  try {
    const a = f.register(), created = f.create(a, 'readmit-once');
    expect(f.query(readJobSourceDispatch, { scopeId: 'application', source: created.input.admission.source })).toBe(true);
    const b = f.register(nextContract, 1, 'register-b');
    expect(() => f.query(readJobSourceDispatch, { scopeId: 'application', source: created.input.admission.source })).toThrow(expect.objectContaining({ code: 'JOBS_AUTHORITY_RETIRED' }));
    const change = { identity, id: 'readmit-once', requestId: 'readmit-under-b', expectedRevision: 1, action: 'readmit', admission: admission(b, 'readmit-once', nextContract), seal, now: now + 2 };
    const readmitted = f.command('source.change', change); expect(readmitted).toMatchObject({ sourceId: a.id, policyGeneration: 2, revision: 2, generation: 2 });
    expect(f.command('source.change', change)).toEqual(readmitted);
    expect(f.query(readJobSourceDispatch, { scopeId: 'application', source: change.admission.source })).toBe(true);
    f.command('source.retire', { identity, expectedRevision: 2, requestId: 'retire-b', now: now + 3 });
    const cancel = { identity, id: 'readmit-once', requestId: 'cancel-retired-b', expectedRevision: 2, action: 'cancel', now: now + 4 };
    const cancelled = f.command('source.change', cancel); expect(cancelled).toMatchObject({ policyGeneration: 2, revision: 3, generation: 2, control: 'cancelled' });
    expect(f.command('source.change', cancel)).toEqual(cancelled);
    expect(f.db.get('_jobs_cursors', 'readmit-once')!.next_due_at).toBeNull();
    expect(() => f.command('source.change', { ...change, requestId: 'cannot-revive-cancelled', expectedRevision: 3 })).toThrow(expect.objectContaining({ code: 'JOBS_STAGE_CONFLICT' }));
    expect(() => f.command('source.change', { ...cancel, requestId: 'new-cancel-terminal', expectedRevision: 3 })).toThrow(expect.objectContaining({ code: 'JOBS_STAGE_CONFLICT' }));
    expect(f.query(readSourceJobIntent, { identity, requestId: created.input.requestId })).toEqual(created.receipt);
  } finally { f.close(); }
});

test('source registry/pin/scope bindings and human endpoints cannot forge or expose private source work', () => {
  const f = fixture();
  try {
    const registration = f.register(), created = f.create(registration, 'private-source');
    for (const patch of [{ actorId: 'human-owner', principal: 'human-session' }, { source: { ...created.input.admission.source, generation: 2 } },
      { scopeId: 'tenant:other' }, { definitionHash: '9'.repeat(64) }, { workflow: { ...contract.workflow, versionId: 'forged-version' } }]) {
      expect(() => f.create(registration, 'forgery-' + jobHash(patch).slice(0, 10), { admission: { ...created.input.admission, id: 'forged-once', ...patch } })).toThrow();
    }
    expect(f.query(listJobSchedules, { actor })).toEqual({ items: [], total: 0 });
    expect(() => f.query(readJobSchedule, { actor, id: 'private-source' })).toThrow(expect.objectContaining({ code: 'JOBS_NOT_FOUND' }));
    expect(() => f.query(readJobScheduleContext, { actor, id: 'private-source' })).toThrow(expect.objectContaining({ code: 'JOBS_NOT_FOUND' }));
    expect(() => f.command('jobs.schedule.change', { actor, id: 'private-source', requestId: 'human-admin-cancel', expectedRevision: 1, action: 'cancel', now })).toThrow(expect.objectContaining({ code: 'JOBS_NOT_FOUND' }));
    expect(() => f.command('jobs.schedule.create', { actor, requestId: 'human-mints-source', admission: created.input.admission, seal, now })).toThrow(expect.objectContaining({ code: 'JOBS_FORBIDDEN' }));
    expect(() => f.query(readSourceJobSchedule, { identity: { ...identity, ownerId: 'forged-owner' }, id: 'private-source' })).toThrow(expect.objectContaining({ code: 'JOBS_NOT_FOUND' }));
    expect(f.query(getJobSource, { identity: { ...identity, ownerId: 'forged-owner' } })).toBeNull();
    expect(f.db.list('job_schedules')).toHaveLength(1);
  } finally { f.close(); }
});

test('shared and source-specific budgets roll back schedules, admissions, intents, cursors and registry changes atomically', () => {
  const f = fixture();
  try {
    const registration = f.register(), perSource = 'source:' + jobHash(identity);
    f.db.createStrict('_jobs_usage', { id: perSource, count: 1000 });
    expect(() => f.create(registration, 'source-quota')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.db.get('_jobs_usage', 'schedules')).toBeNull();
    expect(f.db.get('_jobs_usage', 'intents')!.count).toBe(1);
    expect(f.db.get('_jobs_source_intents', sourceIntentId(identity, 'create-source-quota'))).toBeNull();
    expect(f.db.get('_jobs_admissions', 'source-quota:1')).toBeNull(); expect(f.db.get('_jobs_cursors', 'source-quota')).toBeNull();
    f.db.update('_jobs_usage', perSource, { count: 0 });
    f.db.createStrict('_jobs_usage', { id: 'schedules', count: 10_000 });
    expect(() => f.create(registration, 'shared-schedules-quota')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.db.get('_jobs_usage', perSource)!.count).toBe(0);
    f.db.update('_jobs_usage', 'schedules', { count: 0 });
    f.db.update('_jobs_usage', 'source-policies', { count: 10_000 });
    expect(() => f.register(nextContract, 1, 'policy-quota')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.query(getJobSource, { identity })).toEqual(registration); expect(f.db.list('_jobs_source_policies')).toHaveLength(1);
    f.db.update('_jobs_usage', 'intents', { count: 100_000 });
    expect(() => f.create(registration, 'shared-intents-quota')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.db.list('job_schedules')).toHaveLength(0); expect(f.db.get('_jobs_usage', 'schedules')!.count).toBe(0);
    expect(f.register()).toEqual(registration); // Permanent receipt replay does not consume another quota unit.
  } finally { f.close(); }
});

test('source schedule semantic evidence is once per actual transition and never fabricates human execution authority', () => {
  const f = fixture(true);
  try {
    const registration = f.register(), created = f.create(registration, 'source-audit');
    f.command('source.create', created.input);
    const change = { identity, id: 'source-audit', requestId: 'source-readmit-audit', expectedRevision: 1, action: 'readmit', admission: created.input.admission, seal, now: now + 1 };
    f.command('source.change', change); f.command('source.change', change);
    const cancel = { identity, id: 'source-audit', requestId: 'source-cancel-audit', expectedRevision: 2, action: 'cancel', now: now + 2 };
    f.command('source.change', cancel); f.command('source.change', cancel);
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['jobs.schedule.created', 'jobs.schedule.readmitted', 'jobs.schedule.cancelled']);
    expect(new Set(events.map(event => event.id)).size).toBe(3);
    expect(events.every(event => event.actor.kind === 'system' && event.actor.sessionId === null)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_SOURCE_');
    expect(events.every(event => event.actor.id !== 'factual-human' && event.actor.initiatorId === null)).toBe(true);
    expect(events.every(event => event.metadata.initiatedBy === 'factual-human' && event.metadata.policyGeneration === 1
      && event.metadata.sourceId === jobSourceId(identity))).toBe(true);
  } finally { f.close(); }
});

test('source registry and occurrence capacity share global budgets without partial evidence or counter commits', () => {
  const f = fixture();
  try {
    const registration = f.register(), created = f.create(registration, 'capacity-occurrence');
    f.db.update('_jobs_usage', 'sources', { count: 1_024 });
    const otherIdentity = { ...identity, ownerId: 'another-native-owner' }, otherContract = { ...contract, identity: otherIdentity };
    expect(() => f.register(otherContract, 0, 'sources-quota')).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.query(getJobSource, { identity: otherIdentity })).toBeNull();
    expect(f.db.get('_jobs_source_intents', sourceIntentId(otherIdentity, 'sources-quota'))).toBeNull();
    expect(f.db.list('_jobs_sources')).toHaveLength(1); expect(f.db.get('_jobs_usage', 'intents')!.count).toBe(2);
    f.db.createStrict('_jobs_usage', { id: 'occurrences', count: 100_000 });
    expect(() => f.command('jobs.materialize', { scopeId: 'application', id: 'capacity-occurrence', expectedRevision: 1, now: due })).toThrow(expect.objectContaining({ code: 'JOBS_CAPACITY' }));
    expect(f.db.list('_jobs_occurrences')).toHaveLength(0); expect(f.db.get('_jobs_cursors', 'capacity-occurrence')!.next_due_at).toBe(due);
    expect(f.query(readSourceJobIntent, { identity, requestId: created.input.requestId })).toEqual(created.receipt);
    f.db.update('_jobs_usage', 'occurrences', { count: 99_999 });
    expect(f.command('jobs.materialize', { scopeId: 'application', id: 'capacity-occurrence', expectedRevision: 1, now: due })).toEqual({ created: 1, skipped: false });
    expect(f.db.get('_jobs_usage', 'occurrences')!.count).toBe(100_000);
    expect(f.db.list('_jobs_occurrences')).toHaveLength(1);
  } finally { f.close(); }
});
