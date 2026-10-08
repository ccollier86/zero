/** Optional Torrent progress presentation. Capabilities are supplied by the owning domain. */
import type { WorkflowStatus } from '../workflows/types';
import type { WorkflowProgress } from '../frontend/client/workflow-run-hooks';
import type { WorkflowObservationStatus } from '../frontend/client/workflow-observation-hooks';

/** UI capability hints are not a replacement for server authorization. */
export interface ModalWorkflowCapabilities {
  readonly cancel?: boolean;
  readonly pause?: boolean;
  readonly resume?: boolean;
}

/** An already admitted durable run; mounting/reopening does not start one. */
export interface ModalWorkflowProgressProps {
  readonly runId: string;
  readonly workflowName: string;
  readonly capabilities?: ModalWorkflowCapabilities;
  readonly className?: string;
}

/** Honest view state; completion is durable status, not a rounded percentage. */
export interface ModalWorkflowProgressModel {
  readonly observation: WorkflowObservationStatus;
  readonly status: WorkflowStatus | null;
  readonly label: string;
  readonly terminal: boolean;
  readonly determinate: boolean;
  readonly percent: number | null;
  readonly progress: WorkflowProgress;
  readonly canCancel: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
}
