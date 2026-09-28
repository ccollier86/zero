/**
 * admin-mfa-user-service.ts
 *
 * Owns administrator MFA state transitions. It consumes auth stores/services
 * directly and has no dependency on Elysia request contexts.
 */

import { assertAdminMayResetMfa } from './admin-user-guards';
import type { MfaChallengeService } from './mfa-challenge-service';
import type { MfaService } from './mfa-service';
import { AuthError } from './types';
import type { AuthSecurityAuditContext, UserStore } from './user-store';
import type { AssertAuthAdminMutationAuthority } from './auth-admin-mutation-authority';

export class AdminMfaUserService {
  constructor(
    private readonly store: UserStore,
    private readonly mfa: MfaChallengeService,
    private readonly readiness: MfaService,
    private readonly emailOtpReady: boolean
  ) {}

  /** Return public-safe enrollment state and the active requirement source. */
  getStatus(userId: string) {
    const user = this.requireUser(userId);
    const requirement = this.mfa.getMfaRequirement(user);
    return {
      methods: this.mfa.listPublicMethods(userId),
      required: requirement !== 'none',
      requirement,
    };
  }

  /** Set a per-user MFA requirement and durably invalidate existing sessions. */
  require(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    audit?: AuthSecurityAuditContext,
  ) {
    this.assertAvailable();
    return this.store.transaction(() => {
      const actorId = assertCurrentAuthority().userId;
      const user = this.requireUser(userId);
      const changed = !user.mfaRequired;
      if (changed) {
        this.store.updateUser(userId, { mfaRequired: true });
        this.store.revokeAllUserTokens(userId);
      }
      this.record('account.mfa-required', userId, actorId, audit, { changed });
      return this.requireUser(userId);
    });
  }

  /** Clear only the per-user requirement and invalidate existing sessions. */
  clearRequirement(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    audit?: AuthSecurityAuditContext,
  ) {
    return this.store.transaction(() => {
      const actorId = assertCurrentAuthority().userId;
      const user = this.requireUser(userId);
      const changed = user.mfaRequired;
      if (changed) {
        this.store.updateUser(userId, { mfaRequired: false });
        this.store.revokeAllUserTokens(userId);
      }
      this.record(
        'account.mfa-requirement-cleared',
        userId,
        actorId,
        audit,
        { changed },
      );
      return this.requireUser(userId);
    });
  }

  /** Delete another user's methods/challenges and invalidate their sessions. */
  reset(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    audit?: AuthSecurityAuditContext,
  ) {
    return this.store.transaction(() => {
      const actorId = assertCurrentAuthority().userId;
      const user = this.requireUser(userId);
      assertAdminMayResetMfa(actorId, user);
      const result = this.mfa.resetUserMfa(userId);
      this.store.revokeAllUserTokens(userId);
      this.record('account.mfa-reset', userId, actorId, audit, {
        'deleted-methods': result.deletedMethods,
        'invalidated-challenges': result.invalidatedChallenges,
      });
      return result;
    });
  }

  private record(
    action: string,
    userId: string,
    actorId: string,
    audit: AuthSecurityAuditContext | undefined,
    metadata: Readonly<Record<string, number | boolean>>,
  ): void {
    this.store.appendControlPlaneAudit({
      action,
      outcome: 'succeeded',
      scope: { kind: 'application' },
      actor: audit?.actor ?? {
        userId: actorId,
        provenance: 'authenticated-request',
      },
      request: audit?.request,
      target: { type: 'user', id: userId },
      metadata,
    });
  }

  private assertAvailable(): void {
    const state = this.readiness.getReadiness({ emailOtpReady: this.emailOtpReady });
    if (!state.enabled || !state.ready || !state.availableMethods.length) {
      throw new AuthError('MFA is not available', 'MFA_NOT_AVAILABLE', 409);
    }
  }

  private requireUser(userId: string) {
    const user = this.store.getUserById(userId);
    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    return user;
  }
}
