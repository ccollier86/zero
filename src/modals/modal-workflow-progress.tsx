'use client';

/**
 * Optional progress body composed from Zero's workflow hooks and UI primitives.
 * Closing/unmounting stops observation, not the durable run. No starts, polling,
 * inferred cancellation or automatic mutation retries are performed here.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Progress } from '../components/ui/progress';
import { useWorkflowRun } from '../frontend/client/workflow-run-hooks';
import { useWorkflowObservation } from '../frontend/client/workflow-observation-hooks';
import { AuthorizationScopeBoundaryFence, useAuthorizationScopeBoundary } from '../frontend/client/authorization-scope-hooks';
import { emitFrontendCode } from '../frontend/client/observability';
import { OBS_CODES } from '../observability/codes';
import { cn } from '../lib/utils';
import { deriveModalWorkflowProgress } from './modal-workflow-progress-model';
import type { ModalWorkflowProgressProps } from './modal-workflow-progress.types';

/** Observe an already admitted run; the app retains its scoped ID for reopening. */
export function ModalWorkflowProgress({ runId, workflowName, capabilities, className }: ModalWorkflowProgressProps) {
  const run = useWorkflowRun(workflowName, { instanceId: runId });
  const observation = useWorkflowObservation(run.instanceId, run.instance);
  const boundary = useAuthorizationScopeBoundary();
  const ownerFence = useRef(new AuthorizationScopeBoundaryFence()).current;
  const owner = ownerFence.update(JSON.stringify([boundary.key, boundary.ready, workflowName, runId]));
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [action, setAction] = useState<{ owner: number; pending: string | null; error: boolean }>({ owner, pending: null, error: false });
  const pendingRef = useRef<{ owner: number } | null>(null);
  const model = deriveModalWorkflowProgress(observation, run.progress,
    { waitingForInput: run.isWaitingForInput, retrying: run.isRetrying }, capabilities);
  const visible = action.owner === owner ? action : { owner, pending: null, error: false };

  async function dispatch(kind: 'cancel' | 'pause' | 'resume') {
    if (!mounted.current || !boundary.ready || !ownerFence.isCurrent(owner) || pendingRef.current?.owner === owner || visible.pending
      || (kind === 'cancel' ? !model.canCancel : kind === 'pause' ? !model.canPause : !model.canResume)) return;
    // Capture both the monotonic selection and this exact admission. An older
    // A receipt must not clear a newly admitted A action after visiting B.
    const admission = { owner };
    pendingRef.current = admission;
    setAction({ owner, pending: kind, error: false });
    try {
      await run[kind]();
      if (mounted.current && ownerFence.isCurrent(owner) && pendingRef.current === admission) setAction({ owner, pending: null, error: false });
    } catch {
      if (mounted.current && ownerFence.isCurrent(owner) && pendingRef.current === admission) {
        setAction({ owner, pending: null, error: true });
        emitFrontendCode(OBS_CODES.FRONTEND_WORKFLOW_PROGRESS_ACTION_FAILED, { metadata: { action: kind } });
      }
    } finally { if (pendingRef.current === admission) pendingRef.current = null; }
  }

  return (
    <section className={cn('grid gap-4 text-sm', className)} aria-label="Workflow progress" data-slot="modal-workflow-progress">
      <p className={cn('font-medium', model.status === 'failed' && 'text-destructive')} role="status" aria-live="polite">{model.label}</p>
      <Progress value={model.percent} className={model.determinate ? undefined : 'animate-pulse'} aria-label="Workflow root steps" />
      {model.determinate && <p className="text-muted-foreground tabular-nums">{run.progress.rootNodes.completedSteps} of {run.progress.rootNodes.totalSteps} root steps complete</p>}
      {model.observation === 'ready' && run.progress.fanoutItems.totalSteps > 0 && <p className="text-muted-foreground tabular-nums">Parallel items: {run.progress.fanoutItems.completedSteps} of {run.progress.fanoutItems.totalSteps}</p>}
      {model.observation === 'ready' && run.progress.deliverySteps.totalSteps > 0 && <p className="text-muted-foreground tabular-nums">Interaction deliveries: {run.progress.deliverySteps.completedSteps} of {run.progress.deliverySteps.totalSteps}</p>}
      {visible.error && <p role="alert" className="text-destructive">The action could not be confirmed. Refresh status before deciding whether to try again.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {(observation.status === 'error' || observation.status === 'unavailable' || visible.error) && <Button variant="outline" onClick={observation.reload}>Refresh status</Button>}
        {model.canPause && <Button variant="outline" disabled={visible.pending !== null} onClick={() => { void dispatch('pause'); }}>Pause</Button>}
        {model.canResume && <Button variant="outline" disabled={visible.pending !== null} onClick={() => { void dispatch('resume'); }}>Resume</Button>}
        {model.canCancel && <Button variant="destructive" disabled={visible.pending !== null} onClick={() => { void dispatch('cancel'); }}>Cancel run</Button>}
      </div>
      {!model.terminal && <p className="text-xs text-muted-foreground">You can close this view and reopen it later. Closing does not cancel the run. Cancellation does not undo effects already performed.</p>}
    </section>
  );
}
