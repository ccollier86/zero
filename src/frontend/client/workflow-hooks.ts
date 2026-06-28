/**
 * workflow-hooks.ts
 *
 * React hooks for real-time workflow observability. Uses the platform's
 * useCollection/useRow/useQuery for automatic re-renders when workflow
 * state changes via the sync engine (WebSocket broadcast).
 *
 * Actions go through the SDK client's fetch (auth token included).
 */

import { useCallback, useMemo } from 'react';
import type { Row } from '../../sync/types';
import { useClient } from './client-context';
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

  const start = useCallback(async (name: string, input?: unknown): Promise<string> => {
    const res = unwrap(await client.api.workflows.post({ name, input }));
    return (res as { instanceId: string }).instanceId;
  }, [client]);

  const cancel = useCallback(async (instanceId: string): Promise<void> => {
    unwrap(await client.api.workflows[instanceId].cancel.post());
  }, [client]);

  const pause = useCallback(async (instanceId: string): Promise<void> => {
    unwrap(await client.api.workflows[instanceId].pause.post());
  }, [client]);

  const resume = useCallback(async (instanceId: string): Promise<void> => {
    unwrap(await client.api.workflows[instanceId].resume.post());
  }, [client]);

  const sendEvent = useCallback(
    async (instanceId: string, eventName: string, payload?: unknown): Promise<void> => {
      unwrap(await client.api.workflows[instanceId].events.post({ eventName, payload }));
    },
    [client],
  );

  return { start, cancel, pause, resume, sendEvent };
}
