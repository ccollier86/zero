/** Actor-local atomicity, evidence budget and attribution checks with disposable ReactiveDB state. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { LoggingActorSource, normalizeLoggingActorSourceBinding, normalizeLoggingActorSourcePage } from './logging-actor-source';
import { loggingContext } from './test-support/logging-fixture';
import { defineDatabaseRealm, runDatabaseRealmCommand, type DatabaseWriteCommandContext } from '../databases/database-realm';
import { createDatabaseWriteCommandSession } from '../databases/database-write-command-capability';
import { appendDatabaseCommandSourceAudit, registerDatabaseCommandSourceAudit } from '../databases/database-command-source-audit';

test('actor capture rolls back with the source, binds tenant scope, expires attribution and omits row contents', () => {
  const db = createReactiveDB({ mode: 'memory' }); db.defineTable('records', { id: 'text primary key', content: 'text' });
  const policy = normalizeLoggingActorSourceBinding({ records: true, policyVersion: 'policy-v1', scope: { kind: 'tenant', tenantId: 'tenant-a' } });
  const source = new LoggingActorSource(db, policy);
  try {
    expect(() => source.run(loggingContext('tenant-a'), () => db.transaction(() => { db.create('records', { id: 'abort', content: 'PRIVATE' }); throw new Error('rollback'); }))).toThrow('rollback');
    expect(source.control({}).queued).toBe(0);
    source.run(loggingContext('tenant-a'), () => db.create('records', { id: 'attributed', content: 'PRIVATE' }));
    db.create('records', { id: 'background' });
    const page = normalizeLoggingActorSourcePage(source.control({}), policy.scope);
    expect(page.queued).toBe(2); expect(page.rows[0]!.event.actor.kind).toBe('user'); expect(page.rows[1]!.event.actor.kind).toBe('system');
    expect(page.rows.every(row => row.event.scope.tenantId === 'tenant-a')).toBe(true); expect(JSON.stringify(page)).not.toContain('PRIVATE');
    expect(() => source.run(loggingContext('tenant-b'), () => db.create('records', { id: 'forged' }))).toThrow();
    expect(db.get('records', 'forged')).toBeNull();
    const id = page.rows[0]!.id;
    expect(source.control({ acknowledge: [id] }).queued).toBe(1); expect(source.control({ acknowledge: [id] }).queued).toBe(1);
    expect(() => normalizeLoggingActorSourcePage(page, { kind: 'tenant', tenantId: 'tenant-b' })).toThrow();
    expect(() => source.control({ acknowledge: [id], scope: 'forged' })).toThrow();
  } finally { source.close(); db.dispose(); }
});

test('full actor outbox rejects the business change in the same transaction, without losing earlier evidence', () => {
  const db = createReactiveDB({ mode: 'memory' }); db.defineTable('records', { id: 'text primary key' });
  const source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: true, policyVersion: 'policy-v1', sourceQueue: { maxEvents: 10000 }, scope: { kind: 'application', tenantId: null } }));
  try {
    db.transaction(() => { for (let i = 0; i < 10000; i++) db.create('records', { id: 'row-' + i }); });
    expect(source.control({}).queued).toBe(10000);
    expect(() => db.create('records', { id: 'must-not-commit' })).toThrow(expect.objectContaining({ code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }));
    expect(db.get('records', 'must-not-commit')).toBeNull(); expect(source.control({}).queued).toBe(10000);
  } finally { source.close(); db.dispose(); }
}, 20000);

test('source SQLite capacity failure rolls back both data and evidence and permits a clean retry', () => {
  const db = createReactiveDB({ mode: 'memory' }); db.defineTable('records', { id: 'text primary key', content: 'text' });
  const source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: true, policyVersion: 'policy-v1', scope: { kind: 'application', tenantId: null } }));
  try {
    const count = (db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count;
    db.prepare('PRAGMA max_page_count=' + (count + 1)).get();
    expect(() => db.transaction(() => { for (let i = 0; i < 100; i++) db.create('records', { id: 'limited-' + i, content: 'x'.repeat(2048) }); })).toThrow();
    expect(db.list('records')).toHaveLength(0); expect(source.control({}).queued).toBe(0);
    db.prepare('PRAGMA max_page_count=10000').get();
    db.create('records', { id: 'retry' }); expect(source.control({}).queued).toBe(1);
  } finally { source.close(); db.dispose(); }
});

test('reducing the configured budget preserves previously admitted source evidence and shared attribution is reclaimed after acknowledgment', () => {
  const db = createReactiveDB({ mode: 'memory' }); db.defineTable('records', { id: 'text primary key' });
  let source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: true, policyVersion: 'old-policy', scope: { kind: 'application', tenantId: null } }));
  try {
    db.create('records', { id: 'one' }); db.create('records', { id: 'two' }); source.close();
    expect((db.prepare('SELECT count(*) AS n FROM _zero_logging_contexts').get() as { n: number }).n).toBe(1);
    source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: true, policyVersion: 'new-policy', sourceQueue: { maxEvents: 1 }, scope: { kind: 'application', tenantId: null } }));
    const queued = source.control({}); expect(queued.queued).toBe(2);
    expect(queued.rows.every(row => row.event.policyVersion === 'old-policy')).toBe(true);
    expect(() => db.create('records', { id: 'three' })).toThrow();
    source.control({ acknowledge: queued.rows.map(row => row.id) });
    expect((db.prepare('SELECT count(*) AS n FROM _zero_logging_contexts').get() as { n: number }).n).toBe(0);
    db.create('records', { id: 'three' }); expect(source.control({}).rows[0]!.event.policyVersion).toBe('new-policy');
  } finally { source.close(); db.dispose(); }
});

test('command source workflow capture is independent of records and command authority is revoked before return', () => {
  const event = { id: 'semantic-command', family: 'workflow' as const, action: 'jobs.schedule.created', outcome: 'succeeded' as const,
    occurredAt: 1700000000000, target: { type: 'job.schedule', id: 'synthetic-job' }, metadata: { revision: 1 } };
  for (const capture of [{ records: true, workflow: false }, { records: false, workflow: true }, { records: true, workflow: true }]) {
    const db = createReactiveDB({ mode: 'memory' }); db.defineTable('records', { id: 'text primary key' });
    const source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ ...capture, policyVersion: 'semantic-policy', scope: { kind: 'tenant', tenantId: 'tenant-a' } }));
    const retained: { context: DatabaseWriteCommandContext | null } = { context: null };
    const realm = defineDatabaseRealm({ name: 'source-audit-fixture', version: '1', tables: { records: { id: 'text primary key' } }, commands: {
      'fixture.create': context => { retained.context = context; context.db.createStrict('records', { id: 'synthetic-job' }); appendDatabaseCommandSourceAudit(context, event); return null; },
    } });
    try {
      source.run(loggingContext('tenant-a'), () => runDatabaseRealmCommand(realm, db, 'fixture.create', {}));
      const page = source.control({});
      const expected: ('records' | 'workflow')[] = [];
      if (capture.records) expected.push('records'); if (capture.workflow) expected.push('workflow');
      expect(page.rows.map(row => row.event.family).sort()).toEqual(expected.sort());
      expect(page.rows.every(row => row.event.actor.id === 'fixture-user' && row.event.scope.tenantId === 'tenant-a' && row.event.evidence === 'server-confirmed')).toBe(true);
      expect(() => appendDatabaseCommandSourceAudit(retained.context!, event)).toThrow(expect.objectContaining({ code: 'DATABASE_CLOSED' }));
      const session = createDatabaseWriteCommandSession(db);
      try { expect(() => appendDatabaseCommandSourceAudit(session.context, event)).toThrow(expect.objectContaining({ code: 'DATABASE_OPERATION_UNSUPPORTED' })); }
      finally { session.close(); }
      expect(() => source.run(loggingContext('tenant-b'), () => runDatabaseRealmCommand(realm, db, 'fixture.create', {}))).toThrow(expect.objectContaining({ code: 'DATABASE_AUTHORITY_CHANGED' }));
    } finally { source.close(); db.dispose(); }
  }
});

test('semantic source events cannot supply attribution or provider confirmation and a retired source cannot silently disable audit', () => {
  const db = createReactiveDB({ mode: 'memory' }); db.defineTable('records', { id: 'text primary key' });
  const source = new LoggingActorSource(db, normalizeLoggingActorSourceBinding({ records: false, workflow: true, policyVersion: 'semantic-policy', scope: { kind: 'application', tenantId: null } }));
  const session = createDatabaseWriteCommandSession(db);
  const event = { id: 'semantic-command', family: 'workflow' as const, action: 'jobs.schedule.created', outcome: 'succeeded' as const,
    occurredAt: 1700000000000, target: { type: 'job.schedule', id: 'synthetic-job' } };
  try {
    expect(() => db.transaction(() => appendDatabaseCommandSourceAudit(session.context, { ...event, evidence: 'provider-confirmed' } as typeof event))).toThrow();
    expect(() => db.transaction(() => appendDatabaseCommandSourceAudit(session.context, { ...event, actor: loggingContext(null).actor } as typeof event))).toThrow();
    expect(source.control({}).queued).toBe(0);
    source.close();
    expect(() => db.transaction(() => appendDatabaseCommandSourceAudit(session.context, event))).toThrow(expect.objectContaining({ code: 'DATABASE_CLOSED' }));
  } finally { session.close(); source.close(); db.dispose(); }
});

test('a yielded command source capture cannot grant business commit authority', () => {
  const db = createReactiveDB({ mode: 'memory' }); db.defineTable('records', { id: 'text primary key' });
  const remove = registerDatabaseCommandSourceAudit(db, async () => { throw new Error('synthetic asynchronous capture'); });
  const realm = defineDatabaseRealm({ name: 'yielded-source-audit-fixture', version: '1', tables: { records: { id: 'text primary key' } }, commands: {
    'fixture.create': context => { context.db.createStrict('records', { id: 'must-rollback' }); appendDatabaseCommandSourceAudit(context,
      { id: 'yielded-command', family: 'workflow', action: 'jobs.schedule.created', outcome: 'succeeded', occurredAt: 1700000000000 }); return null; },
  } });
  try {
    expect(() => runDatabaseRealmCommand(realm, db, 'fixture.create', {})).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID', outcome: 'not-committed' }));
    expect(db.get('records', 'must-rollback')).toBeNull();
  } finally { remove(); db.dispose(); }
});
