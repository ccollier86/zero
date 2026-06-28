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
