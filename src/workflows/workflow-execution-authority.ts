/**
 * Public compatibility surface for durable workflow execution authority.
 *
 * Focused modules own contracts, schema, codecs, factories, and persistence;
 * existing callers retain this stable import path.
 */

export {
  createActorIdentity,
  createSystemAuthority,
  sameExecutionIdentity,
  scopeFromIdentity,
} from './workflow-execution-authority-factory';
export { defineWorkflowExecutionAuthorityTables } from './workflow-execution-authority-schema';
export { WorkflowExecutionAuthorityStore } from './workflow-execution-authority-store';
export type {
  WorkflowActorExecutionAuthority,
  WorkflowAuthorityFailureReason,
  WorkflowAuthorityReadResult,
  WorkflowAuthoritySeal,
  WorkflowExecutionAuthorityKind,
  WorkflowExecutionAuthorityProvider,
  WorkflowExecutionIdentity,
  WorkflowExecutionServiceProvider,
  WorkflowPersistedExecutionAuthority,
  WorkflowResolvedExecutionAuthority,
  WorkflowSystemExecutionAuthority,
  WorkflowSystemExecutionOptions,
} from './workflow-execution-authority-types';
