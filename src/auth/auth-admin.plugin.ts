/**
 * auth-admin.plugin.ts
 *
 * Elysia controller for admin user-management routes. This file owns HTTP
 * validation and admin authentication; user persistence remains in UserStore
 * and user-property validation remains in UserPropertyService.
 */

import { Elysia, t } from 'elysia';
import type { AccountEmailService } from './account-email-service';
import type { AuthActionTokenService } from './action-token-service';
import type { TokenService } from './token-service';
import type { UserStore } from './user-store';
import { extractAuthContext } from './auth-context';
import { AuthError, type AuthContext, type ResolvedAuthBehaviorConfig } from './types';
import type { UserPropertyService } from './user-property-service';
import { getEmailRuntime } from '../email';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface AuthAdminPluginConfig {
  getUserStore: () => UserStore | null;
  getTokenService: () => TokenService | null;
  getPropertyService: () => UserPropertyService | null;
  getActionTokenService: () => AuthActionTokenService | null;
  getAccountEmailService: () => AccountEmailService | null;
  getAuthConfig: () => ResolvedAuthBehaviorConfig;
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

/**
 * Create the admin auth routes mounted under `/auth/admin`.
 *
 * These routes are intentionally admin-only and do not affect the public
 * register/login flow except through shared store state.
 */
export function createAuthAdminPlugin(config: AuthAdminPluginConfig) {
  return new Elysia({ name: 'auth-admin', prefix: '/admin' })
    .get('/config', async ({ request }) => {
      const { store } = await requireAdminServices(config, request);
      return buildAdminConfigResponse(store, config.getAuthConfig());
    })
    .get('/users', async ({ request }) => {
      const { store } = await requireAdminServices(config, request);
      return { users: store.listUsers() };
    })
    .get(
      '/users/:userId',
      async ({ request, params }) => {
        const { store } = await requireAdminServices(config, request);
        const user = store.getUserById(params.userId);
        if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        return { user };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
      }
    )
    .post(
      '/users',
      async ({ request, body }) => {
        const { store, propertyService, auth } = await requireAdminServices(config, request);
        const authConfig = config.getAuthConfig();

        if (authConfig.registration.mode === 'disabled') {
          emitPlatformCode(OBS_CODES.AUTH_REGISTRATION_DISABLED, {
            userId: auth.userId,
            metadata: { route: '/auth/admin/users' },
          });
          throw new AuthError('Registration disabled', 'REGISTRATION_DISABLED', 403);
        }

        const shouldSendSetupEmail = body.sendSetupEmail ?? authConfig.accountEmails.adminCreatedUser;
        const properties = {
          ...propertyService.getDefaultProperties(),
          ...propertyService.validateWrites(body.properties, 'admin'),
        };

        const user = await store.createUser({
          username: body.username,
          email: body.email,
          password: body.password ?? createTemporaryPassword(),
          firstName: body.firstName,
          lastName: body.lastName,
          role: body.role ?? 'user',
          passwordChangeRequired: body.passwordChangeRequired ?? shouldSendSetupEmail,
          properties,
        });

        let setupEmailSent = false;
        if (shouldSendSetupEmail) {
          setupEmailSent = await sendSetupEmail({
            store,
            actionTokens: config.getActionTokenService(),
            accountEmail: config.getAccountEmailService(),
            userId: user.userId,
            actorId: auth.userId,
          });
        }

        emitPlatformCode(OBS_CODES.AUTH_ADMIN_USER_CREATED, {
          userId: auth.userId,
          metadata: {
            createdUserId: user.userId,
            role: user.role,
            setupEmailSent,
          },
        });

        return { user: store.getUserById(user.userId)!, setupEmailSent };
      },
      {
        body: t.Object({
          username: t.String({ minLength: 1 }),
          email: t.String({ format: 'email' }),
          password: t.Optional(t.String({ minLength: 8 })),
          firstName: t.Optional(t.String()),
          lastName: t.Optional(t.String()),
          role: t.Optional(t.String()),
          passwordChangeRequired: t.Optional(t.Boolean()),
          sendSetupEmail: t.Optional(t.Boolean()),
          properties: t.Optional(t.Record(t.String(), t.Unknown())),
        }),
      }
    )
    .patch(
      '/users/:userId',
      async ({ request, params, body }) => {
        const { store, propertyService, auth } = await requireAdminServices(config, request);
        const existing = store.getUserById(params.userId);
        if (!existing) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);

        if (body.role !== undefined && existing.role === 'admin' && body.role !== 'admin') {
          assertNotLastAdmin(store);
        }

        const updated = store.updateUser(params.userId, {
          username: body.username,
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
          role: body.role,
          status: body.status,
          passwordChangeRequired: body.passwordChangeRequired,
        });
        if (!updated) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);

        const properties = propertyService.validateWrites(body.properties, 'admin');
        store.setProperties(params.userId, properties);

        const user = store.getUserById(params.userId)!;
        emitPlatformCode(OBS_CODES.AUTH_ADMIN_USER_UPDATED, {
          userId: auth.userId,
          metadata: { updatedUserId: user.userId },
        });

        return { user };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
        body: t.Object({
          username: t.Optional(t.String({ minLength: 1 })),
          email: t.Optional(t.String({ format: 'email' })),
          firstName: t.Optional(t.String()),
          lastName: t.Optional(t.String()),
          role: t.Optional(t.String()),
          status: t.Optional(t.Union([t.Literal('active'), t.Literal('suspended')])),
          passwordChangeRequired: t.Optional(t.Boolean()),
          properties: t.Optional(t.Record(t.String(), t.Unknown())),
        }),
      }
    )
    .delete(
      '/users/:userId',
      async ({ request, params }) => {
        const { store, auth } = await requireAdminServices(config, request);
        const existing = store.getUserById(params.userId);
        if (!existing) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        if (existing.role === 'admin') assertNotLastAdmin(store);

        store.deleteUser(params.userId);
        emitPlatformCode(OBS_CODES.AUTH_ADMIN_USER_DELETED, {
          userId: auth.userId,
          metadata: { deletedUserId: params.userId },
        });

        return { ok: true };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
      }
    )
    .put(
      '/users/:userId/properties/:key',
      async ({ request, params, body }) => {
        const { store, propertyService } = await requireAdminServices(config, request);
        assertUserExists(store, params.userId);

        const value = propertyService.validateWrite(params.key, body.value, 'admin');
        store.setProperty(params.userId, params.key, value);

        return { ok: true };
      },
      {
        params: t.Object({
          userId: t.String({ minLength: 1 }),
          key: t.String({ minLength: 1 }),
        }),
        body: t.Object({ value: t.Unknown() }),
      }
    )
    .patch(
      '/users/:userId/properties',
      async ({ request, params, body }) => {
        const { store, propertyService } = await requireAdminServices(config, request);
        assertUserExists(store, params.userId);

        const properties = propertyService.validateWrites(body.properties, 'admin');
        store.setProperties(params.userId, properties);

        return { ok: true };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
        body: t.Object({
          properties: t.Record(t.String(), t.Unknown()),
        }),
      }
    )
    .delete(
      '/users/:userId/properties/:key',
      async ({ request, params }) => {
        const { store, propertyService } = await requireAdminServices(config, request);
        assertUserExists(store, params.userId);
        propertyService.deleteProperty(params.userId, params.key, 'admin', store);
        return { ok: true };
      },
      {
        params: t.Object({
          userId: t.String({ minLength: 1 }),
          key: t.String({ minLength: 1 }),
        }),
      }
    )
    .post(
      '/users/:userId/reset-password',
      async ({ request, params, body }) => {
        const { store, auth } = await requireAdminServices(config, request);
        const ok = await store.resetPassword(params.userId, body.password);
        if (!ok) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);

        emitPlatformCode(OBS_CODES.AUTH_ADMIN_PASSWORD_RESET, {
          userId: auth.userId,
          metadata: { resetUserId: params.userId },
        });

        return { ok: true };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
        body: t.Object({ password: t.String({ minLength: 8 }) }),
      }
    )
    .post(
      '/users/:userId/send-setup-email',
      async ({ request, params }) => {
        const { store, auth } = await requireAdminServices(config, request);
        const setupEmailSent = await sendSetupEmail({
          store,
          actionTokens: config.getActionTokenService(),
          accountEmail: config.getAccountEmailService(),
          userId: params.userId,
          actorId: auth.userId,
        });

        emitPlatformCode(OBS_CODES.AUTH_ADMIN_SETUP_EMAIL_SENT, {
          userId: auth.userId,
          metadata: { targetUserId: params.userId },
        });

        return { ok: true, setupEmailSent };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
      }
    )
    .post(
      '/users/:userId/send-password-reset',
      async ({ request, params }) => {
        const { store, auth } = await requireAdminServices(config, request);
        const authConfig = config.getAuthConfig();
        if (!authConfig.accountEmails.passwordReset) {
          throw new AuthError('Password reset email is disabled', 'PASSWORD_RESET_DISABLED', 403);
        }

        const user = store.getUserById(params.userId);
        if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        if (user.status === 'suspended') {
          throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
        }

        const actionTokens = config.getActionTokenService();
        const accountEmail = config.getAccountEmailService();
        if (!actionTokens || !accountEmail) {
          throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
        }

        store.requirePasswordChange(user.userId);
        const updated = store.getUserById(user.userId)!;
        const created = actionTokens.create({
          userId: updated.userId,
          type: 'admin_password_reset',
          createdBy: auth.userId,
          metadata: { source: 'admin' },
        });

        await accountEmail.sendPasswordReset({
          user: updated,
          rawToken: created.rawToken,
          token: created.record,
        });

        emitPlatformCode(OBS_CODES.AUTH_ADMIN_PASSWORD_RESET_EMAIL_SENT, {
          userId: auth.userId,
          metadata: { resetUserId: updated.userId },
        });

        return { ok: true };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
      }
    )
    .post(
      '/users/:userId/suspend',
      async ({ request, params }) => {
        const { store, auth } = await requireAdminServices(config, request);
        const existing = store.getUserById(params.userId);
        if (!existing) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        if (existing.role === 'admin') assertNotLastAdmin(store);

        const user = store.updateUser(params.userId, { status: 'suspended' });
        store.revokeAllUserTokens(params.userId);
        emitPlatformCode(OBS_CODES.AUTH_ACCOUNT_SUSPENDED, {
          userId: auth.userId,
          metadata: { targetUserId: params.userId },
        });

        return { user };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
      }
    )
    .post(
      '/users/:userId/activate',
      async ({ request, params }) => {
        const { store, auth } = await requireAdminServices(config, request);
        const user = store.updateUser(params.userId, { status: 'active' });
        if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);

        emitPlatformCode(OBS_CODES.AUTH_ACCOUNT_REACTIVATED, {
          userId: auth.userId,
          metadata: { targetUserId: params.userId },
        });

        return { user };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
      }
    )
    .post(
      '/users/:userId/revoke-sessions',
      async ({ request, params }) => {
        const { store } = await requireAdminServices(config, request);
        assertUserExists(store, params.userId);
        store.revokeAllUserTokens(params.userId);
        return { ok: true };
      },
      {
        params: t.Object({ userId: t.String({ minLength: 1 }) }),
      }
    );
}

