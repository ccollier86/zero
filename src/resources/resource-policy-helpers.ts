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
import type { TenantKind } from '../auth/tenancy/tenancy-types';
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
  GuardianActorPolicyOptions,
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
  validateGuardianActorPolicy,
  validateMetadataPolicy,
  validateResourcePolicy,
  validateTenantKindPolicy,
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
  const immutable = options.immutable ?? true;

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

      if (
        action === 'update'
        && immutable
        && hasOwn(input, userField)
        && input?.[userField] !== row[userField]
      ) {
        return denyResourcePolicyDecision(
          'owner-input-mismatch',
          403,
          'Owner field is immutable',
          { field: userField },
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
      ownerImmutable: immutable,
      authenticatedActions: ['list', 'get', 'create', 'update', 'delete'],
    }
  );
}

/**
 * Bind app data to the current server-resolved Guardian actor.
 *
 * Create stamping ignores caller-supplied identity values. Membership values
 * come only from the live tenant authorization subject, while user values come
 * from the authenticated Resource policy principal. The referenced anchor
 * rows provide relational integrity; this policy provides authorization.
 */
export function guardianActorPolicy(options: GuardianActorPolicyOptions): ResourcePolicy {
  const createMode = options.create ?? 'stamp';
  const immutable = options.immutable ?? true;
  const userField = options.userField;
  const membershipField = options.membershipField;
  const validationOptions = Object.freeze({
    userField,
    ...(membershipField === undefined ? {} : { membershipField }),
    create: createMode,
    immutable,
  });
  const ownerFields = Object.freeze([
    userField,
    ...(membershipField === undefined ? [] : [membershipField]),
  ]);

  return createResourcePolicy(
    'guardian-actor',
    ({ action, user, row, input, authorization }) => {
      if (!user) return denyResourcePolicyDecision('unauthorized', 401, 'Unauthorized');

      let membershipId: string | undefined;
      if (membershipField !== undefined) {
        if (!authorization) {
          return denyResourcePolicyDecision(
            'authorization-unavailable',
            503,
            'Authorization services are unavailable',
          );
        }
        const scope = authorization.subject?.authorization;
        if (
          scope?.scopeKind !== 'tenant'
          || !scope.tenantId
          || !scope.membershipId
          || scope.scopeId !== scope.tenantId
        ) {
          return denyResourcePolicyDecision(
            'tenant-membership-required',
            authorization.subject ? 403 : 401,
            authorization.subject ? 'Active tenant membership is required' : 'Unauthorized',
          );
        }
        membershipId = scope.membershipId;
      }

      const referenceValues: Array<readonly [string, string]> = [
        [userField, user.userId],
        ...(membershipField !== undefined && membershipId !== undefined
          ? [[membershipField, membershipId] as const]
          : []),
      ];

      if (action === 'list') {
        return allowResourcePolicyDecision({
          constraints: referenceValues.map(([field, value]) => (
            fieldEqualsConstraint(field, value)
          )),
        });
      }

      if (action === 'create') {
        if (createMode === 'forbid') {
          return denyResourcePolicyDecision(
            'create-forbidden',
            403,
            'Guardian actor policy does not allow create',
          );
        }
        if (createMode === 'require') {
          const mismatch = referenceValues.find(([field, value]) => input?.[field] !== value);
          if (!mismatch) return allowResourcePolicyDecision();
          return denyResourcePolicyDecision(
            mismatch[0] === userField ? 'guardian-user-mismatch' : 'guardian-membership-mismatch',
            403,
            'Guardian actor reference does not match the active principal',
            { field: mismatch[0] },
          );
        }
        return allowResourcePolicyDecision({
          stampedInput: Object.fromEntries([
            ...Object.entries(input ?? {}),
            ...referenceValues,
          ]),
        });
      }

      if (!row) {
        return denyResourcePolicyDecision(
          'guardian-actor-row-required',
          403,
          'Loaded row is required for Guardian actor policy',
          { fields: ownerFields },
        );
      }

      const rowMismatch = referenceValues.find(([field, value]) => row[field] !== value);
      if (rowMismatch) {
        return denyResourcePolicyDecision(
          rowMismatch[0] === userField ? 'guardian-user-mismatch' : 'guardian-membership-mismatch',
          403,
          'Guardian actor does not own this resource',
          { field: rowMismatch[0] },
        );
      }

      if (action === 'update' && immutable) {
        const changed = referenceValues.find(([field]) => (
          hasOwn(input, field) && input?.[field] !== row[field]
        ));
        if (changed) {
          return denyResourcePolicyDecision(
            'guardian-reference-immutable',
            403,
            'Guardian actor references are immutable',
            { field: changed[0] },
          );
        }
      }

      return allowResourcePolicyDecision();
    },
    ({ authConfig }) => validateGuardianActorPolicy(validationOptions, authConfig),
    {
      ownerFields,
      ownerCreateMode: createMode,
      ownerImmutable: immutable,
      guardianUserField: userField,
      guardianMembershipField: membershipField,
      authenticatedActions: ['list', 'get', 'create', 'update', 'delete'],
    },
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
 * Admit only live tenant scopes whose server-owned purpose matches one of the
 * declared kinds. The tenant kind comes from durable Guardian authority, never
 * from a request header, body, resource row, or bearer claim.
 */
export function tenantKindPolicy(
  tenantKind: TenantKind,
  ...additionalTenantKinds: TenantKind[]
): ResourcePolicy {
  const tenantKinds = normalizeTenantKinds([tenantKind, ...additionalTenantKinds]);

  return createResourcePolicy(
    'tenant-kind',
    ({ authorization }) => {
      if (!authorization) {
        return denyResourcePolicyDecision(
          'authorization-unavailable',
          503,
          'Authorization services are unavailable',
        );
      }
      if (!authorization.subject) {
        return denyResourcePolicyDecision('unauthorized', 401, 'Unauthorized');
      }
      const scope = authorization.subject.authorization;
      if (scope?.scopeKind !== 'tenant' || !scope.tenantId || !scope.membershipId) {
        return denyResourcePolicyDecision(
          'authorization-denied',
          403,
          'Forbidden',
          { reason: 'tenant-scope-required' },
        );
      }
      if (!authorization.tenantKind || !tenantKinds.includes(authorization.tenantKind)) {
        return denyResourcePolicyDecision(
          'authorization-denied',
          403,
          'Forbidden',
          {
            tenantKind: authorization.tenantKind ?? null,
            requiredTenantKinds: tenantKinds,
          },
        );
      }
      return allowResourcePolicyDecision();
    },
    ({ authConfig }) => validateTenantKindPolicy(authConfig),
    {
      tenantKinds,
      authenticatedActions: ['list', 'get', 'create', 'update', 'delete'],
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
    ...(diagnostics.ownerFields ? {
      ownerFields: Object.freeze([...diagnostics.ownerFields]),
    } : {}),
    ...(diagnostics.publicActions ? {
      publicActions: Object.freeze([...diagnostics.publicActions]),
    } : {}),
    ...(diagnostics.authenticatedActions ? {
      authenticatedActions: Object.freeze([...diagnostics.authenticatedActions]),
    } : {}),
    ...(diagnostics.tenantKinds ? {
      tenantKinds: Object.freeze([...diagnostics.tenantKinds]),
    } : {}),
  }) : undefined;
  return Object.freeze({ kind, evaluate, validate, diagnostics: frozenDiagnostics });
}

function normalizeTenantKinds(tenantKinds: readonly TenantKind[]): readonly TenantKind[] {
  const normalized = [...new Set(tenantKinds)];
  for (const tenantKind of normalized) {
    if (tenantKind !== 'organization' && tenantKind !== 'administration') {
      throw new Error(
        `[resources] Unknown tenant kind "${String(tenantKind)}". `
        + 'Expected "organization" or "administration".',
      );
    }
  }
  return Object.freeze(normalized);
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

function hasOwn(value: Record<string, unknown> | undefined, field: string): boolean {
  return value !== undefined && Object.prototype.hasOwnProperty.call(value, field);
}
