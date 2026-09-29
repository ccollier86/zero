import { AuthError, type AuthTenancyMode } from './types';
import { AuthSessionStore } from './auth-session-store';
import type {
  AuthSessionRecord,
  PreparedWebSessionBinding,
  PrepareWebSessionInput,
  ResolvedWebSessionAuthority,
  ResolveWebSessionInput,
  WebSessionBinding,
} from './auth-session-types';
import type { TenancyService } from './tenancy/tenancy-service';
import type { TenantKind } from './tenancy/tenancy-types';
import type { AuthAuditService } from './auth-audit-service';
import type {
  AuthAuditActorProvenance,
  AuthAuditRequestContext,
} from './auth-audit-types';
import { normalizeMfaVerifiedAt } from './mfa-assurance';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

const PERSISTENCE_ROLLBACK = new Error('auth-session-persistence-rollback');

/**
 * App-local durable authority for browser access, refresh, and page sessions.
 * Tenant bindings are selected and revalidated only from server-owned rows.
 */
export class AuthSessionService {
  private runtimeProfileGuard: (() => void) | null = null;
  private mfaAssuranceValidator: (session: AuthSessionRecord) => boolean = () => true;
  private rejectLegacyWithoutMfaAssurance = false;

  constructor(
    readonly store: AuthSessionStore,
    private readonly tenancyMode: AuthTenancyMode,
    private readonly tenancy: TenancyService | null,
    private readonly audit?: AuthAuditService,
    private readonly emitCode?: AuthPlatformCodeEmitter,
  ) {}

  /** Fence cached/direct service consumers to the committed profile generation. */
  setRuntimeProfileGuard(guard: () => void): void {
    this.runtimeProfileGuard = guard;
  }

  /** Install the live MFA policy used at issuance, refresh, and request resolution. */
  setMfaAssuranceValidator(
    validator: (session: AuthSessionRecord) => boolean,
    options: { rejectLegacyWithoutAssurance?: boolean } = {},
  ): void {
    this.mfaAssuranceValidator = validator;
    this.rejectLegacyWithoutMfaAssurance =
      options.rejectLegacyWithoutAssurance === true;
  }

