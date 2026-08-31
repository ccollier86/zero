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
import type { UserStore } from './user-store';

export class AdminEmailVerificationService {
  constructor(
    private readonly store: UserStore,
    private readonly tokens: AuthActionTokenService,
    private readonly email: AccountEmailService,
    private readonly config: ResolvedAuthBehaviorConfig
  ) {}

  /** Send a tokenized verification link to an active pending account. */
  async send(userId: string, actorId: string): Promise<void> {
    if (!this.config.account.requireEmailVerification) {
      throw new AuthError('Email verification is disabled', 'EMAIL_VERIFICATION_DISABLED', 403);
    }
    const user = this.requireUser(userId);
    if (user.status === 'suspended') {
      throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
    }
    if (!user.emailVerificationRequired || user.emailVerifiedAt !== null) return;
    this.email.assertReady();

    const created = this.tokens.create({
      userId,
      type: 'email_verification',
      createdBy: actorId,
      metadata: { source: 'admin' },
      skipCooldown: true,
    });
    try {
      await this.email.sendEmailVerification({
        user,
        rawToken: created.rawToken,
        token: created.record,
      });
    } catch (error) {
      discardUndeliveredActionToken(this.tokens, created.rawToken);
      throw error;
    }
  }

  /** Mark an email verified only when the app enables the admin override. */
  verify(userId: string) {
    if (!this.config.account.allowAdminMarkEmailVerified) {
      throw new AuthError(
        'Admin email verification override is disabled',
        'ADMIN_EMAIL_VERIFICATION_DISABLED',
        403
      );
    }
    const existing = this.requireUser(userId);
    const updated = this.store.markEmailVerified(userId);
    if (!updated) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    if (existing.emailVerificationRequired || existing.emailVerifiedAt === null) {
      this.store.revokeAllUserTokens(userId);
    }
    return this.requireUser(userId);
  }

  private requireUser(userId: string) {
    const user = this.store.getUserById(userId);
    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    return user;
  }
}
