/** Actual native workflow-owner dependency order. Strictly memory-only; no Guardian/runtime fixture, files or external servers. */
import { expect, spyOn, test } from 'bun:test';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { flow, step } from './workflow-dsl';
import { workflowDeferredStarts, type WorkflowDeferredStartBridge } from './workflow-deferred-start-bridge';
import {
  createWorkflowPluginRuntimeOwner, getWorkflowRegistry, getWorkflowService,
  type WorkflowPluginConfig, type WorkflowPluginRuntimeOwner,
} from './workflow-plugin-runtime';
import { WorkflowService } from './workflow-service';

function latch() {
  let release!: () => void, enter!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  return { entered, release, async wait() { enter(); await promise; } };
}
function standaloneConfig(db: ReactiveDB): WorkflowPluginConfig {
  return { db, shutdownGraceMs: 0, getTokenService: () => null,
    authorization: { getAuthorizationKernel: () => null, getPropertyStore: () => null,
      getRoleAssignments: () => null, getRequestCredentialResolver: () => null },
    register(registry) {
      registry.registerActivity({ name: 'native.dependency.activity', version: '1', handler: async context => context.input });
      registry.create({ name: 'native.dependency.workflow', version: 1, flow: flow(step('observe', { name: 'native.dependency.activity', version: '1' })) });
    } };
}
function assertBridgeReady(service: WorkflowService): WorkflowDeferredStartBridge {
  const bridge = workflowDeferredStarts(service), input = { dependency: 'ready' }, binding = 'native-dependency-binding';
  bridge.assertRuntimeCurrent();
  const authority = bridge.system({ principal: 'native:dependency', reason: 'Synthetic native dependency readiness', scope: applicationServiceDataScope() });
  const pin = bridge.pin(authority, 'native.dependency.workflow', input, 1);
  expect(pin).toMatchObject({ name: 'native.dependency.workflow', version: 1 });
  expect(bridge.open(bridge.seal(authority, binding), binding)).toEqual(authority);
  // Receipt inspection is an ordinary operation and intentionally prevents a
  // later initialization-only recovery. Construction/pinning/sealing do not.
  return bridge;
}

test('managed native dependencies finish before actual recovery/publication while the private bridge is already usable', async () => {
  const db = createReactiveDB({ mode: 'memory' }), gate = latch(), order: string[] = [];
  db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
  const previousRegistry = getWorkflowRegistry(), previousService = getWorkflowService();
  const original = WorkflowService.prototype.recoverInFlight;
  let owner: WorkflowPluginRuntimeOwner | undefined, created: WorkflowService | undefined, dependenciesReady = false;
  let initializing: Promise<void> | undefined, initializer: (() => Promise<void>) | undefined;
  const recovery = spyOn(WorkflowService.prototype, 'recoverInFlight').mockImplementation(function(this: WorkflowService, onReady) {
    expect(this).toBe(created!); expect(dependenciesReady).toBe(true); order.push('recovery');
    expect(() => owner!.requireReadyService()).toThrow(); expect(getWorkflowService()).toBeNull();
    return original.call(this, onReady);
  });
  try {
    owner = createWorkflowPluginRuntimeOwner(standaloneConfig(db), {
      managedStartup: true, onInitializerCreated(value) { initializer = value; },
      async beforeRecovery(service, { signal }) {
        created = service; order.push('dependencies-enter');
        expect(signal.aborted).toBe(false); expect(getWorkflowRegistry()).toBe(owner!.registry);
        expect(() => owner!.requireReadyService()).toThrow(); expect(getWorkflowService()).toBeNull();
        assertBridgeReady(service); await gate.wait();
        expect(signal.aborted).toBe(false); assertBridgeReady(service);
        dependenciesReady = true; order.push('dependencies-ready');
      },
      onServiceCreated(service) { expect(service).toBe(created!); expect(dependenciesReady).toBe(true); order.push('published'); },
    });
    expect(initializer).toBeDefined(); initializing = initializer!();
    expect(owner.initialize()).toBe(initializing);
    await gate.entered;
    expect(recovery).not.toHaveBeenCalled(); expect(getWorkflowService()).toBeNull();
    await expect(owner.initializeForRequest()).rejects.toMatchObject({ code: 'WORKFLOW_NOT_READY' });
    gate.release(); await initializing;
    expect(recovery).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['dependencies-enter', 'dependencies-ready', 'recovery', 'published']);
    expect(owner.requireReadyService()).toBe(created!); expect(getWorkflowService()).toBe(created!);
    expect(db.list('workflow_instances')).toHaveLength(0);
    await owner.stop(); expect(getWorkflowRegistry()).toBe(previousRegistry); expect(getWorkflowService()).toBe(previousService);
  } finally {
    gate.release();
    try { await initializing?.catch(() => undefined); await owner?.stop(); }
    finally { recovery.mockRestore(); db.dispose(); }
  }
});

