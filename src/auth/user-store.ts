/**
 * user-store.ts
 *
 * Owns SQLite persistence for auth users, credentials, user properties,
 * refresh tokens, and auth config. This store hides SQL details from Elysia
 * route handlers; it does not verify request tokens or make HTTP decisions.
 */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type {
  AuthActionTokenRecord,
  AuthActionTokenType,
  RefreshTokenRecord,
  UserRecord,
  UserStatus,
} from './types';
import { AuthError } from './types';
import { AuthGenerationStore } from './auth-generation-store';
import { canonicalizeEmail, isValidEmail } from './auth-email-identity';

// ─── SQL Row Types ─────────────────────────────────────────────────────────

interface UserRow {
  user_id: string;
  username: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  status: UserStatus;
  password_change_required: number;
  email_verified_at: number | null;
  email_verification_required: number;
  mfa_required: number;
  created_at: number;
  updated_at: number | null;
}

interface PropertyRow {
  user_id: string;
  key: string;
  value: string | null;
}

interface CredentialRow {
  user_id: string;
  password_hash: string;
}

interface RefreshTokenRow {
  token_id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
  revoked_at: number | null;
}

interface AuthActionTokenRow {
  token_id: string;
  user_id: string;
  type: AuthActionTokenType;
  token_hash: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
  created_by: string | null;
  metadata: string | null;
}

interface ConfigRow {
  key: string;
  value: string;
}

interface CountRow {
  count: number;
}

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: UserStatus;
  passwordChangeRequired?: boolean;
  emailVerifiedAt?: number | null;
  emailVerificationRequired?: boolean;
  mfaRequired?: boolean;
  properties?: Record<string, string>;
}

export interface AtomicRegistrationPolicy {
  role: 'admin' | 'user';
  requireEmailVerification: boolean;
  mfaRequired: boolean;
}

export interface RefreshTokenReplacement {
  tokenId: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
}

export type RefreshTokenRotationResult = 'rotated' | 'replayed' | 'invalid';

interface PreparedUserCreate {
  params: CreateUserInput;
  email: string;
  userId: string;
  now: number;
  passwordHash: string;
}

/** Filter and pagination options for admin user listing. */
export interface UserListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  role?: string;
  status?: UserStatus;
}

export const USER_LIST_DEFAULT_LIMIT = 50;
export const USER_LIST_MAX_LIMIT = 200;

// ─── UserStore ─────────────────────────────────────────────────────────────

/**
 * SQLite operations for auth data.
 *
 * Two write paths:
 * - Public users table → through ReactiveDB for reactivity
 * - User properties table → direct SQL because it has a composite primary key
 * - Internal tables (_credentials, _refresh_tokens, _auth_config) → direct prepared statements
 *
 * All statements prepared once in constructor, reused per call.
 */
export class UserStore {
  private stmts: {
    // Users (public — reads via prepared stmt, writes via ReactiveDB)
    getUserById: Statement;
    getUserByUsername: Statement;
    getUsersByCanonicalEmail: Statement;
    listUsers: Statement;
    countUsers: Statement;
    countUsersByRole: Statement;
    countActiveAdmins: Statement;

    // Credentials (internal — direct SQL, no broadcast)
    insertCredential: Statement;
    getCredential: Statement;
    updateCredential: Statement;

    // Properties (composite PK — managed via prepared stmts, not ReactiveDB)
    insertProperty: Statement;
    getProperty: Statement;
    getProperties: Statement;
    deleteProperty: Statement;

    // Refresh tokens (internal — direct SQL)
    insertRefreshToken: Statement;
    insertRefreshTokenIfCurrent: Statement;
    getRefreshTokenById: Statement;
    getRefreshTokenByHash: Statement;
    consumeRefreshToken: Statement;
    revokeRefreshToken: Statement;
    revokeAllUserTokens: Statement;
    deleteExpiredTokens: Statement;

    // Action tokens (internal — direct SQL)
    insertActionToken: Statement;
    getActionTokenByHash: Statement;
    consumeActionToken: Statement;
    deleteActionToken: Statement;
    countRecentActionTokens: Statement;
    deleteExpiredActionTokens: Statement;

    // Auth config (internal — direct SQL)
    getConfig: Statement;
    setConfig: Statement;
    acquireRegistrationWriteLock: Statement;
  };
  private readonly authGenerations: AuthGenerationStore;