interface AdminServices {
  store: UserStore;
  propertyService: UserPropertyService;
  auth: AuthContext;
}

async function requireAdminServices(
  config: AuthAdminPluginConfig,
  request: Request
): Promise<AdminServices> {
  const store = config.getUserStore();
  const tokenService = config.getTokenService();
  const propertyService = config.getPropertyService();

  if (!store || !tokenService || !propertyService) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }

  const auth = await extractAuthContext(request, tokenService);
  if (!auth) throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
  if (auth.role !== 'admin') throw new AuthError('Forbidden', 'FORBIDDEN', 403);

  return { store, propertyService, auth };
}

function assertNotLastAdmin(store: UserStore): void {
  if (store.countUsersByRole('admin') <= 1) {
    throw new AuthError('Cannot remove the last admin', 'LAST_ADMIN_REQUIRED', 400);
  }
}

function assertUserExists(store: UserStore, userId: string): void {
  if (!store.getUserById(userId)) {
    throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
  }
}

function buildAdminConfigResponse(
  store: UserStore,
  config: ResolvedAuthBehaviorConfig
) {
  const userCount = store.countUsers();
  const emailRuntime = getEmailRuntime();

  return {
    registration: {
      ...config.registration,
      bootstrapRequired: userCount === 0,
      publicRegistrationEnabled: userCount === 0 || config.registration.mode === 'public',
      userCount,
    },
    email: {
      enabled: emailRuntime.enabled,
      provider: emailRuntime.provider.name,
      hasPublicUrl: Boolean(emailRuntime.app.publicUrl),
    },
    accountEmails: {
      ...config.accountEmails,
      adminCreatedUser: config.accountEmails.adminCreatedUser && emailRuntime.enabled,
      passwordReset: config.accountEmails.passwordReset && emailRuntime.enabled,
      passwordChangedNotice: config.accountEmails.passwordChangedNotice && emailRuntime.enabled,
    },
    userProperties: config.userProperties,
    strictUserProperties: config.strictUserProperties,
  };
}

async function sendSetupEmail(params: {
  store: UserStore;
  actionTokens: AuthActionTokenService | null;
  accountEmail: AccountEmailService | null;
  userId: string;
  actorId: string;
}): Promise<boolean> {
  if (!params.actionTokens || !params.accountEmail) {
    throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
  }

  const user = params.store.getUserById(params.userId);
  if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
  if (user.status === 'suspended') {
    throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
  }

  params.store.requirePasswordChange(user.userId);
  const updated = params.store.getUserById(user.userId)!;
  const created = params.actionTokens.create({
    userId: updated.userId,
    type: 'account_setup',
    createdBy: params.actorId,
    metadata: { source: 'admin' },
  });

  await params.accountEmail.sendAccountSetup({
    user: updated,
    rawToken: created.rawToken,
    token: created.record,
  });

  return true;
}

function createTemporaryPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}
