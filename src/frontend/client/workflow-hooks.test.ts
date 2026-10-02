import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

import type { Row } from '../../sync/types';
import { OBS_CODES } from '../../observability/codes';
import type {
  WorkflowClientInteractionRecord,
  WorkflowClientInstanceRecord,
  WorkflowClientStepRecord,
  WorkflowEventRecord,
  WorkflowStatus,
} from '../../workflows/types';
import type { WorkflowPublicTopology } from '../../workflows/workflow-public-topology';
import type { WorkflowInteractionRecord } from '../../workflows/workflow-interaction-records';
import { ApiError } from './api';
import { AuthorizationDataBoundaryController } from './authorization-data-boundary';
import { ClientProvider } from './client-context';
import type { Collection } from './collection';
import type { Client } from './sdk';
import {
  useWorkflow,
  useWorkflowActions,
  useWorkflowList,
  type WorkflowInteractionSubmissionResult,
} from './workflow-hooks';
import { useWorkflowRun, type UseWorkflowRunOptions } from './workflow-run-hooks';
import { useWorkflowTopology } from './workflow-topology-hooks';
import {
  configureFrontendObservability,
  type FrontendObservabilityEvent,
} from './observability';

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
  ) => Promise<EdenResult<WorkflowInteractionSubmissionResult>>;
  topology: (instanceId: string) => Promise<EdenResult<WorkflowPublicTopology>>;
}

const activeRoots = new Set<Root>();
let restoreDom: (() => void) | null = null;

beforeEach(() => {
  restoreDom = installMinimalDom();
  configureFrontendObservability({ console: false, http: false });
});

