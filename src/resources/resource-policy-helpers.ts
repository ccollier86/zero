/**
 * resource-policy-helpers.ts
 *
 * Owns public resource policy helper constructors such as ownerPolicy,
 * metadataPolicy, and anyOf/allOf. Helpers compose the validation, decision,
 * and evaluator modules; they do not mount routes or query persistence.
 */

import { OBS_CODES } from '../observability/codes';
import {
  compileAccessRequirement,
  type AccessRequirement,
} from '../auth/authorization-kernel';
import {
  allowResourcePolicyDecision,
  combineAnyOfConstraints,
  combineAnyOfStampedInput,
  denyResourcePolicyDecision,
  fieldEqualsConstraint,
  mergeStampedInput,
} from './resource-policy-decisions';
import { evaluateResourcePolicy } from './resource-policy-evaluator';
import type {
  CustomResourcePolicyCallback,
  CustomResourcePolicyOptions,
  OwnerPolicyOptions,
  ResourceDataConstraint,
  ResourceMetadataRequirement,
  ResourceMetadataRequirements,
  ResourcePolicy,
  ResourcePolicyDiagnostics,
  ResourcePolicyDecision,
  ResourcePolicyKind,
  ResourcePolicyScalar,
} from './resource-policy-types';
import {
  validateCompositePolicy,
  validateAuthorizationPolicy,
  validateMetadataPolicy,
  validateResourcePolicy,
} from './resource-policy-validation';
import { warnResourcePolicy } from './resource-observability';

/** Require an authenticated admin user for every action. */
export function adminOnly(): ResourcePolicy {
  return createResourcePolicy('admin', ({ user }) => {
    if (!user) return denyResourcePolicyDecision('unauthorized', 401, 'Unauthorized');
    if (user.role !== 'admin') {
      return denyResourcePolicyDecision('forbidden', 403, 'Forbidden', {
        role: user.role,
        requiredRole: 'admin',
      });
    }
    return allowResourcePolicyDecision();
  }, undefined, {
    authenticatedActions: ['list', 'get', 'create', 'update', 'delete'],
  });
}

/** Require any authenticated user for every action. */
export function authenticatedOnly(): ResourcePolicy {
  return createResourcePolicy('authenticated', ({ user }) => {
    if (!user) return denyResourcePolicyDecision('unauthorized', 401, 'Unauthorized');
    return allowResourcePolicyDecision();
  }, undefined, {
    authenticatedActions: ['list', 'get', 'create', 'update', 'delete'],
  });
}

/** Allow public list/get reads and deny create/update/delete. */
export function readOnly(): ResourcePolicy {
  return createResourcePolicy('read-only', ({ action }) => {
    if (action === 'list' || action === 'get') return allowResourcePolicyDecision();
    return denyResourcePolicyDecision('read-only', 403, 'Resource is read-only');
  }, undefined, {
    publicActions: ['list', 'get'],
  });
}

/** Allow public list/get reads while requiring auth for writes. */
export function publicReadUserWrite(): ResourcePolicy {
  return createResourcePolicy('public-read-user-write', ({ action, user }) => {
    if (action === 'list' || action === 'get') return allowResourcePolicyDecision();
    if (!user) return denyResourcePolicyDecision('unauthorized', 401, 'Unauthorized');
    return allowResourcePolicyDecision();
  }, undefined, {
    publicActions: ['list', 'get'],
    authenticatedActions: ['create', 'update', 'delete'],
  });
}

/**
 * Create owner-based policy.
 *
 * List returns a field equality constraint. Row actions require the loaded row
 * to have `userField` equal to the current user id. Create defaults to stamping
 * `userField` onto the input for safer generated endpoints.
 */
