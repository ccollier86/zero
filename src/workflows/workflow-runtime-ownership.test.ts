import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createAuthMiddleware } from '../auth/auth.middleware';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { AuthorizationKernel } from '../auth/authorization-kernel';
import type { TokenService } from '../auth/token-service';
import {
  getPlatformSink,
  setPlatformSink,
  type PlatformEvent,
} from '../observability';
import {
  ZERO_OBSERVABILITY_RUNTIME,
  ZERO_WORKFLOW_SERVICE,
} from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createSchedulerPlugin, SchedulerService } from '../scheduler';
import { createReactiveDB } from '../sync/reactive-db';
import {
  createWorkflowPluginRuntimeOwner,
  getWorkflowRegistry,
  getWorkflowService,
} from './workflow-plugin-runtime';
import { createWorkflowPlugin } from './workflow.plugin';
import { WorkflowRegistry } from './workflow-registry';
import { createWorkflowSchedulerOwner } from './workflow-scheduler-owner';
import { WorkflowService } from './workflow-service';

describe('workflow runtime owner isolation', () => {
  test('never combines one owner registry with another owner service', async () => {
    const dbA = createReactiveDB({ mode: 'memory' });
    const dbB = createReactiveDB({ mode: 'memory' });
    let stopA!: () => Promise<void>;
    let stopB!: () => Promise<void>;
    const ownerA = createWorkflowPluginRuntimeOwner({ db: dbA }, {
      managedStartup: true,
      onInitializerCreated() {},
      onStopCreated(stop) { stopA = stop; },
    });

    try {
      await ownerA.initialize();
      const serviceA = ownerA.requireReadyService();
      expect(getWorkflowRegistry()).toBe(ownerA.registry);
      expect(getWorkflowService()).toBe(serviceA);

      const ownerB = createWorkflowPluginRuntimeOwner({ db: dbB }, {
        managedStartup: true,
        onInitializerCreated() {},
        onStopCreated(stop) { stopB = stop; },
      });
      expect(getWorkflowRegistry()).toBe(ownerB.registry);
      expect(getWorkflowService()).toBeNull();

      await stopA();
      expect(getWorkflowRegistry()).toBe(ownerB.registry);
      expect(getWorkflowService()).toBeNull();

      await ownerB.initialize();
      expect(getWorkflowRegistry()).toBe(ownerB.registry);
      expect(getWorkflowService()).toBe(ownerB.requireReadyService());
      await stopB();
      expect(getWorkflowRegistry()).toBeNull();
      expect(getWorkflowService()).toBeNull();
    } finally {
      await stopB?.().catch(() => undefined);
      await stopA?.().catch(() => undefined);
      dbB.dispose();
      dbA.dispose();
    }
  });

  test('restores the preceding live owner after the current owner stops', async () => {
    const dbA = createReactiveDB({ mode: 'memory' });
    const dbB = createReactiveDB({ mode: 'memory' });
    const ownerA = createWorkflowPluginRuntimeOwner({ db: dbA }, {
      managedStartup: true,
      onInitializerCreated() {},
    });
    const ownerB = createWorkflowPluginRuntimeOwner({ db: dbB }, {
      managedStartup: true,
      onInitializerCreated() {},
    });

    try {
      await ownerA.initialize();
      await ownerB.initialize();
      expect(getWorkflowRegistry()).toBe(ownerB.registry);
      expect(getWorkflowService()).toBe(ownerB.requireReadyService());

      await ownerB.stop();
      expect(getWorkflowRegistry()).toBe(ownerA.registry);
      expect(getWorkflowService()).toBe(ownerA.requireReadyService());

      await ownerA.stop();
      expect(getWorkflowRegistry()).toBeNull();
      expect(getWorkflowService()).toBeNull();
    } finally {
      await ownerB.stop().catch(() => undefined);
      await ownerA.stop().catch(() => undefined);
      dbB.dispose();
      dbA.dispose();
    }
  });
});

