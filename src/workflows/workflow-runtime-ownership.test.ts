import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createAuthMiddleware } from '../auth/auth.middleware';
import type { TokenService } from '../auth/token-service';
import {
  getPlatformSink,
  setPlatformSink,
  type PlatformEvent,
} from '../observability';
import { createSchedulerPlugin, getScheduler } from '../scheduler';
import { createReactiveDB } from '../sync/reactive-db';
import {
  createWorkflowPluginRuntimeOwner,
  getWorkflowRegistry,
  getWorkflowService,
} from './workflow-plugin-runtime';
import { createWorkflowPlugin } from './workflow.plugin';
import { createWorkflowSchedulerOwner } from './workflow-scheduler-owner';

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
    const appA = new Elysia().use(createSchedulerPlugin()).listen(0);
    const schedulerA = getScheduler()!;
    const ownerA = createWorkflowSchedulerOwner(() => null);
    ownerA.start();
    expect(schedulerA.has('workflow-retries')).toBe(true);
    expect(schedulerA.has('workflow-timeouts')).toBe(true);

    const appB = new Elysia().use(createSchedulerPlugin()).listen(0);
    const schedulerB = getScheduler()!;
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
      .use(createSchedulerPlugin())
      .use(createWorkflowPlugin({
        db,
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
