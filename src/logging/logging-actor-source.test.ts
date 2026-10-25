/** Actor-local atomicity, evidence budget and attribution checks with disposable ReactiveDB state. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { LoggingActorSource, normalizeLoggingActorSourceBinding, normalizeLoggingActorSourcePage } from './logging-actor-source';
import { loggingContext } from './test-support/logging-fixture';

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