describe('workflow scheduler owner isolation', () => {
  test('tears down jobs on the scheduler captured at startup', async () => {
    const schedulerA = new SchedulerService();
    const appA = new Elysia()
      .use(createSchedulerPlugin({ service: schedulerA }))
      .listen(0);
    const ownerA = createWorkflowSchedulerOwner(() => null, () => schedulerA);
    ownerA.start();
    expect(schedulerA.has('workflow-retries')).toBe(true);
    expect(schedulerA.has('workflow-timeouts')).toBe(true);

    const schedulerB = new SchedulerService();
    const appB = new Elysia()
      .use(createSchedulerPlugin({ service: schedulerB }))
      .listen(0);
    schedulerB.register({
      name: 'workflow-retries',
      pattern: '* * * * *',
      paused: true,
      run: async () => undefined,
    });
    schedulerB.register({
      name: 'workflow-timeouts',
      pattern: '* * * * *',
      paused: true,
      run: async () => undefined,
    });

    try {
      ownerA.stop();
      expect(schedulerA.has('workflow-retries')).toBe(false);
      expect(schedulerA.has('workflow-timeouts')).toBe(false);
      expect(schedulerB.has('workflow-retries')).toBe(true);
      expect(schedulerB.has('workflow-timeouts')).toBe(true);
    } finally {
      ownerA.stop();
      schedulerB.unregister('workflow-retries');
      schedulerB.unregister('workflow-timeouts');
      await appB.stop(true);
      await appA.stop(true);
    }
  });
});

