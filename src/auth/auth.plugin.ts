/**
 * auth.plugin.ts
 *
 * Main Elysia controller for Zero auth. This file owns route registration,
 * plugin lifecycle, and HTTP validation; user persistence, token operations,
 * auth-context extraction, and user-property validation live in dedicated
 * services.
 */

import { Elysia, t } from 'elysia';
import { UserStore } from './user-store';
import { TokenService } from './token-service';
import { AuthError, type UserRecord } from './types';
import type { AuthPluginConfig } from './types';
import { extractAuthContext } from './auth-context';
import { createAuthAdminPlugin } from './auth-admin.plugin';
import { createAuthAccountPlugin } from './auth-account.plugin';
import { resolveAuthBehaviorConfig } from './auth-config';
import { UserPropertyService } from './user-property-service';
import { AuthActionTokenService } from './action-token-service';
import { AccountEmailService } from './account-email-service';
import { getEmailRuntime } from '../email';
import { getPlatformTokenService } from '../tokens';
import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

// ─── Module-Level Singletons ──────────────────────────────────────────────

let _userStore: UserStore | null = null;
let _tokenService: TokenService | null = null;
let _propertyService: UserPropertyService | null = null;
let _actionTokenService: AuthActionTokenService | null = null;
let _accountEmailService: AccountEmailService | null = null;

/**
 * Get the UserStore instance. Returns null if the auth plugin hasn't started.
 * Use this for cross-plugin access.
 */
export function getAuthStore(): UserStore | null {
  return _userStore;
}

/**
 * Get the TokenService instance. Returns null if the auth plugin hasn't started.
 * Use this for cross-plugin access (e.g., auth middleware needs this).
 */
export function getTokenService(): TokenService | null {
  return _tokenService;
}

// ─── Table Definitions ────────────────────────────────────────────────────

/**
 * Define all auth tables on the shared ReactiveDB.
 *
 * Public tables go through defineTable() — get change tracking + broadcast.
 * Internal tables (_prefix) are created via raw SQL — no broadcast.
 */
