import type {
  AuthError,
  AuthAuthorizationMode,
  AuthTenancyMode,
  PermissionKey,
  ResolvedAuthAuthorizationConfig,
  ResolvedAuthTenancyConfig,
  ResolvedUserPropertyFieldConfig,
} from './types';

export type TrustedPropertyScalar = string | number | boolean;

/** JSON-safe matcher for one server-approved user property. */
export type TrustedPropertyRequirement =
  | TrustedPropertyScalar
  | readonly TrustedPropertyScalar[]
  | {
      equals?: TrustedPropertyScalar;
      in?: readonly TrustedPropertyScalar[];
      not?: TrustedPropertyScalar | readonly TrustedPropertyScalar[];
      exists?: boolean;
    };

export type LegacyAccessRequirement =
  | false
  | true
  | 'optional'
  | 'user'
  | 'required'
  | 'admin';

/** Structured, transport-neutral, and JSON-serializable access declaration. */
export interface StructuredAccessRequirement {
  user?: 'required' | 'optional';
  /** Existing global/platform role. This never means tenant role. */
  platformRole?: string | readonly string[];
  /** Require a validated tenant authorization scope. */
  tenant?: 'required';
  /** Application role in single mode or tenant role in multi mode. */
  scopeRole?: string | readonly string[];
  permission?: PermissionKey;
  allPermissions?: readonly PermissionKey[];
  anyPermissions?: readonly PermissionKey[];
  properties?: Readonly<Record<string, TrustedPropertyRequirement>>;
}

export type AccessRequirement = LegacyAccessRequirement | StructuredAccessRequirement;

/**
 * Canonical conjunctive representation used after root-to-leaf compilation.
 * Every field remains JSON-safe; sets are intentionally represented as arrays.
 */
export interface CompiledAccessRequirement {
  readonly kind: 'zero.access-requirement';
  readonly version: 1;
  readonly user: 'optional' | 'required';
  readonly tenant: boolean;
  /** Each inner group is OR; separate groups are AND. */
  readonly platformRoleGroups: readonly (readonly string[])[];
  /** Each inner group is OR; separate groups are AND. */
  readonly scopeRoleGroups: readonly (readonly string[])[];
  readonly allPermissions: readonly PermissionKey[];
  /** Each inner group is OR; separate groups are AND. */
  readonly anyPermissionGroups: readonly (readonly PermissionKey[])[];
  /** Separate property maps are AND, preserving parent and child constraints. */
  readonly propertyGroups: readonly Readonly<Record<string, TrustedPropertyRequirement>>[];
}

/** Static validation inputs supplied by a configured AuthorizationKernel. */
export interface AccessRequirementCompileOptions {
  tenancy?: AuthTenancyMode;
  declaredPermissions?: readonly PermissionKey[];
  declaredRoles?: readonly string[];
  trustedProperties?: readonly string[];
}

export type AuthorizationScopeKind = 'application' | 'tenant';

/** Live, server-supplied authority inside one application or tenant scope. */
export interface AuthorizationScopeSnapshot {
  readonly tenancy: AuthTenancyMode;
  readonly mode: AuthAuthorizationMode;
  readonly scopeKind: AuthorizationScopeKind;
  readonly scopeId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly PermissionKey[];
  readonly allPermissions?: boolean;
  readonly revision: string;
  /** Present only for a validated multi-tenant membership scope. */
  readonly tenantId?: string;
  readonly membershipId?: string;
}

/** Authenticated identity plus optional live application authorization scope. */
export interface AuthorizationSubjectSnapshot {
  readonly platformRole: string;
  readonly properties?: Readonly<Record<string, string>>;
  /** Active application or tenant scope selected by the session. */
  readonly authorization?: AuthorizationScopeSnapshot | null;
  /**
   * Platform control-plane scope projected only from a live membership in the
   * protected administration organization. In single mode this aliases the
   * active application scope.
   */
  readonly applicationAuthorization?: AuthorizationScopeSnapshot | null;
}

export interface SingleSimpleScopeInput {
  /** Current live `users.role`, retained as the global/platform role. */
  platformRole: string;
  /** Explicit application-role projection. Defaults to platformRole. */
  scopeRole?: string;
  /** Stable application boundary identifier. Default: `application`. */
  scopeId?: string;
  /** Caller-supplied revision when a wider runtime owns revisioning. */
  revision?: string;
}

export type AuthorizationDenialReason =
  | 'authentication-required'
  | 'platform-role'
  | 'scope-required'
  | 'scope-invalid'
  | 'tenant-required'
  | 'scope-role'
  | 'permission'
  | 'property';

export type AuthorizationDecision =
  | {
      readonly allowed: true;
      readonly scope: AuthorizationScopeSnapshot | null;
      readonly requirement: CompiledAccessRequirement;
    }
  | {
      readonly allowed: false;
      readonly scope: AuthorizationScopeSnapshot | null;
      readonly requirement: CompiledAccessRequirement;
      readonly reason: AuthorizationDenialReason;
      readonly error: AuthError;
    };

export interface AuthorizationKernelConfig {
  tenancy: ResolvedAuthTenancyConfig;
  authorization: ResolvedAuthAuthorizationConfig;
  userProperties?: Readonly<Record<string, ResolvedUserPropertyFieldConfig>>;
}