describe('workflow request readiness', () => {
  test('awaits auth readiness before resolving the first request identity', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const scheduler = new SchedulerService();
    let tokenService: TokenService | null = null;
    let readinessCalls = 0;
    const readyTokenService = {
      async resolveAuthContext(token: string) {
        return token === 'first-request-token'
          ? { userId: 'first-user', email: 'first@example.test', role: 'user' }
          : null;
      },
    } as unknown as TokenService;
    const app = new Elysia()
      // Reproduce createApp's earlier global auth middleware. The workflow's
      // scoped resolver must run again after readiness and replace its null
      // first snapshot for workflow routes only.
      .use(createAuthMiddleware(() => null))
      .use(createSchedulerPlugin({ service: scheduler }))
      .use(createWorkflowPlugin({
        db,
        scheduler,
        getTokenService: () => tokenService,
        async ensureAuthReady() {
          readinessCalls += 1;
          await Promise.resolve();
          tokenService = readyTokenService;
        },
      }, {
        managedStartup: true,
        onInitializerCreated() {},
      }))
      .get('/health', () => ({ status: 'ok' }))
      .listen(0);

    try {
      const health = await app.handle(new Request('http://localhost/health'));
      expect(health.status).toBe(200);
      expect(readinessCalls).toBe(0);

      const response = await app.handle(new Request('http://localhost/workflows', {
        headers: { authorization: 'Bearer first-request-token' },
      }));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([]);
      expect(readinessCalls).toBe(1);
    } finally {
      await app.stop(true);
      db.dispose();
    }
  });

  test('managed standalone stop awaits workflow lease release', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const scheduler = new SchedulerService();
    let initialize!: () => Promise<void>;
    const app = new Elysia()
      .use(createSchedulerPlugin({ service: scheduler }))
      .use(createWorkflowPlugin({ db, scheduler }, {
        managedStartup: true,
        onInitializerCreated(created) { initialize = created; },
      }))
      .listen(0);

    try {
      await initialize();
      expect(getWorkflowService()).not.toBeNull();
      await app.stop(true);

      const replacement = new WorkflowService(db, new WorkflowRegistry(), {
        runtimeOwnership: { ownerId: 'post-stop-owner' },
      });
      await replacement.dispose();
    } finally {
      await app.stop(true).catch(() => undefined);
      db.dispose();
    }
  });

  test('ownership loss retires stale jobs and publication without touching a replacement', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const scheduler = new SchedulerService();
    const events: PlatformEvent[] = [];
    const previousSink = getPlatformSink();
    setPlatformSink({ emit(event) { events.push(event); } });
    const tokens = {
      async resolveAuthContext(token: string) {
        return token === 'owner-loss-token'
          ? { userId: 'owner-loss-user', email: 'owner-loss@example.test', role: 'user' }
          : null;
      },
    } as unknown as TokenService;
    let initialize!: () => Promise<void>;
    const app = new Elysia()
      .use(createSchedulerPlugin({ service: scheduler }))
      .use(createWorkflowPlugin({
        db,
        scheduler,
        getTokenService: () => tokens,
      }, {
        managedStartup: true,
        onInitializerCreated(created) { initialize = created; },
      }))
      .listen(0);
    let replacement: ReturnType<typeof createWorkflowPluginRuntimeOwner> | null = null;
    const replacementScheduler = new SchedulerService();

    try {
      await initialize();
      const stale = getWorkflowService()!;
      expect(stale).not.toBeNull();
      expect(scheduler.has('workflow-retries')).toBe(true);
      expect(scheduler.has('workflow-timeouts')).toBe(true);

      const lease = db.prepare(`SELECT heartbeat_at
        FROM _workflow_runtime_owner_lease`).get() as { heartbeat_at: number };
      const expiredAt = lease.heartbeat_at + 1;
      db.prepare(`UPDATE _workflow_runtime_owner_lease
        SET expires_at = ?`).run(expiredAt);
      while (Date.now() <= expiredAt) await Bun.sleep(1);

      expect(() => stale.pollTimeouts()).toThrow(expect.objectContaining({
        code: 'WORKFLOW_RUNTIME_LEASE_LOST',
        status: 503,
      }));
      expect(getWorkflowService()).toBeNull();
      expect(scheduler.has('workflow-retries')).toBe(false);
      expect(scheduler.has('workflow-timeouts')).toBe(false);

      const response = await app.handle(new Request('http://localhost/workflows/', {
        headers: { authorization: 'Bearer owner-loss-token' },
      }));
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_NOT_READY',
      });

      const repeatedFailuresBefore = repeatedOwnershipPollFailures(events);
      expect(scheduler.trigger('workflow-retries')).toBe(false);
      expect(scheduler.trigger('workflow-timeouts')).toBe(false);
      await Bun.sleep(0);
      expect(repeatedOwnershipPollFailures(events)).toBe(repeatedFailuresBefore);

      replacement = createWorkflowPluginRuntimeOwner({
        db,
        scheduler: replacementScheduler,
        getTokenService: () => tokens,
      }, {
        managedStartup: true,
        onInitializerCreated() {},
      });
      await replacement.start();
      await replacement.initialize();
      const replacementService = replacement.requireReadyService();
      expect(getWorkflowService()).toBe(replacementService);
      expect(replacementScheduler.has('workflow-retries')).toBe(true);
      expect(replacementScheduler.has('workflow-timeouts')).toBe(true);

      await app.stop(true);
      expect(getWorkflowService()).toBe(replacementService);
      expect(replacement.requireReadyService()).toBe(replacementService);
      expect(replacementScheduler.has('workflow-retries')).toBe(true);
      expect(replacementScheduler.has('workflow-timeouts')).toBe(true);
    } finally {
      await replacement?.stop().catch(() => undefined);
      await app.stop(true).catch(() => undefined);
      setPlatformSink(previousSink);
      db.dispose();
    }
  });

  test('a stale stop cannot clear a same-runtime replacement capability', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const runtime = new ZeroAppRuntime('workflow-owner-replacement');
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
      sink: { emit() {} },
      store: null,
      config: { console: false },
    });
    const staleScheduler = new SchedulerService();
    const replacementScheduler = new SchedulerService();
    const tokens = {
      async resolveAuthContext() { return null; },
    } as unknown as TokenService;
    const kernel = new AuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'single',
    }));
    const properties = {
      getProperties() { return {}; },
    };
    const authorization = {
      getAuthorizationKernel: () => kernel,
      getPropertyStore: () => properties,
    };
    let stale: ReturnType<typeof createWorkflowPluginRuntimeOwner> | null = null;
    let replacement: ReturnType<typeof createWorkflowPluginRuntimeOwner> | null = null;

    try {
      stale = createWorkflowPluginRuntimeOwner({
        db,
        runtime,
        scheduler: staleScheduler,
        getTokenService: () => tokens,
        authorization,
      }, {
        managedStartup: true,
        onInitializerCreated() {},
      });
      await stale.start();
      await stale.initialize();
      const staleService = stale.requireReadyService();
      expect(runtime.get(ZERO_WORKFLOW_SERVICE)).toBe(staleService);

      const lease = db.prepare(`SELECT heartbeat_at
        FROM _workflow_runtime_owner_lease`).get() as { heartbeat_at: number };
      const expiredAt = lease.heartbeat_at + 1;
      db.prepare(`UPDATE _workflow_runtime_owner_lease
        SET expires_at = ?`).run(expiredAt);
      while (Date.now() <= expiredAt) await Bun.sleep(1);

      expect(() => staleService.pollTimeouts()).toThrow(expect.objectContaining({
        code: 'WORKFLOW_RUNTIME_LEASE_LOST',
      }));
      expect(runtime.get(ZERO_WORKFLOW_SERVICE)).toBeNull();

      replacement = createWorkflowPluginRuntimeOwner({
        db,
        runtime,
        scheduler: replacementScheduler,
        getTokenService: () => tokens,
        authorization,
      }, {
        managedStartup: true,
        onInitializerCreated() {},
      });
      await replacement.start();
      await replacement.initialize();
      const replacementService = replacement.requireReadyService();
      expect(runtime.get(ZERO_WORKFLOW_SERVICE)).toBe(replacementService);

      await stale.stop();
      expect(runtime.get(ZERO_WORKFLOW_SERVICE)).toBe(replacementService);
      expect(replacement.requireReadyService()).toBe(replacementService);
      expect(replacementScheduler.has('workflow-retries')).toBe(true);
      expect(replacementScheduler.has('workflow-timeouts')).toBe(true);
    } finally {
      await replacement?.stop().catch(() => undefined);
      await stale?.stop().catch(() => undefined);
      await runtime.dispose().catch(() => undefined);
      db.dispose();
    }
  });
});

