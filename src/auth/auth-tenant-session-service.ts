import { AuthSessionContinuationStore } from './auth-session-continuation-store';
import type { WebSessionBinding } from './auth-session-types';
import type {
  AuthTenantCreateInput,
  AuthTenantListResult,
  AuthTenantSessionCompletion,
  AuthTenantSummary,
  TenantOnboardingCompletion,
} from './auth-tenant-session-types';
import type { TokenService } from './token-service';
import type { TenancyService } from './tenancy/tenancy-service';
import type { ActiveTenantMembership } from './tenancy/tenancy-types';
import type { TenantCreationResult } from './tenancy/tenancy-types';
import {
  canUserCreateTenant,
  mapTenantCreationError,
  normalizeTenantCreateFields,
  requireUserCanCreateTenant,
  toTenantSummary as toCreatedTenantSummary,
} from './auth-tenant-creation';
import { AuthError, type ResolvedAuthBehaviorConfig, type UserRecord } from './types';
import type { UserStore } from './user-store';
import type { AuthUserProfileCompletionService } from './auth-user-profile-completion-service';
import type { WebSessionIssueOptions } from './auth-session-types';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import {
  AuthAuditService,
  captureAuthAuditRequestContext,
} from './auth-audit-service';
import type { AuthAuditRequestContext } from './auth-audit-types';
import type { AuthorizationKernel } from './authorization-kernel';
import type { AuthorizationRoleService } from './authorization-role-service';
import { createRequestAuthorizationAccess } from './authorization-access';
import {
  captureAuthApplicationMutationAuthority,
  type AssertAuthApplicationMutationAuthority,
} from './auth-application-mutation-authority';

export const TENANT_SELECTION_CONTINUATION_TTL_MS = 5 * 60_000;
export const TENANT_ONBOARDING_CONTINUATION_TTL_MS = 10 * 60_000;

/**
 * Single completion boundary for browser identity proof, tenant binding, and
 * refresh-family-backed tenant switching.
 */
export class AuthTenantSessionService {
  private profileCompletion: AuthUserProfileCompletionService | null = null;
  setProfileCompletionService(service: AuthUserProfileCompletionService): void { this.profileCompletion = service; }
  constructor(
    readonly continuations: AuthSessionContinuationStore,
    private readonly authConfig: ResolvedAuthBehaviorConfig,
    private readonly tenancy: TenancyService | null,
    private readonly users: UserStore,
    private readonly tokens: TokenService,
    private readonly audit: AuthAuditService,
    private readonly kernel: AuthorizationKernel,
    private readonly roles: AuthorizationRoleService | null,
  ) {}

  /** Finish password/email/MFA authentication without bypassing tenant choice. */
  async complete(
    user: UserRecord,
    explicitBinding: WebSessionBinding | undefined,
    mfaVerifiedAt: number | null,
    expectedAuthGeneration: number,
    admit?: () => boolean,
  ): Promise<AuthTenantSessionCompletion> {
    const authGeneration = this.requireCompletionAuthGeneration(
      user.userId,
      expectedAuthGeneration,
    );
    const gate = this.profileCompletion?.gate(user.userId, authGeneration, mfaVerifiedAt, explicitBinding);
    if (gate) return gate;
    if (this.tenancyMode === 'single') {
      if (explicitBinding) {
        throw new AuthError(
          'Tenant session binding is unavailable in single-tenant mode',
          'INVALID_TENANT_SESSION_BINDING',
          403,
        );
      }
      return {
        kind: 'session',
        tokens: await this.issueCompletionTokens(user, {
          mfaVerifiedAt,
          expectedAuthGeneration: authGeneration,
        }, admit),
      };
    }

    const tenancy = this.requireTenancy();
    if (explicitBinding) {
      const active = this.requireActiveBinding(user.userId, explicitBinding);
      return {
        kind: 'session',
        tokens: await this.issueCompletionTokens(user, {
          binding: explicitBinding,
          mfaVerifiedAt,
          expectedAuthGeneration: authGeneration,
        }, admit),
        tenant: toTenantSummary(active),
      };
    }

    const memberships = tenancy.listActiveTenantMembershipsForUser(user.userId);
    if (memberships.length === 0) {
      return this.users.transaction(() => { this.admitCompletion(admit);
        return this.createOnboardingCompletion(user, mfaVerifiedAt, authGeneration); });
    }
    if (memberships.length === 1) {
      const active = memberships[0]!;
      return {
        kind: 'session',
        tokens: await this.issueCompletionTokens(user, {
          binding: toBinding(active),
          mfaVerifiedAt,
          expectedAuthGeneration: authGeneration,
        }, admit),
        tenant: toTenantSummary(active),
      };
    }

    return this.users.transaction(() => {
    this.admitCompletion(admit);
    const created = this.continuations.create({
      userId: user.userId,
      purpose: 'tenant_selection',
      authGeneration,
      mfaVerifiedAt,
      ttlMs: TENANT_SELECTION_CONTINUATION_TTL_MS,
    });
    return {
      kind: 'tenant_selection_required',
      continuation: created.continuation,
      expiresAt: created.record.expiresAt,
      tenants: memberships.map(toTenantSummary),
    };
    });
  }

