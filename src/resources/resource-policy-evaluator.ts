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
  ResourcePolicy,
  ResourcePolicyContext,
  ResourcePolicyDecision,
} from './resource-policy-types';
import { warnResourcePolicy } from './resource-observability';

/** Evaluate one policy and normalize thrown errors to fail-closed decisions. */
export async function evaluateResourcePolicy(
  policy: ResourcePolicy,
  context: ResourcePolicyContext
): Promise<ResourcePolicyDecision> {
  try {
    return normalizeResourcePolicyDecision(await policy.evaluate(context));
  } catch {
    warnResourcePolicy(context.resource, OBS_CODES.RESOURCE_POLICY_EVALUATION_FAILED, {
      metadata: {
        kind: policy.kind,
        table: context.resource.table,
        action: context.action,
      },
    });
    return denyResourcePolicyDecision('policy-error', 500, 'Resource policy evaluation failed');
  }
}
