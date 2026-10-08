/** Derives honest progress presentation from existing Torrent records, never execution state. */
import type { WorkflowProgress } from '../frontend/client/workflow-run-hooks';
import type { UseWorkflowObservationResult } from '../frontend/client/workflow-observation-hooks';
import type { ModalWorkflowCapabilities, ModalWorkflowProgressModel } from './modal-workflow-progress.types';

/** Keeps root, fanout and delivery denominators separate; failures win over percentage. */
export function deriveModalWorkflowProgress(
  observation: Pick<UseWorkflowObservationResult, 'status' | 'instance'>,
  progress: WorkflowProgress,
  activity: { waitingForInput?: boolean; retrying?: boolean },
  capabilities: ModalWorkflowCapabilities = {},
): ModalWorkflowProgressModel {
  const status = observation.instance?.status ?? null;
  const terminal = status === 'completed' || status === 'failed' || status === 'cancelled';
  const ready = observation.status === 'ready' && status !== null;
  const labels = { idle: 'No run selected', loading: 'Loading workflow status', unavailable: 'Workflow unavailable',
    reconnecting: 'Reconnecting to live workflow updates', offline: 'Offline — status may be out of date',
    error: 'Unable to load workflow status', retired: 'Workflow view retired' };
  const label = observation.status !== 'ready' ? labels[observation.status]
    : status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'cancelled' ? 'Cancelled'
      : status === 'paused' ? 'Paused' : activity.waitingForInput ? 'Waiting for input'
        : activity.retrying ? 'Retrying' : status === 'pending' ? 'Pending' : 'Running';
  const determinate = ready && progress.rootNodes.totalSteps > 0;
  return { observation: observation.status, status, label, terminal, determinate,
    percent: determinate ? Math.max(0, Math.min(100, progress.rootNodes.percent)) : null, progress,
    canCancel: ready && !terminal && capabilities.cancel === true,
    canPause: ready && status === 'running' && capabilities.pause === true,
    canResume: ready && status === 'paused' && capabilities.resume === true,
  };
}
