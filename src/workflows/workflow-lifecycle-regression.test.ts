import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import { createAuthPlugin, getAuthStore, getTokenService } from '../auth/auth.plugin';
import { createApp } from '../frontend/server/app-factory';
import {
  createSchedulerPlugin,
  getScheduler,
  type JobDefinition,
} from '../scheduler';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createWorkflowPluginRuntimeOwner } from './workflow-plugin-runtime';
import { createWorkflowSchedulerOwner } from './workflow-scheduler-owner';
import {
  createWorkflowPlugin,
  getWorkflowRegistry,
  getWorkflowService,
  stopWorkflowRuntime,
} from './workflow.plugin';

describe('workflow startup failure cleanup', () => {
  test('closes a standalone listener and rolls back scheduler ownership after async registration rejects', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const registration = deferred<void>();
    const app = new Elysia()
      .use(createSchedulerPlugin())
      .use(createWorkflowPlugin({
        db,
        getTokenService: () => null,
        register: () => registration.promise,
      }))
      .listen(0);

    try {
      await waitFor(() => Boolean(
        getScheduler()?.has('workflow-retries')
        && getScheduler()?.has('workflow-timeouts'),
      ));
      expect(getWorkflowRegistry()).not.toBeNull();
      expect(getWorkflowService()).toBeNull();

      registration.reject(new Error('async registration failed'));
      await waitFor(() => app.server === null);
      expect(app.server).toBeNull();
      expect(getWorkflowRegistry()).toBeNull();
      expect(getWorkflowService()).toBeNull();
      expect(getScheduler()).toBeNull();
    } finally {
      registration.reject(new Error('test cleanup'));
      await stopWorkflowRuntime().catch(() => undefined);
      if (app.server) await app.stop(true);
      db.dispose();
    }
  });

  test('unpublishes and cleans a service when durable recovery preflight fails', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let initialize!: () => Promise<void>;
    const plugin = createWorkflowPlugin({
      db,
      getTokenService: () => null,
    }, {
      managedStartup: true,
      onInitializerCreated(created) {
        initialize = created;
      },
    });
    seedMissingHandlerWorkflow(db);
    const before = publicWorkflowState(db);
    const app = new Elysia()
      .use(createSchedulerPlugin())
      .use(plugin)
      .listen(0);

    try {
      await waitFor(() => Boolean(getScheduler()?.has('workflow-retries')));
      await expect(initialize()).rejects.toMatchObject({
        code: 'WORKFLOW_STARTUP_FAILED',
        status: 503,
      });
      expect(getWorkflowRegistry()).toBeNull();
      expect(getWorkflowService()).toBeNull();
      expect(publicWorkflowState(db)).toEqual(before);
      expect(db.prepare('SELECT COUNT(*) AS count FROM _workflow_step_attempts').get())
        .toEqual({ count: 0 });

      await stopWorkflowRuntime();
      expect(getScheduler()?.has('workflow-retries')).toBe(false);
      expect(getScheduler()?.has('workflow-timeouts')).toBe(false);
    } finally {
      await stopWorkflowRuntime().catch(() => undefined);
      if (app.server) await app.stop(true);
      db.dispose();
    }
  });

  test('stopping during pre-service registration never accesses a subsequently disposed database', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let rejectRegistration!: (error: unknown) => void;
    let resolveRegistration!: () => void;
    const registration = new Promise<void>((resolve, reject) => {
      resolveRegistration = resolve;
      rejectRegistration = reject;
    });
    let guardDatabase = false;
    let guardedAccesses = 0;
    const guardedMethods = new Set([
      'exec',
      'prepare',
      'transaction',
      'insert',
      'update',
      'delete',
      'query',
      'queryOne',
    ]);
    const guardedDb = new Proxy(db, {
      get(target, property) {
        if (guardDatabase && guardedMethods.has(String(property))) guardedAccesses += 1;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as ReactiveDB;
    let serviceCreations = 0;
    const owner = createWorkflowPluginRuntimeOwner({
      db: guardedDb,
      getTokenService: () => null,
      register: () => registration,
    }, {
      managedStartup: true,
      onInitializerCreated() {},
      onServiceCreated() {
        serviceCreations += 1;
      },
    });

    const initializing = owner.initialize();
    void initializing.catch(() => undefined);
    await Promise.resolve();
    await owner.stop();
    guardDatabase = true;
    db.dispose();
    resolveRegistration();

    try {
      await expect(initializing).rejects.toMatchObject({
        code: 'WORKFLOW_STARTUP_FAILED',
        status: 503,
      });
      expect(serviceCreations).toBe(0);
      expect(guardedAccesses).toBe(0);
      expect(getWorkflowRegistry()).toBeNull();
      expect(getWorkflowService()).toBeNull();
    } finally {
      rejectRegistration(new Error('test cleanup'));
      await owner.stop().catch(() => undefined);
    }
  });
});

