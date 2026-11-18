/** In-memory realm and pure runner clock-fence proofs. No files, subprocesses, servers or providers are created. */
import { expect, test } from 'bun:test';
import { trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createReactiveDB } from '../sync/reactive-db';
import { WorkPool } from '../workers/work-pool';
import { createSystemAuthority } from '../workflows/workflow-execution-authority';
import type { WorkflowDeferredStartBridge } from '../workflows/workflow-deferred-start-bridge';
import type { ResolvedJobsConfig } from './config';
import { defineJob } from './definition';
import { jobOccurrenceId, normalizeJobAdmission, type JobOccurrenceRow } from './model';
import { jobsRealm } from './realm';
import { JobsRunner } from './runner';
import type { JobsRuntime } from './runtime';

const due = Date.parse('2026-12-01T00:00:00Z'), maxLatenessMs = 1000;
const actor = { scopeId: 'application', userId: 'synthetic-owner', principal: 'synthetic-session', manageAll: false };
const definition = defineJob({ name: 'synthetic.not-before', version: '1', workflow: { name: 'synthetic.not-before', version: 1 },
  parseInput: value => value, service: { principal: 'synthetic.not-before', scopes: ['application'], isEligible: () => true } });
const admission = normalizeJobAdmission({ id: 'synthetic-not-before', scopeId: actor.scopeId, actorId: actor.userId, principal: actor.principal,
  definition: definition.name, definitionVersion: definition.version, definitionHash: definition.fingerprint,
  workflow: { ...definition.workflow, definitionId: 'synthetic-definition', versionId: 'synthetic-version', fingerprint: 'b'.repeat(64) },
  input: {}, timing: { kind: 'once', at: new Date(due).toISOString(), maxLatenessMs }, overlap: 'allow', runAs: 'service' });
const occurrenceId = jobOccurrenceId(admission.id, 1, due);
const receipt = { instanceId: 'synthetic-workflow', name: definition.workflow.name, definitionVersion: 1, createdAt: new Date(due).toISOString() };

function memoryRealm() {
  const database = createReactiveDB({ mode: 'memory' });
  try {
    const raw = database.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const migration of jobsRealm.migrations) raw.transaction(() => migration.up(raw))();
    for (const [name, schema] of Object.entries(jobsRealm.tables)) database.defineTable(name, schema);
    const command = (name: string, input: unknown): any => runDatabaseRealmCommand(jobsRealm, database, name, input as DatabaseSerializableValue);
    const query = (name: string, input: unknown): any => runDatabaseRealmQuery(jobsRealm, { database: raw }, name, input as DatabaseSerializableValue);
    command('jobs.owner.bind', { scopeId: actor.scopeId, ownerId: 'synthetic-jobs-owner' });
    command('jobs.schedule.create', { actor, requestId: 'synthetic-create', admission, seal: { authorityJson: '{}', authorityMac: 'synthetic-seal' }, now: due - 1000 });
    command('jobs.materialize', { scopeId: actor.scopeId, id: admission.id, expectedRevision: 1, now: due });
    return { database, raw, command, query, close() { database.dispose(); } };
  } catch (error) { database.dispose(); throw error; }
}

test('a clock rollback defers an early pending claim without mutating its original occurrence', () => {
  const f = memoryRealm();
  try {
    const before = f.database.get('_jobs_occurrences', occurrenceId), sequence = f.database.currentSeq;
    expect(f.command('jobs.claim', { scopeId: actor.scopeId, id: occurrenceId, nonce: 'early', leaseMs: 1000, now: due - 1 }).value)
      .toEqual({ claimed: false, reason: 'not-due' });
    expect(f.database.get('_jobs_occurrences', occurrenceId)).toEqual(before);
    expect(f.database.currentSeq).toBe(sequence);
    expect(f.query('jobs.context', { scopeId: actor.scopeId, id: occurrenceId, now: due - 1 }).value.dispatchAllowed).toBe(false);
  } finally { f.close(); }
});

