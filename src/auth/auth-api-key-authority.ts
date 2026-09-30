/** Live user, tenant, and RBAC projection for Guardian user API keys. */

import { createRequestAuthorizationAccess } from './authorization-access';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import type {
  AuthApiKeyRecord,
  AuthApiKeyScopeKind,
  AuthApiKeyStatus,
} from './auth-api-key-types';
import { canUserReceiveAuthTokens } from './auth-user-eligibility';
import type { TenancyService } from './tenancy/tenancy-service';
import type { TenantMembershipRecord, TenantRecord } from './tenancy/tenancy-types';
import type { AuthContext, ResolvedAuthApiKeyConfig, UserRecord } from './types';
import type { UserStore } from './user-store';

export interface AuthApiKeyBinding {
  readonly scopeKind: AuthApiKeyScopeKind;
  readonly scopeId: string;
  readonly tenantId: string | null;
  readonly membershipId: string | null;
  readonly tenant: TenantRecord | null;
  readonly membership: TenantMembershipRecord | null;
}

export interface AuthApiKeyAuthorityOptions {
  readonly config: ResolvedAuthApiKeyConfig;
  readonly users: UserStore;
  readonly tenancy: TenancyService | null;
  readonly authorization: AuthorizationKernel;
  readonly roles: AuthorizationRoleService | null;
}

export class AuthApiKeyAuthority {
  constructor(private readonly options: AuthApiKeyAuthorityOptions) {}

  bindingFromActor(auth: AuthContext): AuthApiKeyBinding | null {
    if (this.options.authorization.tenancy.mode === 'single') {
      return applicationBinding();
    }
    if (auth.sessionScopeKind !== 'tenant' || !auth.tenantId || !auth.membershipId) {
      return null;
    }
    return this.tenantBinding(auth.tenantId, auth.membershipId, auth.userId, true);
  }

  tenantTarget(
    tenantId: string,
    membershipId: string,
    requireActive: boolean,
  ): AuthApiKeyBinding | null {
    return this.tenantBinding(tenantId, membershipId, undefined, requireActive);
  }

  bindingFromRecord(
    record: AuthApiKeyRecord,
    requireActive: boolean,
  ): AuthApiKeyBinding | null {
    if (record.scopeKind === 'application') {
      return this.options.authorization.tenancy.mode === 'single'
        ? applicationBinding()
        : null;
    }
    if (!record.tenantId || !record.membershipId) return null;
    return this.tenantBinding(
      record.tenantId,
      record.membershipId,
      record.userId,
      requireActive,
    );
  }

  requireEligibleUser(userId: string, binding: AuthApiKeyBinding): UserRecord | null {
    if (!isActiveBinding(binding)) return null;
    const user = this.options.users.getUserById(userId);
    if (!user || !canUserReceiveAuthTokens(user)) return null;
    const context = this.contextFor(
      'eligibility-check',
      user,
      this.options.users.getAuthGeneration(userId),
      binding,
    );
    return this.isEligibleContext(context) ? user : null;
  }

  hydrate(record: AuthApiKeyRecord, now: number): AuthContext | null {
    if (record.revokedAt !== null || record.expiresAt <= now) return null;
    const user = this.options.users.getUserById(record.userId);
    if (!user || !canUserReceiveAuthTokens(user)) return null;
    const authGeneration = this.options.users.getAuthGeneration(record.userId);
    if (authGeneration !== record.issuedAuthGeneration) return null;
    const binding = this.bindingFromRecord(record, true);
    if (!binding) return null;
    const context = this.contextFor(record.keyId, user, authGeneration, binding);
    return this.isEligibleContext(context) ? context : null;
  }