  /** Prepare a signed-token snapshot; persistence happens atomically later. */
  prepareWebSession(input: PrepareWebSessionInput): AuthSessionRecord {
    this.assertCurrentProfile();
    const now = Date.now();
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) {
      throw new AuthError('Session expiry is invalid', 'AUTH_SESSION_INVALID', 500);
    }
    const scope = this.resolveIssuanceScope(input.userId, input.binding);
    return {
      sessionId: `ses_${crypto.randomUUID()}`,
      userId: input.userId,
      kind: 'web',
      status: 'active',
      generation: 0,
      ...scope,
      provenance: 'local',
      authenticatedAt: input.authenticatedAt ?? now,
      mfaVerifiedAt: normalizeMfaVerifiedAt(input.mfaVerifiedAt, now),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: input.expiresAt,
      revokedAt: null,
      revocationReason: null,
    };
  }

  /**
   * Persist a prepared parent and its first refresh child in one transaction.
   * A false child insert rolls the parent insert back instead of orphaning it.
   */
  persistPreparedWebSession(
    prepared: AuthSessionRecord,
    persistRefresh: () => boolean,
    admit: () => boolean = () => true,
  ): boolean {
    try {
      return this.transaction(() => {
        if (!this.invokeBooleanCallback(
          admit,
          'web-session-admission-async',
          '[auth] Web session admission must be synchronous.',
        )) throw PERSISTENCE_ROLLBACK;
        // Admission may atomically insert a newly prepared tenant/membership.
        // Validate only after those writes exist, before any session is stored.
        if (!this.isCurrentAuthority(prepared, prepared.generation)) {
          throw PERSISTENCE_ROLLBACK;
        }
        this.store.insert(prepared);
        if (!this.invokeBooleanCallback(
          persistRefresh,
          'refresh-persistence-async',
          '[auth] Refresh persistence callback must be synchronous.',
        )) throw PERSISTENCE_ROLLBACK;
        return true;
      });
    } catch (error) {
      if (error === PERSISTENCE_ROLLBACK) return false;
      throw error;
    }
  }

  /**
   * Persist a replacement parent and revoke its predecessor inside the
   * caller's refresh-token transaction. This is used for tenant switching so
   * the old access/page/refresh family cannot outlive the new binding.
   */
  replacePreparedWebSession(
    current: AuthSessionRecord,
    replacement: AuthSessionRecord,
  ): boolean {
    try {
      return this.transaction(() => {
        if (current.userId !== replacement.userId
          || current.sessionId === replacement.sessionId
          || !this.isCurrentAuthority(current, current.generation)
          || !this.isCurrentAuthority(replacement, replacement.generation)) {
          throw PERSISTENCE_ROLLBACK;
        }
        this.store.insert(replacement);
        if (!this.store.revoke(
          current.sessionId,
          'tenant-switched',
          Date.now(),
        )) {
          throw PERSISTENCE_ROLLBACK;
        }
        this.audit?.append({
          action: 'session.scope-switched',
          outcome: 'succeeded',
          scope: replacement.tenantId
            ? { kind: 'tenant', tenantId: replacement.tenantId }
            : { kind: 'application' },
          actor: {
            userId: current.userId,
            membershipId: current.membershipId ?? undefined,
            sessionId: current.sessionId,
            sessionKind: 'web',
            provenance: 'authenticated-request',
          },
          target: { type: 'auth-session', id: replacement.sessionId },
          metadata: { 'previous-scope': current.scopeId },
        });
        return true;
      });
    } catch (error) {
      if (error === PERSISTENCE_ROLLBACK) return false;
      throw error;
    }
  }

  /**
   * Lazily adopt a pre-migration browser refresh row in single-tenant mode.
   * Multi-tenant rows remain unbound and fail closed until a tenant is chosen.
   */
  adoptLegacySingleRefresh(input: {
    tokenId: string;
    userId: string;
    createdAt: number;
    expiresAt: number;
  }): AuthSessionRecord | null {
    if (this.tenancyMode !== 'single' || input.expiresAt <= Date.now()) return null;
    const prepared = this.prepareWebSession({
      userId: input.userId,
      expiresAt: input.expiresAt,
      authenticatedAt: input.createdAt,
      mfaVerifiedAt: null,
    });
    try {
      return this.transaction(() => {
        this.store.insert(prepared);
        if (!this.store.linkLegacyRefresh(
          prepared.sessionId,
          input.tokenId,
          input.userId,
        )) {
          throw PERSISTENCE_ROLLBACK;
        }
        return prepared;
      });
    } catch (error) {
      if (error === PERSISTENCE_ROLLBACK) return null;
      throw error;
    }
  }

  /** Resolve a live parent and revalidate its captured tenant authority. */
  resolveWebSession(input: ResolveWebSessionInput): AuthSessionRecord | null {
    return this.resolveWebSessionAuthority(input)?.session ?? null;
  }

  /** Resolve the parent and its tenant role from one consistent DB snapshot. */
  resolveWebSessionAuthority(
    input: ResolveWebSessionInput,
  ): ResolvedWebSessionAuthority | null {
    return this.transaction(() => {
      const session = this.store.getById(input.sessionId);
      if (!session || session.userId !== input.userId) return null;
      if (input.generation !== undefined && session.generation !== input.generation) {
        return null;
      }
      const authority = this.resolveCurrentAuthority(session, input.generation);
      return authority ? {
        session,
        tenantKind: authority.tenantKind,
        tenantRole: authority.tenantRole,
      } : null;
    });
  }

  /**
   * Revalidate and run refresh rotation under the same SQLite transaction,
   * retaining the parent while moving its child refresh credential forward.
   */
  withActiveWebSession<T>(
    input: ResolveWebSessionInput,
    nextExpiresAt: number,
    operation: (session: AuthSessionRecord) => T,
  ): { session: AuthSessionRecord; value: T } | null {
    return this.transaction(() => {
      const authority = this.resolveWebSessionAuthority(input);
      if (!authority) return null;
      const { session } = authority;
      const value = invokeSynchronousAuthCallback(() => operation(session), {
        component: 'auth-session-service',
        invariant: 'active-session-operation-async',
        message: '[auth] Active web session operation must be synchronous.',
        emitCode: this.emitCode,
      });
      this.store.touch(
        session.sessionId,
        session.userId,
        session.generation,
        nextExpiresAt,
      );
      return { session, value };
    });
  }

  revoke(
    sessionId: string,
    reason: string,
    now = Date.now(),
    auditContext?: {
      provenance?: AuthAuditActorProvenance;
      request?: AuthAuditRequestContext;
    },
  ): boolean {
    const normalizedReason = normalizeReason(reason);
    return this.transaction(() => {
      const current = this.store.getById(sessionId);
      const revoked = this.store.revoke(sessionId, normalizedReason, now);
      if (revoked && current) {
        this.audit?.append({
          action: 'session.revoked',
          outcome: 'succeeded',
          reason: auditReason(normalizedReason),
          scope: current.tenantId
            ? { kind: 'tenant', tenantId: current.tenantId }
            : { kind: 'application' },
          actor: {
            userId: current.userId,
            membershipId: current.membershipId ?? undefined,
            sessionId: current.sessionId,
            sessionKind: 'web',
            provenance: auditContext?.provenance ?? 'system',
          },
          request: auditContext?.request,
          target: { type: 'auth-session', id: current.sessionId },
        });
      }
      return revoked;
    });
  }

  revokeAllForUser(userId: string, reason: string, now = Date.now()): number {
    const normalizedReason = normalizeReason(reason);
    return this.transaction(() => {
      const revoked = this.store.revokeAllForUser(userId, normalizedReason, now);
      if (revoked > 0) {
        this.audit?.append({
          action: 'session.user-scope-revoked',
          outcome: 'succeeded',
          reason: auditReason(normalizedReason),
          scope: { kind: 'application' },
          actor: { provenance: 'system' },
          target: { type: 'user', id: userId },
          metadata: { count: revoked },
        });
      }
      return revoked;
    });
  }

  deleteExpiredSessions(now = Date.now()): number {
    return this.transaction(() => this.store.deleteExpired(now));
  }

  /**
   * Whether a pre-session-boundary browser access token may finish its
   * original short lifetime. Multi-tenant access is never safe without an
   * explicit, server-validated tenant binding and therefore always fails
   * closed.
   */
  allowsLegacyUnboundWebAccess(): boolean {
    this.assertCurrentProfile();
    return this.tenancyMode === 'single' && !this.rejectLegacyWithoutMfaAssurance;
  }

  private transaction<T>(operation: () => T): T {
    return this.store.transaction(() => {
      // AuthSessionStore transactions use BEGIN IMMEDIATE. Checking after the
      // writer lock closes the in-flight race with a profile transition.
      this.assertCurrentProfile();
      return operation();
    });
  }

  private invokeBooleanCallback(
    callback: () => boolean,
    invariant: string,
    message: string,
  ): boolean {
    return invokeSynchronousAuthCallback(callback, {
      component: 'auth-session-service',
      invariant,
      message,
      emitCode: this.emitCode,
    });
  }

  private assertCurrentProfile(): void {
    if (!this.runtimeProfileGuard) return;
    invokeSynchronousAuthCallback(this.runtimeProfileGuard, {
      component: 'auth-session-service',
      invariant: 'runtime-profile-guard-async',
      message: '[auth] Session runtime profile guard must be synchronous.',
      emitCode: this.emitCode,
    });
  }

  private resolveIssuanceScope(
    userId: string,
    binding: WebSessionBinding | undefined,
  ): Pick<AuthSessionRecord,
    | 'scopeKind'
    | 'scopeId'
    | 'tenantId'
    | 'membershipId'
    | 'tenantAuthorizationGeneration'
    | 'membershipAuthorizationGeneration'> {
    if (this.tenancyMode === 'single') {
      if (binding) {
        throw new AuthError(
          'Tenant session binding is unavailable in single-tenant mode',
          'INVALID_TENANT_SESSION_BINDING',
          403,
        );
      }
      return {
        scopeKind: 'application',
        scopeId: 'application',
        tenantId: null,
        membershipId: null,
        tenantAuthorizationGeneration: null,
        membershipAuthorizationGeneration: null,
      };
    }

    if (!this.tenancy) {
      throw new AuthError('Tenant services are not initialized', 'AUTH_NOT_READY', 503);
    }
    const hasPreparedGeneration = binding && (
      'tenantAuthorizationGeneration' in binding
      || 'membershipAuthorizationGeneration' in binding
    );
    if (binding && hasPreparedGeneration) {
      if (!isPreparedWebSessionBinding(binding)) {
        throw new AuthError(
          'Tenant session binding is invalid',
          'INVALID_TENANT_SESSION_BINDING',
          403,
        );
      }
      return {
        scopeKind: 'tenant',
        scopeId: binding.tenantId,
        tenantId: binding.tenantId,
        membershipId: binding.membershipId,
        tenantAuthorizationGeneration: binding.tenantAuthorizationGeneration,
        membershipAuthorizationGeneration: binding.membershipAuthorizationGeneration,
      };
    }
    const membership = binding
      ? this.tenancy.getMembershipById(binding.membershipId)
      : this.resolveOnlyActiveMembership(userId);
    const tenant = membership
      ? this.tenancy.getTenant(membership.tenantId)
      : null;
    if (!membership || !tenant
      || membership.userId !== userId
      || (binding && (membership.tenantId !== binding.tenantId
        || tenant.tenantId !== binding.tenantId))
      || membership.status !== 'active'
      || tenant.status !== 'active') {
      throw new AuthError(
        'Tenant session binding is invalid',
        'INVALID_TENANT_SESSION_BINDING',
        403,
      );
    }
    return {
      scopeKind: 'tenant',
      scopeId: tenant.tenantId,
      tenantId: tenant.tenantId,
      membershipId: membership.membershipId,
      tenantAuthorizationGeneration: tenant.authorizationGeneration,
      membershipAuthorizationGeneration: membership.authorizationGeneration,
    };
  }

  private resolveOnlyActiveMembership(userId: string) {
    const memberships = this.tenancy!.listActiveMembershipsForUser(userId);
    if (memberships.length === 0) {
      throw new AuthError(
        'An active organization membership is required',
        'TENANT_MEMBERSHIP_REQUIRED',
        403,
      );
    }
    if (memberships.length !== 1) {
      throw new AuthError(
        'Organization selection is required',
        'TENANT_SELECTION_REQUIRED',
        409,
      );
    }
    return memberships[0];
  }

  private isCurrentAuthority(
    session: AuthSessionRecord,
    expectedGeneration: number | undefined,
  ): boolean {
    return this.resolveCurrentAuthority(session, expectedGeneration) !== null;
  }

  private resolveCurrentAuthority(
    session: AuthSessionRecord,
    expectedGeneration: number | undefined,
  ): { tenantKind: TenantKind | null; tenantRole: string | null } | null {
    if (session.kind !== 'web' || session.status !== 'active') return null;
    if (session.expiresAt <= Date.now()) return null;
    if (!this.invokeBooleanCallback(
      () => this.mfaAssuranceValidator(session),
      'mfa-assurance-validator-async',
      '[auth] MFA assurance validation must be synchronous.',
    )) return null;
    if (expectedGeneration !== undefined && session.generation !== expectedGeneration) {
      return null;
    }
    if (this.tenancyMode === 'single') {
      return session.scopeKind === 'application'
        && session.scopeId === 'application'
        && session.tenantId === null
        && session.membershipId === null
        ? { tenantKind: null, tenantRole: null }
        : null;
    }
    if (!this.tenancy
      || session.scopeKind !== 'tenant'
      || !session.tenantId
      || !session.membershipId
      || session.scopeId !== session.tenantId) {
      return null;
    }
    const tenant = this.tenancy.getTenant(session.tenantId);
    const membership = this.tenancy.getMembershipById(session.membershipId);
    return (
      tenant
      && membership
      && tenant.status === 'active'
      && membership.status === 'active'
      && membership.userId === session.userId
      && membership.tenantId === session.tenantId
      && tenant.authorizationGeneration === session.tenantAuthorizationGeneration
      && membership.authorizationGeneration
        === session.membershipAuthorizationGeneration
    ) ? { tenantKind: tenant.kind, tenantRole: membership.roleKey } : null;
  }
}

function normalizeReason(reason: string): string {
  const value = reason.trim().slice(0, 120);
  return value || 'revoked';
}

function auditReason(reason: string): string {
  const normalized = reason.toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return normalized || 'revoked';
}

function isPreparedWebSessionBinding(
  binding: WebSessionBinding | PreparedWebSessionBinding,
): binding is PreparedWebSessionBinding {
  const tenantGeneration = Reflect.get(binding, 'tenantAuthorizationGeneration');
  const membershipGeneration = Reflect.get(binding, 'membershipAuthorizationGeneration');
  return Number.isSafeInteger(tenantGeneration)
    && typeof tenantGeneration === 'number'
    && tenantGeneration >= 0
    && Number.isSafeInteger(membershipGeneration)
    && typeof membershipGeneration === 'number'
    && membershipGeneration >= 0;
}
