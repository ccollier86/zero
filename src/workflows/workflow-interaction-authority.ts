/**
 * workflow-interaction-authority.ts
 *
 * Defines the narrow authorization boundary for human/workflow interaction
 * responses. Guardian or app policy adapters supply the decision callback;
 * this module fails closed and never performs persistence.
 */

import { WorkflowError, type WorkflowErrorCode } from './workflow-error';
import type { WorkflowJsonValue } from './workflow-json-value';

const INTERACTION_FORBIDDEN = 'WORKFLOW_INTERACTION_FORBIDDEN' as WorkflowErrorCode;

/** Minimal authenticated actor passed to an app-owned responder policy. */
export interface WorkflowInteractionActor {
  actorId: string;
  tenantId?: string | null;
  roles?: readonly string[];
  claims?: Readonly<Record<string, unknown>>;
}

export interface WorkflowInteractionAuthorityContext {
  interactionId: string;
  instanceId: string;
  nodeId: string;
  actor: WorkflowInteractionActor;
  responderPolicy: WorkflowJsonValue;
  /** Aborted when the owning workflow pauses, stops, or shuts down. */
  signal?: AbortSignal;
}

export type WorkflowInteractionAuthorityDecision =
  | boolean
  | { allowed: boolean };

export type WorkflowInteractionAuthorize = (
  context: WorkflowInteractionAuthorityContext,
) => WorkflowInteractionAuthorityDecision | Promise<WorkflowInteractionAuthorityDecision>;

/** Authenticated, callback-driven responder authorization. */
export class WorkflowInteractionAuthority {
  constructor(
    private readonly authorize: WorkflowInteractionAuthorize = () => false,
  ) {}

  /** Resolve one responder decision and throw a privacy-safe denial. */
  async assertCanRespond(context: WorkflowInteractionAuthorityContext): Promise<void> {
    if (!context.actor || typeof context.actor.actorId !== 'string'
      || !context.actor.actorId.trim()) {
      throw forbidden(401);
    }

    throwIfAborted(context.signal);
    let decision: WorkflowInteractionAuthorityDecision;
    try {
      decision = await this.authorize(context);
    } catch {
      throwIfAborted(context.signal);
      throw forbidden(403);
    }
    throwIfAborted(context.signal);
    const allowed = typeof decision === 'boolean' ? decision : decision?.allowed === true;
    if (!allowed) throw forbidden(403);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof WorkflowError) throw signal.reason;
  throw new WorkflowError(
    'Workflow interaction authorization was interrupted',
    'WORKFLOW_DRAINING',
    409,
    true,
  );
}

function forbidden(status: 401 | 403): WorkflowError {
  return new WorkflowError(
    status === 401
      ? 'Authentication is required to answer this workflow interaction'
      : 'Workflow interaction response is not permitted',
    INTERACTION_FORBIDDEN,
    status,
  );
}
