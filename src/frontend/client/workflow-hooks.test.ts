import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

import type { Row } from '../../sync/types';
import type {
  WorkflowClientInteractionRecord,
  WorkflowClientInstanceRecord,
  WorkflowClientStepRecord,
  WorkflowStatus,
} from '../../workflows/types';
import { ApiError } from './api';
import { ClientProvider } from './client-context';
import type { Collection } from './collection';
import type { Client } from './sdk';
import {
  useWorkflow,
  useWorkflowActions,
  useWorkflowList,
} from './workflow-hooks';
import { useWorkflowRun, type UseWorkflowRunOptions } from './workflow-run-hooks';

type EdenSuccess<T> = { data: T; error: null };
type EdenFailure = {
  data: null;
  error: { status: number; value: { error: string; code: string } };
};
type EdenResult<T> = EdenSuccess<T> | EdenFailure;

interface WorkflowTransport {
  calls: Array<{ action: string; args: unknown[] }>;
  start: (
    name: string,
    input: unknown,
    version?: number,
  ) => Promise<EdenResult<{ instanceId: string }>>;
  cancel: (instanceId: string) => Promise<EdenResult<{ success: boolean }>>;
  pause: (instanceId: string) => Promise<EdenResult<{ success: boolean }>>;
  resume: (instanceId: string) => Promise<EdenResult<{ success: boolean }>>;
  event: (
    instanceId: string,
    eventName: string,
    payload: unknown,
  ) => Promise<EdenResult<{ matched: boolean }>>;
  response: (
    instanceId: string,
    interactionId: string,
    submissionId: string,
    payload: unknown,
    channel: string | undefined,
  ) => Promise<EdenResult<{ outcome: 'accepted' | 'rejected' | 'superseded' }>>;
}

const activeRoots = new Set<Root>();
let restoreDom: (() => void) | null = null;

beforeEach(() => {
  restoreDom = installMinimalDom();
});

afterEach(async () => {
  for (const root of [...activeRoots]) {
    await act(async () => root.unmount());
    activeRoots.delete(root);
  }
  restoreDom?.();
  restoreDom = null;
});

