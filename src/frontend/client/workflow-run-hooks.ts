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
import { useWorkflow, useWorkflowActions, type UseWorkflowResult } from './workflow-hooks';

export interface WorkflowProgress {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  runningSteps: number;
  percent: number;
}

export interface UseWorkflowRunOptions {
  instanceId?: string | null;
}

export interface UseWorkflowRunResult extends UseWorkflowResult {
  instanceId: string | null;
  progress: WorkflowProgress;
  start: (input?: unknown) => Promise<string>;
  cancel: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  sendEvent: (eventName: string, payload?: unknown) => Promise<void>;
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
  const instanceId = visible ? options.instanceId ?? localInstanceId : null;
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
    (input?: unknown) => actions.start(name, input),
    {
      metadata: { workflow: name, action: 'start' },
      onSuccess: setLocalInstanceId,
    },
  );

  const actionMutation = useMutation(
    async (action: 'cancel' | 'pause' | 'resume' | 'event', eventName?: string, payload?: unknown) => {
      const targetInstanceId = requireInstanceId(instanceId);
      switch (action) {
        case 'cancel':
          return actions.cancel(targetInstanceId);
        case 'pause':
          return actions.pause(targetInstanceId);
        case 'resume':
          return actions.resume(targetInstanceId);
        case 'event':
          return actions.sendEvent(targetInstanceId, eventName ?? '', payload);
      }
    },
    { metadata: { workflow: name } },
  );

  const progress = useMemo((): WorkflowProgress => {
    const totalSteps = workflow.steps.length;
    const completedSteps = workflow.steps.filter((step) => step.status === 'completed' || step.status === 'skipped').length;
    const failedSteps = workflow.steps.filter((step) => step.status === 'failed').length;
    const runningSteps = workflow.steps.filter((step) => step.status === 'running' || step.status === 'waiting').length;
    return {
      totalSteps,
      completedSteps,
      failedSteps,
      runningSteps,
      percent: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
    };
  }, [workflow.steps]);

  const cancel = useCallback(() => actionMutation.run('cancel'), [actionMutation.run]);
  const pause = useCallback(() => actionMutation.run('pause'), [actionMutation.run]);
  const resume = useCallback(() => actionMutation.run('resume'), [actionMutation.run]);
  const sendEvent = useCallback(
    (eventName: string, payload?: unknown) => actionMutation.run('event', eventName, payload),
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
    starting: startMutation.pending,
    actionPending: actionMutation.pending,
    actionError: startMutation.error ?? actionMutation.error,
    setInstanceId,
  };
}
