/** Workflow observation hooks and client-safe definitions. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Workflows: React Hooks ────────────────────────────────────────────
export {
  useWorkflow,
  useWorkflowList,
  useWorkflowActions,
} from '../../client/workflow-hooks';
export type {
  UseWorkflowResult,
  UseWorkflowListResult,
  WorkflowActions,
  WorkflowInteractionSubmissionResult,
} from '../../client/workflow-hooks';
export { useWorkflowRun } from '../../client/hooks';
export { useWorkflowObservation } from '../../client/hooks';
export type { UseWorkflowObservationResult, WorkflowObservationStatus } from '../../client/hooks';
export type {
  UseWorkflowRunOptions,
  UseWorkflowRunResult,
  WorkflowProgress,
  WorkflowProgressCounts,
} from '../../client/hooks';
export { useWorkflowTopology } from '../../client/hooks';
export type { UseWorkflowTopologyResult } from '../../client/hooks';

// ─── Workflows: Types (no bun:sqlite — types.ts is clean) ──────────────
export type {
  WorkflowStatus,
  StepStatus,
  StepDefinition,
  WorkflowAccessRule,
  WorkflowDefinitionAccessPolicy,
  WorkflowDefinition,
  StepContext,
  StepHandler,
} from '../../../workflows/types';
export type {
  WorkflowPublicTopology,
  WorkflowPublicTopologyEdge,
  WorkflowPublicTopologyNode,
} from '../../../workflows/workflow-public-topology';
