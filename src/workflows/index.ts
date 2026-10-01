/**
 * Workflows subsystem public API.
 */

export {
  createWorkflowPlugin,
  getWorkflowRegistry,
  getWorkflowService,
  stopWorkflowRuntime,
  type WorkflowPluginConfig,
} from './workflow.plugin';
export { WorkflowRegistry } from './workflow-registry';
export {
  canAccessWorkflowDefinition,
  type WorkflowAccessPrincipal,
  type WorkflowDefinitionCapability,
} from './workflow-access';
export { WorkflowService, type WorkflowServiceOptions } from './workflow-service';
export { DEFAULT_WORKFLOW_SHUTDOWN_GRACE_MS } from './workflow-shutdown-policy';
export { WorkflowExecutor } from './workflow-executor';
export type { WorkflowWakeTimer } from './workflow-wake-coordinator';
export { WorkflowError, workflowNotFound, type WorkflowErrorCode } from './workflow-error';
export { defineWorkflowTables } from './workflow-schema';
export {
  createWorkflowSyncPolicyAdapter,
  type WorkflowSyncPolicyOptions,
} from './workflow-sync-policy';
export type {
  WorkflowStatus,
  StepStatus,
  StepDefinition,
  WorkflowAccessRule,
  WorkflowDefinitionAccessPolicy,
  WorkflowDefinition,
  StepContext,
  StepHandler,
  WorkflowDefinitionRecord,
  WorkflowInstanceRecord,
  WorkflowClientInstanceRecord,
  WorkflowStepRecord,
  WorkflowClientStepRecord,
  WorkflowEventRecord,
} from './types';
export {
  MAX_WORKFLOW_ATTEMPTS,
  WORKFLOW_SERVER_TABLE_NAMES,
  WORKFLOW_TABLES,
} from './types';