for (const now of [due, due + maxLatenessMs, due + maxLatenessMs + 1]) test('claim and dispatch context retain inclusive due/expiry bounds at ' + (now - due), () => {
  const f = memoryRealm();
  try {
    const allowed = now <= due + maxLatenessMs;
    expect(f.query('jobs.context', { scopeId: actor.scopeId, id: occurrenceId, now }).value.dispatchAllowed).toBe(allowed);
    const claimed = f.command('jobs.claim', { scopeId: actor.scopeId, id: occurrenceId, nonce: 'boundary', leaseMs: 1000, now }).value;
    if (allowed) expect(claimed).toMatchObject({ claimed: true, dispatchAllowed: true });
    else expect(claimed).toEqual({ claimed: false, reason: 'expired' });
    expect(f.database.get('_jobs_occurrences', occurrenceId)?.scheduled_at).toBe(due);
  } finally { f.close(); }
});

test('an expired legacy early claim is reclaimable for receipt reconciliation but not a fresh handoff', () => {
  const f = memoryRealm();
  try {
    // This retained shape was possible before not-before fencing. It must not
    // be rewritten as known never-started merely because the clock is early.
    f.raw.run("UPDATE _jobs_occurrences SET state='claimed',lease_nonce='legacy',lease_until=?,lease_generation=1 WHERE id=?", [due - 1, occurrenceId]);
    expect(f.command('jobs.claim', { scopeId: actor.scopeId, id: occurrenceId, nonce: 'reconcile', leaseMs: 1000, now: due - 1 }).value)
      .toMatchObject({ claimed: true, dispatchAllowed: false, leaseGeneration: 2 });
    const context = f.query('jobs.context', { scopeId: actor.scopeId, id: occurrenceId, now: due - 1 }).value;
    expect(context.dispatchAllowed).toBe(false); expect(context.occurrence.state).toBe('claimed');
    expect(context.occurrence.scheduled_at).toBe(due);
  } finally { f.close(); }
});

async function runnerCase(options: { now: number; receipt?: boolean; enqueueAt?: number; dispatchAllowed?: boolean }) {
  const scope = trustedSystemServiceDataScope({ scopeKind: 'application' }), writes: { name: string; input: any }[] = [];
  let now = options.now, accepted = options.receipt ?? false, enqueues = 0, inspections = 0;
  const occurrence: JobOccurrenceRow = { id: occurrenceId, scope_id: actor.scopeId, schedule_id: admission.id, admission_id: admission.id + ':1',
    generation: 1, scheduled_at: due, state: 'claimed', lease_nonce: 'synthetic-claim', lease_until: due + 60_000, lease_generation: 1,
    workflow_id: null, receipt_json: null, terminal_status: null, error_code: null, created_at: due, updated_at: due };
  const runtime = {
    async read(_scope: unknown, name: string) {
      expect(name).toBe('jobs.context');
      return { occurrence, admission, seal: { authorityJson: '{}', authorityMac: 'synthetic-seal' }, dispatchAllowed: options.dispatchAllowed ?? true };
    },
    async write(_scope: unknown, name: string, input: unknown) {
      writes.push({ name, input }); return name === 'jobs.claim' ? { claimed: true, leaseGeneration: 1 } : {};
    },
  } as unknown as JobsRuntime;
  const bridge = {
    assertRuntimeCurrent() {},
    open() { return createSystemAuthority({ principal: 'jobs:' + definition.service!.principal, reason: 'Synthetic clock proof', scope }); },
    inspect() { inspections++; return accepted ? { receipt, status: 'running' } : null; },
    async enqueue(_authority: unknown, _pin: unknown, _input: unknown, _key: unknown, _binding: unknown, fence: () => void) {
      enqueues++; now = options.enqueueAt ?? now; fence(); accepted = true; return receipt;
    },
  } as unknown as WorkflowDeferredStartBridge;
  const gate = new WorkPool({ concurrency: 1 });
  const runner = new JobsRunner({ runtime, bridge, config: { catalog: { resolve: () => definition } } as unknown as ResolvedJobsConfig, gate, now: () => now });
  let error: unknown;
  try {
    await (runner as unknown as { dispatch(scope: ServiceDataScope, id: string): Promise<void> }).dispatch(scope, occurrenceId);
  } catch (caught) { error = caught; }
  finally { await runner.close(); await gate.close(); }
  return { writes, enqueues, inspections, error };
}

