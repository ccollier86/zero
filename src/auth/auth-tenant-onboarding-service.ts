import type { ReactiveDB } from '../sync/reactive-db';
import type {
  AuthorizationKernel,
  AuthorizationScopeSnapshot,
} from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import type { AuthAuditService } from './auth-audit-service';
import type { AuthAuditActor, AuthAuditRequestContext } from './auth-audit-types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import {
  AuthTenantInvitationService,
  type AcceptedTenantInvitation,
  type PendingTenantInvitationAccount,
} from './auth-tenant-invitation-service';
import { AuthTenantJoinRequestService } from './auth-tenant-join-request-service';
import type { AssertAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import { defineAuthTenantOnboardingTables } from './auth-tenant-onboarding-schema';
import type {
  AuthTenantInvitation,
  AuthTenantInvitationCreated,
  AuthTenantInvitationDelivery,
  AuthTenantInvitationInspection,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestStatus,
  ResolvedAuthTenantOnboardingConfig,
} from './auth-tenant-onboarding-types';
import type { TenancyService } from './tenancy/tenancy-service';
import type { UserPropertyService } from './user-property-service';
import type { UserStore } from './user-store';

export type {
  AcceptedTenantInvitation,
  PendingTenantInvitationAccount,
} from './auth-tenant-invitation-service';

/**
 * Compatibility facade for tenant invitations and join requests.
 *
 * Invitation delivery and join-request workflows are deliberately separate
 * internal services. Existing callers retain one transport-neutral onboarding
 * API while each control plane owns its own persistence and orchestration.
 */
export class AuthTenantOnboardingService {
  private readonly invitations: AuthTenantInvitationService;
  private readonly joinRequests: AuthTenantJoinRequestService;

  constructor(
    db: ReactiveDB,
    readonly config: ResolvedAuthTenantOnboardingConfig,
    kernel: AuthorizationKernel,
    users: UserStore,
    properties: UserPropertyService,
    tenancy: TenancyService,
    roles: AuthorizationRoleService | null,
    audit: AuthAuditService,
    now: () => number = Date.now,
    emitCode?: AuthPlatformCodeEmitter,
  ) {
    defineAuthTenantOnboardingTables(db);
    this.invitations = new AuthTenantInvitationService(
      db,
      config,
      kernel,
      users,
      properties,
      tenancy,
      roles,
      audit,
      now,
      emitCode,
    );
    this.joinRequests = new AuthTenantJoinRequestService(
      db,
      config,
      kernel,
      users,
      tenancy,
      roles,
      audit,
      now,
      emitCode,
    );
  }

  /** Current tenant generation used for a freshly admitted session binding. */
  getTenantAuthorizationGeneration(tenantId: string): number {
    return this.joinRequests.getTenantAuthorizationGeneration(tenantId);
  }

  issueInvitation(
    input: Parameters<AuthTenantInvitationService['issue']>[0],
  ): AuthTenantInvitationCreated {
    return this.invitations.issue(input);
  }

  resolveInvitationDelivery(
    input: Parameters<AuthTenantInvitationService['resolveDelivery']>[0],
  ): AuthTenantInvitationDelivery | null {
    return this.invitations.resolveDelivery(input);
  }

  listInvitations(
    input: Parameters<AuthTenantInvitationService['list']>[0],
  ): { invitations: AuthTenantInvitation[]; page: AuthTenantJoinRequestPage['page'] } {
    return this.invitations.list(input);
  }

  revokeInvitation(
    input: Parameters<AuthTenantInvitationService['revoke']>[0],
  ): AuthTenantInvitation {
    return this.invitations.revoke(input);
  }

  inspectInvitation(rawToken: string): AuthTenantInvitationInspection {
    return this.invitations.inspect(rawToken);
  }

  acceptInvitationForUser(
    rawToken: string,
    userId: string,
    admitIdentityProof?: () => boolean,
    auditContext?: { actor?: AuthAuditActor; request?: AuthAuditRequestContext },
    expectedAuthGeneration?: number,
  ): AcceptedTenantInvitation {
    return this.invitations.accept(
      rawToken,
      userId,
      admitIdentityProof,
      auditContext,
      expectedAuthGeneration,
    );
  }

  createInvitationAccount(
    input: Parameters<AuthTenantInvitationService['createAccount']>[0],
  ): Promise<AcceptedTenantInvitation | PendingTenantInvitationAccount> {
    return this.invitations.createAccount(input);
  }

  submitJoinRequest(input: {
    userId: string;
    tenantSlug: string;
    admitIdentityProof?: () => boolean;
    auditActor?: AuthAuditActor;
    auditRequest?: AuthAuditRequestContext;
  }): { submitted: true } {
    return this.joinRequests.submit(input);
  }

  listJoinRequests(input: {
    tenantId: string;
    status?: AuthTenantJoinRequestStatus;
    limit?: number;
    cursor?: string;
    /** Live request scope used only for the reviewer-safe approval projection. */
    approvalScope?: AuthorizationScopeSnapshot;
    /** Paired live application scope for administration-organization grant ceilings. */
    approvalApplicationScope?: AuthorizationScopeSnapshot | null;
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority;
  }): AuthTenantJoinRequestPage {
    return this.joinRequests.list(input);
  }

  approveJoinRequest(input: {
    tenantId: string;
    joinRequestId: string;
    expectedRequestRevision: number;
    roleKeys?: readonly string[];
    reactivateMembership?: boolean;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantJoinRequest {
    return this.joinRequests.approve(input);
  }

  denyJoinRequest(input: {
    tenantId: string;
    joinRequestId: string;
    expectedRequestRevision: number;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantJoinRequest {
    return this.joinRequests.deny(input);
  }
}
