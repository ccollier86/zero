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
export { WorkflowRegistry, type RegisterWorkflowOptions } from './workflow-registry';
export {
  WorkflowActivityCatalog,
  type WorkflowActivityCapability,
  type WorkflowActivityDefinition,
  type RegisteredWorkflowActivity,
} from './workflow-activity-catalog';
export {
  compileFlow,
  compileWorkflowDefinition,
  canonicalizeWorkflowGraphIR,
  fingerprintWorkflowDefinitionContent,
  stableWorkflowStringify,
  type CompiledWorkflowDefinition,
  type CompileWorkflowDefinitionOptions,
  type WorkflowDefinitionAuthoringSource,
  type WorkflowDefinitionFormat,
  type WorkflowDefinitionInput,
  type WorkflowFlowDefinition,
  type WorkflowGraphDefinition,
} from './workflow-compiler';
export {
  choose,
  each,
  flow,
  otherwise,
  parallel,
  requestAndWait,
  step,
  waitFor,
  when,
  type WorkflowChooseDsl,
  type WorkflowChooseOptions,
  type WorkflowDslNode,
  type WorkflowEachDsl,
  type WorkflowEachOptions,
  type WorkflowFlow,
  type WorkflowOtherwiseDsl,
  type WorkflowParallelDsl,
  type WorkflowRequestAndWaitDsl,
  type WorkflowRequestAndWaitOptions,
  type WorkflowStepDsl,
  type WorkflowStepOptions,
  type WorkflowWaitDsl,
  type WorkflowWaitOptions,
  type WorkflowWhenDsl,
} from './workflow-dsl';
export {
  evaluateWorkflowExpression,
  expr,
  isWorkflowExpression,
  validateWorkflowExpression,
  type WorkflowComparisonExpression,
  type WorkflowComparisonOperator,
  type WorkflowExistsExpression,
  type WorkflowExpression,
  type WorkflowExpressionContext,
  type WorkflowExpressionInput,
  type WorkflowIncludesExpression,
  type WorkflowLiteralExpression,
  type WorkflowLogicalExpression,
  type WorkflowNotExpression,
  type WorkflowReferenceExpression,
  type WorkflowReferenceScope,
} from './workflow-expression';
export {
  WORKFLOW_COMPILER_ID_PREFIX,
  WORKFLOW_GRAPH_LIMITS,
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowActivityInvocation,
  type WorkflowActivityNode,
  type WorkflowActivityReference,
  type WorkflowChoiceNode,
  type WorkflowEachErrorPolicy,
  type WorkflowEachInvalidItemPolicy,
  type WorkflowEachNode,
  type WorkflowGraphIR,
  type WorkflowInteractionDefinition,
  type WorkflowIREdge,
  type WorkflowIRNode,
  type WorkflowJoinNode,
  type WorkflowJsonValue,
  type WorkflowParallelNode,
  type WorkflowWaitNode,
} from './workflow-ir';
export {
  assertWorkflowJsonValue,
  validateWorkflowGraphIR,
  type WorkflowGraphValidationOptions,
} from './workflow-ir-validator';
export {
  normalizeWorkflowSchemaSnapshot,
  rehydrateWorkflowSchema,
  validateWorkflowSchemaValue,
} from './workflow-schema-snapshot';
export {
  canAccessWorkflowDefinition,
  type WorkflowAccessPrincipal,
  type WorkflowDefinitionCapability,
} from './workflow-access';
export { WorkflowService, type WorkflowServiceOptions } from './workflow-service';
export type { WorkflowStartOptions } from './workflow-start-options';
export {
  WorkflowInteractionAuthority,
  type WorkflowInteractionActor,
  type WorkflowInteractionAuthorityContext,
  type WorkflowInteractionAuthorityDecision,
  type WorkflowInteractionAuthorize,
} from './workflow-interaction-authority';
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
  WorkflowClientInteractionRecord,
  WorkflowEventRecord,
} from './types';
export type { WorkflowMemoryContext } from './workflow-memory-context';
export type {
  WorkflowInteractionRecord,
  WorkflowInteractionStatus,
} from './workflow-interaction-records';
export {
  MAX_WORKFLOW_ATTEMPTS,
  WORKFLOW_SERVER_TABLE_NAMES,
  WORKFLOW_TABLES,
} from './types';
