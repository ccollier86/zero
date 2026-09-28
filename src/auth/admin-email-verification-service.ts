/**
 * admin-email-verification-service.ts
 *
 * Owns administrator-triggered verification delivery and the explicitly gated
 * manual verification override. It does not authenticate HTTP requests.
 */

import type { AccountEmailService } from './account-email-service';
import type { AuthActionTokenService } from './action-token-service';
import { discardUndeliveredActionToken } from './auth-action-token-delivery';
import { AuthError, type ResolvedAuthBehaviorConfig } from './types';
import type { AuthSecurityAuditContext, UserStore } from './user-store';
import type { AssertAuthAdminMutationAuthority } from './auth-admin-mutation-authority';

export class AdminEmailVerificationService {
  constructor(
    private readonly store: UserStore,
    private readonly tokens: AuthActionTokenService,
    private readonly email: AccountEmailService,
    private readonly config: ResolvedAuthBehaviorConfig
  ) {}

  /** Send a tokenized verification link to an active pending account. */
  async send(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
  ): Promise<void> {
    if (!this.config.account.requireEmailVerification) {
      throw new AuthError('Email verification is disabled', 'EMAIL_VERIFICATION_DISABLED', 403);
    }
    const prepared = this.store.transaction(() => {
      const actorId = assertCurrentAuthority().userId;
      const user = this.requireUser(userId);
      if (user.status === 'suspended') {
        throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
      }
      if (!user.emailVerificationRequired || user.emailVerifiedAt !== null) {
        return { user, created: null };
      }
      this.email.assertReady();
      const created = this.tokens.create({
        userId,
        type: 'email_verification',
        createdBy: actorId,
        metadata: { source: 'admin' },
        skipCooldown: true,
      });
      return { user, created };
    });
    if (!prepared.created) return;
    try {
      await this.email.sendEmailVerification({
        user: prepared.user,
        rawToken: prepared.created.rawToken,
        token: prepared.created.record,
      });
      assertCurrentAuthority();
    } catch (error) {
      discardUndeliveredActionToken(this.tokens, prepared.created.rawToken);
      throw error;
    }
  }

  /** Mark an email verified only when the app enables the admin override. */
  verify(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    audit?: AuthSecurityAuditContext,
  ) {
    if (!this.config.account.allowAdminMarkEmailVerified) {
      throw new AuthError(
        'Admin email verification override is disabled',
        'ADMIN_EMAIL_VERIFICATION_DISABLED',
        403
      );
    }
    return this.store.transaction(() => {
      const actorId = assertCurrentAuthority().userId;
      const existing = this.requireUser(userId);
      const updated = this.store.markEmailVerified(userId);
      if (!updated) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      const changed = existing.emailVerificationRequired || existing.emailVerifiedAt === null;
      if (changed) this.store.revokeAllUserTokens(userId);
      this.store.appendControlPlaneAudit({
        action: 'account.email-verified-by-admin',
        outcome: 'succeeded',
        scope: { kind: 'application' },
        actor: audit?.actor ?? {
          userId: actorId,
          provenance: 'authenticated-request',
        },
        request: audit?.request,
        target: { type: 'user', id: userId },
        metadata: { changed },
      });
      return this.requireUser(userId);
    });
  }

  private requireUser(userId: string) {
    const user = this.store.getUserById(userId);
    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    return user;
  }
}