describe('workflow observation hooks', () => {
  test('returns an empty, inert result for a null instance id', async () => {
    const client = workflowClient({
      instances: [instance('other', 'running', 0, '2030-01-01T00:00:00.000Z')],
      steps: [step('other-step', 'other', 0, 'running')],
    });
    const rendered = await renderHook(() => useWorkflow(null), undefined, client.value);

    expect(rendered.current).toEqual({
      instance: null,
      steps: [],
      activeSteps: [],
      interactions: [],
      currentStep: null,
      isRunning: false,
      isComplete: false,
      isFailed: false,
      isPaused: false,
      isCancelled: false,
      isWaiting: false,
      isWaitingForInput: false,
      isRetrying: false,
      isRunningInParallel: false,
    });
  });

  test('sorts steps, resolves the legal frontier, and derives status flags from live rows', async () => {
    const client = workflowClient({
      instances: [instance('run_1', 'running', 0, '2030-01-01T00:00:00.000Z')],
      steps: [
        step('step_2', 'run_1', 2, 'pending'),
        step('step_0', 'run_1', 0, 'completed'),
        step('step_1', 'run_1', 1, 'waiting'),
      ],
    });
    const rendered = await renderHook(
      ({ id }: { id: string | null }) => useWorkflow(id),
      { id: 'run_1' as string | null },
      client.value,
    );

    expect(rendered.current.steps.map((row) => row.step_id))
      .toEqual(['step_0', 'step_1', 'step_2']);
    expect(rendered.current.currentStep?.step_id).toBe('step_1');
    expect(rendered.current).toMatchObject({
      isRunning: true,
      isComplete: false,
      isWaiting: true,
      isRetrying: false,
    });

    await act(async () => {
      client.instances.replace([
        instance('run_1', 'paused', 2, '2030-01-01T00:00:00.000Z'),
      ]);
      client.steps.replace([
        step('step_2', 'run_1', 2, 'failed', { retry_at: '2030-01-01T00:01:00.000Z' }),
        step('step_1', 'run_1', 1, 'completed'),
        step('step_0', 'run_1', 0, 'completed'),
      ]);
    });

    expect(rendered.current.currentStep?.step_id).toBe('step_2');
    expect(rendered.current).toMatchObject({
      isRunning: false,
      isPaused: true,
      isWaiting: false,
      isRetrying: true,
    });

    await act(async () => {
      client.steps.replace([
        step('step_2', 'run_1', 2, 'completed'),
        step('step_1', 'run_1', 1, 'completed'),
        step('step_0', 'run_1', 0, 'completed'),
      ]);
      client.instances.replace([
        instance('run_1', 'completed', 2, '2030-01-01T00:00:00.000Z'),
      ]);
    });
    expect(rendered.current.currentStep).toBeNull();
    expect(workflowStatusFlags(rendered.current)).toEqual({
      running: false,
      complete: true,
      failed: false,
      paused: false,
      cancelled: false,
    });

    await act(async () => client.instances.replace([
      instance('run_1', 'failed', 2, '2030-01-01T00:00:00.000Z'),
    ]));
    expect(workflowStatusFlags(rendered.current)).toEqual({
      running: false,
      complete: false,
      failed: true,
      paused: false,
      cancelled: false,
    });

    await act(async () => client.instances.replace([
      instance('run_1', 'cancelled', 2, '2030-01-01T00:00:00.000Z'),
    ]));
    expect(workflowStatusFlags(rendered.current)).toEqual({
      running: false,
      complete: false,
      failed: false,
      paused: false,
      cancelled: true,
    });

    await rendered.rerender({ id: null });
    expect(rendered.current.instance).toBeNull();
    expect(rendered.current.steps).toEqual([]);
    expect(rendered.current.currentStep).toBeNull();
  });

  test('projects parallel activity and durable human waits from live Sync rows', async () => {
    const client = workflowClient({
      instances: [instance('run_graph', 'running', 0, '2030-01-01T00:00:00.000Z')],
      steps: [
        step('branch_b', 'run_graph', 2, 'waiting', {
          node_id: 'branch-b', started_at: '2030-01-01T00:00:02.000Z',
        }),
        step('branch_a', 'run_graph', 1, 'running', {
          node_id: 'branch-a', started_at: '2030-01-01T00:00:01.000Z',
        }),
      ],
      interactions: [interaction('wait_1', 'run_graph', 'branch_b', 'open')],
    });
    const rendered = await renderHook(() => useWorkflow('run_graph'), undefined, client.value);

    expect(rendered.current.activeSteps.map((row) => row.step_id))
      .toEqual(['branch_a', 'branch_b']);
    expect(rendered.current.interactions.map((row) => row.interaction_id))
      .toEqual(['wait_1']);
    expect(rendered.current).toMatchObject({
      isRunningInParallel: true,
      isWaiting: true,
      isWaitingForInput: true,
    });

    await act(async () => {
      client.interactions.replace([
        interaction('wait_1', 'run_graph', 'branch_b', 'accepted'),
      ]);
      client.steps.replace([
        step('branch_a', 'run_graph', 1, 'completed', { node_id: 'branch-a' }),
        step('branch_b', 'run_graph', 2, 'running', {
          node_id: 'branch-b', started_at: '2030-01-01T00:00:02.000Z',
        }),
      ]);
    });
    expect(rendered.current.isWaitingForInput).toBe(false);
    expect(rendered.current.isRunningInParallel).toBe(false);
  });

  test('applies both list filters and sorts matching instances newest first', async () => {
    const client = workflowClient({
      instances: [
        instance('alpha-old', 'running', 0, '2030-01-01T00:00:00.000Z', 'alpha'),
        instance('beta-new', 'running', 0, '2030-01-04T00:00:00.000Z', 'beta'),
        instance('alpha-new', 'running', 0, '2030-01-03T00:00:00.000Z', 'alpha'),
        instance('alpha-done', 'completed', 0, '2030-01-02T00:00:00.000Z', 'alpha'),
      ],
    });
    type Filter = { status?: WorkflowStatus; name?: string } | undefined;
    const rendered = await renderHook(
      ({ filter }: { filter: Filter }) => useWorkflowList(filter),
      { filter: { status: 'running', name: 'alpha' } as Filter },
      client.value,
    );

    expect(rendered.current.instances.map((row) => row.instance_id))
      .toEqual(['alpha-new', 'alpha-old']);
    expect(rendered.current.count).toBe(2);

    await rendered.rerender({ filter: { status: 'completed' } });
    expect(rendered.current.instances.map((row) => row.instance_id))
      .toEqual(['alpha-done']);
    expect(rendered.current.count).toBe(1);

    await rendered.rerender({ filter: undefined });
    expect(rendered.current.instances.map((row) => row.instance_id)).toEqual([
      'beta-new',
      'alpha-new',
      'alpha-done',
      'alpha-old',
    ]);
  });
});

