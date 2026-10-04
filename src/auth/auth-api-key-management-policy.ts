/** Session, permission, target, and input policy for API-key management. */

import { parseTokenTTL } from '../tokens/token-utils';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { createRequestAuthorizationAccess } from './authorization-access';
import {
  type AuthApiKeyAuthority,
  type AuthApiKeyBinding,
  applicationBinding,
} from './auth-api-key-authority';
import {
  apiKeyAuthorityChanged,
  apiKeyForbidden,
  apiKeyNotFound,
  apiKeySubjectIneligible,
  apiKeySubjectUnavailable,
  apiKeysUnavailable,
  apiKeyValidation,
} from './auth-api-key-errors';
import type {
  AuthApiKeyManagementCapabilities,
  AuthApiKeyRecord,
  AuthApiKeyTenantTarget,
} from './auth-api-key-types';
import type { AuthContext, ResolvedAuthApiKeyConfig } from './types';
import type { UserStore } from './user-store';

const MAX_LABEL_LENGTH = 100;

export class AuthApiKeyManagementPolicy {
  constructor(private readonly options: {
    readonly config: ResolvedAuthApiKeyConfig;
    readonly users: UserStore;
    readonly authority: AuthApiKeyAuthority;
    readonly authorization: AuthorizationKernel;
    readonly roles: AuthorizationRoleService | null;
    readonly assertCurrentProfile: () => void;
  }) {}

  requireAdministratorTarget(
    auth: AuthContext,
    target: { userId?: string; membershipId?: string },
    requireActive: boolean,
  ): AuthApiKeyBinding {
    this.requireAdministrator(auth, requireActive);
    if (this.options.authorization.tenancy.mode === 'single') {
      if (!target.userId || target.membershipId !== undefined) {
        throw apiKeySubjectUnavailable();
      }
      if (requireActive && !this.options.authority.requireEligibleUser(
        target.userId,
        applicationBinding(),
      )) throw apiKeySubjectIneligible();
      if (!requireActive && !this.options.users.getUserById(target.userId)) {
        throw apiKeySubjectUnavailable();
      }
      return applicationBinding();
    }
    if (!auth.tenantId || !target.membershipId || target.userId !== undefined) {
      throw apiKeySubjectUnavailable();
    }
    const binding = this.options.authority.tenantTarget(
      auth.tenantId,
      target.membershipId,
      requireActive,
    );
    if (!binding) throw apiKeySubjectUnavailable();
    return binding;
  }

  selfCapabilities(
    auth: AuthContext,
    binding: AuthApiKeyBinding,
  ): AuthApiKeyManagementCapabilities {
    const eligible = Boolean(this.options.authority.requireEligibleUser(
      auth.userId,
      binding,
    ));
    return managementCapabilities(eligible, eligible, true);
  }

  administratorCapabilities(
    auth: AuthContext,
    userId: string,
    binding: AuthApiKeyBinding,
  ): AuthApiKeyManagementCapabilities {
    const canManage = this.canAdministratorManage(auth);
    const canAdminister = canManage
      && this.options.config.administratorIssuance
      && Boolean(this.options.authority.requireEligibleUser(userId, binding));
    return managementCapabilities(canAdminister, canAdminister, canManage);
  }

  requireAdministratorRecord(
    auth: AuthContext,
    record: AuthApiKeyRecord,
    requireActive: boolean,
  ): AuthApiKeyBinding {
    this.requireAdministrator(auth, true);
    const binding = this.options.authority.bindingFromRecord(record, requireActive);
    if (!binding) throw apiKeyNotFound();
    if (this.options.authorization.tenancy.mode === 'single') return binding;
    if (binding.scopeKind !== 'tenant' || binding.tenantId !== auth.tenantId) {
      throw apiKeyNotFound();
    }
    return binding;
  }

  requirePlatformAdministrator(auth: AuthContext, mutate: boolean): void {
    this.requireSession(auth);
    this.requireEnabled();
    if (this.options.authorization.tenancy.mode !== 'multi'
      || auth.tenantKind !== 'administration') throw apiKeyForbidden();
    const access = this.access(auth);
    access.requireApplicationAuthorization();
    access.requirePermission(mutate
      ? 'application.users:manage'
      : 'application.users:read');
    access.requirePermission('application.tenants:read');
  }

  requirePlatformTarget(
    target: AuthApiKeyTenantTarget,
    requireActive: boolean,
  ): AuthApiKeyBinding {
    const binding = this.options.authority.tenantTarget(
      target.tenantId,
      target.membershipId,
      requireActive,
    );
    if (!binding) throw apiKeySubjectUnavailable();
    return binding;
  }

