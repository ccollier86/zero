/**
 * admin-lifecycle-email-service.ts
 *
 * Coordinates admin-forced setup/reset delivery and the password-change gate.
 * Email must succeed before state is mutated, so provider failures cannot lock
 * an otherwise usable account.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { AccountEmailService } from './account-email-service';
import { serializeAdminLifecycleDelivery } from './admin-lifecycle-delivery-queue';
import type { AuthActionTokenService } from './action-token-service';
import { assertAdminMayForcePasswordChange } from './admin-user-guards';
import { discardUndeliveredActionToken } from './auth-action-token-delivery';
import { AuthError, type AuthActionTokenType } from './types';
import type { UserStore } from './user-store';

type DeliveryKind = 'setup' | 'reset';

export class AdminLifecycleEmailService {
  constructor(
    private readonly store: UserStore,
    private readonly actionTokens: AuthActionTokenService,
    private readonly accountEmail: AccountEmailService
  ) {}

  /** Send account setup instructions, then require a password change. */
  sendSetup(userId: string, actorId: string): Promise<void> {
    return this.deliver(userId, actorId, 'setup');
  }

  /** Send admin password-reset instructions, then require a password change. */
  sendPasswordReset(userId: string, actorId: string): Promise<void> {
    return this.deliver(userId, actorId, 'reset');
  }

  private deliver(userId: string, actorId: string, kind: DeliveryKind): Promise<void> {
    return serializeAdminLifecycleDelivery(this.store, userId, () =>
      this.deliverOnce(userId, actorId, kind)
    );
  }

  private async deliverOnce(userId: string, actorId: string, kind: DeliveryKind): Promise<void> {
    const user = this.store.getUserById(userId);
    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    if (user.status === 'suspended') {
      throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
    }
    assertAdminMayForcePasswordChange(this.store, actorId, user);
    this.accountEmail.assertReady();

    const type: AuthActionTokenType = kind === 'setup'
      ? 'account_setup'
      : 'admin_password_reset';
    const created = this.actionTokens.create({
      userId,
      type,
      createdBy: actorId,
      metadata: { source: 'admin' },
      skipCooldown: true,
      afterSecurityTransition: true,
    });

    try {
      const input = { user, rawToken: created.rawToken, token: created.record };
      if (kind === 'setup') await this.accountEmail.sendAccountSetup(input);
      else await this.accountEmail.sendPasswordReset(input);
    } catch (error) {
      const cleanupSucceeded = discardUndeliveredActionToken(
        this.actionTokens,
        created.rawToken
      );
      if (kind === 'reset') {
        emitPlatformCode(OBS_CODES.AUTH_ADMIN_PASSWORD_RESET_DELIVERY_FAILED, {
          userId: actorId,
          error,
          metadata: { targetUserId: userId, cleanupSucceeded },
        });
      }
      throw error;
    }

    try {
      if (!this.store.requirePasswordChange(userId)) {
        throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      }
    } catch (error) {
      discardUndeliveredActionToken(this.actionTokens, created.rawToken);
      throw error;
    }
  }
}
