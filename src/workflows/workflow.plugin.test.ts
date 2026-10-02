import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin, getAuthStore, getTokenService } from '../auth/auth.plugin';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { AuthError, type UserRecord } from '../auth/types';
import { OBS_CODES } from '../observability/codes';
import { MemoryEventStore } from '../observability/memory-event-store';
import {
  configureObservability,
  getObservabilityRuntime,
} from '../observability/sink';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createSchedulerPlugin, getScheduler } from '../scheduler';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  createWorkflowPlugin,
  getWorkflowRegistry,
  getWorkflowService,
  stopWorkflowRuntime,
} from './workflow.plugin';
import { flow, requestAndWait } from './workflow-dsl';
import {
  createSystemAuthority,
  WorkflowExecutionAuthorityStore,
} from './workflow-execution-authority';
import { WorkflowError } from './workflow-error';
import { WorkflowInteractionAuthority } from './workflow-interaction-authority';
import type { WorkflowRegistry } from './workflow-registry';
import { getWorkflowGraphRuntime } from './workflow-service';

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
      seedWorkflow(runtime.db, 'owned-workflow', owner.user.userId, true);
      runtime.db.update('workflow_steps', 'step-owned-workflow', {
        // Released 1.3 persisted the executable handler key here. Public
        // topology must resolve the human definition label instead.
        step_name: 'internal-handler-key',
      });
      seedWorkflow(runtime.db, 'foreign-workflow', stranger.user.userId);
      seedWorkflow(runtime.db, 'graph-key-workflow', owner.user.userId);
      runtime.db.update('workflow_instances', 'graph-key-workflow', {
        definition_version_id: 'version-graph-key',
        definition_version: 1,
        graph_json: '{"schemaVersion":1}',
        graph_fingerprint: 'fingerprint-graph-key',
      });
      runtime.db.update('workflow_steps', 'step-graph-key-workflow', {
        node_id: 'patients', node_kind: 'activity', node_path: 'patients',
        item_key: 'patient@example.com', item_index: 0,
        activation_key: 'patient@example.com',
      });

      const ownerList = await runtime.request<ReadonlyArray<Record<string, unknown>>>(
        '/workflows', {}, owner.token,
      );
      expect(ownerList.status).toBe(200);
      expect(ownerList.data.map((row) => row.instance_id))
        .toEqual(['graph-key-workflow', 'owned-workflow']);
      expect(ownerList.data[0]).not.toHaveProperty('steps_json');

      const adminList = await runtime.request<ReadonlyArray<Record<string, unknown>>>(
        '/workflows', {}, admin.token,
      );
      expect(adminList.status).toBe(200);
      expect(adminList.data.map((row) => row.instance_id).sort())
        .toEqual(['foreign-workflow', 'graph-key-workflow', 'owned-workflow']);

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
      const foreignTopology = await runtime.request<Record<string, unknown>>(
        '/workflows/foreign-workflow/topology', {}, owner.token,
      );
      expect(foreignSteps).toEqual(foreign);
      expect(foreignEvents).toEqual(foreign);
      expect(foreignTopology).toEqual(foreign);

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
      expect(own.data).toMatchObject({ input: null, output: null, error: null });
      const ownSteps = await runtime.request<Array<Record<string, unknown>>>(
        '/workflows/owned-workflow/steps', {}, owner.token,
      );
      expect(ownSteps.data[0]?.step_name).toBe('Noop');
      expect(ownSteps.data[0]).not.toHaveProperty('wait_event');
      expect(ownSteps.data[0]).toMatchObject({
        input: null, output: null, error: null,
        item_key: null, activation_key: null,
        node_path: 'step-owned-workflow',
      });
      const ownEvents = await runtime.request<Array<Record<string, unknown>>>(
        '/workflows/owned-workflow/events', {}, owner.token,
      );
      expect(ownEvents.data[0]).toMatchObject({
        event_name: 'audit-only', payload: null,
      });
      expect(JSON.stringify([own.data, ownSteps.data, ownEvents.data]))
        .not.toContain('legacy-http-secret');
      const graphKeySteps = await runtime.request<Array<Record<string, unknown>>>(
        '/workflows/graph-key-workflow/steps', {}, owner.token,
      );
      expect(graphKeySteps.data[0]).toMatchObject({
        item_key: null, item_index: 0, activation_key: null,
      });
      expect(JSON.stringify(graphKeySteps.data)).not.toContain('patient@example.com');
      const ownTopology = await runtime.request<Record<string, any>>(
        '/workflows/owned-workflow/topology', {}, owner.token,
      );
      expect(ownTopology).toEqual({
        status: 200,
        data: {
          instanceId: 'owned-workflow',
          name: 'manual-workflow',
          format: 'legacy',
          schemaVersion: null,
          definitionVersion: null,
          graphFingerprint: null,
          entry: 'step-owned-workflow',
          nodes: [{
            id: 'step-owned-workflow', path: 'step-owned-workflow',
            kind: 'activity', label: 'Noop', parentPath: null, branchKey: null,
          }],
          edges: [],
        },
      });
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
        'discoverable-admin', 'metadata-workflow',
      ]);
      const operatorDefinitions = await runtime.request<DefinitionSummary[]>(
        '/workflows/definitions', {}, operator.token,
      );
      expect(operatorDefinitions.data.map(({ name }) => name)).toEqual([
        'discoverable-admin', 'metadata-workflow', 'operator-only',
      ]);
      const adminDefinitions = await runtime.request<DefinitionSummary[]>(
        '/workflows/definitions', {}, admin.token,
      );
      expect(adminDefinitions.data.map(({ name }) => name)).toEqual([
        'admin-only', 'discoverable-admin', 'metadata-workflow', 'operator-only',
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

  test('administers immutable database definitions without exposing executable graphs', async () => {
    const runtime = await createHttpRuntime((registry) => {
      registry.registerActivity({
        name: 'database-noop',
        version: '1',
        databaseCallable: true,
        default: true,
        handler: async ({ input }) => ({ input }),
      });
    });
    try {
      const user = await runtime.createUser('user');
      const admin = await runtime.createUser('admin');
      const graph = {
        schemaVersion: 1,
        entry: 'complete',
        nodes: [{
          id: 'complete',
          kind: 'activity',
          label: 'Complete request',
          activity: { name: 'database-noop', version: '1' },
        }],
        edges: [],
      };
      const forbidden = await runtime.request<Record<string, unknown>>(
        '/workflows/admin/definitions/publish',
        jsonPost({ name: 'database-workflow', graph }),
        user.token,
      );
      expect(forbidden).toEqual({
        status: 403,
        data: { error: 'Forbidden', code: 'FORBIDDEN' },
      });

      const untrustedGraph = {
        ...graph,
        nodes: [{
          id: 'complete', kind: 'activity', activity: { name: 'noop', version: '1' },
        }],
      };
      const disallowed = await runtime.request<Record<string, unknown>>(
        '/workflows/admin/definitions/publish',
        jsonPost({ name: 'disallowed-workflow', graph: untrustedGraph }),
        admin.token,
      );
      expect(disallowed).toEqual({
        status: 403,
        data: {
          error: 'Workflow activity "noop" version "1" is not allowed in database-authored workflows',
          code: 'WORKFLOW_ACTIVITY_NOT_ALLOWED',
        },
      });

      const first = await runtime.request<Record<string, any>>(
        '/workflows/admin/definitions/publish',
        jsonPost({
          name: 'database-workflow',
          graph,
          access: { start: 'authenticated', inspect: 'admin' },
        }),
        admin.token,
      );
      expect(first.status).toBe(200);
      expect(first.data).toMatchObject({
        name: 'database-workflow',
        created: true,
        activated: true,
        version: { version: 1, source: 'database', status: 'published' },
      });
      expect(JSON.stringify(first.data)).not.toContain('graph_json');
      expect(JSON.stringify(first.data)).not.toContain('database-noop');

      const visible = await runtime.request<Array<Record<string, unknown>>>(
        '/workflows/definitions',
        {},
        user.token,
      );
      expect(visible.data.find((definition) => definition.name === 'database-workflow'))
        .toBeUndefined();
      const adminVisible = await runtime.request<Array<Record<string, unknown>>>(
        '/workflows/definitions',
        {},
        admin.token,
      );
      expect(adminVisible.data.find((definition) => definition.name === 'database-workflow'))
        .toEqual({ name: 'database-workflow', steps: [{ name: 'Complete request' }] });

      const started = await runtime.request<{ instanceId: string }>(
        '/workflows',
        jsonPost({ name: 'database-workflow', input: { requestId: 'r1' } }),
        user.token,
      );
      expect(started.status).toBe(200);
      await waitFor(() => runtime.db.queryOne(
        'workflow_instances',
        started.data.instanceId,
      )?.status === 'completed');
      expect(runtime.db.queryOne('workflow_instances', started.data.instanceId))
        .toMatchObject({ definition_version: 1, started_by: user.user.userId });
      const publicInstance = await runtime.request<Record<string, unknown>>(
        `/workflows/${started.data.instanceId}`,
        {},
        user.token,
      );
      expect(publicInstance.data).toMatchObject({
        input: null,
        output: null,
        error: null,
      });
      expect(publicInstance.data).not.toHaveProperty('graph_json');
      const publicSteps = await runtime.request<Array<Record<string, unknown>>>(
        `/workflows/${started.data.instanceId}/steps`,
        {},
        user.token,
      );
      expect(publicSteps.data).toHaveLength(1);
      expect(publicSteps.data[0]).toMatchObject({
        input: null,
        output: null,
        error: null,
      });
      const topology = await runtime.request<Record<string, any>>(
        `/workflows/${started.data.instanceId}/topology`,
        {},
        user.token,
      );
      expect(topology.status).toBe(200);
      expect(topology.data).toMatchObject({
        instanceId: started.data.instanceId,
        name: 'database-workflow',
        format: 'graph',
        schemaVersion: 1,
        definitionVersion: 1,
        entry: 'complete',
        nodes: [{
          id: 'complete', path: 'complete', kind: 'activity',
          label: 'Complete request', parentPath: null, branchKey: null,
        }],
        edges: [],
      });
      expect(topology.data.graphFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(topology.data)).not.toContain('database-noop');
      expect(JSON.stringify(topology.data)).not.toContain('requestId');
      expect(runtime.db.queryOne('workflow_instances', started.data.instanceId)?.output)
        .toContain('requestId');
      expect(runtime.db.query('workflow_steps').find(
        (step) => step.instance_id === started.data.instanceId,
      )?.output).toContain('requestId');

      const second = await runtime.request<Record<string, any>>(
        '/workflows/admin/definitions/publish',
        jsonPost({
          name: 'database-workflow',
          graph,
          version: 2,
          activate: false,
          expectedActiveVersionId: first.data.activeVersionId,
        }),
        admin.token,
      );
      expect(second.data).toMatchObject({
        created: true,
        activated: false,
        activeVersionId: first.data.activeVersionId,
        version: { version: 2 },
      });

      const versions = await runtime.request<Array<Record<string, unknown>>>(
        `/workflows/admin/definitions/${first.data.definitionId}/versions`,
        {},
        admin.token,
      );
      expect(versions.data.map((version) => version.version)).toEqual([2, 1]);
      expect(JSON.stringify(versions.data)).not.toContain('graph_json');

      const activities = await runtime.request<Array<Record<string, unknown>>>(
        '/workflows/admin/definitions/activities',
        {},
        admin.token,
      );
      expect(activities.data).toContainEqual(expect.objectContaining({
        name: 'database-noop', version: '1', databaseCallable: true,
      }));

      const draft = await runtime.request<Record<string, any>>(
        '/workflows/admin/definitions/drafts',
        jsonPut({
          definitionId: first.data.definitionId,
          name: 'database-workflow',
          graph,
          baseVersionId: first.data.version.versionId,
          editorMetadata: { viewport: { x: 10, y: 20 } },
        }),
        admin.token,
      );
      expect(draft.data).toMatchObject({
        definitionId: first.data.definitionId,
        baseVersionId: first.data.version.versionId,
        revision: 1,
      });
      const mismatchedDraft = await runtime.request<Record<string, unknown>>(
        '/workflows/admin/definitions/drafts',
        jsonPut({
          definitionId: first.data.definitionId,
          name: 'another-workflow',
          graph,
        }),
        admin.token,
      );
      expect(mismatchedDraft).toEqual({
        status: 409,
        data: {
          error: 'Workflow draft definition identity does not match its name',
          code: 'WORKFLOW_DRAFT_CONFLICT',
        },
      });
      const loadedDraft = await runtime.request<Record<string, any>>(
        `/workflows/admin/definitions/drafts/${draft.data.draftId}`,
        {},
        admin.token,
      );
      expect(loadedDraft.data).toMatchObject({
        graph,
        editorMetadata: { viewport: { x: 10, y: 20 } },
      });

      const unfencedUpdate = await runtime.request<Record<string, unknown>>(
        '/workflows/admin/definitions/drafts',
        jsonPut({
          definitionId: first.data.definitionId,
          draftId: draft.data.draftId,
          name: 'database-workflow',
          graph,
        }),
        admin.token,
      );
      expect(unfencedUpdate).toMatchObject({
        status: 422,
        data: { code: 'WORKFLOW_REQUEST_INVALID' },
      });
      const unfencedDelete = await runtime.request<Record<string, unknown>>(
        `/workflows/admin/definitions/drafts/${draft.data.draftId}`,
        { method: 'DELETE' },
        admin.token,
      );
      expect(unfencedDelete).toMatchObject({
        status: 422,
        data: { code: 'WORKFLOW_REQUEST_INVALID' },
      });

      const missingRevision = await runtime.request<Record<string, unknown>>(
        `/workflows/admin/definitions/drafts/${draft.data.draftId}/publish`,
        jsonPost({ activate: false }),
        admin.token,
      );
      expect(missingRevision).toMatchObject({
        status: 422,
        data: { code: 'WORKFLOW_REQUEST_INVALID' },
      });

      const updatedGraph = {
        ...graph,
        nodes: [{
          ...graph.nodes[0],
          label: 'Complete updated request',
        }],
      };
      const updatedDraft = await runtime.request<Record<string, any>>(
        '/workflows/admin/definitions/drafts',
        jsonPut({
          definitionId: first.data.definitionId,
          draftId: draft.data.draftId,
          name: 'database-workflow',
          graph: updatedGraph,
          baseVersionId: first.data.version.versionId,
          expectedRevision: 1,
        }),
        admin.token,
      );
      expect(updatedDraft.data).toMatchObject({ revision: 2 });

      const staleDelete = await runtime.request<Record<string, unknown>>(
        `/workflows/admin/definitions/drafts/${draft.data.draftId}?expectedRevision=1`,
        { method: 'DELETE' },
        admin.token,
      );
      expect(staleDelete).toEqual({
        status: 409,
        data: {
          error: 'Workflow draft was changed by another editor',
          code: 'WORKFLOW_DRAFT_CONFLICT',
        },
      });

      const stalePublication = await runtime.request<Record<string, unknown>>(
        `/workflows/admin/definitions/drafts/${draft.data.draftId}/publish`,
        jsonPost({ expectedRevision: 1, activate: false }),
        admin.token,
      );
      expect(stalePublication).toEqual({
        status: 409,
        data: {
          error: 'Workflow draft changed before it could be published',
          code: 'WORKFLOW_DRAFT_CONFLICT',
        },
      });
      expect(runtime.db.prepare(`SELECT COUNT(*) AS count
        FROM workflow_definition_versions WHERE definition_id = ?`)
        .get(first.data.definitionId)).toEqual({ count: 2 });

      const currentPublication = await runtime.request<Record<string, any>>(
        `/workflows/admin/definitions/drafts/${draft.data.draftId}/publish`,
        jsonPost({ expectedRevision: 2, activate: false }),
        admin.token,
      );
      expect(currentPublication.data).toMatchObject({
        created: true,
        activated: false,
        version: { version: 3 },
      });
    } finally {
      await runtime.stop();
    }
  });

  test('preserves retryable workflow errors at the definition-admin HTTP boundary', async () => {
    const runtime = await createHttpRuntime((registry) => {
      registry.registerActivity({
        name: 'retryable-definition-noop',
        version: '1',
        databaseCallable: true,
        default: true,
        handler: async () => null,
      });
    });
    try {
      const admin = await runtime.createUser('admin');
      const published = await runtime.request<Record<string, any>>(
        '/workflows/admin/definitions/publish',
        jsonPost({
          name: 'retryable-definition',
          graph: {
            schemaVersion: 1,
            entry: 'complete',
            nodes: [{
              id: 'complete',
              kind: 'activity',
              activity: { name: 'retryable-definition-noop', version: '1' },
            }],
            edges: [],
          },
        }),
        admin.token,
      );
      expect(published.status).toBe(200);

      const versions = getWorkflowGraphRuntime(runtime.service).versions;
      const listVersions = versions.listVersions;
      versions.listVersions = () => {
        throw new WorkflowError(
          'Stale workflow runtime owner',
          'WORKFLOW_RUNTIME_LEASE_LOST',
          503,
          true,
        );
      };
      try {
        const response = await runtime.request<Record<string, unknown>>(
          `/workflows/admin/definitions/${published.data.definitionId}/versions`,
          {},
          admin.token,
        );
        expect(response).toEqual({
          status: 503,
          data: {
            error: 'Workflow definition request failed',
            code: 'WORKFLOW_RUNTIME_LEASE_LOST',
            retryable: true,
          },
        });
      } finally {
        versions.listVersions = listVersions;
      }
    } finally {
      await runtime.stop();
    }
  });

  test('exposes privacy-safe live interactions and resumes from an idempotent response', async () => {
    const runtime = await createHttpRuntime((registry) => {
      registry.registerWorkflow({
        name: 'interactive-approval',
        flow: flow(requestAndWait(
          'approval',
          'approval.responded',
          { label: 'Approval required', request: { prompt: 'Approve this request?' } },
        )),
      });
    });
    try {
      const owner = await runtime.createUser('user');
      const stranger = await runtime.createUser('user');
      const started = await runtime.request<{ instanceId: string }>(
        '/workflows',
        jsonPost({ name: 'interactive-approval', input: { requestId: 'r1' } }),
        owner.token,
      );
      expect(started.status).toBe(200);
      const instanceId = started.data.instanceId;
      await waitFor(() => runtime.db.query('workflow_interactions').length === 1);

      const interactions = await runtime.request<Array<Record<string, unknown>>>(
        `/workflows/${instanceId}/interactions`,
        {},
        owner.token,
      );
      expect(interactions.status).toBe(200);
      expect(interactions.data).toHaveLength(1);
      expect(interactions.data[0]).toMatchObject({
        instanceId,
        nodeId: 'approval',
        safeLabel: 'Approval required',
        status: 'open',
      });
      expect(JSON.stringify(interactions.data)).not.toContain('prompt');
      const interactionId = String(interactions.data[0].interactionId);

      const hidden = await runtime.request<Record<string, unknown>>(
        `/workflows/${instanceId}/interactions`,
        {},
        stranger.token,
      );
      expect(hidden).toEqual({
        status: 404,
        data: { error: 'Workflow not found', code: 'WORKFLOW_NOT_FOUND' },
      });

      const accepted = await runtime.request<Record<string, unknown>>(
        `/workflows/${instanceId}/interactions/${interactionId}/responses`,
        jsonPost({
          submissionId: 'submission-1',
          payload: { approved: true },
          channel: 'web',
        }),
        owner.token,
      );
      expect(accepted.status).toBe(200);
      expect(accepted.data).toMatchObject({ outcome: 'accepted' });
      await waitFor(() => runtime.db.queryOne('workflow_instances', instanceId)?.status
        === 'completed');

      const replay = await runtime.request<Record<string, unknown>>(
        `/workflows/${instanceId}/interactions/${interactionId}/responses`,
        jsonPost({
          submissionId: 'submission-1',
          payload: { approved: true },
          channel: 'web',
        }),
        owner.token,
      );
      expect(replay.data).toMatchObject({ outcome: 'accepted' });
      expect(runtime.db.prepare(`SELECT COUNT(*) AS count
        FROM _workflow_interaction_responses`).get()).toEqual({ count: 1 });
    } finally {
      await runtime.stop();
    }
  });

  test('lets an interaction authority grant a non-owner response without run access', async () => {
    let responderId = '';
    const authority = new WorkflowInteractionAuthority(({ actor }) =>
      actor.actorId === responderId
    );
    const runtime = await createHttpRuntime((registry) => {
      registry.registerWorkflow({
        name: 'delegated-approval',
        flow: flow(requestAndWait('approval', 'approval.responded')),
      });
    }, { interactionAuthority: authority });
    try {
      const owner = await runtime.createUser('user');
      const responder = await runtime.createUser('user');
      responderId = responder.user.userId;
      const started = await runtime.request<{ instanceId: string }>(
        '/workflows',
        jsonPost({ name: 'delegated-approval' }),
        owner.token,
      );
      const instanceId = started.data.instanceId;
      await waitFor(() => runtime.db.query('workflow_interactions').length === 1);
      const interaction = runtime.db.query('workflow_interactions')[0] as {
        interaction_id: string;
      };

      const accepted = await runtime.request<Record<string, unknown>>(
        `/workflows/${instanceId}/interactions/${interaction.interaction_id}/responses`,
        jsonPost({ submissionId: 'delegated-response', payload: { approved: true } }),
        responder.token,
      );
      expect(accepted).toMatchObject({ status: 200, data: { outcome: 'accepted' } });
      await waitFor(() => runtime.db.queryOne('workflow_instances', instanceId)?.status
        === 'completed');
    } finally {
      await runtime.stop();
    }
  });

  test('advances a rejected interaction that reaches its rejection limit', async () => {
    const runtime = await createHttpRuntime((registry) => {
      registry.registerActivity({
        name: 'reject-response',
        handler: async () => ({
          valid: false,
          code: 'not_approved',
          publicMessage: 'Response was not approved.',
        }),
      });
      registry.registerWorkflow({
        name: 'single-rejection',
        flow: flow(requestAndWait('approval', 'approval.responded', {
          validator: 'reject-response',
          maxRejections: 1,
        })),
      });
    });
    try {
      const owner = await runtime.createUser('user');
      const started = await runtime.request<{ instanceId: string }>(
        '/workflows',
        jsonPost({ name: 'single-rejection' }),
        owner.token,
      );
      const instanceId = started.data.instanceId;
      await waitFor(() => runtime.db.query('workflow_interactions').length === 1);
      const interaction = runtime.db.query('workflow_interactions')[0] as {
        interaction_id: string;
      };
      const rejected = await runtime.request<Record<string, unknown>>(
        `/workflows/${instanceId}/interactions/${interaction.interaction_id}/responses`,
        jsonPost({ submissionId: 'rejected-response', payload: { approved: false } }),
        owner.token,
      );

      expect(rejected).toMatchObject({
        status: 200,
        data: { outcome: 'rejected', interaction: { status: 'rejection_limit' } },
      });
      await waitFor(() => runtime.db.queryOne('workflow_instances', instanceId)?.status
        === 'failed');
    } finally {
      await runtime.stop();
    }
  });

  test('preserves responder roles across direct and named-event interaction paths', async () => {
    const authority = new WorkflowInteractionAuthority(({ actor }) =>
      actor.roles?.includes('admin') === true
    );
    const runtime = await createHttpRuntime((registry) => {
      registry.registerWorkflow({
        name: 'role-response-parity',
        flow: flow(requestAndWait('approval', 'approval.responded')),
      });
    }, { interactionAuthority: authority });
    try {
      const owner = await runtime.createUser('user');
      const approver = await runtime.createUser('admin');
      const direct = await runtime.request<{ instanceId: string }>(
        '/workflows', jsonPost({ name: 'role-response-parity' }), owner.token,
      );
      const event = await runtime.request<{ instanceId: string }>(
        '/workflows', jsonPost({ name: 'role-response-parity' }), owner.token,
      );
      await waitFor(() => runtime.db.query('workflow_interactions').length >= 2);
      const directInteraction = runtime.db.prepare(`SELECT interaction_id
        FROM workflow_interactions WHERE instance_id = ? LIMIT 1`)
        .get(direct.data.instanceId) as { interaction_id: string };

      const directResult = await runtime.request<Record<string, unknown>>(
        `/workflows/${direct.data.instanceId}/interactions/${directInteraction.interaction_id}/responses`,
        jsonPost({ submissionId: 'role-direct', payload: { approved: true } }),
        approver.token,
      );
      const eventResult = await runtime.request<Record<string, unknown>>(
        `/workflows/${event.data.instanceId}/events`,
        jsonPost({ eventName: 'approval.responded', payload: { approved: true } }),
        approver.token,
      );

      expect(directResult).toMatchObject({ status: 200, data: { outcome: 'accepted' } });
      expect(eventResult).toMatchObject({ status: 200, data: { matched: true } });
      await waitFor(() => [direct.data.instanceId, event.data.instanceId].every((id) =>
        runtime.db.queryOne('workflow_instances', id)?.status === 'completed'
      ));
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

  test('sanitizes AuthError responses and emits one app-local request failure per 5xx', async () => {
    const previous = getObservabilityRuntime().config;
    const globalEvents = new MemoryEventStore();
    const appEvents = new MemoryEventStore();
    configureObservability({ console: false, store: globalEvents });
    const runtime = await createHttpRuntime(undefined, { observability: appEvents });
    try {
      const admin = await runtime.createUser('admin');
      const listInstances = runtime.service.listInstances.bind(runtime.service);
      runtime.service.listInstances = (() => {
        throw new AuthError('private workflow auth failure', 'AUTH_NOT_READY', 503);
      }) as typeof runtime.service.listInstances;
      appEvents.clear();
      globalEvents.clear();

      const workflowFailure = await runtime.request<Record<string, unknown>>(
        '/workflows',
        {},
        admin.token,
      );
      expect(workflowFailure).toEqual({
        status: 503,
        data: { error: 'Authentication service unavailable', code: 'AUTH_NOT_READY' },
      });
      expect(appEvents.query({ code: OBS_CODES.APP_REQUEST_FAILED.code }).count).toBe(1);
      expect(globalEvents.query({ code: OBS_CODES.APP_REQUEST_FAILED.code }).count).toBe(0);

      runtime.service.listInstances = (() => {
        throw new AuthError('Safe workflow denial', 'FORBIDDEN', 403);
      }) as typeof runtime.service.listInstances;
      const safeWorkflowDenial = await runtime.request<Record<string, unknown>>(
        '/workflows',
        {},
        admin.token,
      );
      expect(safeWorkflowDenial).toEqual({
        status: 403,
        data: { error: 'Safe workflow denial', code: 'FORBIDDEN' },
      });
      expect(appEvents.query({ code: OBS_CODES.APP_REQUEST_FAILED.code }).count).toBe(1);
      runtime.service.listInstances = listInstances;

      const graphRuntime = getWorkflowGraphRuntime(runtime.service);
      const listCatalogs = graphRuntime.versions.listCatalogs.bind(graphRuntime.versions);
      graphRuntime.versions.listCatalogs = (() => {
        throw new AuthError('private definition auth failure', 'AUTH_NOT_READY', 503);
      }) as typeof graphRuntime.versions.listCatalogs;
      const definitionFailure = await runtime.request<Record<string, unknown>>(
        '/workflows/admin/definitions',
        {},
        admin.token,
      );
      expect(definitionFailure).toEqual({
        status: 503,
        data: { error: 'Authentication service unavailable', code: 'AUTH_NOT_READY' },
      });
      expect(appEvents.query({ code: OBS_CODES.APP_REQUEST_FAILED.code }).count).toBe(2);
      expect(globalEvents.query({ code: OBS_CODES.APP_REQUEST_FAILED.code }).count).toBe(0);
      graphRuntime.versions.listCatalogs = listCatalogs;
    } finally {
      await runtime.stop();
      configureObservability(previous);
    }
  });

  test('maps corrupt private interaction JSON to one generic app-local 500', async () => {
    const appEvents = new MemoryEventStore();
    const runtime = await createHttpRuntime((registry) => {
      registry.registerWorkflow({
        name: 'corrupt-private-interaction',
        flow: flow(requestAndWait('approval', 'approval.responded')),
      });
    }, { observability: appEvents });
    try {
      const owner = await runtime.createUser('user');
      const started = await runtime.request<{ instanceId: string }>(
        '/workflows',
        jsonPost({ name: 'corrupt-private-interaction' }),
        owner.token,
      );
      await waitFor(() => runtime.db.query('workflow_interactions').length === 1);
      const interaction = runtime.db.query('workflow_interactions')[0] as {
        interaction_id: string;
      };
      runtime.db.exec(`
        DROP TRIGGER trg_workflow_interaction_definition_immutable;
        DROP TRIGGER trg_workflow_interaction_request_immutable;
      `);
      runtime.db.prepare(`UPDATE _workflow_interaction_details
        SET request_json = ? WHERE interaction_id = ?`)
        .run('{', interaction.interaction_id);
      appEvents.clear();

      const response = await runtime.request<Record<string, unknown>>(
        `/workflows/${started.data.instanceId}/interactions/${interaction.interaction_id}/responses`,
        jsonPost({ submissionId: 'corrupt-json', payload: { approved: true } }),
        owner.token,
      );
      expect(response).toEqual({
        status: 500,
        data: { error: 'Workflow request failed', code: 'WORKFLOW_STATE_INVALID' },
      });
      expect(appEvents.query({ code: OBS_CODES.APP_REQUEST_FAILED.code }).count).toBe(1);
    } finally {
      await runtime.stop();
    }
  });

  test('revalidates request authority inside every workflow writer transaction', async () => {
    const runtime = await createHttpRuntime((registry) => {
      registry.registerActivity({
        name: 'database-commit-noop', version: '1', databaseCallable: true,
        handler: async ({ input }) => input,
      });
    });
    try {
      const admin = await runtime.createUser('admin');
      const graph = {
        schemaVersion: 1,
        entry: 'complete',
        nodes: [{
          id: 'complete', kind: 'activity',
          activity: { name: 'database-commit-noop', version: '1' },
        }],
        edges: [],
      };
      const secondGraph = {
        ...graph,
        entry: 'complete-v2',
        nodes: [{
          id: 'complete-v2', kind: 'activity',
          activity: { name: 'database-commit-noop', version: '1' },
        }],
      };
      const first = await runtime.request<Record<string, any>>(
        '/workflows/admin/definitions/publish',
        jsonPost({ name: 'commit-fenced-definition', graph }),
        admin.token,
      );
      const second = await runtime.request<Record<string, any>>(
        '/workflows/admin/definitions/publish',
        jsonPost({
          name: 'commit-fenced-definition', graph: secondGraph, version: 2, activate: false,
        }),
        admin.token,
      );
      const draft = await runtime.request<Record<string, any>>(
        '/workflows/admin/definitions/drafts',
        jsonPut({
          definitionId: first.data.definitionId,
          name: 'commit-fenced-definition',
          graph,
        }),
        admin.token,
      );
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(draft.status).toBe(200);

      seedWorkflow(runtime.db, 'event-fence', admin.user.userId);
      seedWorkflow(runtime.db, 'cancel-fence', admin.user.userId);
      seedWorkflow(runtime.db, 'pause-fence', admin.user.userId);
      seedWorkflow(runtime.db, 'resume-fence', admin.user.userId);
      runtime.db.update('workflow_instances', 'resume-fence', { status: 'paused' });
      const eventCount = runtime.db.query('workflow_events').length;

      const captureActorAuthorityFence = runtime.service.captureActorAuthorityFence
        .bind(runtime.service);
      const rejectCommit = () => {
        throw new AuthError(
          'Authorization changed before the workflow action could commit',
          'AUTH_STATE_CHANGED',
          409,
        );
      };
      runtime.service.captureActorAuthorityAssertion = () => rejectCommit;
      runtime.service.captureActorAuthorityFence = (context) => ({
        authority: captureActorAuthorityFence(context).authority,
        assertCurrentAuthority: rejectCommit,
      });

      const requests: Array<Promise<{ status: number; data: Record<string, unknown> }>> = [
        runtime.request(
          '/workflows/admin/definitions/publish',
          jsonPost({ name: 'commit-fenced-definition', graph, version: 3 }),
          admin.token,
        ),
        runtime.request(
          '/workflows/admin/definitions/drafts',
          jsonPut({
            definitionId: first.data.definitionId,
            draftId: draft.data.draftId,
            name: 'commit-fenced-definition',
            graph,
            expectedRevision: 1,
          }),
          admin.token,
        ),
        runtime.request(
          `/workflows/admin/definitions/drafts/${draft.data.draftId}?expectedRevision=1`,
          { method: 'DELETE' },
          admin.token,
        ),
        runtime.request(
          `/workflows/admin/definitions/drafts/${draft.data.draftId}/publish`,
          jsonPost({ expectedRevision: 1, activate: false }),
          admin.token,
        ),
        runtime.request(
          `/workflows/admin/definitions/${first.data.definitionId}/versions/${second.data.version.versionId}/activate`,
          { method: 'POST' },
          admin.token,
        ),
        runtime.request(
          `/workflows/admin/definitions/${first.data.definitionId}/versions/${first.data.version.versionId}/retire`,
          { method: 'POST' },
          admin.token,
        ),
        runtime.request(
          '/workflows/event-fence/events',
          jsonPost({ eventName: 'continue', payload: { accepted: true } }),
          admin.token,
        ),
        runtime.request('/workflows/cancel-fence/cancel', { method: 'POST' }, admin.token),
        runtime.request('/workflows/pause-fence/pause', { method: 'POST' }, admin.token),
        runtime.request('/workflows/resume-fence/resume', { method: 'POST' }, admin.token),
      ];
      for (const response of await Promise.all(requests)) {
        expect(response).toMatchObject({
          status: 409,
          data: { code: 'AUTH_STATE_CHANGED' },
        });
      }

      expect(runtime.db.prepare(`SELECT COUNT(*) AS count
        FROM workflow_definition_versions WHERE definition_id = ?`)
        .get(first.data.definitionId)).toEqual({ count: 2 });
      expect(runtime.db.prepare(`SELECT revision FROM _workflow_definition_drafts
        WHERE draft_id = ?`).get(draft.data.draftId)).toEqual({ revision: 1 });
      expect(runtime.db.prepare(`SELECT active_version_id FROM workflow_definitions
        WHERE definition_id = ?`).get(first.data.definitionId)).toEqual({
          active_version_id: first.data.version.versionId,
        });
      expect(runtime.db.prepare(`SELECT status FROM workflow_definition_versions
        WHERE version_id = ?`).get(first.data.version.versionId)).toEqual({
          status: 'published',
        });
      expect(runtime.db.query('workflow_events')).toHaveLength(eventCount);
      expect(runtime.db.queryOne('workflow_instances', 'cancel-fence')?.status).toBe('running');
      expect(runtime.db.queryOne('workflow_instances', 'pause-fence')?.status).toBe('running');
      expect(runtime.db.queryOne('workflow_instances', 'resume-fence')?.status).toBe('paused');

      const now = new Date().toISOString();
      runtime.db.insert('workflow_definitions', {
        definition_id: 'corrupt-definition', name: 'corrupt-definition', version: 1,
        steps_json: '{}', input_schema: null, created_at: now, updated_at: now,
        active_version_id: null, source: 'database', scope_type: 'application',
        scope_id: '', status: 'active', access_policy_json: null,
        created_by: admin.user.userId, updated_by: admin.user.userId,
      });
      runtime.db.prepare(`INSERT INTO workflow_definition_versions (
        version_id, definition_id, version_number, source, graph_format,
        schema_version, graph_json, input_schema_json, access_policy_json,
        fingerprint, status, created_by, created_at
      ) VALUES (?, ?, 1, 'database', 'graph', 1, '{}', NULL, NULL, ?,
        'published', ?, ?)`).run(
          'corrupt-version',
          'corrupt-definition',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          admin.user.userId,
          now,
        );
      const internal = await runtime.request<Record<string, unknown>>(
        '/workflows/admin/definitions/corrupt-definition/versions/corrupt-version',
        {},
        admin.token,
      );
      expect(internal).toEqual({
        status: 500,
        data: {
          error: 'Workflow definition request failed',
          code: 'WORKFLOW_VERSION_HISTORY_INVALID',
        },
      });
    } finally {
      await runtime.stop();
    }
  });
});

async function createHttpRuntime(
  register?: (registry: WorkflowRegistry) => void,
  options: {
    interactionAuthority?: WorkflowInteractionAuthority;
    observability?: MemoryEventStore;
  } = {},
) {
  const db = createReactiveDB({ mode: 'memory' });
  const appRuntime = options.observability
    ? new ZeroAppRuntime(`workflow-http-test-${crypto.randomUUID()}`)
    : undefined;
  if (appRuntime && options.observability) {
    appRuntime.set(ZERO_OBSERVABILITY_RUNTIME, {
      sink: options.observability,
      store: options.observability,
      config: { console: false, store: options.observability },
    });
  }
  let initialize!: () => Promise<void>;
  const plugin = createWorkflowPlugin({
    db,
    runtime: appRuntime,
    interactionAuthority: options.interactionAuthority,
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
    .use(createAuthPlugin({ db, runtime: appRuntime }))
    .use(createSchedulerPlugin(appRuntime ? { runtime: appRuntime } : undefined))
    .use(plugin)
    .listen(0);
  await waitFor(() => Boolean(getAuthStore() && getTokenService()));
  await initialize();
  const baseUrl = `http://localhost:${app.server!.port}`;

  return {
    db,
    service: getWorkflowService()!,
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
      await appRuntime?.dispose();
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

function jsonPut(body: unknown): RequestInit {
  return { ...jsonPost(body), method: 'PUT' };
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

function seedWorkflow(
  db: ReactiveDB,
  instanceId: string,
  ownerId: string,
  withPrivatePayload = false,
): void {
  const now = new Date().toISOString();
  db.insert('workflow_instances', {
    instance_id: instanceId,
    definition_id: 'manual-definition',
    name: 'manual-workflow',
    status: 'running',
    current_step: 0,
    input: withPrivatePayload ? '{"legacy-http-secret":"instance-input"}' : null,
    output: withPrivatePayload ? '{"legacy-http-secret":"instance-output"}' : null,
    error: withPrivatePayload ? 'legacy-http-secret instance failure' : null,
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
    input: withPrivatePayload ? '{"legacy-http-secret":"step-input"}' : null,
    output: withPrivatePayload ? '{"legacy-http-secret":"step-output"}' : null,
    error: withPrivatePayload ? 'legacy-http-secret step failure' : null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    wait_event: 'continue',
    timeout_at: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    item_key: withPrivatePayload ? 'legacy-http-secret-item' : null,
    activation_key: withPrivatePayload ? 'legacy-http-secret-activation' : null,
  });
  db.insert('workflow_events', {
    event_id: `event-${instanceId}`,
    instance_id: instanceId,
    event_name: 'audit-only',
    payload: withPrivatePayload ? '{"legacy-http-secret":"event"}' : null,
    sent_by: ownerId,
    created_at: now,
  });
  seedResourceAccounting(db, instanceId);
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
  new WorkflowExecutionAuthorityStore(db).insert(
    instanceId,
    createSystemAuthority({
      principal: 'workflow-plugin-test',
      reason: 'Seed a recoverable standalone workflow fixture',
      scope: applicationServiceDataScope(),
      legacyCompatibility: true,
    }),
  );
  seedResourceAccounting(db, instanceId);
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