test('an early uncertain claim reconciles an accepted receipt before applying not-before', async () => {
  const result = await runnerCase({ now: due - 1, receipt: true, dispatchAllowed: false });
  expect(result.error).toBeUndefined(); expect(result.enqueues).toBe(0); expect(result.inspections).toBe(1);
  expect(result.writes.map(write => write.name)).toEqual(['jobs.claim', 'jobs.dispatch']);
});

test('an early uncertain claim without a receipt remains recoverable instead of being blocked as revoked', async () => {
  const result = await runnerCase({ now: due - 1, dispatchAllowed: false });
  expect(result.error).toMatchObject({ code: 'JOBS_NOT_READY' }); expect(result.enqueues).toBe(0); expect(result.inspections).toBe(1);
  expect(result.writes.map(write => write.name)).toEqual(['jobs.claim']);
});

test('the repeated final handoff fence rejects a backward clock step after enqueue admission waits', async () => {
  const result = await runnerCase({ now: due, enqueueAt: due - 1 });
  expect(result.error).toMatchObject({ code: 'JOBS_NOT_READY' }); expect(result.enqueues).toBe(1); expect(result.inspections).toBe(2);
  expect(result.writes.map(write => write.name)).toEqual(['jobs.claim', 'jobs.claim.defer']);
});

test('not-ready deferral shortens only the current claim while retaining uncertainty and the original identity', () => {
  const f = memoryRealm();
  try {
    f.command('jobs.claim', { scopeId: actor.scopeId, id: occurrenceId, nonce: 'current', leaseMs: 60_000, now: due });
    const before = f.database.get('_jobs_occurrences', occurrenceId);
    expect(() => f.command('jobs.claim.defer', { scopeId: actor.scopeId, id: occurrenceId, nonce: 'wrong', leaseGeneration: 1, now: due })).toThrow();
    expect(f.database.get('_jobs_occurrences', occurrenceId)).toEqual(before);
    expect(f.command('jobs.claim.defer', { scopeId: actor.scopeId, id: occurrenceId, nonce: 'current', leaseGeneration: 1, now: due }).value).toEqual({ deferred: true });
    expect(f.database.get('_jobs_occurrences', occurrenceId)).toMatchObject({ id: occurrenceId, state: 'claimed', lease_nonce: 'current',
      lease_generation: 1, lease_until: due + 1000, scheduled_at: due, receipt_json: null });
    f.command('jobs.claim', { scopeId: actor.scopeId, id: occurrenceId, nonce: 'next', leaseMs: 60_000, now: due + 1000 });
    expect(() => f.command('jobs.claim.defer', { scopeId: actor.scopeId, id: occurrenceId, nonce: 'current', leaseGeneration: 1, now: due + 1000 })).toThrow();
    expect(f.database.get('_jobs_occurrences', occurrenceId)).toMatchObject({ lease_nonce: 'next', lease_generation: 2 });
  } finally { f.close(); }
});

for (const now of [due, due + maxLatenessMs]) test('the final handoff fence permits its inclusive boundary at ' + (now - due), async () => {
  const result = await runnerCase({ now });
  expect(result.error).toBeUndefined(); expect(result.enqueues).toBe(1);
  expect(result.writes.map(write => write.name)).toEqual(['jobs.claim', 'jobs.dispatch']);
});

test('the final handoff fence still blocks work that expires during an enqueue wait', async () => {
  const result = await runnerCase({ now: due + maxLatenessMs, enqueueAt: due + maxLatenessMs + 1 });
  expect(result.error).toBeUndefined(); expect(result.enqueues).toBe(1);
  expect(result.writes.map(write => write.name)).toEqual(['jobs.claim', 'jobs.block']);
  expect(result.writes[1]?.input.code).toBe('JOBS_AUTHORITY_RETIRED');
});
