/** Real tenant/named writer subprocesses and a separate log realm; no live data, accounts, or provider calls. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlatformSQLiteService } from '../persistence';
import { DatabaseRuntime } from '../databases/database-runtime';
import { DatabaseManager } from '../databases/database-manager';
import { DatabaseCoordinator } from '../databases/database-coordinator';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { createSubprocessDatabaseExecutorFactory } from '../databases/subprocess-database-executor-factory';
import { databaseActorFixtureRealm } from '../databases/test-fixtures/database-actor-realm';
import { installLoggingFabricCapture } from './logging-fabric-capture';
import { LoggingRuntime } from './logging-runtime';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from './logging-managed-config';
import { MemoryEventStore } from '../observability/memory-event-store';
import { runWithLoggingAttribution } from './logging-attribution';
import { loggingContext } from './test-support/logging-fixture';
import type { LoggingEvent } from './logging-contracts';
import { deriveNamedDatabaseId, deriveTenantDatabaseId } from '../databases/database-binding-ref';
import { resolveDatabaseFile } from '../databases/database-file';
import { DATABASE_FILE_PLACEMENT_POLICY, DATABASE_HOT_SHORTHAND_PLACEMENT_POLICY } from '../databases/database-placement';
import { installDatabaseLoggingBinding, prepareDatabaseLoggingBinding } from '../databases/database-logging-binding';
import { normalizeLoggingSourceLimits } from './logging-source-limits';
import type { DatabaseExecutorValue } from '../databases/database-executor';
import type { LoggingFabricStore } from './logging-fabric-store';

test.each(['file', 'hot'] as const)('independent %s Fabric capture preserves tenant attribution, transaction rollback and restart recovery after sink acknowledgment loss', async placement => {
  const root = await mkdtemp(join(tmpdir(), 'logging-tenant-capture-'));
  const store = new MemoryEventStore();
  const logging = await LoggingRuntime.open(resolveManagedLoggingConfig({ rootDirectory: join(root, 'logs'), preset: 'activity',
    resources: { todos: { fields: { title: { values: ['draft', 'approved'] } } } } }, root) as ResolvedManagedLoggingConfig,
    { sink: store, store, config: { console: false } });
  let manager: DatabaseManager | undefined, capture: ReturnType<typeof installLoggingFabricCapture> = null;
  let fail = true;
  const delivered = new Set<string>();
  // Fault the actual private sink after commit, not the public direct-event
  // facade: source delivery now originates in the dedicated subprocess.
  const sink = (logging as unknown as { streams: Map<string, { store: LoggingFabricStore }> }).streams.get('audit')!.store;
  const append = sink.append.bind(sink);
  sink.append = async events => { const result = await append(events); events.forEach(event => delivered.add(event.id)); if (fail) throw new Error('Synthetic lost receipt'); return result; };
  const open = () => {
    const systemRuntime = DatabaseRuntime.open({ id: 'system', role: 'system', sqlite: createPlatformSQLiteService({ mode: 'file', path: join(root, 'system.db') }), ownsSQLite: true });
    const appRuntime = DatabaseRuntime.open({ id: 'default', role: 'default', sqlite: createPlatformSQLiteService({ mode: 'file', path: join(root, 'application.db') }), ownsSQLite: true });
    const authority = new AuthorityCommitCoordinator();
    const coordinator = new DatabaseCoordinator({ rootDirectory: join(root, 'fabric'), realm: databaseActorFixtureRealm,
      createExecutor: createSubprocessDatabaseExecutorFactory({ launch: { kind: 'source', entrypoint: new URL('../databases/test-fixtures/database-actor-same-entry.ts', import.meta.url) }, env: {} }),
      placement: placement === 'file' ? DATABASE_FILE_PLACEMENT_POLICY : DATABASE_HOT_SHORTHAND_PLACEMENT_POLICY,
      maxDatabases: 4, readers: true, sweepIntervalMs: false, sqlite: { synchronous: 'FULL' }, authorityCommitCoordinator: authority, requireCommitAuthority: true });
    manager = new DatabaseManager({ systemRuntime, appRuntime, multiple: { coordinator, tenantDatabases: true, authorityCommitCoordinator: authority } });
    capture = installLoggingFabricCapture(logging, manager, systemRuntime.db, join(root, 'fabric'), () => {}); manager.start();
    return manager;
  };
  try {
    const first = open();
    const a = await first.bindTenant({ tenantId: 'tenant-a', assertCurrentAuthoritySync: () => undefined });
    const b = await first.bindTenant({ tenantId: 'tenant-b', assertCurrentAuthoritySync: () => undefined });
    try {
      await Promise.all([
        runWithLoggingAttribution(logging, loggingContext('tenant-a'), () => {}, () => a.client.mutate({ type: 'create', table: 'todos', row: { id: 'a', title: 'PRIVATE_ROW_A' } }, { idempotencyKey: 'create-a' })),
        b.client.mutate({ type: 'create', table: 'todos', row: { id: 'b', title: 'PRIVATE_ROW_B' } }, { idempotencyKey: 'create-b' }),
      ]);
      await expect(a.client.batch({ mutations: [{ type: 'create', table: 'todos', row: { id: 'abort', title: 'never' } }, { type: 'create', table: 'todos', row: { id: 'a', title: 'conflict' } }] }, { idempotencyKey: 'abort' })).rejects.toMatchObject({ code: 'DATABASE_CONFLICT', outcome: 'not-committed' });
      expect((await a.client.get('todos', 'abort')).value).toBeNull();
      await capture!.flush();
      expect(delivered.size).toBe(2); expect(capture!.diagnostics().queued).toBe(2);
      const pa = await logging.page('audit', { kind: 'tenant', tenantId: 'tenant-a' });
      expect(pa.events).toHaveLength(1); expect(pa.events[0]!.event.actor.kind).toBe('user');
      expect(pa.events[0]!.event.detail).toMatchObject({ kind: 'record-change', table: 'todos', changes: [
        { field: 'id', kind: 'redacted' }, { field: 'title', kind: 'redacted' },
      ] });
      expect((await logging.page('audit', { kind: 'tenant', tenantId: 'tenant-b' })).events[0]!.event.actor.kind).toBe('system');
      expect(JSON.stringify(pa)).not.toContain('PRIVATE_ROW');
      expect(first.diagnostics().coordinator?.heldAuthorityLeases).toBe(0);
    } finally { a.release(); b.release(); }
    const catalog = first.systemRuntime.db.prepare('SELECT root_id FROM _zero_logging_fabric_sources LIMIT 1').get() as { root_id: string };
    first.systemRuntime.db.prepare('INSERT INTO _zero_logging_fabric_sources(id,scope_kind,tenant_id,root_id) VALUES(?,?,?,?)').run(deriveTenantDatabaseId('missing-source'), 'tenant', 'missing-source', catalog.root_id);
    await capture!.close(); await first.close();
    fail = false; open(); await capture!.flush();
    expect(capture!.diagnostics()).toMatchObject({ queued: 0, pendingSources: 0, sources: 3 });
    expect(delivered.size).toBe(2);
    expect((await logging.page('audit', { kind: 'platform' })).events).toHaveLength(2);
    expect(manager!.diagnostics().coordinator?.databaseFiles).toBe(2);
    expect(await Bun.file(resolveDatabaseFile(join(root, 'fabric'), deriveTenantDatabaseId('missing-source')).path).exists()).toBe(false);
    const named = await manager!.acquireNamed('shared');
    try { await named.execute({ type: 'mutate', mutation: { type: 'create', table: 'todos', row: { id: 'named', title: 'private' } }, idempotencyKey: 'create-named' }); }
    finally { named.release(); }
    const file = resolveDatabaseFile(join(root, 'fabric'), deriveNamedDatabaseId('shared')).path;
    const before = placement === 'hot' ? new Bun.CryptoHasher('sha256').update(await Bun.file(file).arrayBuffer()).digest('hex') : null;
    await capture!.flush(); expect((await logging.page('audit', { kind: 'application' })).events).toHaveLength(1);
    if (before) expect(new Bun.CryptoHasher('sha256').update(await Bun.file(file).arrayBuffer()).digest('hex')).toBe(before);
    const editing = await manager!.bindTenant({ tenantId: 'tenant-a', assertCurrentAuthoritySync: () => undefined });
    try {
      for (const title of ['draft', 'approved']) await runWithLoggingAttribution(logging, loggingContext('tenant-a'), () => {},
        () => editing.client.mutate({ type: 'update', table: 'todos', id: 'a', patch: { title } }, { idempotencyKey: 'edit-' + title }));
      await capture!.flush();
      const edited = await logging.page('audit', { kind: 'tenant', tenantId: 'tenant-a' }, { action: 'record.updated', targetId: 'a' });
      expect(edited.events).toHaveLength(2);
      expect(edited.events[0]!.event.detail).toMatchObject({ kind: 'record-change', table: 'todos', changes: [
        { field: 'title', kind: 'value', before: 'draft', after: 'approved' },
      ] });
    } finally { editing.release(); }
  } finally { await (capture as ReturnType<typeof installLoggingFabricCapture>)?.close(); await manager?.close(); await logging.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test('managed capture refuses to publish an actor binding that omits its audit readiness proof', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-unqualified-actor-'));
  const factory = createSubprocessDatabaseExecutorFactory({ launch: { kind: 'source', entrypoint: new URL('../databases/test-fixtures/database-actor-same-entry.ts', import.meta.url) }, env: {} });
  const coordinator = new DatabaseCoordinator({ rootDirectory: root, realm: databaseActorFixtureRealm, sweepIntervalMs: false,
    createExecutor(context) {
      const executor = factory(context), execute = executor.execute.bind(executor);
      executor.execute = (async (request, options) => {
        const value = await execute(request, options);
        if (request.operation !== 'database.writer.bind') return value;
        const { loggingPolicyFingerprint, ...unqualified } = value as Record<string, DatabaseExecutorValue>;
        return unqualified;
      }) as typeof executor.execute;
      return executor;
    } });
  const remove = installDatabaseLoggingBinding(coordinator, { records: true, policyVersion: 'policy-a', sourceQueue: normalizeLoggingSourceLimits(), context: () => null });
  prepareDatabaseLoggingBinding(coordinator, 'source-a', { kind: 'application', tenantId: null });
  try {
    coordinator.start();
    await expect(coordinator.acquire('source-a')).rejects.toMatchObject({ code: 'DATABASE_PROTOCOL_ERROR', outcome: 'not-started' });
  } finally { await coordinator.close(); remove(); await rm(root, { recursive: true, force: true }); }
}, 20000);
