/** Durability, source fences, replay identity and rollback for privileged once-only starts. */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { MemoryEventStore } from '../observability';
import { OBS_CODES } from '../observability/codes';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { WorkflowDefinitionManager } from './workflow-definition-manager';
import { flow, step } from './workflow-dsl';
import { WorkflowError } from './workflow-error';
import { createWorkflowObservability } from './workflow-observability';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { getWorkflowGraphRuntime, WorkflowService } from './workflow-service';

const databases: ReactiveDB[] = [];
const services: WorkflowService[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.allSettled(services.splice(0).map(service => service.dispose()));
  for (const db of databases.splice(0)) db.dispose();
  // These exact mkdtemp directories contain only this test's disposable SQLite files.
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const system = (idempotencyKey = 'effect:one') => ({ principal: 'system-start-test', reason: 'Test retry-safe workflow creation',
  scope: applicationServiceDataScope(), idempotencyKey });

describe('idempotent privileged workflow starts', () => {
  test('rejects async authority fences without an unhandled rejection or then getter access', async () => {
    const { db, service, calls } = fixture();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on('unhandledRejection', onUnhandled);
    let getterReads = 0;
    try {
      const rejected = Promise.reject(new Error('Rejected async fence'));
      Object.defineProperty(rejected, 'then', { get() { getterReads++; throw new Error('Do not inspect then getter'); } });
      await expect(service.startAsSystemOnce('legacy', {}, system(), {},
        { assertCurrentAuthority: () => rejected as unknown as void })).rejects.toMatchObject({ code: 'WORKFLOW_CONFIG_INVALID', status: 500 });
      await Bun.sleep(1);
      expect(unhandled).toEqual([]);
      expect(getterReads).toBe(0);
      expect(count(db, 'workflow_instances')).toBe(0);
      expect(calls.value).toBe(0);
    } finally { process.removeListener('unhandledRejection', onUnhandled); }
  });

  test('rejects nested starts and replays before creation, execution or premature acknowledgement', async () => {
    const { db, service, calls } = fixture();
    let pending!: ReturnType<WorkflowService['startAsSystemOnce']>;
    db.transaction(() => { pending = service.startAsSystemOnce('legacy', {}, system()); });
    await expect(pending).rejects.toMatchObject({ code: 'WORKFLOW_REQUEST_INVALID', status: 422 });
    expect(() => db.transaction(() => {
      pending = service.startAsSystemOnce('legacy', {}, system());
      throw new Error('Outer rollback');
    })).toThrow('Outer rollback');
    await expect(pending).rejects.toMatchObject({ code: 'WORKFLOW_REQUEST_INVALID' });
    expect(count(db, 'workflow_instances')).toBe(0);
    expect(count(db, '_workflow_system_start_receipts')).toBe(0);
    expect(calls.value).toBe(0);
    await service.startAsSystemOnce('legacy', {}, system());
    db.transaction(() => { pending = service.startAsSystemOnce('legacy', {}, system()); });
    await expect(pending).rejects.toMatchObject({ code: 'WORKFLOW_REQUEST_INVALID' });
    expect(count(db, 'workflow_instances')).toBe(1);
    expect(calls.value).toBe(1);
  });

  test('rejects a source fence that changes the pinned command after receipt creation', async () => {
    const { db, service, calls } = fixture();
    await expect(service.startAsSystemOnce('legacy', { value: 'original' }, system(), {}, {
      assertCurrentAuthority() {
        const receipt = db.prepare('SELECT instance_id FROM _workflow_system_start_receipts').get() as { instance_id: string } | null;
        if (receipt) db.update('workflow_instances', receipt.instance_id, { input: '{"value":"changed"}' });
      },
    })).rejects.toMatchObject({ code: 'WORKFLOW_STATE_INVALID', status: 500 });
    expect(count(db, 'workflow_instances')).toBe(0);
    expect(count(db, '_workflow_system_start_receipts')).toBe(0);
    expect(calls.value).toBe(0);
  });

  test('does not execute a pinned command altered by a reentrant committed-change listener', async () => {
    const { db, service, calls } = fixture();
    let changed = false;
    const unsubscribe = db.onChange(change => {
      if (change.table !== 'workflow_instances' || change.op !== 'INSERT' || changed) return;
      changed = true;
      db.update('workflow_instances', change.rowId, { input: '{"value":"changed-after-commit"}' });
    });
    try {
      await expect(service.startAsSystemOnce('legacy', { value: 'original' }, system())).rejects.toMatchObject({ code: 'WORKFLOW_STATE_INVALID', status: 500 });
      expect(changed).toBeTrue();
      expect(calls.value).toBe(0);
      expect(count(db, '_workflow_system_start_receipts')).toBe(1);
    } finally { unsubscribe(); }
  });

  test('concurrent calls create one graph and return the same frozen canonical acknowledgement', async () => {
    const { db, service, calls, events } = fixture();
    const results = await Promise.all(Array.from({ length: 40 }, () => service.startAsSystemOnce('graph',
      { z: 2, a: { x: true } }, system(), { initialMemory: { secret: 'private-seed' } })));
    expect(new Set(results.map(result => JSON.stringify(result))).size).toBe(1);
    expect(results.every(Object.isFrozen)).toBeTrue();
    expect(results[0]?.definitionVersion).toBe(1);
    expect(calls.value).toBe(1);
    expect(count(db, 'workflow_instances')).toBe(1);
    expect(count(db, 'workflow_steps')).toBe(1);
    expect(count(db, '_workflow_system_start_receipts')).toBe(1);
    expect(count(db, '_workflow_execution_authorities')).toBe(1);
    expect(await service.startAsSystemOnce('graph', { a: { x: true }, z: 2 }, system(),
      { initialMemory: { secret: 'private-seed' } })).toEqual(results[0]);
    expect(events.query({ code: OBS_CODES.WORKFLOW_SYSTEM_START_CREATED.code }).count).toBe(1);
    expect(events.query({ code: OBS_CODES.WORKFLOW_SYSTEM_START_REPLAYED.code }).count).toBe(40);
    expect(JSON.stringify(events.query({}).events)).not.toContain('private-seed');
    expect(JSON.stringify(events.query({}).events)).not.toContain('effect:one');
    expect(db.prepare('SELECT started_by FROM workflow_instances').get()).toEqual({ started_by: null });
  });

  test('changed command identity conflicts while separate keys and ordinary starts remain independent', async () => {
    const { db, service } = fixture();
    await service.startAsSystemOnce('graph', { value: 1 }, system(), { initialMemory: { secret: 'one' } });
    for (const [name, input, auth, options] of [
      ['graph', { value: 2 }, system(), { initialMemory: { secret: 'one' } }],
      ['legacy', { value: 1 }, system(), { initialMemory: { secret: 'one' } }],
      ['graph', { value: 1 }, { ...system(), reason: 'Changed source reason' }, { initialMemory: { secret: 'one' } }],
      ['graph', { value: 1 }, system(), { initialMemory: { secret: 'two' } }],
      ['graph', { value: 1 }, system(), { initialMemory: { secret: 'one' }, version: 1 }],
      ['graph', { value: 1 }, system(), { initialMemory: { secret: 'one' }, memoryLimits: { maxEntries: 300 } }],
    ] as const) {
      await expect(service.startAsSystemOnce(name, input, auth, options)).rejects.toMatchObject({ code: 'WORKFLOW_START_IDEMPOTENCY_CONFLICT', status: 409 });
    }
    expect(count(db, 'workflow_instances')).toBe(1);
    await service.startAsSystemOnce('graph', {}, system('effect:two'));
    const one = await service.startAsSystem('legacy', {}, system());
    const two = await service.startAsSystem('legacy', {}, system());
    expect(one).not.toBe(two);
    expect(count(db, 'workflow_instances')).toBe(4);
    expect(count(db, '_workflow_system_start_receipts')).toBe(2);
  });

  test('final source revocation rolls back graph, authority, steps, private memory and receipt', async () => {
    const { db, service, calls, events } = fixture();
    let checks = 0;
    await expect(service.startAsSystemOnce('graph', {}, system(), { initialMemory: { secret: 'forbidden' }, memoryLimits: { maxEntries: 300 } }, {
      assertCurrentAuthority() {
        checks++;
        if (count(db, '_workflow_system_start_receipts') === 1) throw new WorkflowError('Source authority changed', 'WORKFLOW_AUTHORITY_CHANGED', 409);
      },
    })).rejects.toMatchObject({ code: 'WORKFLOW_AUTHORITY_CHANGED', status: 409 });
    expect(checks).toBeGreaterThanOrEqual(2);
    for (const table of ['workflow_instances', 'workflow_steps', '_workflow_execution_authorities', '_workflow_memory', '_workflow_memory_policies', '_workflow_system_start_receipts']) expect(count(db, table)).toBe(0);
    expect(calls.value).toBe(0);
    expect(events.query({ code: OBS_CODES.WORKFLOW_INSTANCE_STARTED.code }).count).toBe(0);
    expect(events.query({ code: OBS_CODES.WORKFLOW_SYSTEM_START_CREATED.code }).count).toBe(0);
  });

  test('receipt insertion failure rolls back the whole graph and publishes no start', async () => {
    const { db, service, calls } = fixture();
    db.exec(`CREATE TRIGGER reject_system_start BEFORE INSERT ON _workflow_system_start_receipts
      BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END`);
    await expect(service.startAsSystemOnce('graph', {}, system(), { initialMemory: { secret: 'not-committed' } }))
      .rejects.toMatchObject({ code: 'WORKFLOW_INTERNAL_ERROR', status: 500 });
    for (const table of ['workflow_instances', 'workflow_steps', '_workflow_execution_authorities', '_workflow_memory', '_workflow_system_start_receipts']) expect(count(db, table)).toBe(0);
    expect(calls.value).toBe(0);
  });

  test('replay checks source authority again and does not return a revoked acknowledgement', async () => {
    const { db, service } = fixture();
    const original = await service.startAsSystemOnce('legacy', {}, system());
    let checks = 0;
    await expect(service.startAsSystemOnce('legacy', {}, system(), {}, { assertCurrentAuthority() {
      if (++checks === 2) throw new WorkflowError('Source revoked', 'WORKFLOW_AUTHORITY_CHANGED', 409);
    } })).rejects.toMatchObject({ code: 'WORKFLOW_AUTHORITY_CHANGED' });
    expect(checks).toBe(2);
    expect(count(db, 'workflow_instances')).toBe(1);
    expect(await service.startAsSystemOnce('legacy', {}, system())).toEqual(original);
  });

  test('post-commit advancement failure retains a receipt and replay re-kicks the same run', async () => {
    const { db, service, calls } = fixture();
    const hooks = startHooks(service);
    const advance = hooks.advance;
    const interruption = new Error('Interrupted before first advancement');
    hooks.advance = async () => { throw interruption; };
    await expect(service.startAsSystemOnce('legacy', {}, system())).rejects.toBe(interruption);
    expect(count(db, 'workflow_instances')).toBe(1);
    expect(count(db, '_workflow_system_start_receipts')).toBe(1);
    expect(calls.value).toBe(0);
    const row = db.prepare('SELECT instance_id FROM _workflow_system_start_receipts').get() as { instance_id: string };
    expect(service.getSteps(row.instance_id)[0]?.status).toBe('pending');
    hooks.advance = advance;
    expect((await service.startAsSystemOnce('legacy', {}, system())).instanceId).toBe(row.instance_id);
    expect(service.get(row.instance_id)?.status).toBe('completed');
    expect(calls.value).toBe(1);
  });

  test('file restart recovery advances a committed start without creating a replacement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-system-start-'));
    directories.push(directory);
    const path = join(directory, 'system.sqlite');
    const first = fixture(path);
    startHooks(first.service).advance = async () => { throw new Error('Crash after commit'); };
    await expect(first.service.startAsSystemOnce('graph', {}, system(), { initialMemory: { secret: 'retained' } })).rejects.toThrow('Crash after commit');
    const receipt = first.db.prepare('SELECT instance_id FROM _workflow_system_start_receipts').get() as { instance_id: string };
    await first.service.dispose(); first.db.dispose();
    const second = fixture(path);
    await second.service.recoverInFlight();
    await second.service.advance(receipt.instance_id);
    const replay = await second.service.startAsSystemOnce('graph', {}, system(), { initialMemory: { secret: 'retained' } });
    expect(replay.instanceId).toBe(receipt.instance_id);
    expect(second.service.get(replay.instanceId)?.status).toBe('completed');
    expect(second.calls.value).toBe(1);
    expect(count(second.db, 'workflow_instances')).toBe(1);
  });

  test('replays stay pinned when the active database-authored version changes', async () => {
    const { service, registry } = fixture();
    const manager = new WorkflowDefinitionManager(registry, getWorkflowGraphRuntime(service).versions);
    const graph = registry.getCompiledWorkflow('graph')!.graph;
    manager.publish({ name: 'persisted', graph }, 'system-test');
    const original = await service.startAsSystemOnce('persisted', {}, system());
    manager.publish({ name: 'persisted', graph: { ...graph, nodes: graph.nodes.map(node => ({ ...node, label: 'Version two' })) }, version: 2 }, 'system-test');
    expect(await service.startAsSystemOnce('persisted', {}, system())).toEqual(original);
    expect((await service.startAsSystemOnce('persisted', {}, system('effect:latest'))).definitionVersion).toBe(2);
  });

  test('scope and principal isolate the same effect key without a fabricated user', async () => {
    const { db, service } = fixture(undefined, 'multi');
    const a = { ...system(), scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'tenant-a' }) };
    const b = { ...system(), scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'tenant-b' }) };
    const results = await Promise.all([service.startAsSystemOnce('legacy', {}, a), service.startAsSystemOnce('legacy', {}, b),
      service.startAsSystemOnce('legacy', {}, { ...a, principal: 'another-system' })]);
    expect(new Set(results.map(result => result.instanceId)).size).toBe(3);
    expect(await service.startAsSystemOnce('legacy', {}, a)).toEqual(results[0]);
    expect(count(db, '_workflow_system_start_receipts')).toBe(3);
    expect(db.prepare('SELECT DISTINCT authority_kind, actor_user_id FROM _workflow_execution_authorities').all()).toEqual([{ authority_kind: 'system', actor_user_id: null }]);
  });

  test('private receipt mutation is forbidden and corruption fails replay and recovery closed', async () => {
    const { db, service } = fixture();
    startHooks(service).advance = async () => { throw new Error('before advance'); };
    await expect(service.startAsSystemOnce('graph', {}, system())).rejects.toThrow('before advance');
    expect(() => db.prepare('DELETE FROM _workflow_system_start_receipts').run()).toThrow('immutable');
    db.exec('PRAGMA foreign_keys = OFF');
    expect(() => db.prepare('DELETE FROM workflow_instances').run()).toThrow('receipt parent is immutable');
    db.exec('PRAGMA foreign_keys = ON');
    expect(() => db.prepare('UPDATE _workflow_system_start_receipts SET request_fingerprint = ?').run('0'.repeat(64))).toThrow('immutable');
    db.exec('DROP TRIGGER trg_workflow_system_start_receipt_immutable');
    db.prepare('UPDATE _workflow_system_start_receipts SET request_fingerprint = ?').run('0'.repeat(64));
    await expect(service.startAsSystemOnce('graph', {}, system())).rejects.toMatchObject({ code: 'WORKFLOW_STATE_INVALID', status: 500 });
    await expect(service.recoverInFlight()).rejects.toMatchObject({ code: 'WORKFLOW_STATE_INVALID', status: 500 });
  });

  test('rejects invalid keys before mutation and preserves undefined versus null input identity', async () => {
    const { db, service } = fixture();
    for (const idempotencyKey of ['', 'bad key', 'x'.repeat(129)]) await expect(service.startAsSystemOnce('legacy', {}, system(idempotencyKey)))
      .rejects.toMatchObject({ code: 'WORKFLOW_START_IDEMPOTENCY_INVALID', status: 422 });
    expect(count(db, 'workflow_instances')).toBe(0);
    await service.startAsSystemOnce('legacy', undefined, system());
    await expect(service.startAsSystemOnce('legacy', null, system())).rejects.toMatchObject({ code: 'WORKFLOW_START_IDEMPOTENCY_CONFLICT' });
  });
});

function fixture(path?: string, tenancyMode: 'single' | 'multi' = 'single') {
  const db = createReactiveDB(path ? { mode: 'file', path } : { mode: 'memory' });
  databases.push(db); defineWorkflowTables(db);
  const calls = { value: 0 };
  const registry = new WorkflowRegistry();
  registry.registerHandler('legacy-handler', async () => { calls.value++; return { handled: true }; });
  registry.create({ name: 'legacy', steps: [{ name: 'Act', handler: 'legacy-handler' }] });
  registry.registerActivity({ name: 'graph.act', databaseCallable: true, handler: async () => { calls.value++; return { handled: true }; } });
  registry.create({ name: 'graph', flow: flow(step('act', 'graph.act')) });
  const events = new MemoryEventStore();
  const runtime = new ZeroAppRuntime('system-start-test');
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false, store: events } });
  const service = new WorkflowService(db, registry, { tenancyMode, wakeTimer: false, observability: createWorkflowObservability(db, runtime) });
  services.push(service);
  return { db, service, registry, calls, events };
}
function count(db: ReactiveDB, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}
function startHooks(service: WorkflowService) {
  return (service as unknown as { systemStarts: { hooks: { advance(instanceId: string): Promise<void> } } }).systemStarts.hooks;
}
