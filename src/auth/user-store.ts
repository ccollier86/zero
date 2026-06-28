import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { UserRecord, RefreshTokenRecord } from './types';
import { AuthError } from './types';

// ─── SQL Row Types ─────────────────────────────────────────────────────────

interface UserRow {
  user_id: string;
  username: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
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

interface ConfigRow {
  key: string;
  value: string;
}

// ─── UserStore ─────────────────────────────────────────────────────────────

/**
 * SQLite operations for auth data.
 *
 * Two write paths:
 * - Public tables (users, user_properties) → through ReactiveDB for reactivity
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
        created_at: now,
        updated_at: null,
      });

      // Internal table — direct SQL, no broadcast
      this.stmts.insertCredential.run(userId, passwordHash);

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
   * List all users (ordered by creation date, newest first).
   */
  listUsers(): UserRecord[] {
    const rows = this.stmts.listUsers.all() as UserRow[];
    return rows.map((row) =>
      this.toUserRecord(row, this.loadProperties(row.user_id))
    );
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
    }>
  ): UserRecord | null {
    // Map camelCase to snake_case
    const mapped: Record<string, unknown> = { updated_at: Date.now() };
    if (partial.username !== undefined) mapped.username = partial.username;
    if (partial.email !== undefined) mapped.email = partial.email;
    if (partial.firstName !== undefined) mapped.first_name = partial.firstName;
    if (partial.lastName !== undefined) mapped.last_name = partial.lastName;
    if (partial.role !== undefined) mapped.role = partial.role;

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
    this.stmts.updateCredential.run(newHash, userId);

    // Force re-login on all devices
    this.revokeAllUserTokens(userId);

    return true;
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      properties,
    };
  }
}