describe('workflow action hooks', () => {
  test('wires every Eden action, preserves return values, errors, and callback identities', async () => {
    const client = workflowClient();
    const rendered = await renderHook(
      ({ revision: _revision }: { revision: number }) => useWorkflowActions(),
      { revision: 0 },
      client.value,
    );
    const original = rendered.current;

    await expect(rendered.current.start('approval', { requestId: 'r1' }))
      .resolves.toBe('started_1');
    await expect(rendered.current.pause('started_1')).resolves.toBeUndefined();
    await expect(rendered.current.resume('started_1')).resolves.toBeUndefined();
    await expect(rendered.current.sendEvent('started_1', 'approved', { ok: true }))
      .resolves.toBe(true);
    await expect(rendered.current.cancel('started_1')).resolves.toBeUndefined();
    expect(client.transport.calls).toEqual([
      { action: 'start', args: ['approval', { requestId: 'r1' }] },
      { action: 'pause', args: ['started_1'] },
      { action: 'resume', args: ['started_1'] },
      { action: 'event', args: ['started_1', 'approved', { ok: true }] },
      { action: 'cancel', args: ['started_1'] },
    ]);

    await rendered.rerender({ revision: 1 });
    expect(rendered.current.start).toBe(original.start);
    expect(rendered.current.cancel).toBe(original.cancel);
    expect(rendered.current.pause).toBe(original.pause);
    expect(rendered.current.resume).toBe(original.resume);
    expect(rendered.current.sendEvent).toBe(original.sendEvent);

    client.transport.cancel = async () => failure(
      409,
      'WORKFLOW_STATE_INVALID',
      'Cannot cancel a completed workflow',
    );
    const error = await rendered.current.cancel('started_1').catch((reason) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'WORKFLOW_STATE_INVALID',
      message: 'Cannot cancel a completed workflow',
    });
  });

  test('starts a pinned version and submits an idempotent interaction response', async () => {
    const client = workflowClient();
    const rendered = await renderHook(() => useWorkflowActions(), undefined, client.value);

    await expect(rendered.current.start('approval', { requestId: 'r1' }, { version: 7 }))
      .resolves.toBe('started_1');
    await expect(rendered.current.submitResponse(
      'started_1',
      'wait_1',
      { approved: true },
      { submissionId: 'submission_1', channel: 'agent' },
    )).resolves.toBe('accepted');
    expect(client.transport.calls).toEqual([
      { action: 'start', args: ['approval', { requestId: 'r1' }, 7] },
      {
        action: 'response',
        args: [
          'started_1', 'wait_1', 'submission_1', { approved: true }, 'agent',
        ],
      },
    ]);
  });
});

