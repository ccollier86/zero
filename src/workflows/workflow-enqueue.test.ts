/** Commit acknowledgements remain independent of long activities; eager starts retain their existing behavior. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { createReactiveDB } from '../sync/reactive-db';
import { flow, step } from './workflow-dsl';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';
import { WorkflowError } from './workflow-error';

function fixture(path?: string) {
  const db = createReactiveDB(path ? { mode: 'file', path } : { mode: 'memory' }); defineWorkflowTables(db);
  const registry = new WorkflowRegistry();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const calls = { slow: 0, fast: 0 };
  const slow = async () => { calls.slow++; entered(); await gate; return { finished: true }; };
  registry.registerActivity({ name: 'slow', version: '1', handler: slow });
  registry.registerActivity({ name: 'fast', version: '1', handler: async () => { calls.fast++; return { finished: true }; } });
  registry.create({ name: 'slow', version: 1, flow: flow(step('run', { name: 'slow', version: '1' })) });
  registry.create({ name: 'fast', version: 1, flow: flow(step('run', { name: 'fast', version: '1' })) });
  registry.registerHandler('slow-event', slow);
  registry.create({ name: 'wait', steps: [{ name: 'Reply', handler: 'slow-event', waitFor: 'continue' }] });
  const service = new WorkflowService(db, registry, { wakeTimer: false });
  return { db, service, registry, release, started, calls, async close() { release(); await service.dispose(); db.dispose(); } };
}
const system = (idempotencyKey = 'one') => ({ principal: 'enqueue-test', reason: 'Synthetic durable handoff', scope: applicationServiceDataScope(), idempotencyKey });

test('enqueued starts and exact replays acknowledge while an activity remains blocked, without blocking a different run', async () => {
  const f = fixture();
  try {
    const receipt = await bounded(f.service.enqueueAsSystemOnce('slow', { value: 1 }, system()));
    await bounded(f.started);
    expect(f.service.get(receipt.instanceId)?.status).toBe('running');
    expect(await bounded(f.service.enqueueAsSystemOnce('slow', { value: 1 }, system()))).toEqual(receipt);
    const fast = await bounded(f.service.startAsSystemOnce('fast', {}, system('other')));
    expect(f.service.get(fast.instanceId)?.status).toBe('completed');
    expect(f.calls).toEqual({ slow: 1, fast: 1 });
    await expect(f.service.enqueueAsSystemOnce('slow', { value: 2 }, system())).rejects.toMatchObject({ code: 'WORKFLOW_START_IDEMPOTENCY_CONFLICT' });
    f.release(); await bounded(f.service.advance(receipt.instanceId));
    expect(await f.service.startAsSystemOnce('slow', { value: 1 }, system())).toEqual(receipt);
    expect(f.calls.slow).toBe(1);
  } finally { await f.close(); }
});

test('ordinary eager starts still join the initial activity instead of silently changing their contract', async () => {
  const f = fixture();
  try {
    let acknowledged = false;
    const started = f.service.startAsSystemOnce('slow', {}, system()).then(value => { acknowledged = true; return value; });
    await bounded(f.started); expect(acknowledged).toBe(false);
    f.release(); const receipt = await bounded(started);
    expect(f.service.get(receipt.instanceId)?.status).toBe('completed');
  } finally { await f.close(); }
});

test('enqueue preserves independent-transaction, rollback and final authority fences before publishing a receipt', async () => {
  const f = fixture();
  try {
    let nested!: ReturnType<WorkflowService['enqueueAsSystemOnce']>;
    f.db.transaction(() => { nested = f.service.enqueueAsSystemOnce('fast', {}, system()); });
    await expect(nested).rejects.toMatchObject({ code: 'WORKFLOW_REQUEST_INVALID' });
    await expect(f.service.enqueueAsSystemOnce('fast', {}, system(), {}, { assertCurrentAuthority() {
      throw new WorkflowError('Synthetic revoked source', 'WORKFLOW_AUTHORITY_CHANGED', 409);
    } })).rejects.toMatchObject({ code: 'WORKFLOW_AUTHORITY_CHANGED' });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM workflow_instances').get()).toEqual({ count: 0 });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM _workflow_system_start_receipts').get()).toEqual({ count: 0 });
    expect(f.calls.fast).toBe(0);
  } finally { await f.close(); }
});

test('enqueued resume events acknowledge without joining slow downstream work and preserve event idempotency', async () => {
  const f = fixture();
  try {
    const instanceId = await f.service.start('wait');
    const receipt = await bounded(f.service.enqueueEventAsSystem(instanceId, 'continue', { value: 1 }, system()));
    await bounded(f.started);
    expect(f.service.get(instanceId)?.status).toBe('running');
    expect(await bounded(f.service.enqueueEventAsSystem(instanceId, 'continue', { value: 1 }, system()))).toEqual(receipt);
    await expect(f.service.enqueueEventAsSystem(instanceId, 'continue', { value: 2 }, system())).rejects.toMatchObject({ code: 'WORKFLOW_EVENT_IDEMPOTENCY_CONFLICT' });
    expect(f.calls.slow).toBe(1);
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM workflow_events').get()).toEqual({ count: 1 });
    f.release(); await bounded(f.service.advance(instanceId));
    expect(f.service.get(instanceId)?.status).toBe('completed');
  } finally { await f.close(); }
});

test('event enqueue rejects nested transactions and async authority fences without recording an event', async () => {
  const f = fixture();
  try {
    const instanceId = await f.service.start('wait');
    for (const method of ['enqueueEventAsSystem', 'deliverEventAsSystem'] as const) {
      let nested!: ReturnType<WorkflowService['enqueueEventAsSystem']>;
      f.db.transaction(() => { nested = f.service[method](instanceId, 'continue', {}, system()); });
      await expect(nested).rejects.toMatchObject({ code: 'WORKFLOW_REQUEST_INVALID' });
    }
    await expect(f.service.enqueueEventAsSystem(instanceId, 'continue', {}, system(), {
      assertCurrentAuthority: async () => undefined,
    })).rejects.toMatchObject({ code: 'WORKFLOW_CONFIG_INVALID' });
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM workflow_events').get()).toEqual({ count: 0 });
    expect(f.calls.slow).toBe(0);
  } finally { await f.close(); }
});

test('a committed enqueue whose first dispatch is lost recovers after a real file/database restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'torrent-enqueue-recovery-'));
  let owner: ReturnType<typeof fixture> | undefined;
  try {
    const path = join(root, 'workflow.db'); owner = fixture(path);
    // Simulate the process-loss window after commit but before an owned pump starts.
    const hooks = (owner.service as unknown as { idempotentStarts: { hooks: { dispatch(id: string): void } } }).idempotentStarts.hooks;
    hooks.dispatch = () => {};
    const receipt = await owner.service.enqueueAsSystemOnce('fast', {}, system());
    expect(owner.calls.fast).toBe(0);
    expect(owner.service.get(receipt.instanceId)?.status).toBe('running');
    await owner.close(); owner = undefined;
    owner = fixture(path); await owner.service.recoverInFlight();
    const recovered = owner;
    await bounded((async () => { while (recovered.service.get(receipt.instanceId)?.status !== 'completed') await Bun.sleep(1); })());
    expect(owner.service.get(receipt.instanceId)?.status).toBe('completed');
    expect(owner.calls.fast).toBe(1);
    expect(await owner.service.enqueueAsSystemOnce('fast', {}, system())).toEqual(receipt);
    expect(owner.calls.fast).toBe(1);
  } finally { await owner?.close(); await rm(root, { recursive: true, force: true }); }
});

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Durable enqueue did not acknowledge before the blocked activity')), 2000); })]); }
  finally { clearTimeout(timer); }
}