export function ownerPolicy(options: OwnerPolicyOptions): ResourcePolicy {
  const createMode = options.create ?? 'stamp';
  const userField = options.userField;

  return createResourcePolicy(
    'owner',
    ({ action, user, row, input }) => {
      if (!user) return denyResourcePolicyDecision('unauthorized', 401, 'Unauthorized');

      if (action === 'list') {
        return allowResourcePolicyDecision({
          constraints: [fieldEqualsConstraint(userField, user.userId)],
        });
      }

      if (action === 'create') {
        if (createMode === 'forbid') {
          return denyResourcePolicyDecision(
            'create-forbidden',
            403,
            'Owner policy does not allow create'
          );
        }

        if (createMode === 'stamp') {
          return allowResourcePolicyDecision({
            stampedInput: {
              ...(input ?? {}),
              [userField]: user.userId,
            },
          });
        }

        if (input?.[userField] === user.userId) {
          return allowResourcePolicyDecision();
        }

        return denyResourcePolicyDecision(
          'owner-input-mismatch',
          403,
          'Owner field does not match user',
          { field: userField }
        );
      }

      if (!row) {
        return denyResourcePolicyDecision(
          'owner-row-required',
          403,
          'Loaded row is required for owner policy',
          { field: userField }
        );
      }

      if (row[userField] !== user.userId) {
        return denyResourcePolicyDecision(
          'owner-mismatch',
          403,
          'User does not own this resource',
          { field: userField }
        );
      }

      return allowResourcePolicyDecision();
    },
    () => {
      if (userField.trim().length > 0) return [];
      return [{
        code: 'owner-field-invalid',
        message: 'ownerPolicy requires a non-empty userField.',
        path: 'owner.userField',
        severity: 'error',
      }];
    },
    {
      ownerField: userField,
      ownerCreateMode: createMode,
      authenticatedActions: ['list', 'get', 'create', 'update', 'delete'],
    }
  );
}

/**
 * Require trusted auth user metadata.
 *
 * Every referenced key must exist in auth.userProperties and set
 * `useInPolicies: true`; self-editable fields are rejected by auth config and
 * by this validator if an invalid resolved config reaches policy evaluation.
 */
export function metadataPolicy(requirements: ResourceMetadataRequirements): ResourcePolicy {
  const frozenRequirements = freezeMetadataRequirements(requirements);
  const policy = createResourcePolicy(
    'metadata',
    ({ user, authConfig }) => {
      if (!user) return denyResourcePolicyDecision('unauthorized', 401, 'Unauthorized');

      const validationIssues = validateResourcePolicy(policy, { authConfig });
      if (validationIssues.length > 0) {
        return denyResourcePolicyDecision(
          'policy-invalid',
          500,
          'Resource metadata policy is invalid',
          { issues: validationIssues.map(({ code, path }) => ({ code, path })) }
        );
      }

      const denied = findDeniedMetadata(user.properties, frozenRequirements);
      if (denied) return denyResourcePolicyDecision('metadata-property', 403, 'Forbidden', denied);

      return allowResourcePolicyDecision();
    },
    ({ authConfig }) => validateMetadataPolicy(frozenRequirements, authConfig),
    {
      metadataKeys: Object.keys(frozenRequirements),
      authenticatedActions: ['list', 'get', 'create', 'update', 'delete'],
    }
  );

  return policy;
}

/**
 * Apply Zero's route-compatible authorization vocabulary to a managed resource.
 *
 * The live subject comes from the same server-owned session, tenant membership,
 * and advanced role assignments used by `context.access`. This keeps resource
 * CRUD, lazy reads, and Sync on one RBAC contract without app-authored glue.
 */
