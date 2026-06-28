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
    getUserByEmail: Statement;
    listUsers: Statement;
    countUsers: Statement;
    countUsersByRole: Statement;

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
    getRefreshTokenByHash: Statement;
    revokeRefreshToken: Statement;
    revokeAllUserTokens: Statement;
    deleteExpiredTokens: Statement;

    // Action tokens (internal — direct SQL)
    insertActionToken: Statement;
    getActionTokenByHash: Statement;
    consumeActionToken: Statement;
    countRecentActionTokens: Statement;
    deleteExpiredActionTokens: Statement;

    // Auth config (internal — direct SQL)
    getConfig: Statement;
    setConfig: Statement;
  };

  constructor(private db: ReactiveDB) {
    this.stmts = {
      // Users
      getUserById: db.prepare('SELECT * FROM users WHERE user_id = ?'),
      getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
      getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
      listUsers: db.prepare('SELECT * FROM users ORDER BY created_at DESC'),
      countUsers: db.prepare('SELECT COUNT(*) as count FROM users'),
      countUsersByRole: db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?'),

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
      getRefreshTokenByHash: db.prepare(
        'SELECT * FROM _refresh_tokens WHERE token_hash = ?'
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
    };
  }

  // ─── User CRUD ───────────────────────────────────────────────────────

  /**
   * Create a new user with hashed password.
   * Writes user row via ReactiveDB (broadcast) + credential via direct SQL (no broadcast).
   * Atomic — if credential insert fails, user row is rolled back.
   */
  async createUser(params: {
    username: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    role?: string;
    status?: UserStatus;
    passwordChangeRequired?: boolean;
    properties?: Record<string, string>;
  }): Promise<UserRecord> {
    // Check uniqueness upfront — ReactiveDB uses INSERT OR REPLACE which
    // silently resolves UNIQUE conflicts by deleting the conflicting row.
    // We need explicit checks to return proper errors.
    if (this.getUserByUsername(params.username)) {
      throw new AuthError('Username taken', 'DUPLICATE_USERNAME', 409);
    }
    if (this.getUserByEmail(params.email)) {
      throw new AuthError('Email taken', 'DUPLICATE_EMAIL', 409);
    }

    const userId = `u_${crypto.randomUUID()}`;
    const now = Date.now();

    // Hash password (async — Argon2id via Bun.password)
    const passwordHash = await Bun.password.hash(params.password);

    return this.db.transaction(() => {
      // Public table — emits change event, broadcast to subscribers
      this.db.insert('users', {
        user_id: userId,
        username: params.username,
        email: params.email,
        first_name: params.firstName ?? null,
        last_name: params.lastName ?? null,
        role: params.role ?? 'user',
        status: params.status ?? 'active',
        password_change_required: params.passwordChangeRequired ? 1 : 0,
        created_at: now,
        updated_at: null,
      });

      // Internal table — direct SQL, no broadcast
      this.stmts.insertCredential.run(userId, passwordHash);

      for (const [key, value] of Object.entries(params.properties ?? {})) {
        this.stmts.insertProperty.run(userId, key, value);
      }

      return this.toUserRecord(
        this.stmts.getUserById.get(userId) as UserRow,
        this.loadProperties(userId)
      );
    });
  }

  /**
   * Get user by ID. Returns null if not found.
   */
  getUserById(userId: string): UserRecord | null {
    const row = this.stmts.getUserById.get(userId) as UserRow | null;
    if (!row) return null;
    return this.toUserRecord(row, this.loadProperties(userId));
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
    const row = this.stmts.getUserByEmail.get(email) as UserRow | null;
    if (!row) return null;
    return this.toUserRecord(row, this.loadProperties(row.user_id));
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
    }>
  ): UserRecord | null {
    // Map camelCase to snake_case
    const mapped: Record<string, unknown> = { updated_at: Date.now() };
    if (partial.username !== undefined) mapped.username = partial.username;
    if (partial.email !== undefined) mapped.email = partial.email;
    if (partial.firstName !== undefined) mapped.first_name = partial.firstName;
    if (partial.lastName !== undefined) mapped.last_name = partial.lastName;
    if (partial.role !== undefined) mapped.role = partial.role;
    if (partial.status !== undefined) mapped.status = partial.status;
    if (partial.passwordChangeRequired !== undefined) {
      mapped.password_change_required = partial.passwordChangeRequired ? 1 : 0;
    }

    // Check uniqueness upfront for fields being changed
    if (partial.username !== undefined) {
      const existing = this.getUserByUsername(partial.username);
      if (existing && existing.userId !== userId) {
        throw new AuthError('Username taken', 'DUPLICATE_USERNAME', 409);
      }
    }
    if (partial.email !== undefined) {
      const existing = this.getUserByEmail(partial.email);
      if (existing && existing.userId !== userId) {
        throw new AuthError('Email taken', 'DUPLICATE_EMAIL', 409);
      }
    }

    const change = this.db.update('users', userId, mapped);
    if (!change) return null;
    return this.getUserById(userId);
  }

  /**
   * Delete a user. Cascades to _credentials, user_properties, _refresh_tokens.
   * Returns true if deleted, false if not found.
   */
  deleteUser(userId: string): boolean {
    const change = this.db.delete('users', userId);
    return change !== null;
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
   * Mark an account as requiring a password change and revoke refresh tokens.
   */
  requirePasswordChange(userId: string): boolean {
    const updated = this.updateUser(userId, { passwordChangeRequired: true });
    if (!updated) return false;
    this.revokeAllUserTokens(userId);
    return true;
  }

  /**
   * Clear the forced password-change flag without changing credentials.
   */
  clearPasswordChangeRequired(userId: string): boolean {
    return this.updateUser(userId, { passwordChangeRequired: false }) !== null;
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

  /**
   * Store a hashed refresh token. Internal table — no broadcast.
   */
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

  /**
   * Look up a refresh token by its hash.
   * Returns the record EVEN IF REVOKED — caller handles revocation logic.
   * This is deliberate for replay detection.
   */
  getRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null {
    const row = this.stmts.getRefreshTokenByHash.get(
      tokenHash
    ) as RefreshTokenRow | null;
    if (!row) return null;

    return {
      tokenId: row.token_id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    };
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
    this.stmts.revokeAllUserTokens.run(Date.now(), userId);
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
