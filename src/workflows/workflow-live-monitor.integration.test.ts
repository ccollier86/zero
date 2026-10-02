/**
 * End-to-end change-stream contracts for visual workflow monitors.
 *
 * These tests observe ReactiveDB's committed change stream rather than private
 * workflow stores. Sync projection/redaction and WebSocket delivery are covered
 * separately by workflow-sync-policy.test.ts and workflow-sync.integration.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { Change, Row } from '../sync/types';
import {
  each,
  flow,
  parallel,
  requestAndWait,
  step,
} from './workflow-dsl';
import { expr } from './workflow-expression';
import type { WorkflowClock } from './workflow-executor';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { getWorkflowGraphRuntime, WorkflowService } from './workflow-service';

let db: ReactiveDB;
let services: WorkflowService[];

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory', ringBufferDepth: 2_000 });
  defineWorkflowTables(db);
  services = [];
});

afterEach(async () => {
  await Promise.allSettled(services.map((service) => service.dispose()));
  db.dispose();
});

describe('workflow live monitor contract', () => {
  test('tracks parallel, each, interaction, pause, resume, completion, and cancellation', async () => {
    const changes: Change[] = [];
    const unsubscribe = db.onChange((change) => changes.push(change));
    const branchesReady = deferred<void>();
    const releaseBranches = deferred<void>();
    let activeBranches = 0;
    const registry = new WorkflowRegistry();
    registry.registerActivity({
      name: 'live-monitor.branch',
      handler: async ({ input }) => {
        activeBranches += 1;
        if (activeBranches === 2) branchesReady.resolve();
        await releaseBranches.promise;
        return input;
      },
    });
    registry.registerActivity({
      name: 'live-monitor.item',
      handler: async ({ input }) => input,
    });
    registry.create({
      name: 'live-monitor',
      flow: flow(
        parallel('split', {
          left: [step('left', 'live-monitor.branch')],
          right: [step('right', 'live-monitor.branch')],
        }),
        each(
          'items',
          expr.literal(['first', 'second']),
          flow(step('item', 'live-monitor.item')),
          { concurrency: 2, itemKey: expr.itemIndex() },
        ),
        requestAndWait('approval', 'live-monitor.approval', {
          label: 'Approve live run',
        }),
      ),
    });
    const service = track(new WorkflowService(db, registry));

    const starting = service.start('live-monitor', { private: true }, 'owner');
    await branchesReady.promise;
    const instanceId = requireInsertedInstance(changes, 'live-monitor');

    const initialInstanceStatuses = statusHistory(changes, 'workflow_instances', instanceId);
    expect(initialInstanceStatuses.length).toBeGreaterThan(0);
    expect(initialInstanceStatuses.every((status) => status === 'running')).toBe(true);
    expect(nodeStatusHistory(changes, instanceId, 'split')).toContain('completed');
    expect(nodeStatusHistory(changes, instanceId, 'left')).toEqual(['pending', 'running']);
    expect(nodeStatusHistory(changes, instanceId, 'right')).toEqual(['pending', 'running']);

    releaseBranches.resolve();
    expect(await starting).toBe(instanceId);

    expect(nodeStatusHistory(changes, instanceId, '@zero/split/join')).toContain('completed');
    expect(nodeStatusHistory(changes, instanceId, 'items')).toEqual([
      'pending', 'waiting', 'completed',
    ]);
    const itemChildren = latestRows(changes, 'workflow_steps').filter((row) =>
      row.instance_id === instanceId
      && row.node_path === 'items/item'
      && row.parent_step_id !== null);
    expect(itemChildren).toHaveLength(2);
    for (const child of itemChildren) {
      expect(statusHistory(changes, 'workflow_steps', String(child.step_id)))
        .toEqual(['pending', 'running', 'completed']);
    }
    expect(nodeStatusHistory(changes, instanceId, 'approval')).toEqual(['pending', 'waiting']);
    const interaction = getWorkflowGraphRuntime(service).listInteractions(instanceId)[0]!;
    expect(statusHistory(changes, 'workflow_interactions', interaction.interactionId))
      .toEqual(['open']);

    service.pause(instanceId);
    expect(statusHistory(changes, 'workflow_instances', instanceId).at(-1)).toBe('paused');
    await service.resume(instanceId);
    expect(statusHistory(changes, 'workflow_instances', instanceId).at(-1)).toBe('running');

    await getWorkflowGraphRuntime(service).submitInteraction({
      interactionId: interaction.interactionId,
      submissionId: 'live-monitor-accepted',
      actor: { actorId: 'owner' },
      payload: { approved: true },
      channel: 'test',
    });
    expect(statusHistory(changes, 'workflow_interactions', interaction.interactionId).at(-1))
      .toBe('accepted');
    expect(statusHistory(changes, 'workflow_instances', instanceId).at(-1)).toBe('completed');

    const cancelledId = await service.start('live-monitor', { private: true }, 'owner');
    const cancelledInteraction = getWorkflowGraphRuntime(service)
      .listInteractions(cancelledId)[0]!;
    service.cancel(cancelledId);
    expect(statusHistory(changes, 'workflow_instances', cancelledId).at(-1)).toBe('cancelled');
    expect(statusHistory(
      changes,
      'workflow_interactions',
      cancelledInteraction.interactionId,
    ).at(-1)).toBe('cancelled');
    expect(nodeStatusHistory(changes, cancelledId, 'approval').at(-1)).toBe('skipped');

    unsubscribe();
  });

  test('tracks retry scheduling, retry execution, terminal failure, and timeout', async () => {
    const changes: Change[] = [];
    const unsubscribe = db.onChange((change) => changes.push(change));
    const clock = new ManualClock();
    const timeoutStarted = deferred<void>();
    const registry = new WorkflowRegistry();
    let retryCalls = 0;
    registry.registerActivity({
      name: 'live-monitor.retry',
      handler: async () => {
        retryCalls += 1;
        if (retryCalls === 1) throw new Error('retry once');
        return 'done';
      },
    });
    registry.registerActivity({
      name: 'live-monitor.fail',
      handler: async () => { throw new Error('terminal failure'); },
    });
    registry.registerActivity({
      name: 'live-monitor.timeout',
      handler: async ({ signal }) => {
        timeoutStarted.resolve();
        await waitForAbort(signal!);
      },
    });
    registry.create({
      name: 'live-retry',
      flow: flow(step('retry', 'live-monitor.retry', { retries: 2, backoffMs: 100 })),
    });
    registry.create({
      name: 'live-failure',
      flow: flow(step('fail', 'live-monitor.fail', { retries: 1 })),
    });
    registry.create({
      name: 'live-timeout',
      flow: flow(step('timeout', 'live-monitor.timeout', { timeoutMs: 100 })),
    });
    const service = track(new WorkflowService(db, registry, { clock }));

    const retryId = await service.start('live-retry', null, 'owner');
    expect(nodeStatusHistory(changes, retryId, 'retry')).toEqual([
      'pending', 'running', 'failed',
    ]);
    const retryStep = latestNodeRow(changes, retryId, 'retry');
    expect(retryStep.retry_at).toBe('2030-01-01T00:00:00.100Z');
    clock.advance(100);
    expect(await service.pollRetries()).toBe(1);
    await service.advance(retryId);
    expect(nodeStatusHistory(changes, retryId, 'retry')).toEqual([
      'pending', 'running', 'failed', 'pending', 'running', 'completed',
    ]);
    expect(statusHistory(changes, 'workflow_instances', retryId).at(-1)).toBe('completed');

    const failedId = await service.start('live-failure', null, 'owner');
    expect(nodeStatusHistory(changes, failedId, 'fail')).toEqual([
      'pending', 'running', 'failed',
    ]);
    expect(statusHistory(changes, 'workflow_instances', failedId).at(-1)).toBe('failed');

    const timingOut = service.start('live-timeout', null, 'owner');
    await timeoutStarted.promise;
    const timeoutId = requireInsertedInstance(changes, 'live-timeout');
    expect(nodeStatusHistory(changes, timeoutId, 'timeout')).toEqual(['pending', 'running']);
    clock.advance(100);
    expect(service.pollTimeouts()).toBe(1);
    expect(await timingOut).toBe(timeoutId);
    expect(nodeStatusHistory(changes, timeoutId, 'timeout').at(-1)).toBe('failed');
    expect(statusHistory(changes, 'workflow_instances', timeoutId).at(-1)).toBe('failed');

    unsubscribe();
  });
});

function track(service: WorkflowService): WorkflowService {
  services.push(service);
  return service;
}

function requireInsertedInstance(changes: readonly Change[], name: string): string {
  const row = changes.find((change) => change.table === 'workflow_instances'
    && change.op === 'INSERT'
    && change.row?.name === name)?.row;
  if (!row || typeof row.instance_id !== 'string') {
    throw new Error(`Expected tracked workflow instance for ${name}`);
  }
  return row.instance_id;
}

function nodeStatusHistory(
  changes: readonly Change[],
  instanceId: string,
  nodeId: string,
): string[] {
  return changes.filter((change) => change.table === 'workflow_steps'
    && change.row?.instance_id === instanceId
    && change.row?.node_id === nodeId)
    .map((change) => String(change.row?.status));
}

function statusHistory(
  changes: readonly Change[],
  table: string,
  rowId: string,
): string[] {
  return changes.filter((change) => change.table === table && change.rowId === rowId)
    .map((change) => String(change.row?.status));
}

function latestRows(changes: readonly Change[], table: string): Row[] {
  const rows = new Map<string, Row>();
  for (const change of changes) {
    if (change.table !== table) continue;
    if (change.row) rows.set(change.rowId, change.row);
    else rows.delete(change.rowId);
  }
  return [...rows.values()];
}

function latestNodeRow(
  changes: readonly Change[],
  instanceId: string,
  nodeId: string,
): Row {
  const row = latestRows(changes, 'workflow_steps').find((candidate) =>
    candidate.instance_id === instanceId && candidate.node_id === nodeId);
  if (!row) throw new Error(`Expected workflow node ${nodeId}`);
  return row;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

class ManualClock implements WorkflowClock {
  private milliseconds = Date.parse('2030-01-01T00:00:00.000Z');
  now(): Date { return new Date(this.milliseconds); }
  advance(milliseconds: number): void { this.milliseconds += milliseconds; }
}