test('a failing dependency callback skips recovery/publication and physically disposes the unpublished service exactly once', async () => {
  const db = createReactiveDB({ mode: 'memory' }), failure = new Error('Synthetic native dependency preparation failure');
  db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
  const previousRegistry = getWorkflowRegistry(), previousService = getWorkflowService();
  const originalRecover = WorkflowService.prototype.recoverInFlight, originalDispose = WorkflowService.prototype.dispose;
  let created: WorkflowService | undefined, bridge: WorkflowDeferredStartBridge | undefined, publications = 0;
  const disposed: WorkflowService[] = [];
  let owner: WorkflowPluginRuntimeOwner | undefined;
  const recovery = spyOn(WorkflowService.prototype, 'recoverInFlight').mockImplementation(function(this: WorkflowService, onReady) { return originalRecover.call(this, onReady); });
  const disposal = spyOn(WorkflowService.prototype, 'dispose').mockImplementation(function(this: WorkflowService) { disposed.push(this); return originalDispose.call(this); });
  try {
    owner = createWorkflowPluginRuntimeOwner(standaloneConfig(db), {
      managedStartup: true, onInitializerCreated() {}, onServiceCreated() { publications++; },
      async beforeRecovery(service) { created = service; bridge = assertBridgeReady(service); await Promise.resolve(); throw failure; },
    });
    await expect(owner.initialize()).rejects.toMatchObject({ code: 'WORKFLOW_STARTUP_FAILED', status: 503 });
    expect(created).toBeDefined(); expect(recovery).not.toHaveBeenCalled(); expect(publications).toBe(0);
    expect(disposal).toHaveBeenCalledTimes(1); expect(disposed).toEqual([created!]);
    expect(() => owner!.requireReadyService()).toThrow(); expect(() => bridge!.assertRuntimeCurrent()).toThrow();
    expect(getWorkflowRegistry()).toBe(previousRegistry); expect(getWorkflowService()).toBe(previousService);
    await owner.stop(); expect(disposal).toHaveBeenCalledTimes(1);
    expect(db.list('workflow_instances')).toHaveLength(0);
  } finally { try { await owner?.stop(); } finally { disposal.mockRestore(); recovery.mockRestore(); db.dispose(); } }
});