describe('useWorkflowRun', () => {
  test('surfaces a start failure and clears it when a later start succeeds', async () => {
    const client = workflowClient();
    client.transport.start = async () => failure(
      422,
      'WORKFLOW_INPUT_INVALID',
      'Input does not match workflow',
    );
    const rendered = await renderHook(
      () => useWorkflowRun('approval'),
      undefined,
      client.value,
    );

    let startError: unknown;
    await act(async () => {
      startError = await rendered.current.start({ invalid: true }).catch((error) => error);
    });
    expect(startError).toBeInstanceOf(ApiError);
    expect(startError).toMatchObject({ status: 422, code: 'WORKFLOW_INPUT_INVALID' });
    expect(rendered.current).toMatchObject({
      instanceId: null,
      starting: false,
      actionError: startError,
    });

    client.transport.start = async () => success({ instanceId: 'recovered_run' });
    await act(async () => {
      await rendered.current.start({ valid: true });
    });
    expect(rendered.current).toMatchObject({
      instanceId: 'recovered_run',
      starting: false,
      actionError: null,
    });
  });

  test('tracks start/action pending state, errors, progress, and current-run action wiring', async () => {
    const startResponse = deferred<EdenResult<{ instanceId: string }>>();
    const pauseResponse = deferred<EdenResult<{ success: boolean }>>();
    const resumeResponse = deferred<EdenResult<{ success: boolean }>>();
    const client = workflowClient();
    client.transport.start = async () => startResponse.promise;
    client.transport.pause = async () => pauseResponse.promise;
    client.transport.resume = async () => resumeResponse.promise;

    const rendered = await renderHook(
      () => useWorkflowRun('approval'),
      undefined,
      client.value,
    );
    const callbacks = {
      start: rendered.current.start,
      cancel: rendered.current.cancel,
      pause: rendered.current.pause,
      resume: rendered.current.resume,
      sendEvent: rendered.current.sendEvent,
      setInstanceId: rendered.current.setInstanceId,
    };
    expect(rendered.current).toMatchObject({
      instanceId: null,
      starting: false,
      actionPending: false,
      actionError: null,
      progress: {
        totalSteps: 0,
        completedSteps: 0,
        failedSteps: 0,
        runningSteps: 0,
        percent: 0,
      },
    });

    let starting!: Promise<string>;
    await act(async () => {
      starting = rendered.current.start({ requestId: 'r1' });
      await Promise.resolve();
    });
    expect(rendered.current.starting).toBe(true);
    await act(async () => {
      startResponse.resolve(success({ instanceId: 'run_1' }));
      await starting;
    });
    expect(rendered.current.starting).toBe(false);
    expect(rendered.current.instanceId).toBe('run_1');

    await act(async () => {
      client.instances.replace([
        instance('run_1', 'running', 2, '2030-01-01T00:00:00.000Z', 'approval'),
      ]);
      client.steps.replace([
        step('s3', 'run_1', 3, 'failed', { retry_at: null }),
        step('s1', 'run_1', 1, 'skipped'),
        step('s2', 'run_1', 2, 'running'),
        step('s0', 'run_1', 0, 'completed'),
      ]);
    });
    expect(rendered.current.progress).toEqual({
      totalSteps: 4,
      completedSteps: 2,
      failedSteps: 1,
      runningSteps: 1,
      percent: 50,
    });

    let pausing!: Promise<void>;
    await act(async () => {
      pausing = rendered.current.pause();
      await Promise.resolve();
    });
    expect(rendered.current.actionPending).toBe(true);
    await act(async () => {
      pauseResponse.resolve(success({ success: true }));
      await pausing;
    });
    expect(rendered.current.actionPending).toBe(false);

    let resuming!: Promise<void>;
    await act(async () => {
      resuming = rendered.current.resume();
      await Promise.resolve();
    });
    expect(rendered.current.actionPending).toBe(true);
    let resumeError: unknown;
    await act(async () => {
      resumeResponse.resolve(failure(409, 'WORKFLOW_STATE_INVALID', 'Cannot resume workflow'));
      resumeError = await resuming.catch((error) => error);
    });
    expect(resumeError).toBeInstanceOf(ApiError);
    expect(rendered.current.actionPending).toBe(false);
    expect(rendered.current.actionError).toBe(resumeError);

    await act(async () => {
      await rendered.current.cancel();
    });
    expect(rendered.current.actionError).toBeNull();
    let eventMatched = false;
    await act(async () => {
      eventMatched = await rendered.current.sendEvent('approved', { ok: true });
    });
    expect(eventMatched).toBe(true);
    expect(client.transport.calls.slice(-2)).toEqual([
      { action: 'cancel', args: ['run_1'] },
      { action: 'event', args: ['run_1', 'approved', { ok: true }] },
    ]);

    expect(rendered.current.start).toBe(callbacks.start);
    expect(rendered.current.cancel).toBe(callbacks.cancel);
    expect(rendered.current.pause).toBe(callbacks.pause);
    expect(rendered.current.resume).toBe(callbacks.resume);
    expect(rendered.current.sendEvent).toBe(callbacks.sendEvent);
    expect(rendered.current.setInstanceId).toBe(callbacks.setInstanceId);
  });

  test('rejects instance actions before selection and exposes that failure', async () => {
    const client = workflowClient();
    const rendered = await renderHook(
      () => useWorkflowRun('approval'),
      undefined,
      client.value,
    );

    let error: unknown;
    await act(async () => {
      error = await rendered.current.cancel().catch((reason) => reason);
    });
    expect(error).toEqual(
      new Error('Workflow instance id is required for this action.'),
    );
    expect(rendered.current.actionPending).toBe(false);
    expect(rendered.current.actionError).toBe(error);
    expect(client.transport.calls).toEqual([]);
  });

  test('treats explicit null as controlled empty selection and local state only as uncontrolled', async () => {
    const client = workflowClient({
      instances: [
        instance('run_a', 'running', 0, '2030-01-01T00:00:00.000Z'),
        instance('run_b', 'paused', 0, '2030-01-02T00:00:00.000Z'),
      ],
    });
    const initial: { options: UseWorkflowRunOptions } = {
      options: { instanceId: 'run_a' },
    };
    const rendered = await renderHook(
      ({ options }: { options: UseWorkflowRunOptions }) => useWorkflowRun('approval', options),
      initial,
      client.value,
    );

    expect(rendered.current.instanceId).toBe('run_a');
    expect(rendered.current.instance?.instance_id).toBe('run_a');
    await act(async () => rendered.current.setInstanceId('run_b'));
    expect(rendered.current.instanceId).toBe('run_a');

    await rendered.rerender({ options: { instanceId: 'run_b' } });
    expect(rendered.current.instanceId).toBe('run_b');
    expect(rendered.current.instance?.instance_id).toBe('run_b');

    await rendered.rerender({ options: { instanceId: null } });
    expect(rendered.current.instanceId).toBeNull();
    expect(rendered.current.instance).toBeNull();
    await act(async () => {
      await rendered.current.start({ controlled: true });
    });
    expect(rendered.current.instanceId).toBeNull();

    await rendered.rerender({ options: {} });
    expect(rendered.current.instanceId).toBe('started_1');
    await act(async () => rendered.current.setInstanceId('run_b'));
    expect(rendered.current.instanceId).toBe('run_b');
  });
});

