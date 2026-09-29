/**
 * Pure authorization requirement compiler and evaluator.
 *
 * This stable facade owns no request, persistence, token, Elysia, or tenant
 * lifecycle state. Callers supply immutable identity/scope snapshots and
 * receive deterministic decisions. Focused modules behind the facade own the
 * public policy vocabulary, registry validation, requirement compilation, and
 * live-scope evaluation without widening the public import contract.
 */

import type {
  NormalizedAuthBehaviorConfig,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthTenancyConfig,
} from './types';
import type {
  AccessRequirement,
  AccessRequirementCompileOptions,
  AuthorizationDecision,
  AuthorizationKernelConfig,
  AuthorizationScopeSnapshot,
  AuthorizationSubjectSnapshot,
  CompiledAccessRequirement,
  SingleSimpleScopeInput,
} from './authorization-policy-types';
import type { AuthorizationEvaluationContext } from './authorization-scope-evaluator';
import {
  compileAccessRequirement,
  isCompiledAccessRequirement,
  mergeAccessRequirements,
} from './authorization-requirement-compiler';
import {
  freezeAuthorizationConfig,
  validateAuthorizationRegistry,
} from './authorization-registry-validation';
import {
  evaluateAuthorizationRequirement,
  isValidAuthorizationScopeSnapshot,
  synthesizeSingleSimpleAuthorizationScope,
} from './authorization-scope-evaluator';
import {
  authorizationConfigError,
  compareAuthorizationKeys,
} from './authorization-kernel-utils';

export type { PermissionKey } from './types';
export type {
  AccessRequirement,
  AccessRequirementCompileOptions,
  AuthorizationDecision,
  AuthorizationDenialReason,
  AuthorizationKernelConfig,
  AuthorizationScopeKind,
  AuthorizationScopeSnapshot,
  AuthorizationSubjectSnapshot,
  CompiledAccessRequirement,
  LegacyAccessRequirement,
  SingleSimpleScopeInput,
  StructuredAccessRequirement,
  TrustedPropertyRequirement,
  TrustedPropertyScalar,
} from './authorization-policy-types';
export {
  compileAccessRequirement,
  isCompiledAccessRequirement,
  mergeAccessRequirements,
} from './authorization-requirement-compiler';
export {
  authorizationPermissionKeysForScope,
  expandAuthorizationRolesForScope,
  validateAuthorizationRegistry,
  validatePermissionKey,
  validateRoleKey,
} from './authorization-registry-validation';

/** Pure evaluator/factory bound only to immutable normalized application config. */
export class AuthorizationKernel {
  readonly tenancy: ResolvedAuthTenancyConfig;
  readonly authorization: ResolvedAuthAuthorizationConfig;
  private readonly compileOptions: AccessRequirementCompileOptions;
  private readonly trustedProperties: ReadonlySet<string>;
  private readonly evaluationContext: AuthorizationEvaluationContext;

  constructor(config: AuthorizationKernelConfig | NormalizedAuthBehaviorConfig) {
    if (config.tenancy.mode !== 'single' && config.tenancy.mode !== 'multi') {
      throw authorizationConfigError(
        `Unsupported tenancy mode: "${String(config.tenancy.mode)}".`,
      );
    }
    validateAuthorizationRegistry(config.authorization);
    this.tenancy = Object.freeze({
      mode: config.tenancy.mode,
      terminology: Object.freeze({ ...config.tenancy.terminology }),
      creation: Object.freeze({ ...config.tenancy.creation }),
    });
    this.authorization = freezeAuthorizationConfig(config.authorization);
    const trustedProperties = Object.entries(config.userProperties ?? {})
      .filter(([, field]) => field.useInPolicies)
      .map(([key]) => key)
      .sort(compareAuthorizationKeys);
    this.trustedProperties = new Set(trustedProperties);
    this.compileOptions = Object.freeze({
      tenancy: config.tenancy.mode,
      declaredPermissions: Object.freeze(
        Object.keys(this.authorization.permissions).sort(compareAuthorizationKeys),
      ),
      declaredRoles: Object.freeze(
        Object.keys(this.authorization.roles).sort(compareAuthorizationKeys),
      ),
      trustedProperties: Object.freeze(trustedProperties),
    });
    this.evaluationContext = Object.freeze({
      tenancy: this.tenancy,
      authorization: this.authorization,
      compileOptions: this.compileOptions,
    });
  }

  compile(
    requirement: AccessRequirement,
    parent?: AccessRequirement | CompiledAccessRequirement,
  ): CompiledAccessRequirement {
    if (parent === undefined) {
      return compileAccessRequirement(requirement, this.compileOptions);
    }
    return mergeAccessRequirements(parent, requirement, this.compileOptions);
  }

  merge(
    parent: AccessRequirement | CompiledAccessRequirement,
    child: AccessRequirement | CompiledAccessRequirement,
  ): CompiledAccessRequirement {
    return mergeAccessRequirements(parent, child, this.compileOptions);
  }

  /** Whether a server-owned user property is allowed in authorization policy. */
  isPolicyTrustedProperty(key: string): boolean {
    return this.trustedProperties.has(key);
  }

  /**
   * Project today's live global role into the application scope for the exact
   * single/simple compatibility profile.
   */
  synthesizeSingleSimpleScope(input: SingleSimpleScopeInput): AuthorizationScopeSnapshot {
    return synthesizeSingleSimpleAuthorizationScope(this.evaluationContext, input);
  }

  evaluate(
    requirement: AccessRequirement | CompiledAccessRequirement,
    subject: AuthorizationSubjectSnapshot | null,
  ): AuthorizationDecision {
    const compiled = isCompiledAccessRequirement(requirement)
      ? requirement
      : this.compile(requirement);
    return evaluateAuthorizationRequirement(
      this.evaluationContext,
      compiled,
      subject,
      (scope) => this.isValidScopeSnapshot(scope),
    );
  }

  /** Evaluate and throw the stable AuthError contract when access is denied. */
  authorize(
    requirement: AccessRequirement | CompiledAccessRequirement,
    subject: AuthorizationSubjectSnapshot | null,
  ): AuthorizationScopeSnapshot | null {
    const decision = this.evaluate(requirement, subject);
    if (!decision.allowed) throw decision.error;
    return decision.scope;
  }

  /** Validate a live scope supplied by a future persistence/session adapter. */
  isValidScopeSnapshot(scope: AuthorizationScopeSnapshot): boolean {
    return isValidAuthorizationScopeSnapshot(this.evaluationContext, scope);
  }
}

export function createAuthorizationKernel(
  config: AuthorizationKernelConfig | NormalizedAuthBehaviorConfig,
): AuthorizationKernel {
  return new AuthorizationKernel(config);
}
