/**
 * admin-user-create-service.ts
 *
 * Owns administrator user creation policy, defaults, and optional setup email
 * delivery. It is transport-independent.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { AdminLifecycleEmailService } from './admin-lifecycle-email-service';
import { assertMfaRequirementAvailable, type AuthAdminPluginConfig } from './auth-admin-dependencies';
import { createTemporaryPassword, rollbackProvisionedUser } from './admin-user-provisioning';
import { AuthError } from './types';
import type { UserPropertyService } from './user-property-service';
import type { AuthSecurityAuditContext, UserStore } from './user-store';
import type { AssertAuthAdminMutationAuthority } from './auth-admin-mutation-authority';

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
    const actorId = assertCurrentAuthority().userId;
    const authConfig = this.config.getAuthConfig();
    if (authConfig.registration.mode === 'disabled') {
      emitPlatformCode(OBS_CODES.AUTH_REGISTRATION_DISABLED, {
        userId: actorId,
        metadata: { route: '/auth/admin/users' },
      });
      throw new AuthError('Registration disabled', 'REGISTRATION_DISABLED', 403);
    }
    const sendSetup = input.sendSetupEmail ?? authConfig.accountEmails.adminCreatedUser;
    if (input.passwordChangeRequired === true && !sendSetup) {
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
    if (input.mfaRequired) assertMfaRequirementAvailable(this.config);

    const properties = {
      ...this.properties.getDefaultProperties(),
      ...this.properties.validateWrites(input.properties, 'admin'),
    };
    const user = await this.store.createUser({
      ...input,
      password: input.password ?? createTemporaryPassword(),
      role: input.role ?? 'user',
      passwordChangeRequired: sendSetup ? false : input.passwordChangeRequired,
      properties,
    }, {
      actor: audit?.actor ?? {
        userId: actorId,
        provenance: 'authenticated-request',
      },
      request: audit?.request,
      setupRequested: sendSetup,
    }, () => {
      assertCurrentAuthority();
    });

    if (sendSetup) {
      try {
        await new AdminLifecycleEmailService(this.store, tokens!, email!)
          .sendSetup(user.userId, assertCurrentAuthority, audit?.request);
      } catch (error) {
        const cleanupSucceeded = rollbackProvisionedUser(
          this.store,
          user.userId,
          audit ?? {
            actor: { userId: actorId, provenance: 'authenticated-request' },
          },
        );
        emitPlatformCode(OBS_CODES.AUTH_ADMIN_USER_SETUP_DELIVERY_FAILED, {
          userId: actorId,
          metadata: {
            targetUserId: user.userId,
            source: 'admin-create',
            cleanupSucceeded,
          },
        });
        throw error;
      }
    }
    emitPlatformCode(OBS_CODES.AUTH_ADMIN_USER_CREATED, {
      userId: actorId,
      metadata: { createdUserId: user.userId, role: user.role, setupEmailSent: sendSetup },
    });
    return { user: this.store.getUserById(user.userId)!, setupEmailSent: sendSetup };
  }
}
