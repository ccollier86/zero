/**
 * resource-policy-types.ts
 *
 * Owns the type contract for Zero resource authorization policies. This file
 * defines data shapes only; it does not evaluate policy, validate auth config,
 * mount routes, or query persistence.
 */

import type {
  AccessRequirement,
  AuthorizationKernel,
  AuthorizationSubjectSnapshot,
  CompiledAccessRequirement,
} from '../auth/authorization-kernel';
import type {
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthTenancyConfig,
  ResolvedUserPropertyFieldConfig,
} from '../auth/types';

/** Sync or async return helper used by custom resource policies. */
export type ResourceMaybePromise<T> = T | Promise<T>;

/** Resource action names understood by Zero resource policy. */
export type ResourceAction = 'list' | 'get' | 'create' | 'update' | 'delete';

/** Scalar values accepted by metadata requirements and query constraints. */
export type ResourcePolicyScalar = string | number | boolean;

/** Auth user shape needed by resource authorization. */
export interface ResourcePolicyUser {
  userId: string;
  email?: string;
  role: string;
  properties: Record<string, string>;
}

/**
 * Live app-local RBAC evaluation state supplied by Zero's managed transports.
 *
 * Resource policies never accept this state from request input. The subject is
 * projected from the same durable browser/native session, tenant membership,
 * and retained role assignments used by route guards and built-in services.
 */
export interface ResourcePolicyAuthorizationContext {
  readonly kernel: AuthorizationKernel;
  readonly subject: AuthorizationSubjectSnapshot | null;
}

/** Minimal resource shape needed by the policy evaluator. */
export interface ResourcePolicyResource {
  table: string;
  primaryKey: string;
}

/** Auth config subset needed to validate metadata policy keys. */
export interface ResourcePolicyAuthConfig {
  userProperties: Record<string, ResolvedUserPropertyFieldConfig>;
  /** Present on managed Zero apps; optional only for legacy standalone policy evaluators. */
  tenancy?: ResolvedAuthTenancyConfig;
  /** Present on managed Zero apps; optional only for legacy standalone policy evaluators. */
  authorization?: ResolvedAuthAuthorizationConfig;
}

/** Context passed to resource policy evaluators. */
export interface ResourcePolicyContext {
  action: ResourceAction;
  user: ResourcePolicyUser | null;
  resource: ResourcePolicyResource;
  row?: Record<string, unknown>;
  input?: Record<string, unknown>;
  authConfig: ResourcePolicyAuthConfig;
  /** Same live authorization kernel/snapshot used by route and service guards. */
  authorization?: ResourcePolicyAuthorizationContext | null;
}

/** A field equality constraint that data-query/CRUD layers can translate. */
export interface ResourceFieldConstraint {
  type: 'field';
  field: string;
  operator: 'eq';
  value: ResourcePolicyScalar;
}

/** Constraint union for later query planning. Top-level arrays are ANDed. */
export type ResourceDataConstraint =
  | ResourceFieldConstraint
  | { type: 'anyOf'; constraints: ResourceDataConstraint[] }
  | { type: 'allOf'; constraints: ResourceDataConstraint[] };

/** Stable denial reasons returned by resource policy evaluation. */
export type ResourcePolicyDenyReason =
  | 'unauthorized'
  | 'forbidden'
  | 'read-only'
  | 'create-forbidden'
  | 'owner-row-required'
  | 'owner-mismatch'
  | 'owner-input-mismatch'
  | 'metadata-property'
  | 'policy-invalid'
  | 'policy-empty'
  | 'policy-error'
  | 'stamp-conflict'
  | 'authorization-unavailable'
  | 'authorization-denied';

/** Structured resource policy result for route/data/sync integrations. */
export interface ResourcePolicyDecision {
  allowed: boolean;
  reason?: ResourcePolicyDenyReason | string;
  status?: number;
  message?: string;
  constraints?: ResourceDataConstraint[];
  stampedInput?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Values a custom resource policy may return. */
export type ResourcePolicyDecisionInput = boolean | ResourcePolicyDecision;

/** Resource policy primitive returned by helper constructors. */
export interface ResourcePolicy {
  readonly kind: ResourcePolicyKind;
  evaluate(context: ResourcePolicyContext): ResourceMaybePromise<ResourcePolicyDecisionInput>;
  validate?(context: ResourcePolicyValidationContext): ResourcePolicyValidationIssue[];
  readonly diagnostics?: ResourcePolicyDiagnostics;
}

/** Policy helper names used for validation and diagnostics. */
export type ResourcePolicyKind =
  | 'admin'
  | 'authenticated'
  | 'read-only'
  | 'public-read-user-write'
  | 'owner'
  | 'metadata'
  | 'authorization'
  | 'any-of'
  | 'all-of'
  | 'custom';

/** Static metadata used by doctor and registration validation. */
export interface ResourcePolicyDiagnostics {
  ownerField?: string;
  ownerCreateMode?: OwnerPolicyCreateMode;
  metadataKeys?: readonly string[];
  publicActions?: readonly ResourceAction[];
  authenticatedActions?: readonly ResourceAction[];
  children?: readonly ResourcePolicy[];
  customName?: string;
  /** Canonical route-compatible requirement enforced by authorizationPolicy(). */
  authorizationRequirement?: CompiledAccessRequirement;
}

/** Context used to validate resource policies before registration. */
export interface ResourcePolicyValidationContext {
  authConfig: ResourcePolicyAuthConfig;
}

/** Stable validation issue codes for doctor and registration checks. */
export type ResourcePolicyValidationCode =
  | 'metadata-property-unknown'
  | 'metadata-property-untrusted'
  | 'owner-field-invalid'
  | 'composite-policy-empty'
  | 'authorization-config-unavailable'
  | 'authorization-requirement-invalid';

/** Structured policy validation issue. */
export interface ResourcePolicyValidationIssue {
  code: ResourcePolicyValidationCode;
  message: string;
  path?: string;
  severity: 'error';
  metadata?: Record<string, unknown>;
}

/** Owner policy create behavior. */
export type OwnerPolicyCreateMode = 'stamp' | 'require' | 'forbid';

/** Options for owner-based resource policy. */
export interface OwnerPolicyOptions {
  userField: string;
  create?: OwnerPolicyCreateMode;
}

/** Object-form metadata requirement for one trusted user property. */
export interface ResourceMetadataRequirementOperators {
  equals?: ResourcePolicyScalar;
  in?: readonly ResourcePolicyScalar[];
  not?: ResourcePolicyScalar | readonly ResourcePolicyScalar[];
  exists?: boolean;
}

/** Requirement accepted by metadataPolicy for one property key. */
export type ResourceMetadataRequirement =
  | ResourcePolicyScalar
  | readonly ResourcePolicyScalar[]
  | ResourceMetadataRequirementOperators;

/** Map of trusted user property keys to required values/operators. */
export type ResourceMetadataRequirements = Record<string, ResourceMetadataRequirement>;

/** Options for custom resource policy callbacks. */
export interface CustomResourcePolicyOptions {
  name?: string;
}

/** Custom resource policy callback. */
export type CustomResourcePolicyCallback = (
  context: ResourcePolicyContext
) => ResourceMaybePromise<ResourcePolicyDecisionInput>;

/** Route-compatible declaration accepted by authorizationPolicy(). */
export type ResourceAuthorizationRequirement = AccessRequirement;
