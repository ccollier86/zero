/**
 * workflow-hooks.ts
 *
 * React hooks for real-time workflow observability. Uses the platform's
 * useCollection/useRow/useQuery for automatic re-renders when workflow
 * state changes via the sync engine (WebSocket broadcast).
 *
 * Actions go through the SDK client's fetch (auth token included).
 */

import { useCallback, useMemo, useRef } from 'react';
import type { Row } from '../../sync/types';
import { useClient } from './client-context';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useQuery, useRow } from './data-hooks';
import { unwrap } from './api';
import type {
  WorkflowStatus,
  WorkflowInstanceRecord,
  WorkflowStepRecord,
} from '../../workflows/types';

// ─── Types ───────────────────────────────────────────

export interface UseWorkflowResult {
  instance: WorkflowInstanceRecord | null;
  steps: WorkflowStepRecord[];
  currentStep: WorkflowStepRecord | null;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  isPaused: boolean;
}

export interface UseWorkflowListResult {
  instances: WorkflowInstanceRecord[];
  count: number;
}

export interface WorkflowActions {
  start: (name: string, input?: unknown) => Promise<string>;
  cancel: (instanceId: string) => Promise<void>;
  pause: (instanceId: string) => Promise<void>;
  resume: (instanceId: string) => Promise<void>;
  sendEvent: (instanceId: string, eventName: string, payload?: unknown) => Promise<void>;
}

// ─── Hooks ───────────────────────────────────────────

/**
 * Live-updating workflow instance + steps. Re-renders automatically
 * when the sync engine broadcasts changes.
 */
export function useWorkflow(instanceId: string | null): UseWorkflowResult {
  const instance = useRow<WorkflowInstanceRecord & Row>(
    'workflow_instances',
    instanceId ?? '',
  );

  const stepFilter = useCallback(
    (s: WorkflowStepRecord & Row) => s.instance_id === instanceId,
    [instanceId],
  );
  const steps = useQuery<WorkflowStepRecord & Row>('workflow_steps', stepFilter);

  const sorted = useMemo(
    () => [...steps].sort((a, b) => a.step_index - b.step_index),
    [steps],
  );

  const currentStep = useMemo(
    () => sorted.find(s => s.status === 'running' || s.status === 'waiting') ?? null,
    [sorted],
  );

  return {
    instance: instanceId ? instance : null,
    steps: sorted,
    currentStep,
    isRunning: instance?.status === 'running',
    isComplete: instance?.status === 'completed',
    isFailed: instance?.status === 'failed',
    isPaused: instance?.status === 'paused',
  };
}

/**
 * Live-updating workflow list with optional filter.
 */
export function useWorkflowList(filter?: {
  status?: WorkflowStatus;
  name?: string;
}): UseWorkflowListResult {
  const filterStatus = filter?.status;
  const filterName = filter?.name;
  const instanceFilter = useCallback(
    (i: WorkflowInstanceRecord & Row) => {
      if (filterStatus && i.status !== filterStatus) return false;
      if (filterName && i.name !== filterName) return false;
      return true;
    },
    [filterStatus, filterName],
  );
  const instances = useQuery<WorkflowInstanceRecord & Row>('workflow_instances', instanceFilter);

  const sorted = useMemo(
    () => [...instances].sort((a, b) =>
      (b.created_at as string).localeCompare(a.created_at as string),
    ),
    [instances],
  );

  return { instances: sorted, count: sorted.length };
}

/**
 * Workflow action dispatchers. Uses Eden Treaty API.
 */
export function useWorkflowActions(): WorkflowActions {
  const client = useClient();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  const runAction = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) {
      throw new Error('Workflow actions are unavailable during an authorization scope transition.');
    }
    const result = await operation();
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) {
      throw new Error('The authorization scope changed before the workflow action completed.');
    }
    return result;
  }, [callbackBoundaryKey]);

  const start = useCallback((name: string, input?: unknown): Promise<string> => runAction(async () => {
    const res = unwrap(await client.api.workflows.post({ name, input }));
    return (res as { instanceId: string }).instanceId;
  }), [client, runAction]);

  const cancel = useCallback((instanceId: string): Promise<void> => runAction(async () => {
    unwrap(await client.api.workflows[instanceId].cancel.post());
  }), [client, runAction]);

  const pause = useCallback((instanceId: string): Promise<void> => runAction(async () => {
    unwrap(await client.api.workflows[instanceId].pause.post());
  }), [client, runAction]);

  const resume = useCallback((instanceId: string): Promise<void> => runAction(async () => {
    unwrap(await client.api.workflows[instanceId].resume.post());
  }), [client, runAction]);

  const sendEvent = useCallback(
    (instanceId: string, eventName: string, payload?: unknown): Promise<void> => runAction(async () => {
      unwrap(await client.api.workflows[instanceId].events.post({ eventName, payload }));
    }),
    [client, runAction],
  );

  return { start, cancel, pause, resume, sendEvent };
}