describe('workflow dependency and request readiness', () => {
  test('does not let a later app extension create a workflow startup cycle', async () => {
    const scratchRoot = join(process.cwd(), '.zero');
    await mkdir(scratchRoot, { recursive: true });
    const root = await mkdtemp(join(scratchRoot, 'workflow-start-readiness-'));
    const appDir = join(root, 'app');
    const pluginsDir = join(root, 'server', 'plugins');
    await mkdir(appDir, { recursive: true });
    await mkdir(pluginsDir, { recursive: true });
    const gate = deferred<void>();
    const entered = deferred<void>();
    const gateKey = `workflow-start-${crypto.randomUUID()}`;
    const globalGates = workflowStartGates();
    globalGates.set(gateKey, {
      promise: gate.promise,
      entered: () => entered.resolve(),
    });
    await Bun.write(join(pluginsDir, 'slow-start.ts'), [
      "import { Elysia } from 'elysia';",
      `const gate = (globalThis as any).__zeroWorkflowStartGates.get(${JSON.stringify(gateKey)});`,
      `export default new Elysia({ name: ${JSON.stringify(gateKey)} })`,
      "  .onStart(async () => { gate.entered(); await gate.promise; });",
      '',
    ].join('\n'));

    let registrationCalls = 0;
    let app: Awaited<ReturnType<typeof createApp>> | null = null;
    try {
      app = await createApp({
        db: { mode: 'memory' },
        tables: {},
        auth: true,
        workflows: {
          register(registry) {
            registrationCalls += 1;
            registry.registerHandler('readiness-handler', async () => null);
            registry.registerWorkflow({
              name: 'readiness-workflow',
              steps: [{ name: 'Ready', handler: 'readiness-handler' }],
            });
          },
        },
        appDir,
        outDir: join(root, 'out'),
        storageDir: join(root, 'storage'),
        serverResourcesDir: false,
        serverPluginsDir: pluginsDir,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        resourceRoutes: false,
        observability: false,
        ai: false,
        vector: false,
        pdf: false,
        kv: false,
        email: false,
        migrate: false,
      });
      app.listen(0);
      await entered.promise;
      await waitFor(() => Boolean(getAuthStore() && getTokenService()));
      await waitFor(() => getWorkflowService() !== null);
      expect(registrationCalls).toBe(1);
      expect(getWorkflowService()).not.toBeNull();

      const user = await getAuthStore()!.createUser({
        username: 'workflow-readiness-user',
        email: 'workflow-readiness-user@example.test',
        password: 'password123',
        role: 'user',
      });
      const tokens = await getTokenService()!.issueTokenPair(user);
      const response = await fetch(`http://localhost:${app.server!.port}/workflows`, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([]);
      expect(getWorkflowService()).not.toBeNull();
      expect(registrationCalls).toBe(1);
      expect(getScheduler()?.has('workflow-retries')).toBe(true);
      expect(getScheduler()?.has('workflow-timeouts')).toBe(true);
    } finally {
      gate.resolve();
      if (app) await app.stop(true);
      globalGates.delete(gateKey);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('workflow scheduler job ownership', () => {
  test('rolls back partial registration and never removes another owner\'s colliding job', async () => {
    const app = new Elysia().use(createSchedulerPlugin()).listen(0);
    let partialOwner: ReturnType<typeof createWorkflowSchedulerOwner> | null = null;
    let collisionOwner: ReturnType<typeof createWorkflowSchedulerOwner> | null = null;
    let originalRegister: ((definition: JobDefinition) => void) | null = null;

    try {
      await waitFor(() => getScheduler() !== null);
      const scheduler = getScheduler()!;
      originalRegister = scheduler.register.bind(scheduler);
      const injectedFailure = new Error('timeout job registration failed');
      scheduler.register = (definition: JobDefinition) => {
        if (definition.name === 'workflow-timeouts') throw injectedFailure;
        originalRegister!(definition);
      };
      partialOwner = createWorkflowSchedulerOwner(() => null);

      expect(() => partialOwner!.start()).toThrow(injectedFailure);
      expect(scheduler.has('workflow-retries')).toBe(false);
      expect(scheduler.has('workflow-timeouts')).toBe(false);

      scheduler.register = originalRegister;
      partialOwner.start();
      expect(scheduler.has('workflow-retries')).toBe(true);
      expect(scheduler.has('workflow-timeouts')).toBe(true);
      partialOwner.stop();
      expect(scheduler.has('workflow-retries')).toBe(false);
      expect(scheduler.has('workflow-timeouts')).toBe(false);

      scheduler.register({
        name: 'workflow-timeouts',
        pattern: '* * * * *',
        paused: true,
        run: async () => undefined,
      });
      collisionOwner = createWorkflowSchedulerOwner(() => null);
      expect(() => collisionOwner!.start()).toThrow(/already registered/);
      collisionOwner.stop();
      expect(scheduler.has('workflow-retries')).toBe(false);
      expect(scheduler.has('workflow-timeouts')).toBe(true);
      scheduler.unregister('workflow-timeouts');
    } finally {
      const scheduler = getScheduler();
      if (scheduler && originalRegister) scheduler.register = originalRegister;
      try { partialOwner?.stop(); } catch {}
      try { collisionOwner?.stop(); } catch {}
      await app.stop(true);
    }
  });
});

function seedMissingHandlerWorkflow(db: ReactiveDB): void {
  const now = '2030-01-02T03:04:05.000Z';
  const steps = [{ name: 'Unavailable handler', handler: 'missing-handler', waitFor: 'continue' }];
  db.insert('workflow_definitions', {
    definition_id: 'missing-definition',
    name: 'missing-workflow',
    version: 1,
    steps_json: JSON.stringify(steps),
    input_schema: null,
    created_at: now,
    updated_at: now,
  });
  db.insert('workflow_instances', {
    instance_id: 'missing-instance',
    definition_id: 'missing-definition',
    name: 'missing-workflow',
    status: 'running',
    current_step: 0,
    input: null,
    output: null,
    error: null,
    started_by: 'user_1',
    steps_json: JSON.stringify(steps),
    created_at: now,
    updated_at: now,
    completed_at: null,
  });
  db.insert('workflow_steps', {
    step_id: 'missing-step',
    instance_id: 'missing-instance',
    step_index: 0,
    step_name: 'Unavailable handler',
    status: 'waiting',
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: 'continue',
    timeout_at: null,
    started_at: now,
    completed_at: null,
    created_at: now,
  });
  seedResourceAccounting(db, 'missing-instance');
}

function seedResourceAccounting(database: ReactiveDB, instanceId: string): void {
  const bytes = Number((database.prepare(`SELECT
    length(CAST(COALESCE(instance.input, '') AS BLOB))
      + length(CAST(COALESCE(instance.output, '') AS BLOB))
      + COALESCE((SELECT SUM(length(CAST(COALESCE(step.input, '') AS BLOB))
        + length(CAST(COALESCE(step.output, '') AS BLOB)))
        FROM workflow_steps AS step WHERE step.instance_id = instance.instance_id), 0) AS bytes
    FROM workflow_instances AS instance WHERE instance.instance_id = ?`)
    .get(instanceId) as { bytes: number }).bytes);
  database.prepare(`INSERT OR REPLACE INTO _workflow_runtime_usage
    (instance_id, runtime_bytes) VALUES (?, ?)`).run(instanceId, bytes);
  database.prepare(`INSERT OR REPLACE INTO _workflow_event_usage
    (instance_id, total_count, total_bytes, queued_count, queued_bytes, revision)
    VALUES (?, 0, 0, 0, 0, 0)`).run(instanceId);
}

function publicWorkflowState(db: ReactiveDB): Record<string, unknown[]> {
  return {
    definitions: db.query('workflow_definitions'),
    instances: db.query('workflow_instances'),
    steps: db.query('workflow_steps'),
    events: db.query('workflow_events'),
  };
}

function workflowStartGates(): Map<string, { promise: Promise<void>; entered: () => void }> {
  const target = globalThis as unknown as {
    __zeroWorkflowStartGates?: Map<string, { promise: Promise<void>; entered: () => void }>;
  };
  target.__zeroWorkflowStartGates ??= new Map();
  return target.__zeroWorkflowStartGates;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Workflow lifecycle condition did not settle');
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value?: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value?: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise as (value?: T) => void;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
