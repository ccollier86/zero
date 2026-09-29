import type { ReactiveDB } from '../sync/reactive-db';
import type {
  AuthorizationKernel,
  AuthorizationScopeSnapshot,
} from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { canonicalizeEmail } from './auth-email-identity';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import {
  AuthAuditService,
  authAuditActorFromContext,
  captureAuthAuditActor,
  captureAuthAuditRequestContext,
} from './auth-audit-service';
import type { AuthAuditActor, AuthAuditRequestContext } from './auth-audit-types';
import {
  canSubmitGenericJoinRequest,
  AuthTenantJoinRequestProjection,
} from './auth-tenant-join-request-projection';
import { AuthTenantJoinRequestStore } from './auth-tenant-join-request-store';
import type {
  AssertAuthTenantMutationAuthority,
  AuthTenantMutationAuthority,
} from './auth-tenant-mutation-authority';
import {
  decodeCursor,
  encodeCursor,
  normalizeLimit,
  normalizeJoinRequestPageStatus,
} from './auth-tenant-onboarding-codec';
import {
  normalizeAuthTenantOnboardingRoleKeys,
  snapshotAuthTenantOnboardingRoleKeys,
} from './auth-tenant-onboarding-role-policy';
import type {
  AuthTenantJoinRequest,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestRecord,
  AuthTenantJoinRequestStatus,
  ResolvedAuthTenantOnboardingConfig,
} from './auth-tenant-onboarding-types';
import { roleGrantCeilingFromAuthority } from './authorization-role-grant';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import type { TenancyService } from './tenancy/tenancy-service';
import { TenancyError, type TenantMembershipRecord } from './tenancy/tenancy-types';
import { AuthError, type PermissionKey, type UserRecord } from './types';
import type { UserStore } from './user-store';

/** Atomic tenant join-request workflow, independent from invitation delivery. */
export class AuthTenantJoinRequestService {
  private readonly store: AuthTenantJoinRequestStore;
  private readonly projection: AuthTenantJoinRequestProjection;

  constructor(
    private readonly db: ReactiveDB,
    private readonly config: ResolvedAuthTenantOnboardingConfig,
    private readonly kernel: AuthorizationKernel,
    private readonly users: UserStore,
    private readonly tenancy: TenancyService,
    private readonly roles: AuthorizationRoleService | null,
    private readonly audit: AuthAuditService,
    private readonly now: () => number = Date.now,
    private readonly emitCode?: AuthPlatformCodeEmitter,
  ) {
    this.store = new AuthTenantJoinRequestStore(db, now);
    this.projection = new AuthTenantJoinRequestProjection(kernel, tenancy, roles, now);
  }

  getTenantAuthorizationGeneration(tenantId: string): number {
    this.users.assertCurrentProfile();
    return this.requireActiveTenant(tenantId).authorizationGeneration;
  }

  submit(input: {
    userId: string;
    tenantSlug: string;
    admitIdentityProof?: () => boolean;
    auditActor?: AuthAuditActor;
    auditRequest?: AuthAuditRequestContext;
  }): { submitted: true } {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const admitIdentityProof = input.admitIdentityProof;
    const auditActor = captureAuthAuditActor(input.auditActor);
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const user = this.requireJoinRequestEligibleUser(input.userId);
    const tenant = safelyResolveTenant(this.tenancy, input.tenantSlug);
    if (!tenant || tenant.status !== 'active' || tenant.kind !== 'organization') {
      return { submitted: true };
    }

    this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.store.lockTenant(tenant.tenantId);
      if (admitIdentityProof && !invokeSynchronousAuthCallback(
        admitIdentityProof,
        {
          component: 'tenant-onboarding',
          invariant: 'join-request-identity-proof-async',
          message: '[auth] Join request identity proof admission must be synchronous.',
          emitCode: this.emitCode,
        },
      )) {
        throw new AuthError(
          'Onboarding proof is unavailable',
          'TENANT_ONBOARDING_PROOF_INVALID',
          400,
        );
      }
      const membership = this.tenancy.getMembership(tenant.tenantId, user.userId);
      const current = this.store.getByTenantUser(tenant.tenantId, user.userId);
      if (membership?.status === 'active') return;
      if (!current) {
        const now = this.now();
        const joinRequestId = `tjoin_${crypto.randomUUID()}`;
        this.store.insert({
          joinRequestId,
          tenantId: tenant.tenantId,
          userId: user.userId,
          email: canonicalizeEmail(user.email),
          now,
        });
        this.audit.append({
          action: 'tenant.join-request-submitted',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId: tenant.tenantId },
          actor: auditActor ?? {
            userId: user.userId,
            provenance: 'authenticated-request',
          },
          request: auditRequest,
          target: { type: 'tenant-join-request', id: joinRequestId },
        });
        return;
      }

