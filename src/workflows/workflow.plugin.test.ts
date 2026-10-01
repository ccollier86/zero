import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin, getAuthStore, getTokenService } from '../auth/auth.plugin';
import type { UserRecord } from '../auth/types';
import { createSchedulerPlugin, getScheduler } from '../scheduler';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  createWorkflowPlugin,
  getWorkflowRegistry,
  getWorkflowService,
  stopWorkflowRuntime,
} from './workflow.plugin';
import type { WorkflowRegistry } from './workflow-registry';

describe('workflow plugin lifecycle and HTTP authority', () => {
  test('fails closed through Elysia teardown when the scheduler is missing', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const app = new Elysia()
      .use(createWorkflowPlugin({ db, getTokenService: () => null }))
      .listen(0);

    try {
      await waitFor(() => app.server === null && getWorkflowRegistry() === null);
      expect(getWorkflowService()).toBeNull();
      expect(getWorkflowRegistry()).toBeNull();
      expect(app.server).toBeNull();
    } finally {
      if (app.server) await app.stop(true);
      db.dispose();
    }
  });

  test('does not let pending registration make shutdown hang or touch a disposed database', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let resolveRegistration!: () => void;
    const registration = new Promise<void>((resolve) => {
      resolveRegistration = resolve;
    });
    let initialize!: () => Promise<void>;
    createWorkflowPlugin({
      db,
      register: () => registration,
      getTokenService: () => null,
    }, {
      managedStartup: true,
      onInitializerCreated(created) {
        initialize = created;
      },
    });

    const initializing = initialize();
    await Promise.resolve();
    await expect(stopWorkflowRuntime()).resolves.toBeUndefined();
    db.dispose();
    resolveRegistration();
    await expect(initializing).rejects.toMatchObject({
      code: 'WORKFLOW_STARTUP_FAILED', status: 503,
    });
    expect(getWorkflowRegistry()).toBeNull();
    expect(getWorkflowService()).toBeNull();
  });

  test('disposes a recovered service exactly once when publication callback fails', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let initialize!: () => Promise<void>;
    let disposals = 0;
    let handlerCalls = 0;
    createWorkflowPlugin({
      db,
      getTokenService: () => null,
      register(registry) {
        registry.registerHandler('publication-handler', async () => {
          handlerCalls += 1;
          return null;
        });
      },
    }, {
      managedStartup: true,
      onInitializerCreated(created) {
        initialize = created;
      },
      onServiceCreated(service) {
        const dispose = service.dispose.bind(service);
        service.dispose = async () => {
          disposals += 1;
          await dispose();
        };
        throw new Error('publication failed');
      },
    });
    seedRecoverableWorkflow(db, 'publication-failure', 'publication-handler');

    try {
      await expect(initialize()).rejects.toMatchObject({
        code: 'WORKFLOW_STARTUP_FAILED', status: 503,
      });
      expect(disposals).toBe(1);
      expect(handlerCalls).toBe(0);
      expect(getWorkflowService()).toBeNull();
      await stopWorkflowRuntime();
      expect(disposals).toBe(1);
    } finally {
      await stopWorkflowRuntime();
      db.dispose();
    }
  });

  test('publishes the ready service before recovered handlers are dispatched', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let initialize!: () => Promise<void>;
    let observedService: ReturnType<typeof getWorkflowService> | undefined;
    createWorkflowPlugin({
      db,
      getTokenService: () => null,
      register(registry) {
        registry.registerHandler('published-handler', async () => {
          observedService = getWorkflowService();
          return { recovered: true };
        });
      },
    }, {
      managedStartup: true,
      onInitializerCreated(created) {
        initialize = created;
      },
    });
    seedRecoverableWorkflow(db, 'publication-order', 'published-handler');

    try {
      await initialize();
      await waitFor(() => observedService !== undefined);
      expect(observedService).not.toBeNull();
      expect(observedService).toBe(getWorkflowService());
      await waitFor(() => getWorkflowService()?.get('publication-order')?.status === 'completed');
    } finally {
      await stopWorkflowRuntime();
      db.dispose();
    }
  });

  test('waits for startup settlement when concurrent workflow disposal fails', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const disposalFailure = new Error('injected disposal failure');
    let initialize!: () => Promise<void>;
    let stopping: Promise<void> | null = null;
    let initializationSettled = false;

    createWorkflowPlugin({ db, getTokenService: () => null }, {
      managedStartup: true,
      onInitializerCreated(created) {
        initialize = created;
      },
      onServiceCreated(service) {
        service.dispose = async () => { throw disposalFailure; };
        const pendingStop = stopWorkflowRuntime();
        void pendingStop.catch(() => undefined);
        stopping = pendingStop;
      },
    });

    const initializing = initialize().then(
      () => { initializationSettled = true; },
      (error) => {
        initializationSettled = true;
        throw error;
      },
    );
    void initializing.catch(() => undefined);

    try {
      await waitFor(() => stopping !== null);
      const stopError = await stopping!.catch((error) => error);
      expect(stopError).toBe(disposalFailure);
      expect(initializationSettled).toBe(true);
      await expect(initializing).rejects.toMatchObject({
        code: 'WORKFLOW_STARTUP_FAILED', status: 503,
      });
      expect(getWorkflowRegistry()).toBeNull();
      expect(getWorkflowService()).toBeNull();
    } finally {
      await stopWorkflowRuntime();
      db.dispose();
    }
  });

  test('publishes its registry before listen and waits for registration before recovery', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let resolveRegistration!: () => void;
    const registration = new Promise<void>((resolve) => {
      resolveRegistration = resolve;
    });
    let configuredRegistry: WorkflowRegistry | null = null;
    let initialize!: () => Promise<void>;
    const plugin = createWorkflowPlugin({
      db,
      register(registry) {
        configuredRegistry = registry;
        registry.registerHandler('complete', async () => ({ ok: true }));
        registry.registerWorkflow({
          name: 'registered-workflow',
          steps: [{ name: 'Complete', handler: 'complete' }],
        });
        return registration;
      },
    }, {
      managedStartup: true,
      onInitializerCreated(created) {
        initialize = created;
      },
    });

    expect(configuredRegistry).not.toBeNull();
    expect(getWorkflowRegistry()).toBe(configuredRegistry);
    expect(getWorkflowService()).toBeNull();

    const initializing = initialize();
    await Promise.resolve();
    expect(getWorkflowService()).toBeNull();
    resolveRegistration();
    await initializing;
    expect(getWorkflowService()).not.toBeNull();

    const app = new Elysia()
      .use(createSchedulerPlugin())
      .use(plugin)
      .listen(0);
    try {
      expect(getScheduler()?.has('workflow-retries')).toBe(true);
      expect(getScheduler()?.has('workflow-timeouts')).toBe(true);
    } finally {
      await stopWorkflowRuntime();
      expect(getScheduler()?.has('workflow-retries')).toBe(false);
      expect(getScheduler()?.has('workflow-timeouts')).toBe(false);
      await app.stop(true);
      db.dispose();
    }
    expect(getWorkflowRegistry()).toBeNull();
    expect(getWorkflowService()).toBeNull();
  });

  test('makes standalone app.stop wait for active workflow drainage', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let handlerEntered!: () => void;
    const entered = new Promise<void>((resolve) => { handlerEntered = resolve; });
    let releaseHandler!: () => void;
    const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve; });
    const app = new Elysia()
      .use(createSchedulerPlugin())
      .use(createWorkflowPlugin({
        db,
        getTokenService: () => null,
        register(registry) {
          registry.registerHandler('drain-on-stop', async () => {
            handlerEntered();
            await handlerGate;
            return { completed: true };
          });
          registry.registerWorkflow({
            name: 'drain-on-stop',
            steps: [{ name: 'Drain', handler: 'drain-on-stop' }],
          });
        },
      }))
      .listen(0);

    try {
      await waitFor(() => Boolean(getWorkflowService()));
      const starting = getWorkflowService()!.start('drain-on-stop', {});
      await entered;

      let stopSettled = false;
      const stopping = app.stop(true).then(() => { stopSettled = true; });
      await Promise.resolve();
      await Promise.resolve();
      expect(stopSettled).toBe(false);

      releaseHandler();
      await starting;
      await stopping;
      expect(stopSettled).toBe(true);
      expect(getWorkflowService()).toBeNull();
      expect(getWorkflowRegistry()).toBeNull();
    } finally {
      releaseHandler();
      if (app.server) await app.stop(true);
      db.dispose();
    }
  });

  test('limits workflow reads and controls to the owner or global admin', async () => {
    const runtime = await createHttpRuntime();
    try {
      const owner = await runtime.createUser('user');
      const stranger = await runtime.createUser('user');
      const admin = await runtime.createUser('admin');
      seedWorkflow(runtime.db, 'owned-workflow', owner.user.userId);
      seedWorkflow(runtime.db, 'foreign-workflow', stranger.user.userId);

      const ownerList = await runtime.request<ReadonlyArray<Record<string, unknown>>>(
        '/workflows', {}, owner.token,
      );
      expect(ownerList.status).toBe(200);
      expect(ownerList.data.map((row) => row.instance_id)).toEqual(['owned-workflow']);
      expect(ownerList.data[0]).not.toHaveProperty('steps_json');

      const adminList = await runtime.request<ReadonlyArray<Record<string, unknown>>>(
        '/workflows', {}, admin.token,
      );
      expect(adminList.status).toBe(200);
      expect(adminList.data.map((row) => row.instance_id).sort())
        .toEqual(['foreign-workflow', 'owned-workflow']);

      const definitions = await runtime.request<ReadonlyArray<Record<string, unknown>>>(
        '/workflows/definitions', {}, owner.token,
      );
      expect(definitions).toEqual({
        status: 200,
        data: [{
          name: 'metadata-workflow',
          steps: [{ name: 'Noop' }],
        }],
      });

      const foreign = await runtime.request<Record<string, unknown>>(
        '/workflows/foreign-workflow', {}, owner.token,
      );
      const missing = await runtime.request<Record<string, unknown>>(
        '/workflows/does-not-exist', {}, owner.token,
      );
      expect(foreign).toEqual(missing);
      expect(foreign).toEqual({
        status: 404,
        data: { error: 'Workflow not found', code: 'WORKFLOW_NOT_FOUND' },
      });

      const foreignSteps = await runtime.request<Record<string, unknown>>(
        '/workflows/foreign-workflow/steps', {}, owner.token,
      );
      const foreignEvents = await runtime.request<Record<string, unknown>>(
        '/workflows/foreign-workflow/events', {}, owner.token,
      );
      expect(foreignSteps).toEqual(foreign);
      expect(foreignEvents).toEqual(foreign);

      const deniedControls = [
        { suffix: '/events', init: jsonPost({ eventName: 'continue' }) },
        { suffix: '/cancel', init: { method: 'POST' } },
        { suffix: '/pause', init: { method: 'POST' } },
        { suffix: '/resume', init: { method: 'POST' } },
      ];
      for (const { suffix, init } of deniedControls) {
        const denied = await runtime.request<Record<string, unknown>>(
          `/workflows/foreign-workflow${suffix}`, init, owner.token,
        );
        const absent = await runtime.request<Record<string, unknown>>(
          `/workflows/does-not-exist${suffix}`, init, owner.token,
        );
        expect(denied).toEqual(foreign);
        expect(absent).toEqual(foreign);
      }
      expect(runtime.db.queryOne('workflow_instances', 'foreign-workflow')?.status)
        .toBe('running');

      const adminPause = await runtime.request<Record<string, unknown>>(
        '/workflows/foreign-workflow/pause', { method: 'POST' }, admin.token,
      );
      expect(adminPause).toEqual({ status: 200, data: { ok: true } });
      expect(runtime.db.queryOne('workflow_instances', 'foreign-workflow')?.status)
        .toBe('paused');

      const own = await runtime.request<Record<string, unknown>>(
        '/workflows/owned-workflow', {}, owner.token,
      );
      expect(own.status).toBe(200);
      expect(own.data.instance_id).toBe('owned-workflow');
      expect(own.data).not.toHaveProperty('steps_json');
      const ownSteps = await runtime.request<Array<Record<string, unknown>>>(
        '/workflows/owned-workflow/steps', {}, owner.token,
      );
      expect(ownSteps.data[0]?.step_name).toBe('Noop');
      expect(ownSteps.data[0]).not.toHaveProperty('wait_event');
    } finally {
      await runtime.stop();
    }
  });

  test('applies declarative start and inspect authority without revealing denied names', async () => {
    const runtime = await createHttpRuntime((registry) => {
      registry.registerWorkflow({
        name: 'admin-only',
        access: { start: 'admin' },
        steps: [{ name: 'Admin task', handler: 'noop' }],
      });
      registry.registerWorkflow({
        name: 'operator-only',
        access: { start: ['operator'] },
        steps: [{ name: 'Operator task', handler: 'noop' }],
      });
      registry.registerWorkflow({
        name: 'discoverable-admin',
        access: { start: 'admin', inspect: 'authenticated' },
        steps: [{ name: 'Public label', handler: 'noop' }],
      });
    });
    try {
      const user = await runtime.createUser('user');
      const operator = await runtime.createUser('operator');
      const admin = await runtime.createUser('admin');

      const userDefinitions = await runtime.request<DefinitionSummary[]>(
        '/workflows/definitions', {}, user.token,
      );
      expect(userDefinitions.data.map(({ name }) => name)).toEqual([
        'metadata-workflow', 'discoverable-admin',
      ]);
      const operatorDefinitions = await runtime.request<DefinitionSummary[]>(
        '/workflows/definitions', {}, operator.token,
      );
      expect(operatorDefinitions.data.map(({ name }) => name)).toEqual([
        'metadata-workflow', 'operator-only', 'discoverable-admin',
      ]);
      const adminDefinitions = await runtime.request<DefinitionSummary[]>(
        '/workflows/definitions', {}, admin.token,
      );
      expect(adminDefinitions.data.map(({ name }) => name)).toEqual([
        'metadata-workflow', 'admin-only', 'operator-only', 'discoverable-admin',
      ]);
      expect(adminDefinitions.data.find(({ name }) => name === 'admin-only')).toEqual({
        name: 'admin-only',
        steps: [{ name: 'Admin task' }],
      });

      const denied = await runtime.request<Record<string, unknown>>(
        '/workflows', jsonPost({ name: 'admin-only' }), user.token,
      );
      const missing = await runtime.request<Record<string, unknown>>(
        '/workflows', jsonPost({ name: 'does-not-exist' }), user.token,
      );
      expect(denied).toEqual(missing);
      expect(denied).toEqual({
        status: 404,
        data: { error: 'Workflow not found', code: 'WORKFLOW_NOT_FOUND' },
      });

      const operatorStart = await runtime.request<{ instanceId: string }>(
        '/workflows', jsonPost({ name: ' operator-only ' }), operator.token,
      );
      expect(operatorStart.status).toBe(200);
      const adminStart = await runtime.request<{ instanceId: string }>(
        '/workflows', jsonPost({ name: 'admin-only' }), admin.token,
      );
      expect(adminStart.status).toBe(200);
    } finally {
      await runtime.stop();
    }
  });

  test('uses stable auth, validation, and parse errors', async () => {
    const runtime = await createHttpRuntime();
    try {
      const user = await runtime.createUser('user');
      const unauthorized = await runtime.request<Record<string, unknown>>('/workflows');
      expect(unauthorized).toEqual({
        status: 401,
        data: { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      });

      const invalid = await runtime.request<Record<string, unknown>>(
        '/workflows?limit=0', {}, user.token,
      );
      expect(invalid.status).toBe(422);
      expect(invalid.data.code).toBe('WORKFLOW_REQUEST_INVALID');

      const invalidStatus = await runtime.request<Record<string, unknown>>(
        '/workflows?status=unknown', {}, user.token,
      );
      expect(invalidStatus.status).toBe(422);
      expect(invalidStatus.data.code).toBe('WORKFLOW_REQUEST_INVALID');

      const blankName = await runtime.request<Record<string, unknown>>(
        '/workflows', jsonPost({ name: '   ' }), user.token,
      );
      expect(blankName.status).toBe(422);
      expect(blankName.data.code).toBe('WORKFLOW_REQUEST_INVALID');

      const malformed = await runtime.request<Record<string, unknown>>(
        '/workflows', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        }, user.token,
      );
      expect(malformed).toEqual({
        status: 400,
        data: {
          error: 'Invalid workflow request body',
          code: 'WORKFLOW_REQUEST_PARSE_FAILED',
        },
      });
    } finally {
      await runtime.stop();
    }
  });
});