function instance(
  instanceId: string,
  status: WorkflowStatus,
  currentStep: number,
  createdAt: string,
  name = 'workflow',
): WorkflowClientInstanceRecord & Row {
  return {
    instance_id: instanceId,
    definition_id: `definition_${name}`,
    name,
    status,
    current_step: currentStep,
    input: null,
    output: null,
    error: null,
    started_by: 'user_1',
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: status === 'completed' ? createdAt : null,
  };
}

function workflowStatusFlags(result: ReturnType<typeof useWorkflow>): Record<string, boolean> {
  return {
    running: result.isRunning,
    complete: result.isComplete,
    failed: result.isFailed,
    paused: result.isPaused,
    cancelled: result.isCancelled,
  };
}

function step(
  stepId: string,
  instanceId: string,
  stepIndex: number,
  status: WorkflowClientStepRecord['status'],
  overrides: Partial<WorkflowClientStepRecord> = {},
): WorkflowClientStepRecord & Row {
  return {
    step_id: stepId,
    instance_id: instanceId,
    step_index: stepIndex,
    step_name: `Step ${stepIndex}`,
    status,
    input: null,
    output: null,
    error: null,
    retries: 0,
    max_retries: 3,
    retry_at: null,
    timeout_at: null,
    started_at: null,
    completed_at: null,
    created_at: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function interaction(
  interactionId: string,
  instanceId: string,
  stepId: string,
  status: WorkflowClientInteractionRecord['status'],
): WorkflowClientInteractionRecord & Row {
  const now = '2030-01-01T00:00:00.000Z';
  return {
    interaction_id: interactionId,
    instance_id: instanceId,
    node_id: 'approval',
    step_id: stepId,
    safe_label: 'Approval required',
    status,
    opened_at: now,
    expires_at: null,
    accepted_at: status === 'accepted' ? now : null,
    accepted_by: status === 'accepted' ? 'user_1' : null,
    rejection_count: 0,
    max_rejections: 3,
    created_at: now,
    updated_at: now,
  };
}

class TestCollection<T extends Row> {
  private rows: Record<string, T>;
  private readonly listeners = new Set<() => void>();

  constructor(rows: readonly T[], private readonly primaryKey: keyof T) {
    this.rows = indexRows(rows, primaryKey);
  }

  replace(rows: readonly T[]): void {
    this.rows = indexRows(rows, this.primaryKey);
    for (const listener of this.listeners) listener();
  }

  asCollection(name: string): Collection<T> {
    return {
      name,
      getAll: () => this.rows,
      getOne: (id) => this.rows[id] ?? null,
      getMany: (filter) => Object.values(this.rows).filter(filter),
      count: () => Object.keys(this.rows).length,
      subscribe: (listener) => {
        const callback = () => listener(this.rows);
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
      },
      subscribeOne: (id, listener) => {
        const callback = () => listener(this.rows[id] ?? null);
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
      },
      insert: () => undefined,
      identityKey: () => '',
      getByIdentity: () => null,
      upsertByIdentity: () => undefined,
      updateByIdentity: () => undefined,
      deleteByIdentity: () => undefined,
      update: () => undefined,
      remove: () => undefined,
      load: () => undefined,
      clear: () => this.replace([]),
    };
  }
}

function indexRows<T extends Row>(rows: readonly T[], primaryKey: keyof T): Record<string, T> {
  return Object.fromEntries(rows.map((row) => [String(row[primaryKey]), row]));
}

function workflowClient(initial: {
  instances?: Array<WorkflowClientInstanceRecord & Row>;
  steps?: Array<WorkflowClientStepRecord & Row>;
  interactions?: Array<WorkflowClientInteractionRecord & Row>;
} = {}): {
  value: Client;
  instances: TestCollection<WorkflowClientInstanceRecord & Row>;
  steps: TestCollection<WorkflowClientStepRecord & Row>;
  interactions: TestCollection<WorkflowClientInteractionRecord & Row>;
  transport: WorkflowTransport;
} {
  const instances = new TestCollection(initial.instances ?? [], 'instance_id');
  const steps = new TestCollection(initial.steps ?? [], 'step_id');
  const interactions = new TestCollection(initial.interactions ?? [], 'interaction_id');
  const transport: WorkflowTransport = {
    calls: [],
    async start() { return success({ instanceId: 'started_1' }); },
    async cancel() { return success({ success: true }); },
    async pause() { return success({ success: true }); },
    async resume() { return success({ success: true }); },
    async event() { return success({ matched: true }); },
    async response() { return success({ outcome: 'accepted' }); },
  };
  const routes = new Proxy({
    post: async ({ name, input, version }: {
      name: string;
      input: unknown;
      version?: number;
    }) => {
      transport.calls.push({
        action: 'start',
        args: version === undefined ? [name, input] : [name, input, version],
      });
      return transport.start(name, input, version);
    },
  } as Record<PropertyKey, unknown>, {
    get(target, property) {
      if (Reflect.has(target, property)) return Reflect.get(target, property);
      const instanceId = String(property);
      return {
        cancel: { post: async () => {
          transport.calls.push({ action: 'cancel', args: [instanceId] });
          return transport.cancel(instanceId);
        } },
        pause: { post: async () => {
          transport.calls.push({ action: 'pause', args: [instanceId] });
          return transport.pause(instanceId);
        } },
        resume: { post: async () => {
          transport.calls.push({ action: 'resume', args: [instanceId] });
          return transport.resume(instanceId);
        } },
        events: { post: async ({ eventName, payload }: { eventName: string; payload: unknown }) => {
          transport.calls.push({ action: 'event', args: [instanceId, eventName, payload] });
          return transport.event(instanceId, eventName, payload);
        } },
        interactions: new Proxy({}, {
          get(_interactions, interactionProperty) {
            const interactionId = String(interactionProperty);
            return {
              responses: { post: async ({ submissionId, payload, channel }: {
                submissionId: string;
                payload: unknown;
                channel?: string;
              }) => {
                transport.calls.push({
                  action: 'response',
                  args: [instanceId, interactionId, submissionId, payload, channel],
                });
                return transport.response(
                  instanceId,
                  interactionId,
                  submissionId,
                  payload,
                  channel,
                );
              } },
            };
          },
        }),
      };
    },
  });
  const collections: Record<string, Collection<Row>> = {
    workflow_instances: instances.asCollection('workflow_instances') as Collection<Row>,
    workflow_steps: steps.asCollection('workflow_steps') as Collection<Row>,
    workflow_interactions: interactions.asCollection('workflow_interactions') as Collection<Row>,
  };
  const value = {
    api: { workflows: routes },
    collection: (name: string) => collections[name],
  } as unknown as Client;
  return { value, instances, steps, interactions, transport };
}

function success<T>(data: T): EdenSuccess<T> {
  return { data, error: null };
}

function failure(status: number, code: string, message: string): EdenFailure {
  return { data: null, error: { status, value: { error: message, code } } };
}

async function renderHook<Props, Result>(
  hook: (props: Props) => Result,
  initialProps: Props,
  client: Client,
): Promise<{
  readonly current: Result;
  rerender: (props: Props) => Promise<void>;
}> {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createContainer());
  activeRoots.add(root);
  let current!: Result;

  function Capture({ props }: { props: Props }): ReactNode {
    current = hook(props);
    return null;
  }

  async function rerender(props: Props): Promise<void> {
    await act(async () => {
      root.render(createElement(
        ClientProvider,
        { client, children: createElement(Capture, { props }) },
      ));
    });
  }

  await rerender(initialProps);
  return {
    get current() { return current; },
    rerender,
  };
}

function createContainer(): Element {
  const document = globalThis.document as unknown as Record<string, unknown>;
  return {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    textContent: '',
    firstChild: null,
  } as unknown as Element;
}

function installMinimalDom(): () => void {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  class HTMLIFrameElement {}
  const window = {
    event: undefined,
    HTMLIFrameElement,
    document: null as unknown,
  };
  const document = {
    nodeType: 9,
    defaultView: window,
    activeElement: null,
    body: null,
    addEventListener() {},
    removeEventListener() {},
  };
  window.document = document;
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: window },
    document: { configurable: true, writable: true, value: document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
  });

  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
