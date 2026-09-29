/**
 * admin-user-create-service.ts
 *
 * Owns administrator user creation policy, defaults, and optional setup email
 * delivery. It is transport-independent.
 */

import { OBS_CODES } from '../observability/codes';
import { AdminLifecycleEmailService } from './admin-lifecycle-email-service';
import {
  assertMfaRequirementAvailable,
  getAuthAdminEmitter,
  type AuthAdminPluginConfig,
} from './auth-admin-dependencies';
import { createTemporaryPassword, rollbackProvisionedUser } from './admin-user-provisioning';
import { AuthError } from './types';
import type { UserPropertyService } from './user-property-service';
import type { AuthSecurityAuditContext, UserStore } from './user-store';
import {
  invokeAuthAdminMutationAuthority,
  type AssertAuthAdminMutationAuthority,
} from './auth-admin-mutation-authority';
import {
  captureAuthAuditActor,
  captureAuthAuditRequestContext,
} from './auth-audit-service';
import { createAuthStateInvariantError } from './auth-observability';

type AdminUserProvisioningPhase =
  | 'lease-renewal'
  | 'token-binding'
  | 'delivery'
  | 'state-commit';

export interface AdminCreateUserInput {
  username: string;
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  passwordChangeRequired?: boolean;
  mfaRequired?: boolean;
  sendSetupEmail?: boolean;
  properties?: Record<string, unknown>;
}

export class AdminUserCreateService {
  constructor(
    private readonly store: UserStore,
    private readonly properties: UserPropertyService,
    private readonly config: AuthAdminPluginConfig
  ) {}

  /** Create a user and send setup instructions only when delivery is ready. */
  async create(
    input: AdminCreateUserInput,
    assertCurrentAuthority: AssertAuthAdminMutationAuthority,
    audit?: AuthSecurityAuditContext,
  ) {
    const capturedInput = Object.freeze({
      username: input.username,
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      passwordChangeRequired: input.passwordChangeRequired,
      mfaRequired: input.mfaRequired,
      sendSetupEmail: input.sendSetupEmail,
      properties: input.properties === undefined
        ? undefined
        : Object.freeze({ ...input.properties }),
    });
    const suppliedAuditActor = captureAuthAuditActor(audit?.actor);
    const auditRequest = captureAuthAuditRequestContext(audit?.request);
    const emitCode = getAuthAdminEmitter(this.config);
    const mutationBoundary = {
      requestedPlatformRole: capturedInput.role ?? 'user',
    } as const;
    const assertAuthority = () => invokeAuthAdminMutationAuthority(
      assertCurrentAuthority,
      mutationBoundary,
      { component: 'admin-user-create-service', emitCode },
    );
    const actorId = assertAuthority().userId;
    const operationAudit = Object.freeze({
      actor: suppliedAuditActor ?? Object.freeze({
        userId: actorId,
        provenance: 'authenticated-request' as const,
      }),
      request: auditRequest,
    });
    const authConfig = this.config.getAuthConfig();
    if (authConfig.registration.mode === 'disabled') {
      getAuthAdminEmitter(this.config)(OBS_CODES.AUTH_REGISTRATION_DISABLED, {
        userId: actorId,
        metadata: { route: '/auth/admin/users' },
      });
      throw new AuthError('Registration disabled', 'REGISTRATION_DISABLED', 403);
    }
    const sendSetup = capturedInput.sendSetupEmail
      ?? authConfig.accountEmails.adminCreatedUser;
    if (capturedInput.passwordChangeRequired === true && !sendSetup) {
      throw new AuthError(
        'Use a setup email to require a password change for a new user',
        'PASSWORD_CHANGE_REQUIREMENT_REQUIRES_EMAIL',
        409
      );
    }
    const tokens = this.config.getActionTokenService();
    const email = this.config.getAccountEmailService();
    if (sendSetup && (!tokens || !email)) {
      throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
    }
    if (sendSetup) email!.assertReady();
    if (capturedInput.mfaRequired) assertMfaRequirementAvailable(this.config);

    const properties = {
      ...this.properties.getDefaultProperties(),
      ...this.properties.validateWrites(capturedInput.properties, 'admin'),
    };
    const createInput = {
      username: capturedInput.username,
      email: capturedInput.email,
      password: capturedInput.password ?? createTemporaryPassword(),
      firstName: capturedInput.firstName,
      lastName: capturedInput.lastName,
      role: capturedInput.role ?? 'user',
      passwordChangeRequired: sendSetup
        ? false
        : capturedInput.passwordChangeRequired,
      mfaRequired: capturedInput.mfaRequired,
      properties,
    };
    const provisioningAudit = {
      ...operationAudit,
      setupRequested: sendSetup,
    };
    const created = sendSetup
      ? await this.store.createAdminProvisionedUser(
          createInput,
          provisioningAudit,
          assertAuthority,
        )
      : {
          user: await this.store.createUser(
            createInput,
            provisioningAudit,
            assertAuthority,
          ),
          provisioning: null,
        };
    const { user, provisioning } = created;

    if (sendSetup) {
      if (!provisioning) {
        throw createAuthStateInvariantError(emitCode, {
          component: 'admin-user-create-service',
          invariant: 'admin-user-provisioning-receipt-missing',
          message: '[auth] Administrator user provisioning receipt was not created.',
        });
      }
      let phase: AdminUserProvisioningPhase = 'lease-renewal';
      let deliveryAttempted = false;
      let deliveryAccepted = false;
      try {
        this.store.renewAdminUserProvisioningLease(provisioning);
        phase = 'token-binding';
        await new AdminLifecycleEmailService(
          this.store,
          tokens!,
          email!,
          getAuthAdminEmitter(this.config),
        )
          .sendSetup(user.userId, assertCurrentAuthority, auditRequest, {
            onTokenPrepared: (createdToken) => {
              this.store.bindAdminUserProvisioningSetupToken(
                provisioning,
                createdToken.record.tokenId,
              );
            },
            onDeliveryAttempted: () => {
              deliveryAttempted = true;
              phase = 'delivery';
            },
            onDeliveryAccepted: () => {
              deliveryAccepted = true;
              phase = 'state-commit';
            },
            onBeforeCommit: () => {
              this.store.assertAdminUserProvisioningCommitReady(provisioning);
            },
            onCommitted: () => {
              this.store.finalizeAdminUserProvisioning(provisioning);
            },
          });
      } catch (error) {
        const deliveryFailed = deliveryAttempted && !deliveryAccepted;
        const cleanupSucceeded = rollbackProvisionedUser(
          this.store,
          provisioning,
          operationAudit,
          deliveryFailed ? 'setup-delivery-failed' : 'provisioning-failed',
        );
        getAuthAdminEmitter(this.config)(deliveryFailed
          ? OBS_CODES.AUTH_ADMIN_USER_SETUP_DELIVERY_FAILED
          : OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_FAILED, {
          userId: actorId,
          metadata: {
            targetUserId: user.userId,
            source: 'admin-create',
            cleanupSucceeded,
            ...(!deliveryFailed && { phase }),
          },
        });
        throw error;
      }
    }
    getAuthAdminEmitter(this.config)(OBS_CODES.AUTH_ADMIN_USER_CREATED, {
      userId: actorId,
      metadata: { createdUserId: user.userId, role: user.role, setupEmailSent: sendSetup },
    });
    return { user: this.store.getUserById(user.userId)!, setupEmailSent: sendSetup };
  }
}