async function createHttpRuntime(
  register?: (registry: WorkflowRegistry) => void,
) {
  const db = createReactiveDB({ mode: 'memory' });
  let initialize!: () => Promise<void>;
  const plugin = createWorkflowPlugin({
    db,
    register(registry) {
      registry.registerHandler('noop', async () => null);
      registry.registerWorkflow({
        name: 'metadata-workflow',
        steps: [{
          name: 'Noop', handler: 'noop', retries: 4,
          backoffMs: 250, timeoutMs: 5_000,
        }],
      });
      register?.(registry);
    },
  }, {
    managedStartup: true,
    onInitializerCreated(created) {
      initialize = created;
    },
  });
  const app = new Elysia()
    .use(createAuthPlugin({ db }))
    .use(createSchedulerPlugin())
    .use(plugin)
    .listen(0);
  await waitFor(() => Boolean(getAuthStore() && getTokenService()));
  await initialize();
  const baseUrl = `http://localhost:${app.server!.port}`;

  return {
    db,
    async createUser(role: string): Promise<{ user: UserRecord; token: string }> {
      const suffix = crypto.randomUUID();
      const user = await getAuthStore()!.createUser({
        username: `${role}_${suffix}`,
        email: `${role}_${suffix}@example.test`,
        password: 'password123',
        role,
      });
      const tokens = await getTokenService()!.issueTokenPair(user);
      return { user, token: tokens.accessToken };
    },
    async request<T>(path: string, init: RequestInit = {}, token?: string) {
      const headers = new Headers(init.headers);
      if (token) headers.set('authorization', `Bearer ${token}`);
      const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
      const data = await response.json().catch(() => ({})) as T;
      return { status: response.status, data };
    },
    async stop() {
      await stopWorkflowRuntime();
      await app.stop(true);
      db.dispose();
    },
  };
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

interface DefinitionSummary {
  name: string;
  steps: Array<{ name: string }>;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Test runtime did not initialize');
}

function seedWorkflow(db: ReactiveDB, instanceId: string, ownerId: string): void {
  const now = new Date().toISOString();
  db.insert('workflow_instances', {
    instance_id: instanceId,
    definition_id: 'manual-definition',
    name: 'manual-workflow',
    status: 'running',
    current_step: 0,
    input: null,
    output: null,
    error: null,
    started_by: ownerId,
    steps_json: JSON.stringify([{ name: 'Noop', handler: 'noop', waitFor: 'continue' }]),
    created_at: now,
    updated_at: now,
    completed_at: null,
  });
  db.insert('workflow_steps', {
    step_id: `step-${instanceId}`,
    instance_id: instanceId,
    step_index: 0,
    step_name: 'Noop',
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
  db.insert('workflow_events', {
    event_id: `event-${instanceId}`,
    instance_id: instanceId,
    event_name: 'audit-only',
    payload: null,
    sent_by: ownerId,
    created_at: now,
  });
}

function seedRecoverableWorkflow(
  db: ReactiveDB,
  instanceId: string,
  handler: string,
): void {
  const now = '2030-01-02T03:04:05.000Z';
  const steps = [{ name: 'Recover', handler }];
  db.insert('workflow_instances', {
    instance_id: instanceId,
    definition_id: `definition-${instanceId}`,
    name: 'recovery-publication',
    status: 'running',
    current_step: 0,
    input: null,
    output: null,
    error: null,
    started_by: null,
    steps_json: JSON.stringify(steps),
    created_at: now,
    updated_at: now,
    completed_at: null,
  });
  db.insert('workflow_steps', {
    step_id: `step-${instanceId}`,
    instance_id: instanceId,
    step_index: 0,
    step_name: 'Recover',
    status: 'running',
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: null,
    timeout_at: null,
    started_at: now,
    completed_at: null,
    created_at: now,
  });
}