function defineAuthTables(db: ReactiveDB): void {
  // Create/upgrade users before defineTable() prepares statements for all
  // lifecycle columns. Existing databases may have been created before these
  // columns existed.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id                  TEXT PRIMARY KEY,
      username                 TEXT UNIQUE NOT NULL,
      email                    TEXT UNIQUE NOT NULL,
      first_name               TEXT,
      last_name                TEXT,
      role                     TEXT NOT NULL DEFAULT 'user',
      status                   TEXT NOT NULL DEFAULT 'active',
      password_change_required INTEGER NOT NULL DEFAULT 0,
      created_at               INTEGER NOT NULL,
      updated_at               INTEGER
    )
  `);
  ensureColumn(db, 'users', 'status', "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, 'users', 'password_change_required', 'INTEGER NOT NULL DEFAULT 0');

  // Public: users — reactive, broadcast to sync subscribers
  db.defineTable('users', {
    user_id: 'text primary key',
    username: 'text unique not null',
    email: 'text unique not null',
    first_name: 'text',
    last_name: 'text',
    role: "text not null default 'user'",
    status: "text not null default 'active'",
    password_change_required: 'integer not null default 0',
    created_at: 'integer not null',
    updated_at: 'integer',
  });

  // Public: user_properties — composite PK, created via raw SQL
  // (ReactiveDB.defineTable only supports single-column PKs)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_properties (
      user_id TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  // Internal: _credentials — password hashes, never broadcast
  db.exec(`
    CREATE TABLE IF NOT EXISTS _credentials (
      user_id       TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  // Internal: _refresh_tokens — hashed tokens, never broadcast
  db.exec(`
    CREATE TABLE IF NOT EXISTS _refresh_tokens (
      token_id   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON _refresh_tokens(token_hash)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON _refresh_tokens(user_id)'
  );

  // Internal: _auth_action_tokens — hashed reset/setup tokens, never broadcast
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_action_tokens (
      token_id    TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      token_hash  TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at  INTEGER NOT NULL,
      created_by  TEXT,
      metadata    TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_hash ON _auth_action_tokens(token_hash)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user ON _auth_action_tokens(user_id)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user_type_created ON _auth_action_tokens(user_id, type, created_at)'
  );

  // Internal: _auth_config — signing key storage, never broadcast
  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function ensureColumn(
  db: ReactiveDB,
  table: string,
  column: string,
  definition: string
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// ─── Error Handler ────────────────────────────────────────────────────────

function authErrorResponse(err: AuthError) {
  return {
    error: err.message,
    code: err.code,
  };
}

// ─── Plugin ───────────────────────────────────────────────────────────────

/**
 * Create the auth Elysia plugin.
 *
 * - Defines auth tables on the shared ReactiveDB (onStart)
 * - Initializes UserStore + TokenService
 * - Registers /auth/* routes: register, login, refresh, logout, change-password, me, jwks
 * - Derives authStore and tokenService into global Elysia context
 *
 * Composition: mount BEFORE auth middleware, which needs getTokenService().
 */
export function createAuthPlugin(config: AuthPluginConfig) {
  const authConfig = resolveAuthBehaviorConfig(config);

  return new Elysia({ name: 'auth', prefix: '/auth' })

    // ─── Lifecycle ─────────────────────────────────────
    .onStart(async () => {
      // Enable foreign keys (must be set per-connection, before any table creation)
      config.db.exec('PRAGMA foreign_keys = ON');

      // Define all auth tables
      defineAuthTables(config.db);

      // Create UserStore (synchronous — just prepares statements)
      _userStore = new UserStore(config.db);
      _propertyService = new UserPropertyService(authConfig);
      _actionTokenService = new AuthActionTokenService(
        _userStore,
        authConfig.accountEmails.actionTokenTTL,
        authConfig.accountEmails.requestCooldown,
        getPlatformTokenService()
      );
      _accountEmailService = new AccountEmailService(getEmailRuntime, authConfig);

      // Create TokenService (async — loads or generates keypair)
      _tokenService = await TokenService.create({
        db: config.db,
        accessTokenTTL: config.accessTokenTTL,
        refreshTokenTTL: config.refreshTokenTTL,
      });

      // Wire the circular dependency
      _tokenService.setUserStore(_userStore);

      emitPlatformCode(OBS_CODES.AUTH_STARTED, {
        metadata: { tablesDefined: true, keypairInitialized: true },
      });
    })

    .onStop(() => {
      _userStore = null;
      _tokenService = null;
      _propertyService = null;
      _actionTokenService = null;
      _accountEmailService = null;
      emitPlatformCode(OBS_CODES.AUTH_STOPPED);
    })

    // ─── Derive: expose services globally ──────────────
    .derive({ as: 'global' }, () => ({
      authStore: _userStore,
      tokenService: _tokenService,
    }))

    // ─── Error handler for AuthError ───────────────────
    .onError(({ error, set }) => {
      if (error instanceof AuthError) {
        set.status = error.status;
        return authErrorResponse(error);
      }
    })

    .use(createAuthAccountPlugin({
      getUserStore: () => _userStore,
      getTokenService: () => _tokenService,
      getActionTokenService: () => _actionTokenService,
      getAccountEmailService: () => _accountEmailService,
      getAuthConfig: () => authConfig,
    }))

    .use(createAuthAdminPlugin({
      getUserStore: () => _userStore,
      getTokenService: () => _tokenService,
      getPropertyService: () => _propertyService,
      getActionTokenService: () => _actionTokenService,
      getAccountEmailService: () => _accountEmailService,
      getAuthConfig: () => authConfig,
    }))

    // ─── GET /auth/config ───────────────────────────────
    .get('/config', () => {
      if (!_userStore) {
        throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
      }

      const userCount = _userStore.countUsers();
      const emailRuntime = getEmailRuntime();
      const accountEmailReady = emailRuntime.enabled && Boolean(emailRuntime.app.publicUrl);
      return {
        registration: {
          ...authConfig.registration,
          bootstrapRequired: userCount === 0,
          publicRegistrationEnabled: userCount === 0 || authConfig.registration.mode === 'public',
          userCount,
        },
        accountEmails: {
          adminCreatedUser: authConfig.accountEmails.adminCreatedUser && accountEmailReady,
          passwordReset: authConfig.accountEmails.passwordReset && accountEmailReady,
          passwordChangedNotice: authConfig.accountEmails.passwordChangedNotice && accountEmailReady,
        },
        userProperties: Object.fromEntries(
          Object.entries(authConfig.userProperties)
            .filter(([, field]) => field.editableBy === 'user')
        ),
        strictUserProperties: authConfig.strictUserProperties,
      };
    })

    // ─── POST /auth/register ───────────────────────────
    .post(
      '/register',
      async ({ body }) => {
        if (!_userStore || !_tokenService || !_propertyService) {
          throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
        }

        const userCount = _userStore.countUsers();
        const isBootstrap = userCount === 0;

        if (!isBootstrap && authConfig.registration.mode !== 'public') {
          emitPlatformCode(OBS_CODES.AUTH_REGISTRATION_DISABLED, {
            metadata: { mode: authConfig.registration.mode },
          });
          throw new AuthError('Registration disabled', 'REGISTRATION_DISABLED', 403);
        }

        const user = await _userStore.createUser({
          username: body.username,
          email: body.email,
          password: body.password,
          firstName: body.firstName,
          lastName: body.lastName,
          role: isBootstrap ? 'admin' : 'user',
          properties: _propertyService.getDefaultProperties(),
        });

        const tokens = await _tokenService.issueTokenPair(user);

        if (isBootstrap && user.role === 'admin') {
          emitPlatformCode(OBS_CODES.AUTH_FIRST_ADMIN_BOOTSTRAPPED, {
            userId: user.userId,
          });
        }

        return {
          user: toAuthUserResponse(user),
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        };
      },
      {
        body: t.Object({
          username: t.String({ minLength: 1 }),
          email: t.String({ format: 'email' }),
          password: t.String({ minLength: 8 }),
          firstName: t.Optional(t.String()),
          lastName: t.Optional(t.String()),
        }),
      }
    )

    // ─── POST /auth/login ──────────────────────────────
    .post(
      '/login',
      async ({ body }) => {
        if (!_userStore || !_tokenService) {
          throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
        }

        // Look up user by username or email
        let user =
          _userStore.getUserByUsername(body.username) ??
          _userStore.getUserByEmail(body.username);

        if (!user) {
          throw new AuthError(
            'Invalid credentials',
            'INVALID_CREDENTIALS',
            401
          );
        }

        const valid = await _userStore.verifyPassword(
          user.userId,
          body.password
        );
        if (!valid) {
          throw new AuthError(
            'Invalid credentials',
            'INVALID_CREDENTIALS',
            401
          );
        }

        if (user.status === 'suspended') {
          throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
        }

        if (user.passwordChangeRequired) {
          throw new AuthError('Password change required', 'PASSWORD_CHANGE_REQUIRED', 403);
        }

        _propertyService?.applyMissingDefaults(user.userId, _userStore);
        user = _userStore.getUserById(user.userId)!;

        const tokens = await _tokenService.issueTokenPair(user);

        return {
          user: toAuthUserResponse(user),
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        };
      },
      {
        body: t.Object({
          username: t.String({ minLength: 1 }),
          password: t.String({ minLength: 1 }),
        }),
      }
    )

    // ─── POST /auth/refresh ────────────────────────────
    .post(
      '/refresh',
      async ({ body }) => {
        if (!_tokenService) {
          throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
        }

        const result = await _tokenService.rotateRefreshToken(
          body.refreshToken
        );
        if (!result) {
          throw new AuthError(
            'Invalid or expired refresh token',
            'INVALID_REFRESH_TOKEN',
            401
          );
        }

        return {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        };
      },
      {
        body: t.Object({
          refreshToken: t.String({ minLength: 1 }),
        }),
      }
    )

    // ─── POST /auth/logout ─────────────────────────────
    .post(
      '/logout',
      async ({ body, request }) => {
        if (!_tokenService) {
          throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
        }

        // Revoke the refresh token (access token is stateless — expires naturally)
        _tokenService.revokeRefreshTokenByRaw(body.refreshToken);

        return { ok: true };
      },
      {
        body: t.Object({
          refreshToken: t.String({ minLength: 1 }),
        }),
      }
    )

    // ─── POST /auth/change-password ────────────────────
    .post(
      '/change-password',
      async ({ body, request }) => {
        if (!_userStore || !_tokenService) {
          throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
        }

        // Requires auth — verify access token from header
        const authContext = await extractAuthContext(request, _tokenService);
        if (!authContext) {
          throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
        }

        const changed = await _userStore.updatePassword(
          authContext.userId,
          body.currentPassword,
          body.newPassword
        );

        if (!changed) {
          throw new AuthError(
            'Current password is incorrect',
            'INVALID_PASSWORD',
            400
          );
        }

        // Issue fresh tokens after password change
        const user = _userStore.getUserById(authContext.userId);
        if (!user) {
          throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
        }
        if (user.status === 'suspended') {
          throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
        }

        const tokens = await _tokenService.issueTokenPair(user);

        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        };
      },
      {
        body: t.Object({
          currentPassword: t.String({ minLength: 1 }),
          newPassword: t.String({ minLength: 8 }),
        }),
      }
    )

    // ─── GET /auth/me ──────────────────────────────────
    .get('/me', async ({ request }) => {
      if (!_userStore || !_tokenService) {
        throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
      }

      const authContext = await extractAuthContext(request, _tokenService);
      if (!authContext) {
        throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
      }

      const user = _userStore.getUserById(authContext.userId);
      if (!user) {
        throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
      }

      _propertyService?.applyMissingDefaults(user.userId, _userStore);
      return toAuthUserResponse(_userStore.getUserById(user.userId)!);
    })

    // ─── PUT /auth/me/properties/:key ──────────────────
    .put(
      '/me/properties/:key',
      async ({ params, body, request }) => {
        if (!_userStore || !_tokenService || !_propertyService) {
          throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
        }

        const authContext = await extractAuthContext(request, _tokenService);
        if (!authContext) {
          throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
        }

        let value: string;
        try {
          value = _propertyService.validateWrite(params.key, body.value, 'user');
        } catch (err) {
          emitPlatformCode(OBS_CODES.AUTH_USER_PROPERTY_REJECTED, {
            error: err,
            userId: authContext.userId,
            metadata: { key: params.key },
          });
          throw err;
        }

        _userStore.setProperty(authContext.userId, params.key, value);
        return { ok: true };
      },
      {
        params: t.Object({ key: t.String({ minLength: 1 }) }),
        body: t.Object({ value: t.Unknown() }),
      }
    )

    // ─── GET /auth/me/properties ─────────────────────
    .get('/me/properties', async ({ request }) => {
      if (!_userStore || !_tokenService) {
        throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
      }

      const authContext = await extractAuthContext(request, _tokenService);
      if (!authContext) {
        throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
      }

      return { properties: _userStore.getProperties(authContext.userId) };
    })

    // ─── GET /auth/me/properties/:key ────────────────
    .get(
      '/me/properties/:key',
      async ({ params, request }) => {
        if (!_userStore || !_tokenService || !_propertyService) {
          throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
        }

        const authContext = await extractAuthContext(request, _tokenService);
        if (!authContext) {
          throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
        }

        const value = _userStore.getProperty(authContext.userId, params.key);
        if (value === null) {
          throw new AuthError('Property not found', 'PROPERTY_NOT_FOUND', 404);
        }

        return { key: params.key, value };
      },
      {
        params: t.Object({ key: t.String({ minLength: 1 }) }),
      }
    )

    // ─── DELETE /auth/me/properties/:key ─────────────
    .delete(
      '/me/properties/:key',
      async ({ params, request }) => {
        if (!_userStore || !_tokenService || !_propertyService) {
          throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
        }

        const authContext = await extractAuthContext(request, _tokenService);
        if (!authContext) {
          throw new AuthError('Unauthorized', 'UNAUTHORIZED', 401);
        }

        try {
          _propertyService.deleteProperty(authContext.userId, params.key, 'user', _userStore);
        } catch (err) {
          emitPlatformCode(OBS_CODES.AUTH_USER_PROPERTY_REJECTED, {
            error: err,
            userId: authContext.userId,
            metadata: { key: params.key },
          });
          throw err;
        }
        return { ok: true };
      },
      {
        params: t.Object({ key: t.String({ minLength: 1 }) }),
      }
    )

    // ─── GET /auth/jwks ────────────────────────────────
    .get('/jwks', () => {
      if (!_tokenService) {
        throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
      }

      return _tokenService.getJWKS();
    });
}

// ─── Internal Helpers ─────────────────────────────────────────────────────

/**
 * Return the public user payload used by auth route responses.
 */
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
