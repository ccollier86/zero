/** Source-atomic semantic evidence using synthetic in-memory state only. No child, dependency or filesystem output. */
import { expect, test } from 'bun:test';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../logging/logging-actor-source';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { createReactiveDB } from '../sync/reactive-db';
import { JOB_TABLES } from './realm-schema';
import { jobsRealm } from './realm';
import { jobOccurrenceId } from './model';

const now = Date.parse('2026-12-01T00:00:00Z'), due = now + 60_000;
const actor = { scopeId: 'tenant:tenant-a', userId: 'fixture-user', principal: 'fixture-session', manageAll: false };
function create(id: string) {
  return { actor, requestId: 'create-' + id, now, admission: { id, scopeId: actor.scopeId, actorId: actor.userId, principal: actor.principal,
    definition: 'synthetic.report', definitionVersion: '1', definitionHash: 'a'.repeat(64),
    workflow: { name: 'synthetic.report', version: 1, definitionId: 'synthetic-definition', versionId: 'synthetic-version', fingerprint: 'b'.repeat(64) },
    input: { secret: 'NEVER_LOG_JOB_INPUT' }, timing: { kind: 'once', at: new Date(due).toISOString() }, overlap: 'skip', runAs: 'actor' },
    seal: { authorityJson: 'NEVER_LOG_JOB_AUTHORITY', authorityMac: 'c'.repeat(64) } };
}
function fixture(logging: 'enabled' | 'disabled' | 'workflow-disabled' = 'enabled', maxEvents = 10000) {
  const db = createReactiveDB({ mode: 'memory' });
  for (const [table, schema] of Object.entries(JOB_TABLES)) db.defineTable(table, schema);
  const source = logging === 'disabled' ? null : new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false,
    workflow: logging !== 'workflow-disabled', policyVersion: 'jobs-semantic-policy', scope: { kind: 'tenant', tenantId: 'tenant-a' }, sourceQueue: { maxEvents } }));
  const command = (name: string, input: unknown) => {
    const run = () => runDatabaseRealmCommand(jobsRealm, db, name, input as DatabaseSerializableValue);
    return source ? source.run(loggingContext('tenant-a'), run) : run();
  };
  command('jobs.owner.bind', { ownerId: 'synthetic-owner', scopeId: actor.scopeId });
  return { db, source, command,
    background: (name: string, input: unknown) => runDatabaseRealmCommand(jobsRealm, db, name, input as DatabaseSerializableValue),
    close() { source?.close(); db.dispose(); } };
}

test('canonical controls and observed outcomes append once, never for no-ops, receipts, claims or polls', () => {
  const f = fixture();
  try {
    f.command('jobs.schedule.create', create('controls')); f.command('jobs.schedule.create', create('controls'));
    const pause = { actor, id: 'controls', requestId: 'pause-controls', expectedRevision: 1, action: 'pause', now: now + 1 };
    f.command('jobs.schedule.change', pause); f.command('jobs.schedule.change', pause);
    f.command('jobs.schedule.change', { ...pause, requestId: 'noop-pause', expectedRevision: 2 });
    f.command('jobs.schedule.change', { actor, id: 'controls', requestId: 'readmit-controls', expectedRevision: 2, action: 'readmit',
      admission: create('controls').admission, seal: create('controls').seal, now: now + 2 });
    f.command('jobs.schedule.change', { actor, id: 'controls', requestId: 'cancel-controls', expectedRevision: 3, action: 'cancel', now: now + 3 });
    f.command('jobs.schedule.create', create('execution'));
    f.command('jobs.materialize', { scopeId: actor.scopeId, id: 'execution', expectedRevision: 1, now: due });
    const id = jobOccurrenceId('execution', 1, due), claim = { scopeId: actor.scopeId, id, nonce: 'synthetic-claim', leaseMs: 1000, now: due };
    f.command('jobs.claim', claim); f.command('jobs.claim', claim);
    const receipt = { instanceId: 'synthetic-workflow', name: 'synthetic.report', createdAt: new Date(due).toISOString(), definitionVersion: 1 };
    const dispatch = { scopeId: actor.scopeId, id, nonce: claim.nonce, leaseGeneration: 1, receipt, now: due + 1 };
    f.background('jobs.dispatch', dispatch); f.background('jobs.dispatch', dispatch);
    const complete = { scopeId: actor.scopeId, id, instanceId: receipt.instanceId, status: 'completed', now: due + 2 };
    f.background('jobs.complete', complete); f.background('jobs.complete', complete);
    f.command('jobs.materialize', { scopeId: actor.scopeId, id: 'execution', expectedRevision: 1, now: due + 3 });
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['jobs.schedule.created', 'jobs.schedule.paused', 'jobs.schedule.readmitted',
      'jobs.schedule.cancelled', 'jobs.schedule.created', 'jobs.occurrence.handed-off', 'jobs.occurrence.terminal-observed']);
    expect(events.every(event => event.family === 'workflow' && event.evidence === 'server-confirmed' && event.scope.kind === 'tenant' && event.scope.tenantId === 'tenant-a')).toBe(true);
    expect(events.slice(0, 5).every(event => event.actor.id === actor.userId && event.actor.sessionId === actor.principal)).toBe(true);
    expect(events.slice(5).every(event => event.actor.kind === 'system' && event.actor.sessionId === null)).toBe(true);
    expect(events.at(-1)!.metadata.workflowStatus).toBe('completed');
    expect(events.some(event => event.action.startsWith('record.'))).toBe(false);
    expect(new Set(events.map(event => event.id)).size).toBe(events.length);
    expect(JSON.stringify(events)).not.toContain('NEVER_LOG_JOB'); expect(JSON.stringify(events)).not.toContain('authority_mac');
  } finally { f.close(); }
});