afterEach(async () => {
  for (const root of [...activeRoots]) {
    await act(async () => root.unmount());
    activeRoots.delete(root);
  }
  restoreDom?.();
  restoreDom = null;
  configureFrontendObservability({ console: false, http: false });
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
      events: [],
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

  test('fails orphaned live child rows closed until their parent instance is visible', async () => {
    const client = workflowClient({
      steps: [step('orphan-step', 'orphan-run', 0, 'waiting')],
      interactions: [interaction('orphan-wait', 'orphan-run', 'orphan-step', 'open')],
      events: [workflowEvent(
        'orphan-event',
        'orphan-run',
        'continue',
        '2030-01-01T00:00:00.000Z',
      )],
    });
    const rendered = await renderHook(
      () => useWorkflow('orphan-run'),
      undefined,
      client.value,
    );

    expect(rendered.current).toMatchObject({
      instance: null,
      steps: [],
      activeSteps: [],
      interactions: [],
      events: [],
      currentStep: null,
      isWaiting: false,
      isWaitingForInput: false,
    });

    await act(async () => client.instances.replace([
      instance('orphan-run', 'running', 0, '2030-01-01T00:00:00.000Z'),
    ]));
    expect(rendered.current.steps.map((row) => row.step_id)).toEqual(['orphan-step']);
    expect(rendered.current.interactions.map((row) => row.interaction_id))
      .toEqual(['orphan-wait']);
    expect(rendered.current.events.map((row) => row.event_id)).toEqual(['orphan-event']);
    expect(rendered.current.isWaiting).toBe(true);
    expect(rendered.current.isWaitingForInput).toBe(true);

    await act(async () => {
      client.steps.replace([{
        ...step('orphan-step', 'orphan-run', 0, 'waiting'),
        tenant_id: 'foreign-tenant',
      }]);
      client.interactions.replace([{
        ...interaction('orphan-wait', 'orphan-run', 'orphan-step', 'open'),
        tenant_id: 'foreign-tenant',
      }]);
      client.events.replace([{
        ...workflowEvent(
          'orphan-event',
          'orphan-run',
          'continue',
          '2030-01-01T00:00:00.000Z',
        ),
        tenant_id: 'foreign-tenant',
      }]);
    });
    expect(rendered.current).toMatchObject({
      steps: [], interactions: [], events: [], isWaiting: false, isWaitingForInput: false,
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

    await act(async () => client.interactions.replace([
      interaction('wait_1', 'run_graph', 'branch_b', 'accepted'),
    ]));
    expect(rendered.current).toMatchObject({
      isRunningInParallel: true,
      isWaiting: true,
      isWaitingForInput: false,
    });

    await act(async () => {
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

  test('never publishes active, waiting, retry, or parallel state for a terminal run', async () => {
    const client = workflowClient({
      instances: [instance('run_terminal', 'cancelled', 0, '2030-01-01T00:00:00.000Z')],
      steps: [
        step('branch_a', 'run_terminal', 0, 'running', {
          started_at: '2030-01-01T00:00:01.000Z',
        }),
        step('branch_b', 'run_terminal', 1, 'failed', {
          retry_at: '2030-01-01T00:01:00.000Z',
        }),
      ],
      interactions: [interaction('wait_terminal', 'run_terminal', 'branch_a', 'open')],
    });
    const rendered = await renderHook(
      () => useWorkflow('run_terminal'),
      undefined,
      client.value,
    );

    expect(rendered.current).toMatchObject({
      activeSteps: [],
      currentStep: null,
      isWaiting: false,
      isWaitingForInput: false,
      isRetrying: false,
      isRunningInParallel: false,
    });
  });

  test('sorts live events and keeps graph event payloads redacted', async () => {
    const client = workflowClient({
      instances: [instance('run_events', 'running', 0, '2030-01-01T00:00:00.000Z')],
      events: [
        workflowEvent('event_2', 'run_events', 'second', '2030-01-01T00:00:02.000Z'),
        workflowEvent('event_1b', 'run_events', 'same-time-b', '2030-01-01T00:00:01.000Z'),
        workflowEvent('event_1a', 'run_events', 'same-time-a', '2030-01-01T00:00:01.000Z'),
        workflowEvent('other', 'other_run', 'ignored', '2030-01-01T00:00:00.000Z'),
      ],
    });
    const rendered = await renderHook(
      () => useWorkflow('run_events'),
      undefined,
      client.value,
    );

    expect(rendered.current.events.map((row) => row.event_id))
      .toEqual(['event_1a', 'event_1b', 'event_2']);
    expect(rendered.current.events.every((row) => row.payload === null)).toBe(true);

    await act(async () => client.events.replace([
      workflowEvent('event_3', 'run_events', 'third', '2030-01-01T00:00:03.000Z'),
    ]));
    expect(rendered.current.events.map((row) => row.event_id)).toEqual(['event_3']);
  });

  test('distinguishes real branch or fan-out concurrency from delivery bookkeeping', async () => {
    const client = workflowClient({
      instances: [instance('run_parallel', 'running', 0, '2030-01-01T00:00:00.000Z')],
      steps: [
        step('wait', 'run_parallel', 0, 'waiting'),
        step('delivery', 'run_parallel', 1, 'running', {
          parent_step_id: 'wait',
          item_index: null,
        }),
      ],
    });
    const rendered = await renderHook(
      () => useWorkflow('run_parallel'),
      undefined,
      client.value,
    );
    expect(rendered.current.isRunningInParallel).toBe(false);

    await act(async () => client.steps.replace([
      step('each', 'run_parallel', 0, 'waiting'),
      step('item_0', 'run_parallel', 1, 'running', {
        parent_step_id: 'each',
        item_index: 0,
      }),
      step('item_1', 'run_parallel', 2, 'running', {
        parent_step_id: 'each',
        item_index: 1,
      }),
    ]));
    expect(rendered.current.isRunningInParallel).toBe(true);
  });

  test('loads immutable public topology and fences stale instance responses', async () => {
    const events: FrontendObservabilityEvent[] = [];
    configureFrontendObservability({ sink: { emit: (event) => { events.push(event); } } });
    const alpha = deferred<EdenResult<WorkflowPublicTopology>>();
    const beta = deferred<EdenResult<WorkflowPublicTopology>>();
    const client = workflowClient();
    client.transport.topology = async (instanceId) => (
      instanceId === 'run_alpha' ? alpha.promise : beta.promise
    );
    const rendered = await renderHook(
      ({ id }: { id: string | null }) => useWorkflowTopology(id),
      { id: 'run_alpha' as string | null },
      client.value,
    );

    expect(rendered.current).toMatchObject({
      topology: null,
      isLoading: true,
      error: null,
    });

    await rendered.rerender({ id: 'run_beta' });
    await act(async () => {
      beta.resolve(success(publicTopology('run_beta')));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.current).toMatchObject({
      topology: publicTopology('run_beta'),
      isLoading: false,
      error: null,
    });

    await act(async () => {
      alpha.resolve(failure(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.current.topology?.instanceId).toBe('run_beta');
    expect(events).toEqual([]);
    expect(client.transport.calls.filter((call) => call.action === 'topology'))
      .toEqual([
        { action: 'topology', args: ['run_alpha'] },
        { action: 'topology', args: ['run_beta'] },
      ]);

    await rendered.rerender({ id: null });
    expect(rendered.current).toMatchObject({
      topology: null,
      isLoading: false,
      error: null,
    });
  });

  test('joins pinned topology paths to live root and fan-out rows for a visual monitor', async () => {
    const client = workflowClient({
      instances: [instance('run_visual', 'running', 0, '2030-01-01T00:00:00.000Z')],
      steps: [
        step('fanout-step', 'run_visual', 0, 'waiting', {
          node_id: 'fanout',
          node_kind: 'each',
          node_path: 'fanout',
          started_at: '2030-01-01T00:00:00.000Z',
        }),
        step('fanout-item-0', 'run_visual', 0, 'completed', {
          node_id: 'check',
          node_kind: 'activity',
          node_path: 'fanout/check',
          parent_step_id: 'fanout-step',
          item_index: 0,
        }),
        step('fanout-item-1', 'run_visual', 0, 'running', {
          node_id: 'check',
          node_kind: 'activity',
          node_path: 'fanout/check',
          parent_step_id: 'fanout-step',
          item_index: 1,
          started_at: '2030-01-01T00:00:01.000Z',
        }),
        step('delivery-step', 'run_visual', 0, 'running', {
          node_id: 'fanout/delivery/0',
          node_kind: 'activity',
          node_path: 'fanout/delivery/0',
          parent_step_id: 'fanout-step',
          item_index: null,
          started_at: '2030-01-01T00:00:01.000Z',
        }),
      ],
    });
    const topology: WorkflowPublicTopology = {
      ...publicTopology('run_visual'),
      entry: 'fanout',
      nodes: [
        {
          id: 'fanout', path: 'fanout', kind: 'each', label: 'Check records',
          parentPath: null, branchKey: null,
        },
        {
          id: 'check', path: 'fanout/check', kind: 'activity', label: 'Check record',
          parentPath: 'fanout', branchKey: null,
        },
      ],
    };
    client.transport.topology = async () => success(topology);
    const rendered = await renderHook(() => ({
      workflow: useWorkflow('run_visual'),
      topology: useWorkflowTopology('run_visual'),
    }), undefined, client.value);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const paths = new Set(rendered.current.workflow.steps.map((row) => row.node_path));
    expect(rendered.current.topology.topology?.nodes.every((node) => paths.has(node.path)))
      .toBe(true);
    expect(rendered.current.workflow.steps.filter(
      (row) => row.node_path === 'fanout/check',
    ).map((row) => [row.step_id, row.item_index])).toEqual([
      ['fanout-item-0', 0],
      ['fanout-item-1', 1],
    ]);
    expect(rendered.current.workflow.steps.find(
      (row) => row.step_id === 'delivery-step',
    )).toMatchObject({ parent_step_id: 'fanout-step', item_index: null });
  });

  test('surfaces a topology transport error and reloads without changing run identity', async () => {
    const events: FrontendObservabilityEvent[] = [];
    configureFrontendObservability({ sink: { emit: (event) => { events.push(event); } } });
    const client = workflowClient();
    client.transport.topology = async () => failure(
      404,
      'WORKFLOW_NOT_FOUND',
      'Workflow not found',
    );
    const rendered = await renderHook(
      () => useWorkflowTopology('run_topology'),
      undefined,
      client.value,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.current.error).toBeInstanceOf(ApiError);
    expect(rendered.current).toMatchObject({ topology: null, isLoading: false });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code: OBS_CODES.FRONTEND_WORKFLOW_TOPOLOGY_FAILED.code,
      metadata: { action: 'load', instanceId: 'run_topology' },
      error: { name: 'ApiError', message: 'Workflow not found' },
    });

    client.transport.topology = async () => success(publicTopology('run_topology'));
    await act(async () => {
      rendered.current.reload();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rendered.current).toMatchObject({
      topology: publicTopology('run_topology'),
      isLoading: false,
      error: null,
    });
    expect(events).toHaveLength(1);
  });

  test('fails a topology response for another run closed', async () => {
    const client = workflowClient();
    client.transport.topology = async () => success(publicTopology('other-run'));
    const rendered = await renderHook(
      () => useWorkflowTopology('requested-run'),
      undefined,
      client.value,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.current.topology).toBeNull();
    expect(rendered.current.isLoading).toBe(false);
    expect(rendered.current.error).toEqual(
      new Error('Workflow topology response did not match the requested run.'),
    );
  });

  test('clears cached manager topology before an owner-only reconnect is rendered', async () => {
    const manager = deferred<EdenResult<WorkflowPublicTopology>>();
    const ownerOnly = deferred<EdenResult<WorkflowPublicTopology>>();
    const client = workflowClient();
    let requests = 0;
    client.transport.topology = async () => (
      requests++ === 0 ? manager.promise : ownerOnly.promise
    );
    const rendered = await renderHook(
      () => useWorkflowTopology('peer_run'),
      undefined,
      client.value,
    );
    await act(async () => {
      manager.resolve(success(publicTopology('peer_run')));
      await manager.promise;
      await Promise.resolve();
    });
    expect(rendered.current.topology?.instanceId).toBe('peer_run');

    await act(async () => {
      // Sync's 4001 read-authority purge advances this shared boundary before
      // its refreshed owner-only connection can publish a replacement baseline.
      client.authorizationData.invalidate();
      await Promise.resolve();
    });
    expect(rendered.current).toMatchObject({
      topology: null,
      isLoading: true,
      error: null,
    });

    await act(async () => {
      ownerOnly.resolve(failure(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found'));
      await ownerOnly.promise;
      await Promise.resolve();
    });
    expect(rendered.current.topology).toBeNull();
    expect(rendered.current.error).toBeInstanceOf(ApiError);
  });

  test('discards an in-flight manager topology after same-scope authority revocation', async () => {
    const staleManager = deferred<EdenResult<WorkflowPublicTopology>>();
    const ownerOnly = deferred<EdenResult<WorkflowPublicTopology>>();
    const client = workflowClient();
    let requests = 0;
    client.transport.topology = async () => (
      requests++ === 0 ? staleManager.promise : ownerOnly.promise
    );
    const rendered = await renderHook(
      () => useWorkflowTopology('peer_run'),
      undefined,
      client.value,
    );
    expect(rendered.current.isLoading).toBe(true);

    await act(async () => {
      client.authorizationData.invalidate();
      await Promise.resolve();
    });
    await act(async () => {
      ownerOnly.resolve(failure(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found'));
      await ownerOnly.promise;
      await Promise.resolve();
    });
    await act(async () => {
      staleManager.resolve(success(publicTopology('peer_run')));
      await staleManager.promise;
      await Promise.resolve();
    });

    expect(rendered.current.topology).toBeNull();
    expect(requests).toBe(2);
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

  test('starts a pinned version and preserves safe interaction decision detail', async () => {
    const client = workflowClient();
    const rejected: WorkflowInteractionSubmissionResult = {
      outcome: 'rejected',
      interaction: serverInteraction('wait_1', 'started_1', 'open', 1),
      rejectionCode: 'approval_required',
      publicMessage: 'Approval is required.',
    };
    client.transport.response = async () => success(rejected);
    const rendered = await renderHook(() => useWorkflowActions(), undefined, client.value);

    await expect(rendered.current.start('approval', { requestId: 'r1' }, { version: 7 }))
      .resolves.toBe('started_1');
    await expect(rendered.current.submitResponse(
      'started_1',
      'wait_1',
      { approved: true },
      { submissionId: 'submission_1', channel: 'agent' },
    )).resolves.toEqual(rejected);
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
  test('preserves the privacy-safe interaction decision result', async () => {
    const client = workflowClient();
    const rejected: WorkflowInteractionSubmissionResult = {
      outcome: 'rejected',
      interaction: serverInteraction('wait_1', 'run_1', 'open', 1),
      rejectionCode: 'approval_required',
      publicMessage: 'Approval is required.',
    };
    client.transport.response = async () => success(rejected);
    const rendered = await renderHook(
      () => useWorkflowRun('approval', { instanceId: 'run_1' }),
      undefined,
      client.value,
    );

    let result!: WorkflowInteractionSubmissionResult;
    await act(async () => {
      result = await rendered.current.submitResponse(
        'wait_1',
        { approved: false },
        { submissionId: 'submission_1', channel: 'web' },
      );
    });
    expect(result).toEqual(rejected);
    expect(client.transport.calls).toEqual([{
      action: 'response',
      args: ['run_1', 'wait_1', 'submission_1', { approved: false }, 'web'],
    }]);
  });

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
      rootNodes: {
        totalSteps: 4,
        completedSteps: 2,
        failedSteps: 1,
        runningSteps: 1,
        percent: 50,
      },
      fanoutItems: {
        totalSteps: 0,
        completedSteps: 0,
        failedSteps: 0,
        runningSteps: 0,
        percent: 0,
      },
      deliverySteps: {
        totalSteps: 0,
        completedSteps: 0,
        failedSteps: 0,
        runningSteps: 0,
        percent: 0,
      },
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

  test('keeps root progress stable while reporting fan-out and delivery work separately', async () => {
    const client = workflowClient({
      instances: [instance('run_progress', 'running', 1, '2030-01-01T00:00:00.000Z')],
      steps: [
        step('prepare', 'run_progress', 0, 'completed'),
        step('fanout', 'run_progress', 1, 'waiting'),
        step('item_0', 'run_progress', 2, 'completed', {
          parent_step_id: 'fanout', item_key: 'item-0', item_index: 0,
        }),
        step('item_1', 'run_progress', 3, 'running', {
          parent_step_id: 'fanout', item_key: 'item-1', item_index: 1,
        }),
        step('delivery', 'run_progress', 4, 'running', {
          parent_step_id: 'fanout', item_key: null,
        }),
      ],
    });
    const rendered = await renderHook(
      () => useWorkflowRun('approval', { instanceId: 'run_progress' }),
      undefined,
      client.value,
    );

    expect(rendered.current.progress).toMatchObject({
      totalSteps: 2,
      completedSteps: 1,
      percent: 50,
      rootNodes: { totalSteps: 2, completedSteps: 1, percent: 50 },
      fanoutItems: { totalSteps: 2, completedSteps: 1, runningSteps: 1, percent: 50 },
      deliverySteps: { totalSteps: 1, completedSteps: 0, runningSteps: 1, percent: 0 },
    });

    await act(async () => client.steps.replace([
      step('prepare', 'run_progress', 0, 'completed'),
      step('fanout', 'run_progress', 1, 'waiting'),
      step('item_0', 'run_progress', 2, 'completed', {
        parent_step_id: 'fanout', item_key: 'item-0', item_index: 0,
      }),
      step('item_1', 'run_progress', 3, 'completed', {
        parent_step_id: 'fanout', item_key: 'item-1', item_index: 1,
      }),
      step('item_2', 'run_progress', 4, 'running', {
        parent_step_id: 'fanout', item_key: 'item-2', item_index: 2,
      }),
      step('delivery', 'run_progress', 5, 'completed', {
        parent_step_id: 'fanout', item_key: null,
      }),
    ]));

    expect(rendered.current.progress.rootNodes).toMatchObject({
      totalSteps: 2, completedSteps: 1, percent: 50,
    });
    expect(rendered.current.progress.fanoutItems).toMatchObject({
      totalSteps: 3, completedSteps: 2, runningSteps: 1, percent: 67,
    });
    expect(rendered.current.progress.deliverySteps).toMatchObject({
      totalSteps: 1, completedSteps: 1, percent: 100,
    });
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
    tenant_id: null,
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
    tenant_id: null,
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
    tenant_id: null,
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

function serverInteraction(
  interactionId: string,
  instanceId: string,
  status: WorkflowInteractionRecord['status'],
  rejectionCount = 0,
): WorkflowInteractionRecord {
  const now = '2030-01-01T00:00:00.000Z';
  return {
    interactionId,
    tenantId: null,
    instanceId,
    nodeId: 'approval',
    stepId: 'approval-step',
    safeLabel: 'Approval required',
    status,
    openedAt: now,
    expiresAt: null,
    acceptedAt: status === 'accepted' ? now : null,
    acceptedBy: status === 'accepted' ? 'user_1' : null,
    rejectionCount,
    maxRejections: 3,
    createdAt: now,
    updatedAt: now,
  };
}

function workflowEvent(
  eventId: string,
  instanceId: string,
  eventName: string,
  createdAt: string,
): WorkflowEventRecord & Row {
  return {
    event_id: eventId,
    tenant_id: null,
    instance_id: instanceId,
    event_name: eventName,
    payload: null,
    sent_by: 'user_1',
    created_at: createdAt,
  };
}

function publicTopology(instanceId: string): WorkflowPublicTopology {
  return {
    instanceId,
    name: 'approval',
    format: 'graph',
    schemaVersion: 1,
    definitionVersion: 3,
    graphFingerprint: 'fingerprint',
    entry: 'prepare',
    nodes: [{
      id: 'prepare',
      path: 'prepare',
      kind: 'activity',
      label: 'Prepare',
      parentPath: null,
      branchKey: null,
    }],
    edges: [],
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
  events?: Array<WorkflowEventRecord & Row>;
} = {}): {
  value: Client;
  authorizationData: AuthorizationDataBoundaryController;
  instances: TestCollection<WorkflowClientInstanceRecord & Row>;
  steps: TestCollection<WorkflowClientStepRecord & Row>;
  interactions: TestCollection<WorkflowClientInteractionRecord & Row>;
  events: TestCollection<WorkflowEventRecord & Row>;
  transport: WorkflowTransport;
} {
  const authorizationData = new AuthorizationDataBoundaryController();
  const instances = new TestCollection(initial.instances ?? [], 'instance_id');
  const steps = new TestCollection(initial.steps ?? [], 'step_id');
  const interactions = new TestCollection(initial.interactions ?? [], 'interaction_id');
  const events = new TestCollection(initial.events ?? [], 'event_id');
  const transport: WorkflowTransport = {
    calls: [],
    async start() { return success({ instanceId: 'started_1' }); },
    async cancel() { return success({ success: true }); },
    async pause() { return success({ success: true }); },
    async resume() { return success({ success: true }); },
    async event() { return success({ matched: true }); },
    async response() {
      return success({
        outcome: 'accepted',
        interaction: serverInteraction('interaction_1', 'started_1', 'accepted'),
      });
    },
    async topology(instanceId) { return success(publicTopology(instanceId)); },
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
        topology: { get: async () => {
          transport.calls.push({ action: 'topology', args: [instanceId] });
          return transport.topology(instanceId);
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
    workflow_events: events.asCollection('workflow_events') as Collection<Row>,
  };
  const value = {
    api: { workflows: routes },
    collection: (name: string) => collections[name],
    _authorizationDataBoundary: authorizationData,
  } as unknown as Client;
  return {
    value,
    authorizationData,
    instances,
    steps,
    interactions,
    events,
    transport,
  };
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
