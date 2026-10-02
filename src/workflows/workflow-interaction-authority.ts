/**
 * workflow-interaction-authority.ts
 *
 * Defines the narrow authorization boundary for human/workflow interaction
 * responses. Guardian or app policy adapters supply the decision callback;
 * this module fails closed and never performs persistence.
 */

import { OBS_CODES } from '../observability/codes';
import { WorkflowError, type WorkflowErrorCode } from './workflow-error';
import type { WorkflowJsonValue } from './workflow-json-value';
import {
  createWorkflowObservability,
  type WorkflowObservability,
} from './workflow-observability';

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

/**
 * A mutable policy can bind its allow decision to an app-owned revision and
 * re-check that revision synchronously while the response transaction owns
 * the SQLite writer lock. Async policies that allow a response must provide
 * this assertion; a synchronous policy can omit it and will be re-evaluated
 * synchronously at commit time.
 */
export interface WorkflowInteractionAuthorityLease {
  allowed: boolean;
  revision?: string;
  assertCurrent?: (
    expectedRevision: string | undefined,
    context: WorkflowInteractionAuthorityContext,
  ) => boolean | void;
}

export type WorkflowInteractionAuthorityDecision =
  | boolean
  | WorkflowInteractionAuthorityLease;

export type WorkflowInteractionAuthorityCommitAssertion = () => void;

export type WorkflowInteractionAuthorize = (
  context: WorkflowInteractionAuthorityContext,
) => WorkflowInteractionAuthorityDecision | Promise<WorkflowInteractionAuthorityDecision>;

/** Authenticated, callback-driven responder authorization. */
export class WorkflowInteractionAuthority {
  constructor(
    private readonly authorize: WorkflowInteractionAuthorize = () => false,
    private readonly observability: WorkflowObservability = createWorkflowObservability(),
  ) {}

  /**
   * Resolve one responder decision and capture its commit-time assertion.
   * The returned function is deliberately synchronous so persistence can
   * invoke it inside the final writer transaction without yielding.
   */
  async assertCanRespond(
    context: WorkflowInteractionAuthorityContext,
  ): Promise<WorkflowInteractionAuthorityCommitAssertion> {
    if (!context.actor || typeof context.actor.actorId !== 'string'
      || !context.actor.actorId.trim()) {
      throw forbidden(401);
    }

    throwIfAborted(context.signal);
    let decision: WorkflowInteractionAuthorityDecision;
    let evaluatedAsynchronously = false;
    try {
      const pending = this.authorize(context);
      evaluatedAsynchronously = isPromiseLike(pending);
      decision = await pending;
    } catch (error) {
      throwIfAborted(context.signal);
      this.observability.emitNow(OBS_CODES.WORKFLOW_INTERACTION_AUTHORITY_EVALUATION_FAILED, {
        error,
        metadata: {
          interactionId: context.interactionId,
          instanceId: context.instanceId,
          nodeId: context.nodeId,
        },
      });
      throw forbidden(403);
    }
    throwIfAborted(context.signal);
    const allowed = typeof decision === 'boolean' ? decision : decision?.allowed === true;
    if (!allowed) throw forbidden(403);

    if (typeof decision !== 'boolean' && decision.assertCurrent) {
      const revision = normalizeRevision(decision.revision);
      return () => {
        throwIfAborted(context.signal);
        let current: boolean | void;
        try {
          current = decision.assertCurrent!(revision, context);
        } catch (error) {
          reportEvaluationFailure(this.observability, context, error);
          throw forbidden(403);
        }
        if (isPromiseLike(current)) throw asynchronousCommitAssertion();
        if (current === false) throw forbidden(403);
        throwIfAborted(context.signal);
      };
    }

    if (evaluatedAsynchronously) {
      return () => { throw asynchronousCommitAssertion(); };
    }

    return () => {
      throwIfAborted(context.signal);
      let current: WorkflowInteractionAuthorityDecision
        | Promise<WorkflowInteractionAuthorityDecision>;
      try {
        current = this.authorize(context);
      } catch (error) {
        reportEvaluationFailure(this.observability, context, error);
        throw forbidden(403);
      }
      if (isPromiseLike(current)) throw asynchronousCommitAssertion();
      const stillAllowed = typeof current === 'boolean' ? current : current?.allowed === true;
      if (!stillAllowed) throw forbidden(403);
      throwIfAborted(context.signal);
    };
  }
}

function normalizeRevision(revision: string | undefined): string | undefined {
  if (revision === undefined) return undefined;
  const normalized = revision.trim();
  if (!normalized || normalized.length > 512) {
    throw new WorkflowError(
      'Workflow interaction authority revision is invalid',
      'WORKFLOW_CONFIG_INVALID',
      500,
    );
  }
  return normalized;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null
    && typeof (value as { then?: unknown }).then === 'function';
}

function asynchronousCommitAssertion(): WorkflowError {
  return new WorkflowError(
    'Async workflow interaction authority must provide a synchronous commit assertion',
    'WORKFLOW_CONFIG_INVALID',
    500,
  );
}

function reportEvaluationFailure(
  observability: WorkflowObservability,
  context: WorkflowInteractionAuthorityContext,
  error: unknown,
): void {
  observability.emitNow(OBS_CODES.WORKFLOW_INTERACTION_AUTHORITY_EVALUATION_FAILED, {
    error,
    metadata: {
      interactionId: context.interactionId,
      instanceId: context.instanceId,
      nodeId: context.nodeId,
    },
  });
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