      const now = this.now();
      const provenance = this.store.getAnyDomainProvenance(
        tenant.tenantId,
        current.joinRequestId,
      );
      if (current.status === 'pending') {
        // A pre-fence row cannot be guessed current. This explicit generic
        // submission retires it onto the old revision before creating a clean
        // generic revision. Current verified-domain submissions remain
        // idempotent and keep their server-fixed policy.
        if (provenance?.source !== 'legacy-unbound'
          || (provenance.request_revision !== null
            && provenance.request_revision !== current.requestRevision)) return;
        if (!canSubmitGenericJoinRequest({
          request: current,
          provenance,
          now,
          deniedRetryCooldownMs: this.config.verifiedDomains.deniedRetryCooldownMs,
        })) return;
        this.store.bindLegacyProvenanceToRevision(current, provenance);
        if (this.store.supersedePending(current, now) !== 1) throw joinRequestConflict();
      } else {
        if (!canSubmitGenericJoinRequest({
          request: current,
          provenance,
          now,
          deniedRetryCooldownMs: this.config.verifiedDomains.deniedRetryCooldownMs,
        })) return;
        this.store.bindLegacyProvenanceToRevision(current, provenance);
        if (this.store.reopen(current, now) !== 1) throw joinRequestConflict();
      }
      this.audit.append({
        action: 'tenant.join-request-submitted',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: tenant.tenantId },
        actor: auditActor ?? {
          userId: user.userId,
          provenance: 'authenticated-request',
        },
        request: auditRequest,
        target: { type: 'tenant-join-request', id: current.joinRequestId },
        metadata: { reopened: true },
      });
    });
    return { submitted: true };
  }

  list(input: {
    tenantId: string;
    status?: AuthTenantJoinRequestStatus;
    limit?: number;
    cursor?: string;
    approvalScope?: AuthorizationScopeSnapshot;
    approvalApplicationScope?: AuthorizationScopeSnapshot | null;
    assertCurrentAuthority?: AssertAuthTenantMutationAuthority;
  }): AuthTenantJoinRequestPage {
    const status = normalizeJoinRequestPageStatus(input.status);
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    this.users.assertCurrentProfile();
    this.requireEnabled();
    this.requireActiveOrganizationTenant(input.tenantId);
    const rows = this.store.listProjectionRows({
      tenantId: input.tenantId,
      status,
      cursor,
      limit,
    });
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    const requests = selected.map((row) => this.projection.project(
      row,
      input.approvalScope,
      input.approvalApplicationScope,
    ));
    const last = selected.at(-1);
    const result = {
      requests,
      page: {
        limit,
        count: requests.length,
        hasMore,
        nextCursor: hasMore && last
          ? encodeCursor({ timestamp: last.requested_at, id: last.join_request_id })
          : null,
      },
    };
    if (input.assertCurrentAuthority) {
      this.invokeAuthority(input.assertCurrentAuthority, ['tenant.join-requests:review']);
    }
    return result;
  }

  approve(input: {
    tenantId: string;
    joinRequestId: string;
    expectedRequestRevision: number;
    roleKeys?: readonly string[];
    reactivateMembership?: boolean;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantJoinRequest {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const tenantId = input.tenantId;
    const joinRequestId = input.joinRequestId;
    const expectedRequestRevision = input.expectedRequestRevision;
    const reactivateMembership = input.reactivateMembership;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    const inputRoleKeys: unknown = input.roleKeys;
    const suppliedRoleKeys = inputRoleKeys === undefined
      ? undefined
      : snapshotAuthTenantOnboardingRoleKeys(inputRoleKeys);
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.store.lockTenant(tenantId);
      const authority = this.requireMutationAuthority(
        tenantId,
        assertCurrentAuthority,
        ['tenant.join-requests:review'],
      );
      const tenant = this.requireActiveOrganizationTenant(tenantId);
      const request = this.requireJoinRequest(tenantId, joinRequestId);
      this.assertExpectedRequestRevision(request, expectedRequestRevision);
      const anyDomainProvenance = this.store.getAnyDomainProvenance(
        tenantId,
        request.joinRequestId,
      );
      if (anyDomainProvenance?.source === 'legacy-unbound'
        && (anyDomainProvenance.request_revision === null
          || anyDomainProvenance.request_revision === request.requestRevision)) {
        throw joinRequestProvenanceUnbound();
      }
      const domainProvenance = this.store.getVerifiedDomainProvenance(
        tenantId,
        request.joinRequestId,
        request.requestRevision,
      );
      if (domainProvenance && domainProvenance.blocked_until !== null
        && domainProvenance.blocked_until > this.now()) throw joinRequestBlocked();
      const approvalPolicy = this.getProjection(
        tenantId,
        joinRequestId,
        authority.scope,
        authority.applicationScope,
      ).approvalPolicy;
      if (!approvalPolicy.canApprove) throw forbidden();
      if (suppliedRoleKeys !== undefined
        && approvalPolicy.roleSelection.mode !== 'selectable') {
        throw serverOwnedJoinRequestRoles(approvalPolicy.roleSelection.mode);
      }
      const requestedRoleKeys = approvalPolicy.roleSelection.mode === 'selectable'
        ? suppliedRoleKeys === undefined
          ? approvalPolicy.roleSelection.defaultRoleKeys
          : suppliedRoleKeys
        : approvalPolicy.roleSelection.roles.map((role) => role.key);
      const roleKeys = normalizeAuthTenantOnboardingRoleKeys({
        kernel: this.kernel,
        roleKeys: requestedRoleKeys,
        ceiling: roleGrantCeilingFromAuthority(authority),
        tenantKind: tenant.kind,
      });
      if (request.status === 'approved') {
        if (domainProvenance && request.approvedMembershipId) {
          this.store.recordDomainMembershipProvenance(
            request.approvedMembershipId,
            request.joinRequestId,
            domainProvenance,
          );
        }
        return this.getProjection(
          tenantId,
          joinRequestId,
          authority.scope,
          authority.applicationScope,
        );
      }
      if (request.status !== 'pending') throw joinRequestConflict();
      const user = this.requireEligibleUser(request.userId);
      let membership = this.tenancy.getMembership(tenantId, user.userId);
      if (!membership) {
        membership = this.tenancy.addMembership({
          tenantId,
          userId: user.userId,
          roleKey: roleKeys[0]!,
          createdBy: authority.auth.userId,
        });
        if (this.kernel.authorization.mode === 'advanced') {
          this.requireAdvancedRoles().replaceTenantRoles({
            tenantId,
            membershipId: membership.membershipId,
            roleKeys,
            changedBy: authority.auth.userId,
          });
          membership = this.tenancy.getMembershipById(membership.membershipId)!;
        }
      } else if (membership.status !== 'active') {
        if (reactivateMembership !== true) {
          throw new AuthError(
            'Explicit retained-membership reactivation is required',
            'TENANT_JOIN_REACTIVATION_REQUIRED',
            409,
          );
        }
        membership = this.readmitMembership(membership, roleKeys, authority.auth.userId);
      }
      const now = this.now();
      if (this.store.approve({
        request,
        expectedRequestRevision,
        reviewedBy: authority.auth.userId,
        membershipId: membership.membershipId,
        now,
      }) !== 1) throw joinRequestConflict();
      if (domainProvenance) {
        this.store.recordDomainMembershipProvenance(
          membership.membershipId,
          request.joinRequestId,
          domainProvenance,
        );
      }
      this.audit.append({
        action: 'tenant.join-request-approved',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: auditRequest,
        target: { type: 'tenant-join-request', id: request.joinRequestId },
        metadata: {
          'membership-id': membership.membershipId,
          'role-count': roleKeys.length,
        },
      });
      return this.getProjection(
        tenantId,
        joinRequestId,
        authority.scope,
        authority.applicationScope,
      );
    });
  }

  deny(input: {
    tenantId: string;
    joinRequestId: string;
    expectedRequestRevision: number;
    assertCurrentAuthority: AssertAuthTenantMutationAuthority;
    auditRequest?: AuthAuditRequestContext;
  }): AuthTenantJoinRequest {
    this.users.assertCurrentProfile();
    this.requireEnabled();
    const tenantId = input.tenantId;
    const joinRequestId = input.joinRequestId;
    const expectedRequestRevision = input.expectedRequestRevision;
    const assertCurrentAuthority = input.assertCurrentAuthority;
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    return this.db.transaction(() => {
      this.users.assertCurrentProfile();
      this.store.lockTenant(tenantId);
      const authority = this.requireMutationAuthority(
        tenantId,
        assertCurrentAuthority,
        ['tenant.join-requests:review'],
      );
      this.requireActiveOrganizationTenant(tenantId);
      const request = this.requireJoinRequest(tenantId, joinRequestId);
      this.assertExpectedRequestRevision(request, expectedRequestRevision);
      if (request.status === 'denied') {
        return this.getProjection(
          tenantId,
          joinRequestId,
          authority.scope,
          authority.applicationScope,
        );
      }
      if (request.status !== 'pending') throw joinRequestConflict();
      const now = this.now();
      if (this.store.deny({
        request,
        expectedRequestRevision,
        reviewedBy: authority.auth.userId,
        now,
      }) !== 1) throw joinRequestConflict();
      this.store.blockVerifiedDomainProvenance({
        request,
        expectedRequestRevision,
        blockedUntil: now + this.config.verifiedDomains.deniedRetryCooldownMs,
        now,
      });
      this.audit.append({
        action: 'tenant.join-request-denied',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: authAuditActorFromContext(authority.auth),
        request: auditRequest,
        target: { type: 'tenant-join-request', id: request.joinRequestId },
      });
      return this.getProjection(
        tenantId,
        joinRequestId,
        authority.scope,
        authority.applicationScope,
      );
    });
  }

  private getProjection(
    tenantId: string,
    joinRequestId: string,
    approvalScope?: AuthorizationScopeSnapshot,
    approvalApplicationScope?: AuthorizationScopeSnapshot | null,
  ): AuthTenantJoinRequest {
    const row = this.store.getProjectionRow(tenantId, joinRequestId);
    if (!row) {
      throw new AuthError('Join request not found', 'TENANT_JOIN_REQUEST_NOT_FOUND', 404);
    }
    return this.projection.project(row, approvalScope, approvalApplicationScope);
  }

  private requireJoinRequest(
    tenantId: string,
    joinRequestId: string,
  ): AuthTenantJoinRequestRecord {
    const request = this.store.getById(tenantId, joinRequestId);
    if (!request) {
      throw new AuthError('Join request not found', 'TENANT_JOIN_REQUEST_NOT_FOUND', 404);
    }
    return request;
  }

  private readmitMembership(
    membership: TenantMembershipRecord,
    roleKeys: readonly string[],
    changedBy: string,
  ): TenantMembershipRecord {
    let admitted = this.tenancy.readmitMembership(
      membership.membershipId,
      this.kernel.authorization.mode === 'simple' ? roleKeys[0]! : 'member',
    );
    if (this.kernel.authorization.mode === 'advanced') {
      this.requireAdvancedRoles().replaceTenantRoles({
        tenantId: membership.tenantId,
        membershipId: membership.membershipId,
        roleKeys,
        changedBy,
      });
      admitted = this.tenancy.getMembershipById(membership.membershipId)!;
    }
    return admitted;
  }

  private requireMutationAuthority(
    tenantId: string,
    assertCurrentAuthority: AssertAuthTenantMutationAuthority,
    permissions: readonly PermissionKey[],
  ): AuthTenantMutationAuthority {
    const authority = this.invokeAuthority(assertCurrentAuthority, permissions);
    if (authority.scope.tenantId !== tenantId) throw forbidden();
    this.requireActiveTenant(tenantId);
    const membership = this.tenancy.getMembershipById(authority.scope.membershipId);
    if (!membership || membership.tenantId !== tenantId
      || membership.userId !== authority.auth.userId
      || membership.status !== 'active') throw forbidden();
    return authority;
  }

  private invokeAuthority(
    assertion: AssertAuthTenantMutationAuthority,
    permissions: readonly PermissionKey[],
  ): AuthTenantMutationAuthority {
    return invokeSynchronousAuthCallback(
      () => assertion(permissions),
      {
        component: 'auth-tenant-onboarding-service',
        invariant: 'authority-callback-async',
        message: '[auth] Tenant onboarding authority callback must be synchronous.',
        emitCode: this.emitCode,
      },
    );
  }

  private requireActiveTenant(tenantId: string) {
    const tenant = this.tenancy.getTenant(tenantId);
    if (!tenant || tenant.status !== 'active') throw forbidden();
    return tenant;
  }

  private requireActiveOrganizationTenant(tenantId: string) {
    const tenant = this.requireActiveTenant(tenantId);
    if (tenant.kind !== 'organization') throw forbidden();
    return tenant;
  }

  private requireEligibleUser(userId: string): UserRecord {
    const user = this.users.getUserById(userId);
    if (!user || user.status !== 'active') throw invitationUnavailable();
    if (user.passwordChangeRequired) {
      throw new AuthError('Password change required', 'PASSWORD_CHANGE_REQUIRED', 403);
    }
    return user;
  }

  private requireJoinRequestEligibleUser(userId: string): UserRecord {
    const user = this.requireEligibleUser(userId);
    if (user.emailVerificationRequired && user.emailVerifiedAt === null) {
      throw new AuthError(
        'Email verification required',
        'EMAIL_VERIFICATION_REQUIRED',
        403,
      );
    }
    return user;
  }

  private assertExpectedRequestRevision(
    request: AuthTenantJoinRequestRecord,
    expected: number,
  ): void {
    if (!Number.isSafeInteger(expected) || expected < 1
      || request.requestRevision !== expected) throw joinRequestRevisionConflict();
  }

  private requireAdvancedRoles(): AuthorizationRoleService {
    if (!this.roles) {
      throw new AuthError(
        'Advanced authorization services are unavailable',
        'AUTH_POLICY_UNAVAILABLE',
        503,
      );
    }
    return this.roles;
  }

  private requireEnabled(): void {
    if (!this.config.joinRequests.enabled) {
      throw new AuthError(
        'Tenant join requests are unavailable',
        'TENANT_JOIN_REQUESTS_UNAVAILABLE',
        404,
      );
    }
  }
}