  private admitCompletion(admit?: () => boolean): void {
    if (admit && !invokeSynchronousAuthCallback(admit, { component: 'tenant-session',
      invariant: 'profile-completion-admission-async', message: '[auth] Completion admission must be synchronous.' })) {
      throw new AuthError('Profile completion authorization changed', 'AUTH_PROFILE_COMPLETION_INVALID', 409);
    }
  }
  private async issueCompletionTokens(user: UserRecord, options: WebSessionIssueOptions, admit?: () => boolean) {
    if (!admit) return this.tokens.issueTokenPair(user, options);
    const tokens = await this.tokens.issueTokenPairAfterAdmission(user, options, admit);
    if (!tokens) throw new AuthError('Profile completion authorization changed', 'AUTH_PROFILE_COMPLETION_INVALID', 409);
    return tokens;
  }

  /** Consume one identity-only continuation and mint exactly one bound session. */
  async selectTenant(
    rawContinuation: string,
    tenantId: string,
    auditRequest?: AuthAuditRequestContext,
  ): Promise<{
    user: UserRecord;
    completion: Extract<AuthTenantSessionCompletion, { kind: 'session' }>;
  }> {
    const capturedAuditRequest = captureAuthAuditRequestContext(auditRequest);
    if (this.tenancyMode !== 'multi') {
      throw new AuthError(
        'Tenant selection is unavailable in single-tenant mode',
        'TENANT_SELECTION_UNAVAILABLE',
        404,
      );
    }
    const record = this.continuations.inspect(rawContinuation, 'tenant_selection');
    if (!record) throw invalidSelectionContinuation();
    const user = this.users.getUserById(record.userId);
    if (!user || this.users.getAuthGeneration(user.userId) !== record.authGeneration) {
      throw invalidSelectionContinuation();
    }
    const active = this.requireActiveTenantForUser(user.userId, tenantId);
    const tokens = await this.tokens.issueTokenPairAfterAdmission(
      user,
      {
        binding: toBinding(active),
        mfaVerifiedAt: record.mfaVerifiedAt,
        expectedAuthGeneration: record.authGeneration,
      },
      () => {
        if (this.users.getAuthGeneration(user.userId) !== record.authGeneration) {
          return false;
        }
        if (!this.continuations.consumeInspected(
          record,
          'tenant_selection',
          user.userId,
          record.authGeneration,
        )) return false;
        this.audit.append({
          action: 'session.tenant-selected',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId: active.tenant.tenantId },
          actor: { userId: user.userId, provenance: 'authenticated-request' },
          request: capturedAuditRequest,
          target: { type: 'tenant-membership', id: active.membership.membershipId },
        });
        return true;
      },
    );
    if (!tokens) throw invalidSelectionContinuation();
    return {
      user,
      completion: { kind: 'session', tokens, tenant: toTenantSummary(active) },
    };
  }

  /**
   * Create a protected tenant owner boundary and bind a browser session in the
   * same commit. Callers prove either a pre-session onboarding continuation or
   * the currently active refresh family; actor and owner are always derived.
   */
  async createTenant(input: AuthTenantCreateInput & {
    auditRequest?: AuthAuditRequestContext;
  }): Promise<{
    user: UserRecord;
    tokens: { accessToken: string; refreshToken: string };
    tenant: AuthTenantSummary;
  }> {
    const auditRequest = captureAuthAuditRequestContext(input.auditRequest);
    if (this.tenancyMode !== 'multi') {
      throw new AuthError(
        'Organization creation is unavailable',
        'TENANT_CREATION_UNAVAILABLE',
        404,
      );
    }
    const hasContinuation = Boolean(input.continuation);
    const hasRefresh = Boolean(input.refreshToken);
    if (hasContinuation === hasRefresh) {
      throw new AuthError(
        'Provide exactly one organization creation proof',
        'TENANT_CREATION_PROOF_INVALID',
        422,
      );
    }
    const fields = normalizeTenantCreateFields(input.name, input.slug);
    return hasContinuation
      ? this.createTenantFromContinuation(input.continuation!, fields, auditRequest)
      : this.createTenantFromRefresh(input.refreshToken!, fields, auditRequest);
  }

  /** List live tenant choices only after proving the current refresh family. */
  resolveTenantList(rawRefreshToken: string): AuthTenantListResult {
    const proof = this.tokens.resolveWebRefreshProof(rawRefreshToken);
    if (!proof || proof.session.scopeKind !== 'tenant' || !proof.session.tenantId) {
      throw invalidRefreshProof();
    }
    const memberships = this.requireTenancy()
      .listActiveTenantMembershipsForUser(proof.user.userId);
    return {
      activeTenantId: proof.session.tenantId,
      tenants: memberships.map(toTenantSummary),
    };
  }

  /** Replace the current parent and refresh child with a newly bound family. */
  async switchTenant(
    rawRefreshToken: string,
    tenantId: string,
    auditRequest?: AuthAuditRequestContext,
  ): Promise<{
    user: UserRecord;
    tokens: { accessToken: string; refreshToken: string };
    tenant: AuthTenantSummary;
  }> {
    const capturedAuditRequest = captureAuthAuditRequestContext(auditRequest);
    if (this.tenancyMode !== 'multi') {
      throw new AuthError(
        'Tenant switching is unavailable in single-tenant mode',
        'TENANT_SWITCH_UNAVAILABLE',
        404,
      );
    }
    const proof = this.tokens.resolveWebRefreshProof(rawRefreshToken);
    if (!proof || proof.session.scopeKind !== 'tenant' || !proof.session.tenantId) {
      throw invalidRefreshProof();
    }
    if (proof.session.tenantId === tenantId) {
      throw new AuthError('Tenant is already active', 'TENANT_ALREADY_ACTIVE', 409);
    }
    const active = this.requireActiveTenantForUser(proof.user.userId, tenantId);
    const switched = await this.tokens.replaceWebSession(
      rawRefreshToken,
      toBinding(active),
      undefined,
      ({ user, previous }) => {
        this.audit.append({
          action: 'session.tenant-switched',
          outcome: 'succeeded',
          scope: { kind: 'tenant', tenantId: active.tenant.tenantId },
          actor: {
            userId: user.userId,
            membershipId: previous.membershipId ?? undefined,
            sessionId: previous.sessionId,
            sessionKind: 'web',
            provenance: 'authenticated-request',
          },
          request: capturedAuditRequest,
          target: { type: 'tenant-membership', id: active.membership.membershipId },
        });
      },
    );
    if (!switched) throw invalidRefreshProof();
    return {
      user: switched.user,
      tokens: switched.tokens,
      tenant: toTenantSummary(active),
    };
  }

  /**
   * Build a fresh identity-bound onboarding continuation after every account
   * gate. Tenant creation is one optional consumer of this proof, not the
   * condition for issuing it: invitations and join requests also need a safe
   * post-login/post-MFA identity proof when creation is disabled.
   */
  createOnboardingCompletion(
    user: UserRecord,
    mfaVerifiedAt: number | null,
    expectedAuthGeneration: number,
  ): TenantOnboardingCompletion {
    const authGeneration = this.requireCompletionAuthGeneration(
      user.userId,
      expectedAuthGeneration,
    );
    const created = this.continuations.create({
      userId: user.userId,
      purpose: 'tenant_onboarding',
      authGeneration,
      mfaVerifiedAt,
      ttlMs: TENANT_ONBOARDING_CONTINUATION_TTL_MS,
    });
    if (!canUserCreateTenant(this.authConfig, user)) {
      return {
        kind: 'tenant_onboarding_required',
        onboarding: {
          reason: 'no_active_tenant_membership',
          continuation: created.continuation,
          expiresAt: created.record.expiresAt,
          tenantCreation: { allowed: false },
        },
      };
    }
    return {
      kind: 'tenant_onboarding_required',
      onboarding: {
        reason: 'no_active_tenant_membership',
        continuation: created.continuation,
        expiresAt: created.record.expiresAt,
        tenantCreation: {
          allowed: true,
          continuation: created.continuation,
          expiresAt: created.record.expiresAt,
        },
      },
    };
  }

  private async createTenantFromContinuation(
    rawContinuation: string,
    fields: { name: string; slug: string },
    auditRequest?: AuthAuditRequestContext,
  ) {
    const record = this.continuations.inspect(rawContinuation, 'tenant_onboarding');
    if (!record) throw invalidOnboardingContinuation();
    const user = this.users.getUserById(record.userId);
    if (!user || this.users.getAuthGeneration(user.userId) !== record.authGeneration) {
      throw invalidOnboardingContinuation();
    }
    // A pre-session identity continuation has no live administration
    // membership. `platform-admin` creation therefore cannot be bootstrapped
    // from this proof; only the initial system bootstrap bypasses the policy.
    requireUserCanCreateTenant(this.authConfig, user, false);
    const tenancy = this.requireTenancy();
    const prepared = tenancy.prepareTenant({
      ...fields,
      ownerUserId: user.userId,
      createdBy: user.userId,
    });
    let created: TenantCreationResult | null = null;
    try {
      const tokens = await this.tokens.issueTokenPairAfterAdmission(
        user,
        {
          binding: {
            tenantId: prepared.tenantId,
            membershipId: prepared.membershipId,
            tenantAuthorizationGeneration: 0,
            membershipAuthorizationGeneration: 0,
          },
          mfaVerifiedAt: record.mfaVerifiedAt,
          expectedAuthGeneration: record.authGeneration,
        },
        () => {
          const current = this.users.getUserById(user.userId);
          if (!current || this.users.getAuthGeneration(user.userId) !== record.authGeneration) {
            return false;
          }
          requireUserCanCreateTenant(this.authConfig, current, false);
          if (!this.continuations.consumeInspected(
            record,
            'tenant_onboarding',
            user.userId,
            record.authGeneration,
          )) return false;
          created = tenancy.persistPreparedTenant(prepared);
          this.audit.append({
            action: 'tenant.created',
            outcome: 'succeeded',
            scope: { kind: 'tenant', tenantId: created.tenant.tenantId },
            actor: { userId: user.userId, provenance: 'authenticated-request' },
            request: auditRequest,
            target: { type: 'tenant', id: created.tenant.tenantId },
            metadata: { 'owner-membership-id': created.ownerMembership.membershipId },
          });
          return true;
        },
      );
      if (!tokens || !created) throw invalidOnboardingContinuation();
      return { user, tokens, tenant: toCreatedTenantSummary(created) };
    } catch (error) {
      throw mapTenantCreationError(error);
    }
  }

  private async createTenantFromRefresh(
    rawRefreshToken: string,
    fields: { name: string; slug: string },
    auditRequest?: AuthAuditRequestContext,
  ) {
    const proof = this.tokens.resolveWebRefreshProof(rawRefreshToken);
    if (!proof) throw invalidRefreshProof();
    const assertPlatformAuthority = this.capturePlatformTenantCreationAuthority(
      rawRefreshToken,
    );
    requireUserCanCreateTenant(
      this.authConfig,
      proof.user,
      assertPlatformAuthority !== null,
    );
    const tenancy = this.requireTenancy();
    const prepared = tenancy.prepareTenant({
      ...fields,
      ownerUserId: proof.user.userId,
      createdBy: proof.user.userId,
    });
    let created: TenantCreationResult | null = null;
    try {
      const replaced = await this.tokens.replaceWebSession(
        rawRefreshToken,
        {
          tenantId: prepared.tenantId,
          membershipId: prepared.membershipId,
          tenantAuthorizationGeneration: 0,
          membershipAuthorizationGeneration: 0,
        },
        () => {
          const current = this.users.getUserById(proof.user.userId);
          if (!current) return false;
          if (assertPlatformAuthority) {
            assertPlatformAuthority(['application.tenants:manage']);
          }
          requireUserCanCreateTenant(
            this.authConfig,
            current,
            assertPlatformAuthority !== null,
          );
          created = tenancy.persistPreparedTenant(prepared);
          this.audit.append({
            action: 'tenant.created',
            outcome: 'succeeded',
            scope: { kind: 'tenant', tenantId: created.tenant.tenantId },
            actor: {
              userId: proof.user.userId,
              membershipId: proof.session.membershipId ?? undefined,
              sessionId: proof.session.sessionId,
              sessionKind: 'web',
              provenance: 'authenticated-request',
            },
            request: auditRequest,
            target: { type: 'tenant', id: created.tenant.tenantId },
            metadata: { 'owner-membership-id': created.ownerMembership.membershipId },
          });
          return true;
        },
      );
      if (!replaced || !created) throw invalidRefreshProof();
      return {
        user: replaced.user,
        tokens: replaced.tokens,
        tenant: toCreatedTenantSummary(created),
      };
    } catch (error) {
      throw mapTenantCreationError(error);
    }
  }

  private requireCompletionAuthGeneration(
    userId: string,
    expectedAuthGeneration: number,
  ): number {
    const current = this.users.getAuthGeneration(userId);
    if (current !== expectedAuthGeneration) {
      throw authenticationStateChanged();
    }
    return expectedAuthGeneration;
  }

  private get tenancyMode() {
    return this.authConfig.tenancy?.mode ?? 'single';
  }

  private capturePlatformTenantCreationAuthority(
    rawRefreshToken: string,
  ): AssertAuthApplicationMutationAuthority | null {
    if (this.authConfig.tenancy?.creation.mode !== 'platform-admin') return null;
    const auth = this.tokens.resolveWebRefreshAuthContext(rawRefreshToken);
    if (!auth) throw invalidRefreshProof();
    const access = createRequestAuthorizationAccess({
      authContext: auth,
      kernel: this.kernel,
      propertyStore: this.users,
      roleAssignments: this.roles,
    });
    access.requireApplicationAuthorization();
    access.requirePermission('application.tenants:manage');
    return captureAuthApplicationMutationAuthority({
      auth,
      tokenService: this.tokens,
      kernel: this.kernel,
      store: this.users,
      roles: this.roles,
    });
  }

  private requireActiveBinding(
    userId: string,
    binding: WebSessionBinding,
  ): ActiveTenantMembership {
    const active = this.requireActiveTenantForUser(userId, binding.tenantId);
    if (active.membership.membershipId !== binding.membershipId) {
      throw new AuthError(
        'Tenant session binding is invalid',
        'INVALID_TENANT_SESSION_BINDING',
        403,
      );
    }
    return active;
  }

  private requireActiveTenantForUser(
    userId: string,
    tenantId: string,
  ): ActiveTenantMembership {
    const tenancy = this.requireTenancy();
    const tenant = tenancy.getTenant(tenantId);
    const membership = tenancy.getMembership(tenantId, userId);
    if (!tenant || !membership || tenant.status !== 'active'
      || membership.status !== 'active') {
      throw new AuthError(
        'Tenant selection is no longer available',
        'TENANT_SELECTION_INVALID',
        403,
      );
    }
    return { tenant, membership };
  }

  private requireTenancy(): TenancyService {
    if (!this.tenancy) {
      throw new AuthError('Tenant services are not initialized', 'AUTH_NOT_READY', 503);
    }
    return this.tenancy;
  }
}

function toBinding(active: ActiveTenantMembership): WebSessionBinding {
  return {
    tenantId: active.tenant.tenantId,
    membershipId: active.membership.membershipId,
  };
}

function toTenantSummary(active: ActiveTenantMembership): AuthTenantSummary {
  return {
    tenantId: active.tenant.tenantId,
    kind: active.tenant.kind,
    slug: active.tenant.slug,
    name: active.tenant.name,
    role: active.membership.roleKey,
  };
}

function invalidSelectionContinuation(): AuthError {
  return new AuthError(
    'Tenant selection has expired or was already used',
    'TENANT_SELECTION_CONTINUATION_INVALID',
    401,
  );
}

function invalidOnboardingContinuation(): AuthError {
  return new AuthError(
    'Organization setup has expired or was already used',
    'TENANT_ONBOARDING_CONTINUATION_INVALID',
    401,
  );
}

function invalidRefreshProof(): AuthError {
  return new AuthError(
    'Current session proof is invalid or expired',
    'INVALID_REFRESH_TOKEN',
    401,
  );
}

function authenticationStateChanged(): AuthError {
  return new AuthError(
    'Authentication state changed; sign in again',
    'AUTH_STATE_CHANGED',
    409,
  );
}