describe('workflow startup observability', () => {
  test('reports service publication failures without mislabeling recovery', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const publicationError = new Error('publication callback failed');
    const events: PlatformEvent[] = [];
    const previousSink = getPlatformSink();
    setPlatformSink({ emit(event) { events.push(event); } });
    const owner = createWorkflowPluginRuntimeOwner({ db }, {
      managedStartup: true,
      onInitializerCreated() {},
      onServiceCreated() { throw publicationError; },
    });

    try {
      await expect(owner.initialize()).rejects.toMatchObject({
        code: 'WORKFLOW_STARTUP_FAILED',
        status: 503,
      });
      expect(events.filter((event) => event.code === 'workflows.publication.failed'))
        .toHaveLength(1);
      expect(events.find((event) => event.code === 'workflows.publication.failed'))
        .toMatchObject({
          error: publicationError,
          metadata: { phase: 'publication' },
        });
      expect(events.filter((event) => event.code === 'workflows.recovery.failed'))
        .toHaveLength(0);
      expect(events.find((event) => event.code === 'workflows.startup.failed'))
        .toMatchObject({ metadata: { phase: 'publication' } });
    } finally {
      setPlatformSink(previousSink);
      await owner.stop().catch(() => undefined);
      db.dispose();
    }
  });
});

function repeatedOwnershipPollFailures(events: readonly PlatformEvent[]): number {
  return events.filter((event) => event.code === 'workflows.advance.failed'
    || event.code === 'scheduler.job.unhandled_failed').length;
}
