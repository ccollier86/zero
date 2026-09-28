/**
 * resource-policy-validation.ts
 *
 * Owns resource policy validation against trusted auth user-property config.
 * This file performs static checks only; it does not evaluate access, stamp
 * input, mount routes, or inspect database schemas.
 */

import { isPolicyTrustedUserProperty } from '../auth/auth-config';
import { AuthorizationKernel } from '../auth/authorization-kernel';
import type { CompiledAccessRequirement } from '../auth/authorization-kernel';
import type {
  ResourcePolicyAuthConfig,
  ResourceAuthorizationRequirement,
  ResourceMetadataRequirements,
  ResourcePolicy,
  ResourcePolicyValidationContext,
  ResourcePolicyValidationIssue,
} from './resource-policy-types';

/** Validate one policy tree against trusted auth metadata configuration. */
export function validateResourcePolicy(
  policy: ResourcePolicy,
  context: ResourcePolicyValidationContext
): ResourcePolicyValidationIssue[] {
  return policy.validate?.(context) ?? [];
}

/** Validate metadata policy requirements against configured trusted auth keys. */
export function validateMetadataPolicy(
  requirements: ResourceMetadataRequirements,
  authConfig: ResourcePolicyAuthConfig
): ResourcePolicyValidationIssue[] {
  const issues: ResourcePolicyValidationIssue[] = [];

  for (const key of Object.keys(requirements)) {
    const field = authConfig.userProperties[key];
    if (!field) {
      issues.push({
        code: 'metadata-property-unknown',
        message: `metadataPolicy references unknown auth.userProperties key "${key}".`,
        path: `metadata.${key}`,
        severity: 'error',
        metadata: { key },
      });
      continue;
    }

    if (!isPolicyTrustedUserProperty(field)) {
      issues.push({
        code: 'metadata-property-untrusted',
        message: `metadataPolicy references auth.userProperties key "${key}" without useInPolicies: true.`,
        path: `metadata.${key}`,
        severity: 'error',
        metadata: {
          key,
          editableBy: field.editableBy,
          useInPolicies: field.useInPolicies,
        },
      });
    }
  }

  return issues;
}

/** Validate a resource RBAC declaration against the app's exact auth ceiling. */
export function validateAuthorizationPolicy(
  requirement: ResourceAuthorizationRequirement | CompiledAccessRequirement,
  authConfig: ResourcePolicyAuthConfig,
): ResourcePolicyValidationIssue[] {
  if (!authConfig.tenancy || !authConfig.authorization) {
    return [{
      code: 'authorization-config-unavailable',
      message: 'authorizationPolicy requires Zero tenancy and authorization configuration.',
      path: 'authorization',
      severity: 'error',
    }];
  }

  try {
    const kernel = new AuthorizationKernel({
      tenancy: authConfig.tenancy,
      authorization: authConfig.authorization,
      userProperties: authConfig.userProperties,
    });
    kernel.evaluate(requirement, null);
    return [];
  } catch (error) {
    return [{
      code: 'authorization-requirement-invalid',
      message: error instanceof Error
        ? error.message
        : 'authorizationPolicy contains an invalid access requirement.',
      path: 'authorization',
      severity: 'error',
    }];
  }
}

/** Validate and path-prefix child policy issues for composite policy helpers. */
export function validateCompositePolicy(
  label: 'anyOf' | 'allOf',
  policies: ResourcePolicy[],
  context: ResourcePolicyValidationContext
): ResourcePolicyValidationIssue[] {
  if (policies.length === 0) {
    return [{
      code: 'composite-policy-empty',
      message: `${label} requires at least one child policy.`,
      path: label,
      severity: 'error',
    }];
  }

  return policies.flatMap((policy, index) =>
    validateResourcePolicy(policy, context).map((issue) => ({
      ...issue,
      path: issue.path ? `${label}[${index}].${issue.path}` : `${label}[${index}]`,
    }))
  );
}