  platformCapabilities(
    auth: AuthContext,
    target?: { userId: string; binding: AuthApiKeyBinding },
  ): AuthApiKeyManagementCapabilities {
    const canManage = this.canPlatformManage(auth);
    const canAdminister = canManage && this.options.config.administratorIssuance;
    const targetEligible = target
      ? Boolean(this.options.authority.requireEligibleUser(
          target.userId,
          target.binding,
        ))
      : false;
    return managementCapabilities(
      canAdminister && targetEligible,
      canAdminister && (target ? targetEligible : true),
      canManage,
    );
  }

  assertMutationActor(
    admitted: AuthContext,
    assertion: () => AuthContext,
  ): AuthContext {
    const current = assertion();
    this.requireSession(current);
    if (current.userId !== admitted.userId) throw apiKeyAuthorityChanged();
    return current;
  }

  requireSession(auth: AuthContext): void {
    if ((auth.credentialKind ?? 'session') !== 'session') throw apiKeyForbidden();
  }

  requireEnabled(): void {
    this.options.assertCurrentProfile();
    if (!this.options.config.enabled) throw apiKeysUnavailable();
  }

  requireSelfService(): void {
    this.requireEnabled();
    if (!this.options.config.selfService) {
      throw apiKeysUnavailable('API key self-service is unavailable');
    }
  }

  requireAdministratorIssuance(): void {
    this.requireEnabled();
    if (!this.options.config.administratorIssuance) {
      throw apiKeysUnavailable('Administrator API key issuance is unavailable');
    }
  }

  normalizeLabel(value: string): string {
    if (typeof value !== 'string') throw apiKeyValidation('API key label is required');
    const label = value.trim();
    if (label.length < 1 || label.length > MAX_LABEL_LENGTH) {
      throw apiKeyValidation(
        `API key label must be between 1 and ${MAX_LABEL_LENGTH} characters`,
      );
    }
    return label;
  }

  resolveTTL(value: string | undefined): number {
    if (value === undefined) return this.options.config.defaultTTLms;
    let ttl: number;
    try {
      ttl = parseTokenTTL(value, 'API key TTL');
    } catch {
      throw apiKeyValidation('Invalid API key TTL');
    }
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > this.options.config.maxTTLms) {
      throw apiKeyValidation('API key TTL exceeds the configured maximum');
    }
    return ttl;
  }

  private requireAdministrator(auth: AuthContext, mutate: boolean): void {
    this.requireSession(auth);
    this.requireEnabled();
    const access = this.access(auth);
    if (this.options.authorization.tenancy.mode === 'single') {
      if (this.options.authorization.authorization.mode === 'simple') {
        access.requirePlatformAdmin();
      } else {
        access.requireApplicationAuthorization();
        access.requirePermission(mutate
          ? 'application.roles:manage'
          : 'application.roles:read');
      }
      return;
    }
    const scope = access.requireTenant();
    if ((auth.tenantKind !== 'organization' && auth.tenantKind !== 'administration')
      || scope.tenantId !== auth.tenantId) {
      throw apiKeyForbidden();
    }
    access.requirePermission(mutate ? 'tenant.members:manage' : 'tenant.members:read');
  }

  private canAdministratorManage(auth: AuthContext): boolean {
    if ((auth.credentialKind ?? 'session') !== 'session') return false;
    const access = this.access(auth);
    if (this.options.authorization.tenancy.mode === 'single') {
      return this.options.authorization.authorization.mode === 'simple'
        ? auth.role === 'admin'
        : access.hasPermission('application.roles:manage');
    }
    return (auth.tenantKind === 'organization' || auth.tenantKind === 'administration')
      && Boolean(auth.tenantId)
      && access.hasPermission('tenant.members:manage');
  }

  private canPlatformManage(auth: AuthContext): boolean {
    if ((auth.credentialKind ?? 'session') !== 'session'
      || this.options.authorization.tenancy.mode !== 'multi'
      || auth.tenantKind !== 'administration') return false;
    const access = this.access(auth);
    return access.hasPermission('application.users:manage')
      && access.hasPermission('application.tenants:read');
  }

  private access(auth: AuthContext) {
    return createRequestAuthorizationAccess({
      authContext: auth,
      kernel: this.options.authorization,
      propertyStore: this.options.users,
      roleAssignments: this.options.roles,
    });
  }
}

function managementCapabilities(
  canIssue: boolean,
  canRotate: boolean,
  canRevoke: boolean,
): AuthApiKeyManagementCapabilities {
  return Object.freeze({ canIssue, canRotate, canRevoke });
}
