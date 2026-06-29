/**
 * resource-policy-inspection.ts
 *
 * Owns static inspection helpers for resource policies. This file reads
 * policy metadata attached by Zero policy helpers; it does not evaluate
 * policies, call app callbacks, query persistence, or make authorization
 * decisions.
 */

import type { ResourceAction, ResourcePolicy } from './resource-policy-types';

export type ResourcePolicyStaticDecision = 'yes' | 'no' | 'unknown';

/** Return owner fields referenced anywhere in a policy tree. */
export function getPolicyOwnerFields(policy: ResourcePolicy): string[] {
  const fields = new Set<string>();
  visitPolicy(policy, (current) => {
    const field = current.diagnostics?.ownerField?.trim();
    if (field) fields.add(field);
  });
  return [...fields];
}

/** Return trusted metadata keys referenced anywhere in a policy tree. */
export function getPolicyMetadataKeys(policy: ResourcePolicy): string[] {
  const keys = new Set<string>();
  visitPolicy(policy, (current) => {
    for (const key of current.diagnostics?.metadataKeys ?? []) {
      keys.add(key);
    }
  });
  return [...keys];
}

/** Return true when a policy tree includes a custom callback branch. */
export function hasCustomPolicyBranch(policy: ResourcePolicy): boolean {
  let found = false;
  visitPolicy(policy, (current) => {
    if (current.kind === 'custom') found = true;
  });
  return found;
}

/**
 * Decide whether a policy can statically allow anonymous access for an action.
 *
 * `unknown` means a custom branch participates in the decision, so doctor
 * cannot prove the public access shape without executing app code.
 */
export function allowsPublicAction(
  policy: ResourcePolicy,
  action: ResourceAction
): ResourcePolicyStaticDecision {
  if (policy.kind === 'custom') return 'unknown';

  const children = policy.diagnostics?.children ?? [];
  if (policy.kind === 'any-of') {
    let unknown = false;
    for (const child of children) {
      const decision = allowsPublicAction(child, action);
      if (decision === 'yes') return 'yes';
      if (decision === 'unknown') unknown = true;
    }
    return unknown ? 'unknown' : 'no';
  }

  if (policy.kind === 'all-of') {
    let unknown = false;
    for (const child of children) {
      const decision = allowsPublicAction(child, action);
      if (decision === 'no') return 'no';
      if (decision === 'unknown') unknown = true;
    }
    return unknown ? 'unknown' : 'yes';
  }

  return actionListHas(policy.diagnostics?.publicActions, action) ? 'yes' : 'no';
}

/**
 * Decide whether a policy requires an authenticated user for an action.
 *
 * This is a static doctor helper, not an authorization decision. Custom
 * policies return `unknown` because their callback decides at runtime.
 */
export function requiresAuthenticatedUser(
  policy: ResourcePolicy,
  action: ResourceAction
): ResourcePolicyStaticDecision {
  if (policy.kind === 'custom') return 'unknown';

  const children = policy.diagnostics?.children ?? [];
  if (policy.kind === 'any-of') {
    let unknown = false;
    for (const child of children) {
      const decision = requiresAuthenticatedUser(child, action);
      if (decision === 'no') return 'no';
      if (decision === 'unknown') unknown = true;
    }
    return unknown ? 'unknown' : 'yes';
  }

  if (policy.kind === 'all-of') {
    let unknown = false;
    for (const child of children) {
      const decision = requiresAuthenticatedUser(child, action);
      if (decision === 'yes') return 'yes';
      if (decision === 'unknown') unknown = true;
    }
    return unknown ? 'unknown' : 'no';
  }

  return actionListHas(policy.diagnostics?.authenticatedActions, action) ? 'yes' : 'no';
}

function visitPolicy(policy: ResourcePolicy, visitor: (policy: ResourcePolicy) => void): void {
  visitor(policy);
  for (const child of policy.diagnostics?.children ?? []) {
    visitPolicy(child, visitor);
  }
}

function actionListHas(actions: readonly ResourceAction[] | undefined, action: ResourceAction): boolean {
  return actions?.includes(action) ?? false;
}