  constructor(private db: ReactiveDB) {
    this.authGenerations = new AuthGenerationStore(db);

    this.stmts = {
      // Users
      getUserById: db.prepare('SELECT * FROM users WHERE user_id = ?'),
      getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
      getUsersByCanonicalEmail: db.prepare(
        `SELECT * FROM users
         WHERE lower(trim(email)) = ?
         ORDER BY created_at ASC, user_id ASC
         LIMIT 2`
      ),
      listUsers: db.prepare('SELECT * FROM users ORDER BY created_at DESC'),
      countUsers: db.prepare('SELECT COUNT(*) as count FROM users'),
      countUsersByRole: db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?'),
      countActiveAdmins: db.prepare(
        `SELECT COUNT(*) as count FROM users
         WHERE role = 'admin'
           AND status = 'active'
           AND password_change_required = 0
           AND (email_verification_required = 0 OR email_verified_at IS NOT NULL)`
      ),

      // Credentials
      insertCredential: db.prepare(
        'INSERT INTO _credentials (user_id, password_hash) VALUES (?, ?)'
      ),
      getCredential: db.prepare(
        'SELECT * FROM _credentials WHERE user_id = ?'
      ),
      updateCredential: db.prepare(
        'UPDATE _credentials SET password_hash = ? WHERE user_id = ?'
      ),

      // Properties (composite PK — INSERT OR REPLACE for upsert)
      insertProperty: db.prepare(
        'INSERT OR REPLACE INTO user_properties (user_id, key, value) VALUES (?, ?, ?)'
      ),
      getProperty: db.prepare(
        'SELECT value FROM user_properties WHERE user_id = ? AND key = ?'
      ),
      getProperties: db.prepare(
        'SELECT key, value FROM user_properties WHERE user_id = ?'
      ),
      deleteProperty: db.prepare(
        'DELETE FROM user_properties WHERE user_id = ? AND key = ?'
      ),

      // Refresh tokens
      insertRefreshToken: db.prepare(
        'INSERT INTO _refresh_tokens (token_id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
      ),
      insertRefreshTokenIfCurrent: db.prepare(
        `INSERT INTO _refresh_tokens
           (token_id, user_id, token_hash, expires_at, created_at)
         SELECT ?, users.user_id, ?, ?, ? FROM users
         WHERE users.user_id = ?
           AND users.email = ?
           AND users.role = ?
           AND users.status = 'active'
           AND users.password_change_required = 0
           AND (users.email_verification_required = 0
             OR users.email_verified_at IS NOT NULL)
           AND COALESCE((SELECT generation FROM _auth_user_generations
             WHERE user_id = users.user_id), 0) = ?`
      ),
      getRefreshTokenById: db.prepare(
        'SELECT * FROM _refresh_tokens WHERE token_id = ?'
      ),
      getRefreshTokenByHash: db.prepare(
        'SELECT * FROM _refresh_tokens WHERE token_hash = ?'
      ),
      consumeRefreshToken: db.prepare(
        `UPDATE _refresh_tokens SET revoked_at = ?
         WHERE token_id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
           AND COALESCE((SELECT generation FROM _auth_user_generations
             WHERE user_id = _refresh_tokens.user_id), 0) = ?
           AND EXISTS (SELECT 1 FROM users
             WHERE users.user_id = _refresh_tokens.user_id
               AND users.status = 'active'
               AND users.password_change_required = 0
               AND (users.email_verification_required = 0
                 OR users.email_verified_at IS NOT NULL))`
      ),
      revokeRefreshToken: db.prepare(
        'UPDATE _refresh_tokens SET revoked_at = ? WHERE token_id = ?'
      ),
      revokeAllUserTokens: db.prepare(
        'UPDATE _refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'
      ),
      deleteExpiredTokens: db.prepare(
        'DELETE FROM _refresh_tokens WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)'
      ),

      // Action tokens
      insertActionToken: db.prepare(
        'INSERT INTO _auth_action_tokens (token_id, user_id, type, token_hash, expires_at, created_at, created_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      getActionTokenByHash: db.prepare(
        'SELECT * FROM _auth_action_tokens WHERE token_hash = ?'
      ),
      consumeActionToken: db.prepare(
        'UPDATE _auth_action_tokens SET consumed_at = ? WHERE token_id = ? AND consumed_at IS NULL'
      ),
      deleteActionToken: db.prepare(
        'DELETE FROM _auth_action_tokens WHERE token_id = ?'
      ),
      countRecentActionTokens: db.prepare(
        `SELECT COUNT(*) as count
         FROM _auth_action_tokens
         WHERE user_id = ?
           AND type = ?
           AND consumed_at IS NULL
           AND expires_at > ?
           AND created_at >= ?`
      ),
      deleteExpiredActionTokens: db.prepare(
        'DELETE FROM _auth_action_tokens WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)'
      ),

      // Auth config
      getConfig: db.prepare('SELECT value FROM _auth_config WHERE key = ?'),
      setConfig: db.prepare(
        'INSERT OR REPLACE INTO _auth_config (key, value) VALUES (?, ?)'
      ),
      acquireRegistrationWriteLock: db.prepare(
        `INSERT INTO _auth_config (key, value)
         VALUES ('auth.registration.write_lock', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ),
    };
  }

  // ─── User CRUD ───────────────────────────────────────────────────────

  /**
   * Canonical alias for createUser().
   *
   * Use this from app-owned backend code when `zero.auth.store` already makes
   * the user domain obvious.
   */
  async create(params: Parameters<UserStore['createUser']>[0]): Promise<UserRecord> {
    return this.createUser(params);
  }

  /**
   * Create a new user with hashed password.
   * Writes user row via ReactiveDB (broadcast) + credential via direct SQL (no broadcast).
   * Atomic — if credential insert fails, user row is rolled back.
   */
  async createUser(params: CreateUserInput): Promise<UserRecord> {
    const prepared = await this.prepareUserCreate(params);
    return this.db.transaction(() => this.insertPreparedUser(prepared));
  }

  /**
   * Create a self-registered user after resolving bootstrap policy atomically.
   * The lock write is the first statement in the transaction, so every
   * registration observes users committed by the preceding registration.
   */
  async createRegistrationUser<TPolicy extends AtomicRegistrationPolicy>(
    params: Omit<CreateUserInput,
      'role' | 'emailVerifiedAt' | 'emailVerificationRequired' | 'mfaRequired'>,
    resolvePolicy: (isBootstrap: boolean) => TPolicy,
    afterInsert?: (user: UserRecord) => void
  ): Promise<{ user: UserRecord; policy: TPolicy }> {
    const prepared = await this.prepareUserCreate(params);
    return this.db.transaction(() => {
      this.stmts.acquireRegistrationWriteLock.run();
      const policy = resolvePolicy(this.countUsers() === 0);
      const user = this.insertPreparedUser({
        ...prepared,
        params: {
          ...params,
          role: policy.role,
          emailVerifiedAt: policy.requireEmailVerification ? null : Date.now(),
          emailVerificationRequired: policy.requireEmailVerification,
          mfaRequired: policy.mfaRequired,
        },
      });
      afterInsert?.(user);
      return { user, policy };
    });
  }

  private async prepareUserCreate(params: CreateUserInput): Promise<PreparedUserCreate> {
    const email = this.requireCanonicalEmail(params.email);
    this.assertNewUserIdentityAvailable(params.username, email);
    return {
      params,
      email,
      userId: `u_${crypto.randomUUID()}`,
      now: Date.now(),
      passwordHash: await Bun.password.hash(params.password),
    };
  }

  private insertPreparedUser(prepared: PreparedUserCreate): UserRecord {
    const { params, email, userId, now, passwordHash } = prepared;
    // Password hashing yields. Recheck inside the write transaction so a
    // concurrent identity cannot be replaced by ReactiveDB's upsert primitive.
    this.assertNewUserIdentityAvailable(params.username, email);
    this.db.insert('users', {
      user_id: userId,
      username: params.username,
      email,
      first_name: params.firstName ?? null,
      last_name: params.lastName ?? null,
      role: params.role ?? 'user',
      status: params.status ?? 'active',
      password_change_required: params.passwordChangeRequired ? 1 : 0,
      email_verified_at: params.emailVerifiedAt ?? null,
      email_verification_required: params.emailVerificationRequired ? 1 : 0,
      mfa_required: params.mfaRequired ? 1 : 0,
      created_at: now,
      updated_at: null,
    });
    this.stmts.insertCredential.run(userId, passwordHash);
    for (const [key, value] of Object.entries(params.properties ?? {})) {
      this.stmts.insertProperty.run(userId, key, value);
    }
    return this.toUserRecord(
      this.stmts.getUserById.get(userId) as UserRow,
      this.loadProperties(userId)
    );
  }

  private assertNewUserIdentityAvailable(username: string, email: string): void {
    if (this.getUserByUsername(username)) {
      throw new AuthError('Username taken', 'DUPLICATE_USERNAME', 409);
    }
    this.assertEmailAvailable(email);
  }

  /**
   * Get user by ID. Returns null if not found.
   */
  getUserById(userId: string): UserRecord | null {
    const row = this.stmts.getUserById.get(userId) as UserRow | null;
    if (!row) return null;
    return this.toUserRecord(row, this.loadProperties(userId));
  }

  /** Canonical alias for getUserById(). */
  get(userId: string): UserRecord | null {
    return this.getUserById(userId);
  }

  /**
   * Get user by username. Returns null if not found.
   */
  getUserByUsername(username: string): UserRecord | null {
    const row = this.stmts.getUserByUsername.get(username) as UserRow | null;
    if (!row) return null;
    return this.toUserRecord(row, this.loadProperties(row.user_id));
  }

  /**
   * Get user by email. Returns null if not found.
   */
  getUserByEmail(email: string): UserRecord | null {
    const rows = this.getCanonicalEmailRows(email);
    // Legacy databases can contain case/whitespace variants because the old
    // UNIQUE constraint used binary comparison. Never pick an arbitrary user.
    if (rows.length !== 1) return null;
    return this.toUserRecord(rows[0], this.loadProperties(rows[0].user_id));
  }

  /**
   * List users for admin screens.
   *
   * When options are omitted this preserves the historical all-users response.
   * Filtered calls use parameterized SQL and capped pagination.
   */
  listUsers(options: UserListOptions = {}): UserRecord[] {
    const normalized = normalizeUserListOptions(options);
    const hasFilters = hasUserListFilters(normalized);
    if (!hasFilters && options.limit === undefined && options.offset === undefined) {
      const rows = this.stmts.listUsers.all() as UserRow[];
      return rows.map((row) =>
        this.toUserRecord(row, this.loadProperties(row.user_id))
      );
    }

    const filter = buildUserListFilter(normalized);
    const rows = this.db.prepare(
      `SELECT * FROM users${filter.where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...filter.args, normalized.limit, normalized.offset) as UserRow[];
    return rows.map((row) =>
      this.toUserRecord(row, this.loadProperties(row.user_id))
    );
  }

  /** Canonical alias for listUsers(). */
  list(options: UserListOptions = {}): UserRecord[] {
    return this.listUsers(options);
  }

  /**
   * Count user rows, optionally matching the same filters as listUsers().
   */
  countUsers(options: Omit<UserListOptions, 'limit' | 'offset'> = {}): number {
    const normalized = normalizeUserListOptions(options);
    if (!hasUserListFilters(normalized)) {
      const row = this.stmts.countUsers.get() as CountRow;
      return row.count;
    }

    const filter = buildUserListFilter(normalized);
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM users${filter.where}`
    ).get(...filter.args) as CountRow;
    return row.count;
  }

  /**
   * Count users by role.
   */
  countUsersByRole(role: string): number {
    const row = this.stmts.countUsersByRole.get(role) as CountRow;
    return row.count;
  }

  /** Count administrators that can currently complete a normal sign-in. */
  countActiveAdmins(): number {
    const row = this.stmts.countActiveAdmins.get() as CountRow;
    return row.count;
  }

  /**
   * Update user fields. Uses ReactiveDB for broadcast.
   * Returns updated UserRecord or null if user not found.
   */
  updateUser(
    userId: string,
    partial: Partial<{
      username: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      status: UserStatus;
      passwordChangeRequired: boolean;
      emailVerifiedAt: number | null;
      emailVerificationRequired: boolean;
      mfaRequired: boolean;
    }>
  ): UserRecord | null {
    const email = partial.email === undefined
      ? undefined
      : this.requireCanonicalEmail(partial.email);

    // Map camelCase to snake_case
    const mapped: Record<string, unknown> = { updated_at: Date.now() };
    if (partial.username !== undefined) mapped.username = partial.username;
    if (email !== undefined) mapped.email = email;
    if (partial.firstName !== undefined) mapped.first_name = partial.firstName;
    if (partial.lastName !== undefined) mapped.last_name = partial.lastName;
    if (partial.role !== undefined) mapped.role = partial.role;
    if (partial.status !== undefined) mapped.status = partial.status;
    if (partial.passwordChangeRequired !== undefined) {
      mapped.password_change_required = partial.passwordChangeRequired ? 1 : 0;
    }
    if (partial.emailVerifiedAt !== undefined) {
      mapped.email_verified_at = partial.emailVerifiedAt;
    }
    if (partial.emailVerificationRequired !== undefined) {
      mapped.email_verification_required = partial.emailVerificationRequired ? 1 : 0;
    }
    if (partial.mfaRequired !== undefined) {
      mapped.mfa_required = partial.mfaRequired ? 1 : 0;
    }

    // Check uniqueness upfront for fields being changed
    if (partial.username !== undefined) {
      const existing = this.getUserByUsername(partial.username);
      if (existing && existing.userId !== userId) {
        throw new AuthError('Username taken', 'DUPLICATE_USERNAME', 409);
      }
    }
    if (email !== undefined) this.assertEmailAvailable(email, userId);

    const change = this.db.update('users', userId, mapped);
    if (!change) return null;
    return this.getUserById(userId);
  }

  private getCanonicalEmailRows(email: string): UserRow[] {
    const canonical = canonicalizeEmail(email);
    if (!canonical) return [];
    return this.stmts.getUsersByCanonicalEmail.all(canonical) as UserRow[];
  }

  private assertEmailAvailable(email: string, exceptUserId?: string): void {
    const conflict = this.getCanonicalEmailRows(email)
      .some((row) => row.user_id !== exceptUserId);
    if (conflict) throw new AuthError('Email taken', 'DUPLICATE_EMAIL', 409);
  }

  private requireCanonicalEmail(email: string): string {
    const canonical = canonicalizeEmail(email);
    if (!isValidEmail(canonical)) {
      throw new AuthError('Invalid email address', 'INVALID_EMAIL', 400);
    }
    return canonical;
  }

  /** Canonical alias for updateUser(). */
  update(
    userId: string,
    partial: Parameters<UserStore['updateUser']>[1]
  ): UserRecord | null {
    return this.updateUser(userId, partial);
  }

  /**
   * Delete a user. Cascades to _credentials, user_properties, _refresh_tokens.
   * Returns true if deleted, false if not found.
   */
  deleteUser(userId: string): boolean {
    const change = this.db.delete('users', userId);
    return change !== null;
  }

  /** Canonical alias for deleteUser(). */
  delete(userId: string): boolean {
    return this.deleteUser(userId);
  }

  // ─── Password ────────────────────────────────────────────────────────

  /**
   * Verify a password against the stored hash.
   * Returns false if user not found or password wrong.
   */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const cred = this.stmts.getCredential.get(userId) as CredentialRow | null;
    if (!cred) return false;
    return Bun.password.verify(password, cred.password_hash);
  }

  /**
   * Change password. Verifies current password, hashes new one, revokes all refresh tokens.
   * Returns true if changed, false if current password wrong.
   */
  async updatePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const valid = await this.verifyPassword(userId, currentPassword);
    if (!valid) return false;

    const newHash = await Bun.password.hash(newPassword);
    this.db.transaction(() => {
      this.stmts.updateCredential.run(newHash, userId);
      this.updateUser(userId, { passwordChangeRequired: false });
      // Force re-login on all devices
      this.revokeAllUserTokens(userId);
    });

    return true;
  }

  /**
   * Set a user's password without requiring the current password.
   *
   * Intended for admin reset flows. Revokes all refresh tokens so existing
   * sessions cannot continue with the old credential state.
   */
  async resetPassword(
    userId: string,
    newPassword: string,
    options: { passwordChangeRequired?: boolean } = {}
  ): Promise<boolean> {
    if (!this.getUserById(userId)) return false;

    const newHash = await Bun.password.hash(newPassword);
    this.db.transaction(() => {
      this.stmts.updateCredential.run(newHash, userId);
      this.updateUser(userId, {
        passwordChangeRequired: options.passwordChangeRequired ?? false,
      });
      this.revokeAllUserTokens(userId);
    });

    return true;
  }

  /**
   * Commit a one-time password action and credential replacement atomically.
   *
   * Password hashing completes before the transaction begins. The supplied
   * token consumer then shares the same SQLite transaction as the credential,
   * eligibility, and session-generation writes, so a storage failure cannot
   * burn an otherwise reusable recovery link.
   */
  async completePasswordAction(
    userId: string,
    newPassword: string,
    consumeActionToken: () => void
  ): Promise<boolean> {
    const newHash = await Bun.password.hash(newPassword);

    return this.db.transaction(() => {
      if (!this.getUserById(userId)) return false;
      consumeActionToken();
      this.stmts.updateCredential.run(newHash, userId);
      this.updateUser(userId, { passwordChangeRequired: false });
      this.revokeAllUserTokens(userId);
      return true;
    });
  }

  /**
   * Mark an account as requiring a password change and revoke refresh tokens.
   */
  requirePasswordChange(userId: string): boolean {
    return this.db.transaction(() => {
      const updated = this.updateUser(userId, { passwordChangeRequired: true });
      if (!updated) return false;
      this.revokeAllUserTokens(userId);
      return true;
    });
  }

  /**
   * Clear the forced password-change flag and invalidate every prior token.
   */
  clearPasswordChangeRequired(userId: string): boolean {
    return this.db.transaction(() => {
      const updated = this.updateUser(userId, { passwordChangeRequired: false });
      if (!updated) return false;
      this.revokeAllUserTokens(userId);
      return true;
    });
  }

  /**
   * Mark a user's email verified and clear the verification gate.
   */
  markEmailVerified(userId: string, verifiedAt = Date.now()): UserRecord | null {
    return this.updateUser(userId, {
      emailVerifiedAt: verifiedAt,
      emailVerificationRequired: false,
    });
  }

  /** Atomically verify an address and consume the one-time verification link. */
  completeEmailVerification(
    userId: string,
    consumeActionToken: () => void,
    verifiedAt = Date.now()
  ): UserRecord | null {
    return this.db.transaction(() => {
      const current = this.getUserById(userId);
      if (!current) return null;
      if (!current.emailVerificationRequired || current.emailVerifiedAt !== null) {
        throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
      }
      consumeActionToken();
      const user = this.markEmailVerified(userId, verifiedAt);
      if (!user) return null;
      // Verification links complete authentication, so invalidate every
      // sibling link and pre-verification session before issuing a new one.
      this.revokeAllUserTokens(userId);
      return user;
    });
  }

  // ─── Properties KV ───────────────────────────────────────────────────

  /**
   * Set a user property. INSERT OR REPLACE semantics.
   * Uses prepared statement (composite PK — not managed by ReactiveDB defineTable).
   */
  setProperty(userId: string, key: string, value: string): void {
    this.stmts.insertProperty.run(userId, key, value);
  }

  /**
   * Set multiple user properties.
   */
  setProperties(userId: string, properties: Record<string, string>): void {
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(properties)) {
        this.stmts.insertProperty.run(userId, key, value);
      }
    });
  }

  /**
   * Get a single property value. Returns null if not found.
   */
  getProperty(userId: string, key: string): string | null {
    const row = this.stmts.getProperty.get(userId, key) as {
      value: string | null;
    } | null;
    return row?.value ?? null;
  }

  /**
   * Get all properties for a user as a key-value map.
   */
  getProperties(userId: string): Record<string, string> {
    return this.loadProperties(userId);
  }

  /**
   * Delete a single property. Uses prepared statement (composite PK).
   */
  deleteProperty(userId: string, key: string): void {
    this.stmts.deleteProperty.run(userId, key);
  }

  // ─── Refresh Tokens ──────────────────────────────────────────────────

  /** Atomically consume a live refresh token and persist its replacement. */
  rotateRefreshTokenAtomically(
    current: RefreshTokenRecord,
    replacement: RefreshTokenReplacement,
    expectedAuthGeneration: number,
    now = Date.now()
  ): RefreshTokenRotationResult {
    return this.db.transaction(() => {
      const consumed = this.stmts.consumeRefreshToken.run(
        now,
        current.tokenId,
        current.userId,
        now,
        expectedAuthGeneration
      );
      if (consumed.changes === 1) {
        this.stmts.insertRefreshToken.run(
          replacement.tokenId,
          current.userId,
          replacement.tokenHash,
          replacement.expiresAt,
          replacement.createdAt
        );
        return 'rotated';
      }

      const latest = this.getRefreshTokenById(current.tokenId);
      if (latest?.userId === current.userId && latest.revokedAt !== null) {
        this.invalidateRefreshReplay(current.userId, now);
        return 'replayed';
      }
      if (latest?.userId === current.userId) {
        this.stmts.revokeRefreshToken.run(now, current.tokenId);
      }
      return 'invalid';
    });
  }

  /** Apply family invalidation when a presented refresh token was already used. */
  invalidateRefreshTokenReplay(userId: string, now = Date.now()): void {
    this.db.transaction(() => this.invalidateRefreshReplay(userId, now));
  }

  /** Store a hashed refresh token. Internal table — no broadcast. */
  storeRefreshToken(
    tokenId: string,
    userId: string,
    tokenHash: string,
    expiresAt: number
  ): void {
    this.stmts.insertRefreshToken.run(
      tokenId,
      userId,
      tokenHash,
      expiresAt,
      Date.now()
    );
  }

  /** Insert a refresh session only while its signed user state is still current. */
  storeRefreshTokenIfCurrent(
    tokenId: string,
    user: Pick<UserRecord, 'userId' | 'email' | 'role'>,
    tokenHash: string,
    expiresAt: number,
    createdAt: number,
    expectedAuthGeneration: number
  ): boolean {
    const result = this.stmts.insertRefreshTokenIfCurrent.run(
      tokenId,
      tokenHash,
      expiresAt,
      createdAt,
      user.userId,
      user.email,
      user.role,
      expectedAuthGeneration
    );
    return result.changes === 1;
  }

  /**
   * Look up a refresh token by its server-generated session id.
   * Returns revoked and expired records so the caller can fail closed using
   * the same lifecycle rules as refresh-token rotation.
   */
  getRefreshTokenById(tokenId: string): RefreshTokenRecord | null {
    const row = this.stmts.getRefreshTokenById.get(tokenId) as RefreshTokenRow | null;
    return row ? toRefreshTokenRecord(row) : null;
  }

  /**
   * Look up a refresh token by its hash.
   * Returns the record EVEN IF REVOKED — caller handles revocation logic.
   * This is deliberate for replay detection.
   */
  getRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null {
    const row = this.stmts.getRefreshTokenByHash.get(
      tokenHash
    ) as RefreshTokenRow | null;
    return row ? toRefreshTokenRecord(row) : null;
  }

  /**
   * Revoke a single refresh token (set revoked_at).
   */
  revokeRefreshToken(tokenId: string): void {
    this.stmts.revokeRefreshToken.run(Date.now(), tokenId);
  }

  /**
   * Revoke ALL non-revoked refresh tokens for a user (family rotation / password change).
   */
  revokeAllUserTokens(userId: string): void {
    this.db.transaction(() => {
      this.stmts.revokeAllUserTokens.run(Date.now(), userId);
      this.authGenerations.bump(userId);
    });
  }

  private invalidateRefreshReplay(userId: string, now: number): void {
    const user = this.getUserById(userId);
    if (!user || user.passwordChangeRequired) return;
    this.stmts.revokeAllUserTokens.run(now, userId);
    this.authGenerations.bump(userId);
  }

  /** Return the security generation embedded in newly issued auth tokens. */
  getAuthGeneration(userId: string): number {
    return this.authGenerations.get(userId);
  }

  /**
   * Delete expired and revoked tokens. Cleanup operation.
   * Returns number of deleted rows.
   */
  deleteExpiredTokens(): number {
    const now = Date.now();
    const result = this.stmts.deleteExpiredTokens.run(now, now);
    return result.changes;
  }

  // ─── Action Tokens ─────────────────────────────────────────────────

  /**
   * Store a hashed one-time auth action token.
   */
  storeActionToken(params: {
    tokenId: string;
    userId: string;
    type: AuthActionTokenType;
    tokenHash: string;
    expiresAt: number;
    createdAt: number;
    createdBy?: string | null;
    metadata?: Record<string, unknown>;
  }): AuthActionTokenRecord {
    this.stmts.insertActionToken.run(
      params.tokenId,
      params.userId,
      params.type,
      params.tokenHash,
      params.expiresAt,
      params.createdAt,
      params.createdBy ?? null,
      JSON.stringify(params.metadata ?? {})
    );

    return {
      tokenId: params.tokenId,
      userId: params.userId,
      type: params.type,
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
      consumedAt: null,
      createdAt: params.createdAt,
      createdBy: params.createdBy ?? null,
      metadata: params.metadata ?? {},
    };
  }

  /**
   * Look up a one-time auth action token by hash.
   */
  getActionTokenByHash(tokenHash: string): AuthActionTokenRecord | null {
    const row = this.stmts.getActionTokenByHash.get(tokenHash) as AuthActionTokenRow | null;
    if (!row) return null;
    return this.toActionTokenRecord(row);
  }

  /**
   * Mark an action token consumed. Returns false if it was already consumed.
   */
  consumeActionToken(tokenId: string): boolean {
    const result = this.stmts.consumeActionToken.run(Date.now(), tokenId);
    return result.changes > 0;
  }

  /** Delete an action token that failed before delivery completed. */
  deleteActionToken(tokenId: string): boolean {
    const result = this.stmts.deleteActionToken.run(tokenId);
    return result.changes > 0;
  }

  /**
   * Count active action tokens created after a cutoff for cooldown checks.
   */
  countRecentActionTokens(params: {
    userId: string;
    type: AuthActionTokenType;
    createdAfter: number;
    now?: number;
  }): number {
    const row = this.stmts.countRecentActionTokens.get(
      params.userId,
      params.type,
      params.now ?? Date.now(),
      params.createdAfter
    ) as CountRow;
    return row.count;
  }

  /**
   * Delete expired and consumed action tokens. Cleanup operation.
   */
  deleteExpiredActionTokens(): number {
    const now = Date.now();
    const result = this.stmts.deleteExpiredActionTokens.run(now, now);
    return result.changes;
  }

  // ─── Auth Config ─────────────────────────────────────────────────────

  /**
   * Get a config value from _auth_config. Returns null if not found.
   */
  getConfig(key: string): string | null {
    const row = this.stmts.getConfig.get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  /**
   * Set a config value in _auth_config. INSERT OR REPLACE.
   */
  setConfig(key: string, value: string): void {
    this.stmts.setConfig.run(key, value);
  }

  // ─── Internal Helpers ────────────────────────────────────────────────

  private loadProperties(userId: string): Record<string, string> {
    const rows = this.stmts.getProperties.all(userId) as PropertyRow[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (row.value !== null) {
        result[row.key] = row.value;
      }
    }
    return result;
  }

  private toUserRecord(
    row: UserRow,
    properties: Record<string, string>
  ): UserRecord {
    return {
      userId: row.user_id,
      username: row.username,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role,
      status: row.status ?? 'active',
      passwordChangeRequired: Boolean(row.password_change_required),
      emailVerifiedAt: row.email_verified_at,
      emailVerificationRequired: Boolean(row.email_verification_required),
      mfaRequired: Boolean(row.mfa_required),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      properties,
    };
  }

  private toActionTokenRecord(row: AuthActionTokenRow): AuthActionTokenRecord {
    return {
      tokenId: row.token_id,
      userId: row.user_id,
      type: row.type,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      createdAt: row.created_at,
      createdBy: row.created_by,
      metadata: parseMetadata(row.metadata),
    };
  }
}

function toRefreshTokenRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeUserListOptions(options: UserListOptions): Required<Pick<UserListOptions, 'limit' | 'offset'>> &
  Omit<UserListOptions, 'limit' | 'offset'> {
  return {
    limit: normalizeListLimit(options.limit),
    offset: normalizeListOffset(options.offset),
    search: options.search?.trim() || undefined,
    role: options.role?.trim() || undefined,
    status: options.status,
  };
}

function normalizeListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return USER_LIST_DEFAULT_LIMIT;
  return Math.max(1, Math.min(USER_LIST_MAX_LIMIT, Math.floor(limit)));
}

function normalizeListOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

function hasUserListFilters(options: UserListOptions): boolean {
  return Boolean(options.search || options.role || options.status);
}

function buildUserListFilter(options: UserListOptions): {
  where: string;
  args: Array<string>;
} {
  const clauses: string[] = [];
  const args: string[] = [];

  if (options.search) {
    const pattern = `%${escapeLikePattern(options.search)}%`;
    clauses.push(
      `(username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\')`
    );
    args.push(pattern, pattern, pattern, pattern);
  }

  if (options.role) {
    clauses.push('role = ?');
    args.push(options.role);
  }

  if (options.status) {
    clauses.push('status = ?');
    args.push(options.status);
  }

  return {
    where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    args,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
