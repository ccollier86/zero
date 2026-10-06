/**
 * resource-policy-evaluator.ts
 *
 * Owns fail-closed resource policy evaluation. This file normalizes policy
 * decisions and routes evaluator failures through Zero observability; it does
 * not define policy constructors, validate auth metadata, or touch storage.
 */

import { OBS_CODES } from '../observability/codes';
import {
  denyResourcePolicyDecision,
  normalizeResourcePolicyDecision,
} from './resource-policy-decisions';
import type {
  ResourceDataConstraint,
  ResourcePolicy,
  ResourcePolicyContext,
  ResourcePolicyDecision,
} from './resource-policy-types';
import { warnResourcePolicy } from './resource-observability';
import { ResourcePolicyOutputError } from './resource-policy-output-validation';
import { matchesResourceDataConstraints } from './resource-constraint-matcher';

/**
 * Admit one policy decision and enforce get/update/delete constraints on the
 * complete loaded preimage. List constraints remain query predicates; create
 * continues to use its explicit input/stamping policy. Errors fail closed.
 */
export async function evaluateResourcePolicy(
  policy: ResourcePolicy,
  context: ResourcePolicyContext
): Promise<ResourcePolicyDecision> {
  try {
    const decision = normalizeResourcePolicyDecision(await policy.evaluate(context));
    if (context.resource.columns && decision.constraints) {
      validateConstraintColumns(decision.constraints, new Set(context.resource.columns));
    }
    if (decision.allowed && decision.constraints?.length
      && (context.action === 'get' || context.action === 'update' || context.action === 'delete')
      && (!context.row || !matchesResourceDataConstraints(context.row, decision.constraints))) {
      return denyResourcePolicyDecision('forbidden', 403, 'Forbidden');
    }
    return decision;
  } catch (cause) {
    warnResourcePolicy(context.resource, OBS_CODES.RESOURCE_POLICY_EVALUATION_FAILED, {
      metadata: {
        kind: policy.kind,
        table: context.resource.table,
        action: context.action,
      },
    });
    return cause instanceof ResourcePolicyOutputError
      ? denyResourcePolicyDecision('policy-invalid', 500, cause.message)
      : denyResourcePolicyDecision('policy-error', 500, 'Resource policy evaluation failed');
  }
}

/** Check every admitted branch before composite policies can discard its predicates. */
function validateConstraintColumns(
  constraints: readonly ResourceDataConstraint[],
  columns: ReadonlySet<string>,
): void {
  for (const constraint of constraints) {
    if (constraint.type === 'field') {
      if (!columns.has(constraint.field)) {
        throw new ResourcePolicyOutputError('Resource policy constraint references an unknown table column.');
      }
    } else {
      validateConstraintColumns(constraint.constraints, columns);
    }
  }
}
