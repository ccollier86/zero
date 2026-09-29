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
import {
  invokeAuthAdminMutationAuthority,
  type AssertAuthAdminMutationAuthority,
} from './auth-admin-mutation-authority';
import { discardUndeliveredActionToken } from './auth-action-token-delivery';
import { classifyAuthEmailFailure } from './auth-email-outbox-failure-classification';
import { AuthError, type AuthActionTokenType, type UserRecord } from './types';
import type { UserStore } from './user-store';
import type {
  AuthAuditOutcome,
  AuthAuditRequestContext,
} from './auth-audit-types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { captureAuthAuditRequestContext } from './auth-audit-service';
import { createAuthStateInvariantError } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';

type DeliveryKind = 'setup' | 'reset';

/** Internal transaction hooks used only while provisioning a brand-new user. */
interface AdminLifecycleProvisioningHooks {
  /** Runs in the same transaction that creates the exact setup token. */
  onTokenPrepared?: (created: CreatedAuthActionToken) => void;
  /** Runs immediately before the provider is called. */
  onDeliveryAttempted?: () => void;
  /** Runs after the provider accepted the message and before state commit. */
  onDeliveryAccepted?: () => void;
  /** Runs in the final transaction before the password gate is written. */
  onBeforeCommit?: () => void;
  /** Runs after the password gate is written, in that same transaction. */
  onCommitted?: () => void;
}

export class AdminLifecycleEmailService {
  constructor(
    private readonly store: UserStore,
    private readonly actionTokens: AuthActionTokenService,
    private readonly accountEmail: AccountEmailService,
    private readonly emitCode: AuthPlatformCodeEmitter = emitPlatformCode,
  ) {}

  /** Send account setup instructions, then require a password change. */
  sendSetup(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    auditRequest?: AuthAuditRequestContext,
    provisioningHooks?: AdminLifecycleProvisioningHooks,
  ): Promise<void> {
    return this.deliver(
      userId,
      assertCurrentAuthority,
      'setup',
      auditRequest,
      provisioningHooks,
    );
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
    provisioningHooks?: AdminLifecycleProvisioningHooks,
  ): Promise<void> {
    const request = captureAuthAuditRequestContext(auditRequest);
    return serializeAdminLifecycleDelivery(this.store, userId, () =>
      this.deliverOnce(
        userId,
        assertCurrentAuthority,
        kind,
        request,
        provisioningHooks,
      )
    );
  }

  private async deliverOnce(
    userId: string,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    kind: DeliveryKind,
    auditRequest?: AuthAuditRequestContext,
    provisioningHooks?: AdminLifecycleProvisioningHooks,
  ): Promise<void> {
    const initialActor = this.assertAuthority(assertCurrentAuthority, userId);
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
        prepared.actorId = this.assertAuthority(assertCurrentAuthority, userId).userId;
        prepared.user = this.requireEligibleTarget(userId, prepared.actorId);
        prepared.created = this.actionTokens.create({
          userId,
          type,
          createdBy: prepared.actorId,
          metadata: { source: 'admin' },
          skipCooldown: true,
          afterSecurityTransition: true,
        });
        this.invokeProvisioningHook(
          provisioningHooks?.onTokenPrepared,
          'token-prepared',
          prepared.created,
        );
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
      throw createAuthStateInvariantError(this.emitCode, {
        component: 'admin-lifecycle-email-service',
        invariant: 'delivery-preparation-incomplete',
        message: '[auth] Admin lifecycle delivery preparation did not complete.',
      });
    }
    let { actorId } = prepared;
    const { created, user } = prepared;

    try {
      this.invokeProvisioningHook(
        provisioningHooks?.onDeliveryAttempted,
        'delivery-attempted',
      );
    } catch (error) {
      discardUndeliveredActionToken(this.actionTokens, created.rawToken);
      throw error;
    }

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
      const failure = classifyAuthEmailFailure(error);
      this.emitCode(
        kind === 'setup'
          ? OBS_CODES.AUTH_ADMIN_SETUP_DELIVERY_FAILED
          : OBS_CODES.AUTH_ADMIN_PASSWORD_RESET_DELIVERY_FAILED,
        {
          userId: actorId,
          metadata: {
            targetUserId: userId,
            cleanupSucceeded,
            code: failure.code,
            retryable: failure.retryable,
          },
        },
      );
      throw error;
    }

    try {
      this.invokeProvisioningHook(
        provisioningHooks?.onDeliveryAccepted,
        'delivery-accepted',
      );
      this.store.transaction(() => {
        actorId = this.assertAuthority(assertCurrentAuthority, userId).userId;
        this.requireEligibleTarget(userId, actorId);
        this.invokeProvisioningHook(
          provisioningHooks?.onBeforeCommit,
          'before-state-commit',
        );
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
        this.invokeProvisioningHook(
          provisioningHooks?.onCommitted,
          'state-committed',
        );
      });
    } catch (error) {
      // Delivery cannot be undone, but invalidating the link prevents an
      // unauthorized or unaudited transition from completing through it.
      discardUndeliveredActionToken(this.actionTokens, created.rawToken);
      throw error;
    }
  }

  private invokeProvisioningHook<Args extends readonly unknown[]>(
    hook: ((...args: Args) => unknown) | undefined,
    phase: string,
    ...args: Args
  ): void {
    if (!hook) return;
    invokeSynchronousAuthCallback(() => hook(...args), {
      component: 'admin-lifecycle-email-service',
      invariant: `provisioning-hook-${phase}-async`,
      message: '[auth] Administrator provisioning hooks must be synchronous.',
      emitCode: this.emitCode,
    });
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

  private assertAuthority(
    assertion: AssertAuthAdminMutationAuthority,
    targetUserId: string,
  ) {
    return invokeAuthAdminMutationAuthority(
      assertion,
      { targetUserId },
      { component: 'admin-lifecycle-email-service', emitCode: this.emitCode },
    );
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
