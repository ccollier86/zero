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
  WorkflowClientInteractionRecord,
  WorkflowStatus,
  WorkflowClientInstanceRecord,
  WorkflowClientStepRecord,
} from '../../workflows/types';

// ─── Types ───────────────────────────────────────────

export interface UseWorkflowResult {
  instance: WorkflowClientInstanceRecord | null;
  steps: WorkflowClientStepRecord[];
  /** Nodes currently executing, awaiting input, or waiting to retry. */
  activeSteps: WorkflowClientStepRecord[];
  /** Privacy-safe durable interaction progress for this run. */
  interactions: WorkflowClientInteractionRecord[];
  currentStep: WorkflowClientStepRecord | null;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  isPaused: boolean;
  isCancelled: boolean;
  isWaiting: boolean;
  isWaitingForInput: boolean;
  isRetrying: boolean;
  isRunningInParallel: boolean;
}

export interface UseWorkflowListResult {
  instances: WorkflowClientInstanceRecord[];
  count: number;
}

export interface WorkflowActions {
  start: (
    name: string,
    input?: unknown,
    options?: { version?: number },
  ) => Promise<string>;
  cancel: (instanceId: string) => Promise<void>;
  pause: (instanceId: string) => Promise<void>;
  resume: (instanceId: string) => Promise<void>;
  sendEvent: (instanceId: string, eventName: string, payload?: unknown) => Promise<boolean>;
  submitResponse: (
    instanceId: string,
    interactionId: string,
    payload: unknown,
    options?: { submissionId?: string; channel?: string },
  ) => Promise<'accepted' | 'rejected' | 'superseded'>;
}

// ─── Hooks ───────────────────────────────────────────

/**
 * Live-updating workflow instance + steps. Re-renders automatically
 * when the sync engine broadcasts changes.
 */
export function useWorkflow(instanceId: string | null): UseWorkflowResult {
  const instance = useRow<WorkflowClientInstanceRecord & Row>(
    'workflow_instances',
    instanceId ?? '',
  );

  const stepFilter = useCallback(
    (s: WorkflowClientStepRecord & Row) => s.instance_id === instanceId,
    [instanceId],
  );
  const steps = useQuery<WorkflowClientStepRecord & Row>('workflow_steps', stepFilter);
  const interactionFilter = useCallback(
    (interaction: WorkflowClientInteractionRecord & Row) =>
      interaction.instance_id === instanceId,
    [instanceId],
  );
  const interactions = useQuery<WorkflowClientInteractionRecord & Row>(
    'workflow_interactions',
    interactionFilter,
  );

  const sorted = useMemo(
    () => [...steps].sort(compareWorkflowSteps),
    [steps],
  );

  const activeSteps = useMemo(
    () => sorted.filter(isActiveWorkflowStep),
    [sorted],
  );
  const sortedInteractions = useMemo(
    () => [...interactions].sort((a, b) =>
      a.opened_at.localeCompare(b.opened_at)
      || a.interaction_id.localeCompare(b.interaction_id)),
    [interactions],
  );

  const currentStep = useMemo(
    () => {
      const active = activeSteps[0];
      if (active) return active;
      const indexed = sorted.find(
        (step) => step.step_index === instance?.current_step,
      );
      if (indexed && indexed.status !== 'completed' && indexed.status !== 'skipped') {
        return indexed;
      }
      return sorted.find((step) =>
        step.status === 'pending'
        || step.status === 'running'
        || step.status === 'waiting'
        || step.status === 'failed'
      ) ?? null;
    },
    [activeSteps, instance?.current_step, sorted],
  );

  const isWaitingForInput = sortedInteractions.some(
    (interaction) => interaction.status === 'open',
  );

  return {
    instance: instanceId ? instance : null,
    steps: sorted,
    activeSteps,
    interactions: sortedInteractions,
    currentStep,
    isRunning: instance?.status === 'running',
    isComplete: instance?.status === 'completed',
    isFailed: instance?.status === 'failed',
    isPaused: instance?.status === 'paused',
    isCancelled: instance?.status === 'cancelled',
    isWaiting: currentStep?.status === 'waiting' || isWaitingForInput,
    isWaitingForInput,
    isRetrying: activeSteps.some(
      (step) => step.status === 'failed' && step.retry_at !== null,
    ),
    isRunningInParallel: activeSteps.filter((step) =>
      step.status === 'running' || step.status === 'waiting').length > 1,
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
    (i: WorkflowClientInstanceRecord & Row) => {
      if (filterStatus && i.status !== filterStatus) return false;
      if (filterName && i.name !== filterName) return false;
      return true;
    },
    [filterStatus, filterName],
  );
  const instances = useQuery<WorkflowClientInstanceRecord & Row>(
    'workflow_instances',
    instanceFilter,
  );

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

  const start = useCallback(async (
    name: string,
    input?: unknown,
    options?: { version?: number },
  ): Promise<string> => {
    const res = unwrap(await client.api.workflows.post({
      name,
      input,
      ...(options?.version === undefined ? {} : { version: options.version }),
    }));
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
    async (instanceId: string, eventName: string, payload?: unknown): Promise<boolean> => {
      const result = unwrap(await client.api.workflows[instanceId].events.post({ eventName, payload }));
      return Boolean((result as { matched?: boolean }).matched);
    },
    [client],
  );

  const submitResponse = useCallback(async (
    instanceId: string,
    interactionId: string,
    payload: unknown,
    options?: { submissionId?: string; channel?: string },
  ): Promise<'accepted' | 'rejected' | 'superseded'> => {
    const result = unwrap(await client.api.workflows[instanceId]
      .interactions[interactionId].responses.post({
        payload,
        submissionId: options?.submissionId ?? crypto.randomUUID(),
        ...(options?.channel === undefined ? {} : { channel: options.channel }),
      }));
    return (result as { outcome: 'accepted' | 'rejected' | 'superseded' }).outcome;
  }, [client]);

  return { start, cancel, pause, resume, sendEvent, submitResponse };
}

function isActiveWorkflowStep(step: WorkflowClientStepRecord): boolean {
  if (step.status === 'running' || step.status === 'waiting') return true;
  if (step.status === 'failed' && step.retry_at !== null) return true;
  return step.status === 'pending' && step.started_at !== null;
}

function compareWorkflowSteps(
  left: WorkflowClientStepRecord,
  right: WorkflowClientStepRecord,
): number {
  return left.step_index - right.step_index
    || (left.item_index ?? -1) - (right.item_index ?? -1)
    || (left.node_path ?? '').localeCompare(right.node_path ?? '')
    || left.step_id.localeCompare(right.step_id);
}
