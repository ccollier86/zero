/**
 * resource-policy-decisions.ts
 *
 * Owns normalized resource policy decision helpers and constraint/stamp
 * combination rules. This file does not know auth config, policy constructors,
 * Elysia, or persistence.
 */

import type {
  ResourceDataConstraint,
  ResourceFieldConstraint,
  ResourcePolicyDecision,
  ResourcePolicyDecisionInput,
  ResourcePolicyDenyReason,
  ResourcePolicyScalar,
} from './resource-policy-types';

/** Create an allowed policy decision with optional constraints or stamped input. */
export function allowResourcePolicyDecision(
  overrides: Partial<ResourcePolicyDecision> = {}
): ResourcePolicyDecision {
  return {
    allowed: true,
    ...overrides,
  };
}

/** Create a denied policy decision with stable reason/status metadata. */
export function denyResourcePolicyDecision(
  reason: ResourcePolicyDenyReason,
  status: number,
  message: string,
  metadata?: Record<string, unknown>
): ResourcePolicyDecision {
  return {
    allowed: false,
    reason,
    status,
    message,
    metadata,
  };
}

/** Normalize boolean/custom callback output into a structured policy decision. */
export function normalizeResourcePolicyDecision(
  input: ResourcePolicyDecisionInput
): ResourcePolicyDecision {
  if (input === true) return allowResourcePolicyDecision();
  if (input === false) return denyResourcePolicyDecision('forbidden', 403, 'Forbidden');

  if (input.allowed) return allowResourcePolicyDecision(input);

  return {
    ...input,
    allowed: false,
    status: input.status ?? 403,
    message: input.message ?? 'Forbidden',
    reason: input.reason ?? 'forbidden',
  };
}

/** Build a field equality constraint for query translators. */
export function fieldEqualsConstraint(
  field: string,
  value: ResourcePolicyScalar
): ResourceFieldConstraint {
  return {
    type: 'field',
    field,
    operator: 'eq',
    value,
  };
}

/** Combine constraints from OR branches, preserving unconstrained allow-all branches. */
export function combineAnyOfConstraints(
  decisions: ResourcePolicyDecision[]
): ResourceDataConstraint[] | undefined {
  const constrained = decisions
    .map((decision) => decision.constraints ?? [])
    .filter((constraints) => constraints.length > 0);

  if (constrained.length === 0) return undefined;
  if (constrained.length !== decisions.length) return undefined;
  if (constrained.length === 1) return constrained[0];

  return [{
    type: 'anyOf',
    constraints: constrained.map((constraints) =>
      constraints.length === 1
        ? constraints[0]
        : { type: 'allOf', constraints }
    ),
  }];
}

/** Combine stamped input from OR branches only when every allowed branch stamps. */
export function combineAnyOfStampedInput(
  decisions: ResourcePolicyDecision[]
): Record<string, unknown> | undefined {
  const stamped = decisions
    .map((decision) => decision.stampedInput)
    .filter((input): input is Record<string, unknown> => Boolean(input));

  if (stamped.length === 0) return undefined;
  if (stamped.length !== decisions.length) return undefined;

  let merged: Record<string, unknown> | undefined;
  for (const input of stamped) {
    const nextMerged = mergeStampedInput(merged, input);
    if (!nextMerged) return undefined;
    merged = nextMerged;
  }

  return merged;
}

/** Merge stamped input for AND branches, returning null on conflicting values. */
export function mergeStampedInput(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>
): Record<string, unknown> | null {
  const merged = { ...(existing ?? {}) };

  for (const [key, value] of Object.entries(next)) {
    if (Object.hasOwn(merged, key) && merged[key] !== value) return null;
    merged[key] = value;
  }

  return merged;
}
