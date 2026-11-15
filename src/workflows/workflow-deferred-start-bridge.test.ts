/** Exact sealed handoffs against the real Torrent runtime. Synthetic state only; no providers or app database. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { WorkflowService, getWorkflowGraphRuntime } from './workflow-service';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { flow, step } from './workflow-dsl';
import { workflowDeferredStarts } from './workflow-deferred-start-bridge';
import { WorkflowError } from './workflow-error';

function fixture(multi = false) {
  const db = createReactiveDB({ mode: 'memory' }); defineWorkflowTables(db);
  const registry = new WorkflowRegistry(), calls = { count: 0 };
  registry.registerActivity({ name: 'synthetic.echo', version: '1', databaseCallable: true, handler: async context => { calls.count++; return context.input; } });
  registry.create({ name: 'synthetic.report', version: 1, flow: flow(step('echo', { name: 'synthetic.echo', version: '1' })) });
  registry.registerHandler('legacy', async () => ({})); registry.create({ name: 'legacy', steps: [{ name: 'old', handler: 'legacy', retries: 1 }] });
  const service = new WorkflowService(db, registry, { tenancyMode: multi ? 'multi' : 'single', wakeTimer: false });
  return { db, service, registry, calls, bridge: workflowDeferredStarts(service), async close() { await service.dispose(); db.dispose(); } };
}
test('authority seals bind the durable generation, receipts reconcile without a new effect, and wrong commands cannot poison recovery', async () => {
  const f = fixture();
  try {
    const authority = f.bridge.system({ principal: 'synthetic.scheduler', reason: 'Synthetic scheduled task', scope: applicationServiceDataScope() });
    const pin = f.bridge.pin(authority, 'synthetic.report', { value: 1 }, 1), seal = f.bridge.seal(authority, 'jobs:synthetic:1');
    expect(f.bridge.open(seal, 'jobs:synthetic:1')).toEqual(authority);
    expect(() => f.bridge.open(seal, 'jobs:synthetic:2')).toThrow();
    expect(() => f.bridge.open({ ...seal, authorityMac: '0'.repeat(64) }, 'jobs:synthetic:1')).toThrow();
    expect(() => f.bridge.pin(authority, 'legacy', {}, 1)).toThrow();
    expect(f.bridge.inspect(authority, pin, { value: 1 }, 'job:one', 'jobs:synthetic:1')).toBeNull();
    const receipt = await f.bridge.enqueue(authority, pin, { value: 1 }, 'job:one', 'jobs:synthetic:1', () => {});
    expect(f.bridge.inspect(authority, pin, { value: 1 }, 'job:one', 'jobs:synthetic:1')!.receipt).toEqual(receipt);
    expect(await f.bridge.enqueue(authority, pin, { value: 1 }, 'job:one', 'jobs:synthetic:1', () => {})).toEqual(receipt);
    expect(() => f.bridge.inspect(authority, pin, { value: 2 }, 'job:one', 'jobs:synthetic:1')).toThrow();
    expect(() => f.bridge.inspect(authority, pin, { value: 1 }, 'job:one', 'jobs:synthetic:2')).toThrow();
    expect(() => f.bridge.inspect(authority, { ...pin, fingerprint: '0'.repeat(64) }, { value: 1 }, 'job:one', 'jobs:synthetic:1')).toThrow();
    expect(f.calls.count).toBe(1);
    expect(f.db.prepare('SELECT count(*) AS n FROM _workflow_system_start_receipts').get()).toEqual({ n: 1 });
  } finally { await f.close(); }
});
test('new handoffs retain the final synchronous source fence and disposal retires even read-only recovery', async () => {
  const f = fixture();
  try {
    const authority = f.bridge.system({ principal: 'synthetic.scheduler', reason: 'Synthetic scheduled task' }), pin = f.bridge.pin(authority, 'synthetic.report', {}, 1);
    expect(() => f.bridge.enqueue(authority, pin, {}, 'job:one', 'jobs:one:1', () => { throw new WorkflowError('Synthetic revoked source', 'WORKFLOW_AUTHORITY_CHANGED', 409); })).toThrow();
    expect(() => f.bridge.enqueue(authority, pin, {}, 'job:one', 'jobs:one:1', async () => {})).toThrow();
    expect(f.db.prepare('SELECT count(*) AS n FROM workflow_instances').get()).toEqual({ n: 0 });
    expect(f.calls.count).toBe(0);
    await f.service.dispose();
    expect(() => f.bridge.inspect(authority, pin, {}, 'job:one', 'jobs:one:1')).toThrow();
  } finally { await f.close(); }
});
test('a newly shadowing tenant definition cannot replace an admitted global-code pin at dispatch', async () => {
  const f = fixture(true), alpha = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'synthetic-alpha' }), beta = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'synthetic-beta' });
  try {
    const authority = f.bridge.system({ principal: 'synthetic.scheduler', reason: 'Synthetic scheduled task', scope: alpha });
    const pin = f.bridge.pin(authority, 'synthetic.report', {}, 1), compiled = f.registry.getCompiledWorkflow('synthetic.report')!;
    getWorkflowGraphRuntime(f.service).versions.publish({ name: compiled.name, source: 'database', graphFormat: 'graph', schemaVersion: 1,
      graph: compiled.graph, version: 1, scope: { type: 'tenant', id: alpha.tenantId } });
    expect(() => f.bridge.enqueue(authority, pin, {}, 'job:one', 'jobs:one:1', () => {})).toThrow();
    expect(f.calls.count).toBe(0);
    const other = f.bridge.system({ principal: 'synthetic.scheduler', reason: 'Synthetic scheduled task', scope: beta });
    const otherPin = f.bridge.pin(other, 'synthetic.report', {}, 1);
    await f.bridge.enqueue(other, otherPin, {}, 'job:one', 'jobs:one:1', () => {});
    expect(f.bridge.inspect(authority, pin, {}, 'job:one', 'jobs:one:1')).toBeNull();
  } finally { await f.close(); }
});
