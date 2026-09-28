/**
 * Workflows subsystem public API.
 */

export {
  createWorkflowPlugin,
  getWorkflowRegistry,
  getWorkflowService,
  type WorkflowPluginConfig,
} from './workflow.plugin';
export { WorkflowRegistry } from './workflow-registry';
export { WorkflowService } from './workflow-service';
export { WorkflowExecutor } from './workflow-executor';
export { WorkflowAuthorityChangedError } from './workflow-executor';
export {
  WORKFLOW_MANAGE_PERMISSION,
  canManageWorkflowScope,
} from './workflow-access';
export {
  AuthWorkflowExecutionAuthorityProvider,
  type AuthWorkflowExecutionAuthorityProviderOptions,
} from './auth-workflow-execution-authority';
export {
  WorkflowExecutionAuthorityStore,
  createSystemAuthority,
  defineWorkflowExecutionAuthorityTables,
} from './workflow-execution-authority';
export type {
  WorkflowActorExecutionAuthority,
  WorkflowAuthorityFailureReason,
  WorkflowExecutionAuthorityKind,
  WorkflowExecutionAuthorityProvider,
  WorkflowExecutionIdentity,
  WorkflowExecutionServiceProvider,
  WorkflowPersistedExecutionAuthority,
  WorkflowResolvedExecutionAuthority,
  WorkflowSystemExecutionAuthority,
  WorkflowSystemExecutionOptions,
} from './workflow-execution-authority';
export type { WorkflowServiceOptions } from './workflow-service';
export type {
  WorkflowStatus,
  StepStatus,
  StepDefinition,
  WorkflowDefinition,
  StepContext,
  StepHandler,
  WorkflowDefinitionRecord,
  WorkflowInstanceRecord,
  WorkflowStepRecord,
  WorkflowEventRecord,
} from './types';
export { WORKFLOW_TABLES } from './types';
