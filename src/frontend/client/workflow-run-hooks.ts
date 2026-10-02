/**
 * workflow-run-hooks.ts
 *
 * Composes workflow actions and live workflow state into one UI-facing run
 * hook. This file owns selected instance/progress state only; workflow
 * execution, persistence, and authorization remain in the workflow backend.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import { useMutation } from './mutation-hooks';
import {
  useWorkflow,
  useWorkflowActions,
  type UseWorkflowResult,
  type WorkflowInteractionSubmissionResult,
} from './workflow-hooks';

export interface WorkflowProgressCounts {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  runningSteps: number;
  percent: number;
}

export interface WorkflowProgress extends WorkflowProgressCounts {
  /** Stable definition-node progress. The top-level fields mirror this value. */
  rootNodes: WorkflowProgressCounts;
  /** Dynamic `each` child progress, kept out of the stable root denominator. */
  fanoutItems: WorkflowProgressCounts;
  /** Interaction delivery activity progress, tracked separately from graph nodes. */
  deliverySteps: WorkflowProgressCounts;
}

export interface UseWorkflowRunOptions {
  instanceId?: string | null;
  /** Pin new starts to one immutable workflow-definition version. */
  version?: number;
}

export interface UseWorkflowRunResult extends UseWorkflowResult {
  instanceId: string | null;
  progress: WorkflowProgress;
  start: (input?: unknown) => Promise<string>;
  cancel: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  sendEvent: (eventName: string, payload?: unknown) => Promise<boolean>;
  submitResponse: (
    interactionId: string,
    payload: unknown,
    options?: { submissionId?: string; channel?: string },
  ) => Promise<WorkflowInteractionSubmissionResult>;
  starting: boolean;
  actionPending: boolean;
  actionError: unknown;
  setInstanceId: (instanceId: string | null) => void;
}

function requireInstanceId(instanceId: string | null): string {
  if (!instanceId) {
    throw new Error('Workflow instance id is required for this action.');
  }
  return instanceId;
}

/**
 * Start and observe one workflow run by definition name.
 *
 * The hook stores the most recently started instance id locally and reads live
 * workflow state through the existing sync-backed workflow hooks.
 */
export function useWorkflowRun(
  name: string,
  options: UseWorkflowRunOptions = {},
): UseWorkflowRunResult {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [localInstanceId, setLocalInstanceId] = useState<string | null>(options.instanceId ?? null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const previousBoundaryKeyRef = useRef(authorizationBoundary.key);
  boundaryReadyRef.current = authorizationBoundary.ready;
  boundaryKeyRef.current = authorizationBoundary.key;
  const callbackBoundaryKey = authorizationBoundary.key;
  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  // `null` is an intentional controlled value (observe no run). Only an
  // omitted/undefined option falls back to the hook's local selection.
  const requestedInstanceId = options.instanceId !== undefined
    ? options.instanceId
    : localInstanceId;
  const instanceId = visible ? requestedInstanceId : null;
  const workflow = useWorkflow(instanceId);
  const actions = useWorkflowActions();

  useEffect(() => {
    setLoadedBoundaryKey(authorizationBoundary.key);
    if (previousBoundaryKeyRef.current !== authorizationBoundary.key) {
      setLocalInstanceId(null);
      previousBoundaryKeyRef.current = authorizationBoundary.key;
    }
  }, [authorizationBoundary.key]);

  const startMutation = useMutation(
    (input?: unknown) => actions.start(name, input, {
      ...(options.version === undefined ? {} : { version: options.version }),
    }),
    {
      metadata: { workflow: name, action: 'start' },
      onSuccess: setLocalInstanceId,
    },
  );

  const actionMutation = useMutation(
    async (
      action: 'cancel' | 'pause' | 'resume' | 'event' | 'response',
      target?: string,
      payload?: unknown,
      responseOptions?: { submissionId?: string; channel?: string },
    ) => {
      const targetInstanceId = requireInstanceId(instanceId);
      switch (action) {
        case 'cancel':
          return actions.cancel(targetInstanceId);
        case 'pause':
          return actions.pause(targetInstanceId);
        case 'resume':
          return actions.resume(targetInstanceId);
        case 'event':
          return actions.sendEvent(targetInstanceId, target ?? '', payload);
        case 'response':
          return actions.submitResponse(
            targetInstanceId,
            target ?? '',
            payload,
            responseOptions,
          );
      }
    },
    { metadata: { workflow: name } },
  );

  const progress = useMemo((): WorkflowProgress => {
    const rootNodes = summarizeProgress(
      workflow.steps.filter((step) => step.parent_step_id == null),
    );
    const fanoutItems = summarizeProgress(
      workflow.steps.filter((step) => step.parent_step_id != null && step.item_index != null),
    );
    const deliverySteps = summarizeProgress(
      workflow.steps.filter((step) => step.parent_step_id != null && step.item_index == null),
    );
    return {
      ...rootNodes,
      rootNodes,
      fanoutItems,
      deliverySteps,
    };
  }, [workflow.steps]);

  const cancel = useCallback(async () => {
    await actionMutation.run('cancel');
  }, [actionMutation.run]);
  const pause = useCallback(async () => {
    await actionMutation.run('pause');
  }, [actionMutation.run]);
  const resume = useCallback(async () => {
    await actionMutation.run('resume');
  }, [actionMutation.run]);
  const sendEvent = useCallback(
    async (eventName: string, payload?: unknown) =>
      Boolean(await actionMutation.run('event', eventName, payload)),
    [actionMutation.run],
  );
  const submitResponse = useCallback(
    async (
      interactionId: string,
      payload: unknown,
      responseOptions?: { submissionId?: string; channel?: string },
    ) => actionMutation.run(
      'response',
      interactionId,
      payload,
      responseOptions,
    ) as Promise<WorkflowInteractionSubmissionResult>,
    [actionMutation.run],
  );
  const setInstanceId = useCallback((nextInstanceId: string | null) => {
    if (boundaryReadyRef.current
      && boundaryKeyRef.current === callbackBoundaryKey) {
      setLocalInstanceId(nextInstanceId);
    }
  }, [callbackBoundaryKey]);

  return {
    ...workflow,
    instanceId,
    progress,
    start: startMutation.run,
    cancel,
    pause,
    resume,
    sendEvent,
    submitResponse,
    starting: startMutation.pending,
    actionPending: actionMutation.pending,
    actionError: startMutation.error ?? actionMutation.error,
    setInstanceId,
  };
}

function summarizeProgress(
  steps: ReadonlyArray<UseWorkflowResult['steps'][number]>,
): WorkflowProgressCounts {
  const totalSteps = steps.length;
  const completedSteps = steps.filter(
    (step) => step.status === 'completed' || step.status === 'skipped',
  ).length;
  const failedSteps = steps.filter((step) => step.status === 'failed').length;
  const runningSteps = steps.filter(
    (step) => step.status === 'running' || step.status === 'waiting',
  ).length;
  return {
    totalSteps,
    completedSteps,
    failedSteps,
    runningSteps,
    percent: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
  };
}