test('stop aborts deferred native preparation but waits its actual callback before service disposal and never publishes late', async () => {
  const db = createReactiveDB({ mode: 'memory' }), gate = latch(), order: string[] = [];
  db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
  let databaseClosed = false, lateDatabaseCalls = 0, hookSettled = false, hookSignal: AbortSignal | undefined, bridge: WorkflowDeferredStartBridge | undefined;
  const guardedDb = new Proxy(db, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      if (databaseClosed) { lateDatabaseCalls++; throw new Error('Workflow touched closed synthetic database.'); }
      return Reflect.apply(value, target, args);
    };
  } }) as ReactiveDB;
  const previousRegistry = getWorkflowRegistry(), previousService = getWorkflowService();
  const originalRecover = WorkflowService.prototype.recoverInFlight, originalDispose = WorkflowService.prototype.dispose;
  const disposalSawSettledHook: boolean[] = [];
  let owner: WorkflowPluginRuntimeOwner | undefined, initializing: Promise<unknown> | undefined, stopping: Promise<void> | undefined, publications = 0;
  const recovery = spyOn(WorkflowService.prototype, 'recoverInFlight').mockImplementation(function(this: WorkflowService, onReady) { return originalRecover.call(this, onReady); });
  const disposal = spyOn(WorkflowService.prototype, 'dispose').mockImplementation(function(this: WorkflowService) {
    disposalSawSettledHook.push(hookSettled); order.push('dispose'); return originalDispose.call(this);
  });
  try {
    owner = createWorkflowPluginRuntimeOwner(standaloneConfig(guardedDb), {
      managedStartup: true, onInitializerCreated() {}, onServiceCreated() { publications++; },
      async beforeRecovery(service, { signal }) {
        hookSignal = signal; bridge = assertBridgeReady(service);
        signal.addEventListener('abort', () => { order.push('abort'); }, { once: true });
        await gate.wait();
        // Cancellation is not physical completion: dependencies can still do
        // bounded settlement/evidence work while the owner is alive.
        expect(signal.aborted).toBe(true); bridge.assertRuntimeCurrent();
        expect(guardedDb.prepare('SELECT 1 AS alive').get()).toEqual({ alive: 1 });
        hookSettled = true; order.push('hook-settled');
      },
    });
    initializing = owner.initialize().then(value => ({ value }), error => ({ error }));
    await gate.entered; let stopped = false;
    stopping = owner.stop().then(() => { stopped = true; });
    expect(hookSignal!.aborted).toBe(true); expect(order).toEqual(['abort']);
    expect(getWorkflowRegistry()).toBe(previousRegistry); expect(getWorkflowService()).toBe(previousService);
    expect(() => owner!.requireReadyService()).toThrow();
    await Bun.sleep(5);
    expect(stopped).toBe(false); expect(disposal).not.toHaveBeenCalled(); expect(recovery).not.toHaveBeenCalled(); expect(publications).toBe(0);
    bridge!.assertRuntimeCurrent(); gate.release(); await stopping;
    expect(await initializing).toMatchObject({ error: { code: 'WORKFLOW_STARTUP_FAILED', status: 503 } });
    expect(order).toEqual(['abort', 'hook-settled', 'dispose']); expect(disposal).toHaveBeenCalledTimes(1); expect(disposalSawSettledHook).toEqual([true]);
    expect(recovery).not.toHaveBeenCalled(); expect(publications).toBe(0); expect(() => bridge!.assertRuntimeCurrent()).toThrow();
    expect(getWorkflowRegistry()).toBe(previousRegistry); expect(getWorkflowService()).toBe(previousService);
    databaseClosed = true; db.dispose();
    await Bun.sleep(5); expect(lateDatabaseCalls).toBe(0);
    await expect(owner.initialize()).rejects.toMatchObject({ code: 'WORKFLOW_STARTUP_FAILED' });
    await owner.stop(); expect(disposal).toHaveBeenCalledTimes(1); expect(lateDatabaseCalls).toBe(0);
  } finally {
    gate.release(); await Promise.allSettled([initializing, stopping].filter((value): value is Promise<unknown> => !!value));
    try { await owner?.stop(); } finally { disposal.mockRestore(); recovery.mockRestore(); if (!databaseClosed) db.dispose(); }
  }
});

for (const managedStartup of [true, false] as const) test(`the ${managedStartup ? 'managed' : 'legacy standalone'} no-hook path still runs actual recovery and publishes once`, async () => {
  const db = createReactiveDB({ mode: 'memory' }); db.getRawDatabase().run('PRAGMA temp_store=MEMORY');
  const previousRegistry = getWorkflowRegistry(), previousService = getWorkflowService(), original = WorkflowService.prototype.recoverInFlight;
  let owner: WorkflowPluginRuntimeOwner | undefined, publications = 0;
  const recovery = spyOn(WorkflowService.prototype, 'recoverInFlight').mockImplementation(function(this: WorkflowService, onReady) { return original.call(this, onReady); });
  try {
    const config = { ...standaloneConfig(db), onServiceCreated() { publications++; } };
    owner = managedStartup
      ? createWorkflowPluginRuntimeOwner(config, { managedStartup: true, onInitializerCreated() {} })
      : createWorkflowPluginRuntimeOwner(config);
    const initializing = owner.initialize(); expect(owner.initialize()).toBe(initializing); await initializing;
    expect(recovery).toHaveBeenCalledTimes(1); expect(publications).toBe(1);
    assertBridgeReady(owner.requireReadyService()); expect(getWorkflowService()).toBe(owner.requireReadyService());
    await owner.initialize(); expect(recovery).toHaveBeenCalledTimes(1); expect(publications).toBe(1);
    await owner.stop(); expect(getWorkflowRegistry()).toBe(previousRegistry); expect(getWorkflowService()).toBe(previousService);
  } finally { try { await owner?.stop(); } finally { recovery.mockRestore(); db.dispose(); } }
});
