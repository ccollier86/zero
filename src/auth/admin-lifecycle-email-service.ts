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
import type {
  AuthActionTokenService,
  CreatedAuthActionToken,
} from './action-token-service';
import { assertAdminMayForcePasswordChange } from './admin-user-guards';
import type { AssertAuthAdminMutationAuthority } from './auth-admin-mutation-authority';
import { discardUndeliveredActionToken } from './auth-action-token-delivery';
import { AuthError, type AuthActionTokenType, type UserRecord } from './types';
import type { UserStore } from './user-store';
import type {
  AuthAuditOutcome,
  AuthAuditRequestContext,
} from './auth-audit-types';

type DeliveryKind = 'setup' | 'reset';

export class AdminLifecycleEmailService {
  constructor(
    private readonly store: UserStore,
    private readonly actionTokens: AuthActionTokenService,
    private readonly accountEmail: AccountEmailService
  ) {}

  /** Send account setup instructions, then require a password change. */
  sendSetup(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    auditRequest?: AuthAuditRequestContext,
  ): Promise<void> {
    return this.deliver(userId, assertCurrentAuthority, 'setup', auditRequest);
  }

  /** Send admin password-reset instructions, then require a password change. */
  sendPasswordReset(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    auditRequest?: AuthAuditRequestContext,
  ): Promise<void> {
    return this.deliver(userId, assertCurrentAuthority, 'reset', auditRequest);
  }

  private deliver(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    kind: DeliveryKind,
    auditRequest?: AuthAuditRequestContext,
  ): Promise<void> {
    return serializeAdminLifecycleDelivery(this.store, userId, () =>
      this.deliverOnce(userId, assertCurrentAuthority, kind, auditRequest)
    );
  }

  private async deliverOnce(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    kind: DeliveryKind,
    auditRequest?: AuthAuditRequestContext,
  ): Promise<void> {
    const initialActor = assertCurrentAuthority();
    this.requireEligibleTarget(userId, initialActor.userId);
    this.accountEmail.assertReady();

    const type: AuthActionTokenType = kind === 'setup'
      ? 'account_setup'
      : 'admin_password_reset';
    const prepared: {
      actorId?: string;
      created?: CreatedAuthActionToken;
      user?: UserRecord;
    } = {};
    try {
      this.store.transaction(() => {
        prepared.actorId = assertCurrentAuthority().userId;
        prepared.user = this.requireEligibleTarget(userId, prepared.actorId);
        prepared.created = this.actionTokens.create({
          userId,
          type,
          createdBy: prepared.actorId,
          metadata: { source: 'admin' },
          skipCooldown: true,
          afterSecurityTransition: true,
        });
        this.recordDelivery(
          'account.security-delivery-prepared',
          'succeeded',
          userId,
          prepared.actorId,
          kind,
          auditRequest,
        );
      });
    } catch (error) {
      if (prepared.created) {
        discardUndeliveredActionToken(this.actionTokens, prepared.created.rawToken);
      }
      throw error;
    }
    if (!prepared.actorId || !prepared.created || !prepared.user) {
      throw new Error('[auth] Admin lifecycle delivery preparation did not complete.');
    }
    let { actorId } = prepared;
    const { created, user } = prepared;

    try {
      const input = { user, rawToken: created.rawToken, token: created.record };
      if (kind === 'setup') await this.accountEmail.sendAccountSetup(input);
      else await this.accountEmail.sendPasswordReset(input);
    } catch (error) {
      const cleanupSucceeded = discardUndeliveredActionToken(
        this.actionTokens,
        created.rawToken
      );
      this.recordDelivery(
        'account.security-delivery-failed',
        'failed',
        userId,
        actorId,
        kind,
        auditRequest,
        { 'cleanup-succeeded': cleanupSucceeded },
        'delivery-failed',
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
      this.store.transaction(() => {
        actorId = assertCurrentAuthority().userId;
        this.requireEligibleTarget(userId, actorId);
        this.recordDelivery(
          'account.security-delivery-succeeded',
          'succeeded',
          userId,
          actorId,
          kind,
          auditRequest,
        );
        if (!this.store.requirePasswordChange(userId, {
          actor: { userId: actorId, provenance: 'authenticated-request' },
          request: auditRequest,
        })) {
          throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        }
      });
    } catch (error) {
      // Delivery cannot be undone, but invalidating the link prevents an
      // unauthorized or unaudited transition from completing through it.
      discardUndeliveredActionToken(this.actionTokens, created.rawToken);
      throw error;
    }
  }

  private requireEligibleTarget(userId: string, actorId: string) {
    const user = this.store.getUserById(userId);
    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    if (user.status === 'suspended') {
      throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
    }
    assertAdminMayForcePasswordChange(this.store, actorId, user);
    return user;
  }

  private recordDelivery(
    action: string,
    outcome: AuthAuditOutcome,
    userId: string,
    actorId: string,
    kind: DeliveryKind,
    request?: AuthAuditRequestContext,
    metadata: Readonly<Record<string, boolean>> = {},
    reason?: string,
  ): void {
    this.store.appendControlPlaneAudit({
      action,
      outcome,
      ...(reason ? { reason } : {}),
      scope: { kind: 'application' },
      actor: { userId: actorId, provenance: 'authenticated-request' },
      request,
      target: { type: 'user', id: userId },
      metadata: { kind, ...metadata },
    });
  }
}
