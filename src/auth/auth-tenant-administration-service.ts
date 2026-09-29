import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthorizationKernel, AuthorizationScopeSnapshot } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { AuthTenantAdministrationAuthority } from './auth-tenant-administration-authority';
import { AuthTenantAdministrationMutations } from './auth-tenant-administration-mutations';
import { AuthTenantAdministrationReadModel } from './auth-tenant-administration-read-model';
import { AuthTenantAdministrationRolePolicy } from './auth-tenant-administration-role-policy';
import type {
  AuthTenantAdministrationConfig,
  AuthTenantMemberListInput,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
} from './auth-tenant-administration-types';
import type { AuthAuditRequestContext } from './auth-audit-types';
import type { AuthAuditService } from './auth-audit-service';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import type { AssertAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import type { UserStore } from './user-store';
import type { TenancyService } from './tenancy/tenancy-service';
import type { TenantMembershipStatus } from './tenancy/tenancy-types';

/**
 * Headless tenant-member control plane.
 *
 * HTTP adapters must supply the tenant from a live request scope. Every
 * membership relationship is checked again behind this façade so another
 * adapter cannot turn an opaque membership id into cross-tenant authority.
 */
export class AuthTenantAdministrationService {
  private readonly readModel: AuthTenantAdministrationReadModel;
  private readonly mutations: AuthTenantAdministrationMutations;

  constructor(
    db: ReactiveDB,
    kernel: AuthorizationKernel,
    users: UserStore,
    tenancy: TenancyService,
    roles: AuthorizationRoleService | null,
    audit: AuthAuditService,
    emitCode?: AuthPlatformCodeEmitter,
  ) {
    const authority = new AuthTenantAdministrationAuthority(
      users,
      tenancy,
      emitCode,
    );
    const rolePolicy = new AuthTenantAdministrationRolePolicy(
      kernel,
      tenancy,
      roles,
      authority,
    );
    this.readModel = new AuthTenantAdministrationReadModel(
      db,
      kernel,
      tenancy,
      authority,
      rolePolicy,
    );
    this.mutations = new AuthTenantAdministrationMutations(
      db,
      kernel,
      users,
      tenancy,
      audit,
      authority,
      rolePolicy,
      this.readModel,
    );
  }

  getConfig(input: {
    tenantId: string;
    membershipId: string;
    scope: AuthorizationScopeSnapshot;
    applicationScope?: AuthorizationScopeSnapshot | null;
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority;
  }): AuthTenantAdministrationConfig {
    return this.readModel.getConfig(input);
  }

  listMembers(
    tenantId: string,
    input: AuthTenantMemberListInput = {},
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority,
  ): AuthTenantMemberPage {
    return this.readModel.listMembers(tenantId, input, assertCurrentAuthority);
  }

  addMember(input: {
    tenantId: string;
    email: string;
    roleKeys?: readonly string[];
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantMemberMutationResult {
    return this.mutations.addMember(input);
  }

  updateMember(input: {
    tenantId: string;
    membershipId: string;
    status?: Extract<TenantMembershipStatus, 'active' | 'suspended'>;
    roleKeys?: readonly string[];
    expectedRoleRevision?: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantMemberMutationResult {
    return this.mutations.updateMember(input);
  }

  removeMember(input: {
    tenantId: string;
    membershipId: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantMemberMutationResult {
    return this.mutations.removeMember(input);
  }

  transferOwnership(input: {
    tenantId: string;
    targetMembershipId: string;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantOwnershipTransferResult {
    return this.mutations.transferOwnership(input);
  }
}