function safelyResolveTenant(tenancy: TenancyService, slug: string) {
  try {
    return tenancy.getTenantBySlug(slug);
  } catch (error) {
    if (error instanceof TenancyError && error.code === 'TENANT_INVALID_SLUG') {
      return null;
    }
    throw error;
  }
}

function invitationUnavailable(): AuthError {
  return new AuthError(
    'Invitation is unavailable',
    'TENANT_INVITATION_UNAVAILABLE',
    400,
  );
}

function joinRequestConflict(): AuthError {
  return new AuthError(
    'Join request state changed; reload and try again',
    'TENANT_JOIN_REQUEST_STATUS_CONFLICT',
    409,
  );
}

function joinRequestRevisionConflict(): AuthError {
  return new AuthError(
    'Join request revision changed; reload and try again',
    'TENANT_JOIN_REQUEST_REVISION_CONFLICT',
    409,
  );
}

function joinRequestBlocked(): AuthError {
  return new AuthError(
    'Join request admission is temporarily blocked',
    'TENANT_JOIN_REQUEST_BLOCKED',
    409,
  );
}

function joinRequestProvenanceUnbound(): AuthError {
  return new AuthError(
    'Join request provenance must be refreshed before approval',
    'TENANT_JOIN_REQUEST_PROVENANCE_UNBOUND',
    409,
  );
}

function serverOwnedJoinRequestRoles(mode: 'fixed' | 'default'): AuthError {
  return new AuthError(
    mode === 'fixed'
      ? 'Verified-domain requests use the role fixed by the tenant policy'
      : 'This join request uses the server-owned default role',
    mode === 'fixed'
      ? 'AUTH_DOMAIN_REQUEST_ROLE_FIXED'
      : 'TENANT_JOIN_REQUEST_ROLE_SERVER_OWNED',
    409,
  );
}

function forbidden(): AuthError {
  return new AuthError('Forbidden', 'FORBIDDEN', 403);
}