export function authorizationPolicy(requirement: AccessRequirement): ResourcePolicy {
  const compiled = compileAccessRequirement(requirement);
  const authenticated = compiled.user === 'required';

  return createResourcePolicy(
    'authorization',
    ({ authorization }) => {
      if (!authorization) {
        return denyResourcePolicyDecision(
          'authorization-unavailable',
          503,
          'Authorization services are unavailable',
        );
      }

      const decision = authorization.kernel.evaluate(compiled, authorization.subject);
      if (decision.allowed) return allowResourcePolicyDecision();
      return denyResourcePolicyDecision(
        decision.reason === 'authentication-required'
          ? 'unauthorized'
          : 'authorization-denied',
        decision.error.status,
        decision.error.status === 401 ? 'Unauthorized' : 'Forbidden',
        { reason: decision.reason },
      );
    },
    ({ authConfig }) => validateAuthorizationPolicy(compiled, authConfig),
    {
      authorizationRequirement: compiled,
      ...(authenticated
        ? { authenticatedActions: ['list', 'get', 'create', 'update', 'delete'] }
        : { publicActions: ['list', 'get', 'create', 'update', 'delete'] }),
    },
  );
}

/**
 * Compose policies with OR semantics.
 *
 * The first successful unconstrained branch opens the action. Multiple
 * constrained branches are returned as one `anyOf` constraint for later query
 * translation.
 */
export function anyOf(...policies: ResourcePolicy[]): ResourcePolicy {
  return createResourcePolicy(
    'any-of',
    async (context) => {
      if (policies.length === 0) {
        return denyResourcePolicyDecision('policy-empty', 500, 'anyOf requires at least one policy');
      }

      const allowedDecisions: ResourcePolicyDecision[] = [];
      const deniedDecisions: ResourcePolicyDecision[] = [];

      for (const policy of policies) {
        const decision = await evaluateResourcePolicy(policy, context);
        if (decision.allowed) {
          allowedDecisions.push(decision);
        } else {
          deniedDecisions.push(decision);
        }
      }

      if (allowedDecisions.length === 0) {
        return deniedDecisions[0] ??
          denyResourcePolicyDecision('policy-empty', 500, 'No resource policies were evaluated');
      }

      return allowResourcePolicyDecision({
        constraints: combineAnyOfConstraints(allowedDecisions),
        stampedInput: combineAnyOfStampedInput(allowedDecisions),
      });
    },
    (context) => validateCompositePolicy('anyOf', policies, context),
    { children: policies }
  );
}

/**
 * Compose policies with AND semantics.
 *
 * All policies must allow. Constraints are ANDed by concatenation and stamped
 * input is merged, failing closed when two policies stamp conflicting values.
 */
export function allOf(...policies: ResourcePolicy[]): ResourcePolicy {
  return createResourcePolicy(
    'all-of',
    async (context) => {
      if (policies.length === 0) {
        return denyResourcePolicyDecision('policy-empty', 500, 'allOf requires at least one policy');
      }

      let constraints: ResourceDataConstraint[] = [];
      let stampedInput: Record<string, unknown> | undefined;
      let currentContext = context;

      for (const policy of policies) {
        const decision = await evaluateResourcePolicy(policy, currentContext);
        if (!decision.allowed) return decision;

        constraints = constraints.concat(decision.constraints ?? []);

        if (decision.stampedInput) {
          const merged = mergeStampedInput(stampedInput, decision.stampedInput);
          if (!merged) {
            return denyResourcePolicyDecision(
              'stamp-conflict',
              500,
              'Resource policies stamped conflicting input values'
            );
          }

          stampedInput = merged;
          currentContext = { ...currentContext, input: stampedInput };
        }
      }

      return allowResourcePolicyDecision({
        constraints,
        stampedInput,
      });
    },
    (context) => validateCompositePolicy('allOf', policies, context),
    { children: policies }
  );
}

/**
 * Wrap an app-owned callback in the resource policy contract.
 *
 * Thrown errors are routed through the observability boundary and converted to
 * deny decisions so policy failures cannot accidentally allow access.
 */