  status(record: AuthApiKeyRecord, now: number): AuthApiKeyStatus {
    if (record.revokedAt !== null) return 'revoked';
    if (record.expiresAt <= now) return 'expired';
    const user = this.options.users.getUserById(record.userId);
    if (!user) return 'unavailable';
    if (this.options.users.getAuthGeneration(record.userId)
      !== record.issuedAuthGeneration) return 'invalidated';
    if (!canUserReceiveAuthTokens(user)) return 'unavailable';
    const binding = this.bindingFromRecord(record, true);
    if (!binding) return 'unavailable';
    const context = this.contextFor(
      record.keyId,
      user,
      record.issuedAuthGeneration,
      binding,
    );
    return this.isEligibleContext(context) ? 'active' : 'unavailable';
  }

  private contextFor(
    keyId: string,
    user: UserRecord,
    authGeneration: number,
    binding: AuthApiKeyBinding,
  ): AuthContext {
    const base: AuthContext = {
      userId: user.userId,
      email: user.email,
      role: user.role,
      credentialKind: 'api-key',
      credentialId: keyId,
      authGeneration,
      sessionScopeKind: binding.scopeKind,
      sessionScopeId: binding.scopeId,
      ...(binding.scopeKind === 'tenant' ? {
        tenantId: binding.tenantId!,
        membershipId: binding.membershipId!,
        tenantKind: binding.tenant!.kind,
        tenantRole: binding.membership!.roleKey,
        tenantAuthorizationGeneration: binding.tenant!.authorizationGeneration,
        membershipAuthorizationGeneration: binding.membership!.authorizationGeneration,
      } : {}),
    };
    const revision = this.options.authorization.authorization.mode === 'advanced'
      ? binding.scopeKind === 'application'
        ? this.options.roles?.resolveApplicationRoles(user.userId)?.revision ?? null
        : this.options.roles?.resolveTenantRoles({
            tenantId: binding.tenantId!,
            membershipId: binding.membershipId!,
            userId: user.userId,
          })?.revision ?? null
      : null;
    return Object.freeze(revision === null
      ? base
      : { ...base, authorizationAssignmentRevision: revision });
  }

  private isEligibleContext(context: AuthContext): boolean {
    const allowlist = this.options.config.eligibleScopeRoles;
    if (!allowlist) return true;
    const access = createRequestAuthorizationAccess({
      authContext: context,
      kernel: this.options.authorization,
      roleAssignments: this.options.roles,
    });
    // This is an internal eligibility decision over an already verified key
    // subject. RequestAuthorizationAccess deliberately hides API-key identity
    // until the caller explicitly admits that credential class, so perform
    // the same explicit admission an app route must declare before inspecting
    // its live scope roles.
    const scope = access.authorize({
      user: 'required',
      credentials: ['api-key'],
    });
    return Boolean(scope?.roles.some((role) => allowlist.includes(role)));
  }

  private tenantBinding(
    tenantId: string,
    membershipId: string,
    expectedUserId: string | undefined,
    requireActive: boolean,
  ): AuthApiKeyBinding | null {
    const tenant = this.options.tenancy?.getTenant(tenantId) ?? null;
    const membership = this.options.tenancy?.getMembershipById(membershipId) ?? null;
    if (!tenant
      || tenant.kind !== 'organization'
      || !membership
      || membership.tenantId !== tenantId
      || (expectedUserId !== undefined && membership.userId !== expectedUserId)
      || (requireActive && (tenant.status !== 'active' || membership.status !== 'active'))) {
      return null;
    }
    return Object.freeze({
      scopeKind: 'tenant' as const,
      scopeId: tenantId,
      tenantId,
      membershipId,
      tenant,
      membership,
    });
  }
}

export function applicationBinding(): AuthApiKeyBinding {
  return Object.freeze({
    scopeKind: 'application',
    scopeId: 'application',
    tenantId: null,
    membershipId: null,
    tenant: null,
    membership: null,
  });
}

export function isActiveBinding(binding: AuthApiKeyBinding): boolean {
  return binding.scopeKind === 'application'
    || (binding.tenant?.status === 'active' && binding.membership?.status === 'active');
}