test('occurrence blocking is one event and repeated cursor stops retain distinct actual transition identities', () => {
  const f = fixture();
  try {
    f.command('jobs.schedule.create', create('blocked'));
    f.command('jobs.materialize', { scopeId: actor.scopeId, id: 'blocked', expectedRevision: 1, now: due });
    const id = jobOccurrenceId('blocked', 1, due);
    f.command('jobs.claim', { scopeId: actor.scopeId, id, nonce: 'blocked-claim', leaseMs: 1000, now: due });
    f.command('jobs.block', { scopeId: actor.scopeId, id, nonce: 'blocked-claim', leaseGeneration: 1, code: 'JOBS_AUTHORITY_RETIRED', now: due + 1 });
    expect(f.source!.control({}).rows.map(row => row.event.action)).toEqual(['jobs.schedule.created', 'jobs.occurrence.blocked']);
    for (const code of ['JOBS_AUTHORITY_RETIRED', 'JOBS_CAPACITY', 'JOBS_AUTHORITY_RETIRED']) {
      f.command('jobs.cursor.block', { scopeId: actor.scopeId, id: 'blocked', expectedRevision: 1, code });
    }
    const events = f.source!.control({}).rows.map(row => row.event);
    expect(events.map(event => event.action)).toEqual(['jobs.schedule.created', 'jobs.occurrence.blocked', 'jobs.schedule.blocked', 'jobs.schedule.blocked']);
    expect(new Set(events.map(event => event.id)).size).toBe(events.length);
    expect(events.slice(1).every(event => event.outcome === 'denied')).toBe(true);
  } finally { f.close(); }
});

test('disabled logging and disabled workflow capture create no semantic evidence', () => {
  for (const mode of ['disabled', 'workflow-disabled'] as const) {
    const f = fixture(mode);
    try {
      f.command('jobs.schedule.create', create('disabled'));
      expect(f.db.get('job_schedules', 'disabled')).not.toBeNull();
      if (f.source) expect(f.source.control({}).queued).toBe(0);
      else expect(f.db.prepare("SELECT name FROM sqlite_master WHERE name='_zero_logging_outbox'").get()).toBeNull();
    } finally { f.close(); }
  }
});

test('rollback and source queue pressure preserve atomic business, intent and semantic evidence admission', () => {
  const f = fixture('enabled', 1);
  try {
    expect(() => f.db.transaction(() => { f.command('jobs.schedule.create', create('rolled-back')); throw new Error('synthetic rollback'); })).toThrow('synthetic rollback');
    expect(f.db.get('job_schedules', 'rolled-back')).toBeNull(); expect(f.source!.control({}).queued).toBe(0);
    f.command('jobs.schedule.create', create('accepted'));
    expect(() => f.command('jobs.schedule.create', create('pressured'))).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(f.db.get('job_schedules', 'pressured')).toBeNull(); expect(f.db.get('_jobs_admissions', 'pressured:1')).toBeNull();
    expect(f.db.get('_jobs_usage', 'schedules')!.count).toBe(1); expect(f.db.list('_jobs_intents')).toHaveLength(1);
    const page = f.source!.control({}); expect(page.queued).toBe(1);
    f.source!.control({ acknowledge: page.rows.map(row => row.id) });
    f.command('jobs.schedule.create', create('pressured'));
    expect(f.db.list('_jobs_intents')).toHaveLength(2); expect(f.source!.control({}).queued).toBe(1);
  } finally { f.close(); }
});
