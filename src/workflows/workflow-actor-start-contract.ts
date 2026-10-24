/** Public actor-start command identity and original durable acknowledgement; no SYSTEM fallback. */
import type { WorkflowActorExecutionAuthority } from './workflow-execution-authority';
import type { WorkflowStartOptions } from './workflow-start-options';
import type { WorkflowJsonValue } from './workflow-json-value';
import type { WorkflowSystemStartResult } from './workflow-system-start-contract';
import { workflowSystemStartHash } from './workflow-system-start-contract';

/** A permanent key plus the exact app-admitted caller/dependency manifest, included in replay identity. */
export interface WorkflowActorStartOptions extends WorkflowStartOptions {
  idempotencyKey: string;
  binding?: WorkflowJsonValue;
}
export type WorkflowActorStartResult = WorkflowSystemStartResult;

/** Stable user/credential namespace, independent of mutable grants and session renewal. */
export function workflowActorStartPrincipal(authority: WorkflowActorExecutionAuthority): string {
  return workflowSystemStartHash([authority.identity.userId, authority.identity.credentialKind ?? 'session',
    authority.identity.credentialId ?? null, authority.identity.sessionKind, authority.identity.clientId]);
}
