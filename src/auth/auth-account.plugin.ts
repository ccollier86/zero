/**
 * auth-account.plugin.ts
 *
 * Elysia controller for public account lifecycle routes such as forgot
 * password, reset password, and setup password. This file owns HTTP
 * validation/transport only; token policy, email delivery, and persistence
 * live in services.
 */

import { Elysia, t } from 'elysia';
import type { AccountEmailService } from './account-email-service';
import type { AuthActionTokenService } from './action-token-service';
import type { TokenService } from './token-service';
import type { UserStore } from './user-store';
import { AuthError, type ResolvedAuthBehaviorConfig, type UserRecord } from './types';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface AuthAccountPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getActionTokenService: () => AuthActionTokenService | null;
  getAccountEmailService: () => AccountEmailService | null;
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

/** Create public account lifecycle routes mounted directly under `/auth`. */
export function createAuthAccountPlugin(config: AuthAccountPluginConfig) {
  return new Elysia({ name: 'auth-account' })
    .post(
      '/forgot-password',
      async ({ body }) => {
        const { store, actionTokens, accountEmail } = requireAccountServices(config);
        const authConfig = config.getAuthConfig();
        if (!authConfig.accountEmails.passwordReset) {
          throw new AuthError('Password reset email is disabled', 'PASSWORD_RESET_DISABLED', 403);
        }

        const user = store.getUserByEmail(body.email);
        emitPlatformCode(OBS_CODES.AUTH_PASSWORD_RESET_REQUESTED, {
          userId: user?.userId,
          metadata: { found: Boolean(user) },
        });

        if (!user || user.status === 'suspended') {
          return { ok: true };
        }

        const created = actionTokens.create({
          userId: user.userId,
          type: 'password_reset',
          metadata: { source: 'forgot-password' },
        });
        await accountEmail.sendPasswordReset({
          user,
          rawToken: created.rawToken,
          token: created.record,
        });

        return { ok: true };
      },
      {
        body: t.Object({
          email: t.String({ format: 'email' }),
        }),
      }
    )
    .get(
      '/action-token/:token',
      ({ params }) => {
        const { actionTokens } = requireAccountServices(config);
        const { record, user } = actionTokens.inspect(params.token);
        return {
          valid: true,
          type: record.type,
          expiresAt: record.expiresAt,
          user: toActionTokenUserResponse(user),
        };
      },
      {
        params: t.Object({ token: t.String({ minLength: 1 }) }),
      }
    )
    .post(
      '/reset-password',
      async ({ body }) => completePasswordAction(config, {
        rawToken: body.token,
        newPassword: body.newPassword,
        allowedTypes: ['password_reset', 'admin_password_reset'],
      }),
      {
        body: t.Object({
          token: t.String({ minLength: 1 }),
          newPassword: t.String({ minLength: 8 }),
        }),
      }
    )
    .post(
      '/setup-password',
      async ({ body }) => completePasswordAction(config, {
        rawToken: body.token,
        newPassword: body.newPassword,
        allowedTypes: ['account_setup'],
      }),
      {
        body: t.Object({
          token: t.String({ minLength: 1 }),
          newPassword: t.String({ minLength: 8 }),
        }),
      }
    );
}

interface AccountServices {
  store: UserStore;
  tokenService: TokenService;
  actionTokens: AuthActionTokenService;
  accountEmail: AccountEmailService;
}

function requireAccountServices(config: AuthAccountPluginConfig): AccountServices {
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const actionTokens = config.getActionTokenService();
  const accountEmail = config.getAccountEmailService();

  if (!store || !tokenService || !actionTokens || !accountEmail) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }

  return { store, tokenService, actionTokens, accountEmail };
}

async function completePasswordAction(
  config: AuthAccountPluginConfig,
  params: {
    rawToken: string;
    newPassword: string;
    allowedTypes: Parameters<AuthActionTokenService['consume']>[1];
  }
) {
  const { store, tokenService, actionTokens } = requireAccountServices(config);
  const inspection = actionTokens.inspect(params.rawToken, params.allowedTypes);
  if (inspection.user.status === 'suspended') {
    throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
  }

  actionTokens.consume(params.rawToken, params.allowedTypes);

  const changed = await store.resetPassword(inspection.user.userId, params.newPassword);
  if (!changed) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
  store.clearPasswordChangeRequired(inspection.user.userId);

  const user = store.getUserById(inspection.user.userId);
  if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);

  const tokens = await tokenService.issueTokenPair(user);
  emitPlatformCode(OBS_CODES.AUTH_PASSWORD_RESET_COMPLETED, {
    userId: user.userId,
    metadata: { actionType: inspection.record.type },
  });

  return {
    user: toAuthUserResponse(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

function toActionTokenUserResponse(user: UserRecord) {
  return {
    userId: user.userId,
    username: user.username,
    email: user.email,
  };
}

function toAuthUserResponse(user: UserRecord): UserRecord {
  return {
    userId: user.userId,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    passwordChangeRequired: user.passwordChangeRequired,
    properties: user.properties,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