export function customPolicy(
  callback: CustomResourcePolicyCallback,
  options: CustomResourcePolicyOptions = {}
): ResourcePolicy {
  const name = options.name ?? 'custom';

  return createResourcePolicy('custom', async (context) => {
    try {
      return await callback(context);
    } catch {
      warnResourcePolicy(context.resource, OBS_CODES.RESOURCE_POLICY_EVALUATION_FAILED, {
        metadata: {
          policy: name,
          table: context.resource.table,
          action: context.action,
        },
      });
      return denyResourcePolicyDecision('policy-error', 500, 'Resource policy callback failed');
    }
  }, undefined, {
    customName: name,
  });
}

function createResourcePolicy(
  kind: ResourcePolicyKind,
  evaluate: ResourcePolicy['evaluate'],
  validate?: ResourcePolicy['validate'],
  diagnostics?: ResourcePolicyDiagnostics
): ResourcePolicy {
  const frozenDiagnostics = diagnostics ? Object.freeze({
    ...diagnostics,
    ...(diagnostics.children ? {
      children: Object.freeze([...diagnostics.children]),
    } : {}),
    ...(diagnostics.metadataKeys ? {
      metadataKeys: Object.freeze([...diagnostics.metadataKeys]),
    } : {}),
    ...(diagnostics.publicActions ? {
      publicActions: Object.freeze([...diagnostics.publicActions]),
    } : {}),
    ...(diagnostics.authenticatedActions ? {
      authenticatedActions: Object.freeze([...diagnostics.authenticatedActions]),
    } : {}),
  }) : undefined;
  return Object.freeze({ kind, evaluate, validate, diagnostics: frozenDiagnostics });
}

function freezeMetadataRequirements(
  requirements: ResourceMetadataRequirements,
): ResourceMetadataRequirements {
  const copy: ResourceMetadataRequirements = {};
  for (const [key, requirement] of Object.entries(requirements)) {
    if (isPolicyScalarArray(requirement)) {
      copy[key] = Object.freeze([...requirement]);
      continue;
    }
    if (isPolicyScalar(requirement)) {
      copy[key] = requirement;
      continue;
    }
    copy[key] = Object.freeze({
      ...requirement,
      ...(requirement.in ? { in: Object.freeze([...requirement.in]) } : {}),
      ...(isPolicyScalarArray(requirement.not)
        ? { not: Object.freeze([...requirement.not]) }
        : {}),
    });
  }
  return Object.freeze(copy);
}

function findDeniedMetadata(
  properties: Record<string, string>,
  requirements: ResourceMetadataRequirements
): Record<string, unknown> | null {
  for (const [key, requirement] of Object.entries(requirements)) {
    const value = properties[key] ?? null;
    if (!matchesMetadataRequirement(value, requirement)) {
      return {
        key,
        expected: requirement,
        actual: value,
      };
    }
  }

  return null;
}

function matchesMetadataRequirement(
  value: string | null,
  requirement: ResourceMetadataRequirement
): boolean {
  if (isPolicyScalarArray(requirement)) {
    return value !== null && requirement.map(serializePolicyScalar).includes(value);
  }

  if (isPolicyScalar(requirement)) {
    return value === serializePolicyScalar(requirement);
  }

  if (requirement.exists !== undefined) {
    const exists = value !== null;
    if (exists !== requirement.exists) return false;
  }

  if (requirement.equals !== undefined && value !== serializePolicyScalar(requirement.equals)) {
    return false;
  }

  if (requirement.in !== undefined) {
    if (value === null) return false;
    if (!requirement.in.map(serializePolicyScalar).includes(value)) return false;
  }

  if (requirement.not !== undefined) {
    const deniedValues = isPolicyScalarArray(requirement.not)
      ? requirement.not.map(serializePolicyScalar)
      : [serializePolicyScalar(requirement.not)];
    if (value !== null && deniedValues.includes(value)) return false;
  }

  return true;
}

function isPolicyScalar(value: unknown): value is ResourcePolicyScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isPolicyScalarArray(value: unknown): value is readonly ResourcePolicyScalar[] {
  return Array.isArray(value);
}

function serializePolicyScalar(value: ResourcePolicyScalar): string {
  return String(value);
}
