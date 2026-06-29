/**
 * resource-policy-evaluator.ts
 *
 * Owns fail-closed resource policy evaluation. This file normalizes policy
 * decisions and routes evaluator failures through Zero observability; it does
 * not define policy constructors, validate auth metadata, or touch storage.
 */

import { OBS_CODES } from '../observability/codes';
import { warnPlatform } from '../observability/sink';
import {
  denyResourcePolicyDecision,
  normalizeResourcePolicyDecision,
} from './resource-policy-decisions';
import type {
  ResourcePolicy,
  ResourcePolicyContext,
  ResourcePolicyDecision,
} from './resource-policy-types';

/** Evaluate one policy and normalize thrown errors to fail-closed decisions. */
export async function evaluateResourcePolicy(
  policy: ResourcePolicy,
  context: ResourcePolicyContext
): Promise<ResourcePolicyDecision> {
  try {
    return normalizeResourcePolicyDecision(await policy.evaluate(context));
  } catch (error) {
    warnPlatform(OBS_CODES.RESOURCE_POLICY_EVALUATION_FAILED, {
      error,
      metadata: {
        kind: policy.kind,
        table: context.resource.table,
        action: context.action,
      },
      userId: context.user?.userId,
    });
    return denyResourcePolicyDecision('policy-error', 500, 'Resource policy evaluation failed');
  }
}
