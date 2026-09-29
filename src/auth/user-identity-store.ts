import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import { canonicalizeEmail, isValidEmail } from './auth-email-identity';
import { authTokenEligibleUserSql } from './auth-user-eligibility';
import type { UserPropertyConfigStore } from './user-property-config-store';
import { AuthError, type AuthTenancyMode, type UserRecord, type UserStatus } from './types';

interface UserRow {
  user_id: string;
  username: string;
  email: string;
  email_generation: number;
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

interface CountRow {
  count: number;
}

export interface UserIdentityCreateInput {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: UserStatus;
  passwordChangeRequired?: boolean;
  emailVerifiedAt?: number | null;
  emailVerificationRequired?: boolean;
  mfaRequired?: boolean;
}

export interface UserIdentityUpdateInput {
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
}

export interface UserIdentityListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  role?: string;
  status?: UserStatus;
}

export interface UserMailboxProofInput {
  proofId?: string;
  applicationId: string;
  userId: string;
  email: string;
  emailGeneration: number;
  provedAt: number;
  expiresAt: number;
}

export interface UserIdentityStoreOptions {
  tenancyMode: AuthTenancyMode;
  mutation<T>(operation: () => T): T;
  assertCurrentProfile(): void;
  getUserById(userId: string): UserRecord | null;
  getUserByUsername(username: string): UserRecord | null;
}

export const USER_IDENTITY_LIST_DEFAULT_LIMIT = 50;
export const USER_IDENTITY_LIST_MAX_LIMIT = 200;

/**
 * Internal persistence owner for user identity rows and identity projections.
 *
 * UserStore remains the public orchestration facade. It coordinates credentials,
 * registration provisioning, audit, and callbacks around these row operations.
 */
export class UserIdentityStore {
  private readonly stmts: {
    getUserById: Statement;
    getUserByUsername: Statement;
    getUsersByCanonicalEmail: Statement;
    listUsers: Statement;
    countUsers: Statement;
    countUsersByRole: Statement;
    countActiveAdmins: Statement;
  };

  constructor(
    private readonly db: ReactiveDB,
    private readonly properties: UserPropertyConfigStore,
    private readonly options: UserIdentityStoreOptions,
  ) {
    this.stmts = {
      getUserById: db.prepare('SELECT * FROM users WHERE user_id = ?'),
      getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
      getUsersByCanonicalEmail: db.prepare(
        `SELECT * FROM users
         WHERE lower(trim(email)) = ?
         ORDER BY created_at ASC, user_id ASC
         LIMIT 2`,
      ),
      listUsers: db.prepare('SELECT * FROM users ORDER BY created_at DESC'),
      countUsers: db.prepare('SELECT COUNT(*) as count FROM users'),
      countUsersByRole: db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?'),
      countActiveAdmins: db.prepare(
        `SELECT COUNT(*) as count FROM users
         WHERE role = 'admin'
           AND ${authTokenEligibleUserSql('users')}`,
      ),
    };
  }

  requireCanonicalEmail(email: string): string {
    const canonical = canonicalizeEmail(email);
    if (!isValidEmail(canonical)) {
      throw new AuthError('Invalid email address', 'INVALID_EMAIL', 422);
    }
    return canonical;
  }

  assertNewIdentityAvailable(username: string, email: string): void {
    if (this.options.getUserByUsername(username)) {
      throw new AuthError('Username taken', 'DUPLICATE_USERNAME', 409);
    }
    this.assertEmailAvailable(email);
  }

  /** Insert a user row after the facade has acquired the writer transaction. */
  insertRowInCurrentTransaction(input: {
    userId: string;
    now: number;
    user: UserIdentityCreateInput;
  }): void {
    this.assertNewIdentityAvailable(input.user.username, input.user.email);
    this.db.insert('users', {
      user_id: input.userId,
      username: input.user.username,
      email: input.user.email,
      first_name: input.user.firstName ?? null,
      last_name: input.user.lastName ?? null,
      role: input.user.role ?? 'user',
      status: input.user.status ?? 'active',
      password_change_required: input.user.passwordChangeRequired ? 1 : 0,
      email_verified_at: input.user.emailVerifiedAt ?? null,
      email_verification_required: input.user.emailVerificationRequired ? 1 : 0,
      mfa_required: input.user.mfaRequired ? 1 : 0,
      created_at: input.now,
      updated_at: null,
    });
  }

  /** Read a just-written identity after the caller has checked the profile. */
  getByIdInCurrentProfile(userId: string): UserRecord | null {
    const row = this.stmts.getUserById.get(userId) as UserRow | null;
    if (!row) return null;
    return this.toUserRecord(
      row,
      this.properties.loadPropertiesInCurrentProfile(userId),
    );
  }

  getById(userId: string): UserRecord | null {
    this.options.assertCurrentProfile();
    return this.getByIdInCurrentProfile(userId);
  }

  getByUsername(username: string): UserRecord | null {
    this.options.assertCurrentProfile();
    const row = this.stmts.getUserByUsername.get(username) as UserRow | null;
    if (!row) return null;
    return this.toUserRecord(
      row,
      this.properties.loadPropertiesInCurrentProfile(row.user_id),
    );
  }

  getByEmail(email: string): UserRecord | null {
    this.options.assertCurrentProfile();
    const rows = this.getCanonicalEmailRows(email);
    // Legacy databases can contain case/whitespace variants because the old
    // UNIQUE constraint used binary comparison. Never pick an arbitrary user.
    if (rows.length !== 1) return null;
    return this.toUserRecord(
      rows[0],
      this.properties.loadPropertiesInCurrentProfile(rows[0].user_id),
    );
  }

  list(options: UserIdentityListOptions = {}): UserRecord[] {
    this.options.assertCurrentProfile();
    const normalized = normalizeUserListOptions(options);
    const hasFilters = hasUserListFilters(normalized);
    if (!hasFilters && options.limit === undefined && options.offset === undefined) {
      return (this.stmts.listUsers.all() as UserRow[]).map((row) =>
        this.toUserRecord(
          row,
          this.properties.loadPropertiesInCurrentProfile(row.user_id),
        )
      );
    }

    const filter = buildUserListFilter(normalized);
    const rows = this.db.prepare(
      `SELECT * FROM users${filter.where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    ).all(...filter.args, normalized.limit, normalized.offset) as UserRow[];
    return rows.map((row) =>
      this.toUserRecord(
        row,
        this.properties.loadPropertiesInCurrentProfile(row.user_id),
      )
    );
  }

  count(options: Omit<UserIdentityListOptions, 'limit' | 'offset'> = {}): number {
    this.options.assertCurrentProfile();
    const normalized = normalizeUserListOptions(options);
    if (!hasUserListFilters(normalized)) {
      return (this.stmts.countUsers.get() as CountRow).count;
    }

    const filter = buildUserListFilter(normalized);
    return (this.db.prepare(
      `SELECT COUNT(*) as count FROM users${filter.where}`,
    ).get(...filter.args) as CountRow).count;
  }

  countByRole(role: string): number {
    this.options.assertCurrentProfile();
    return (this.stmts.countUsersByRole.get(role) as CountRow).count;
  }

  countActiveAdmins(): number {
    this.options.assertCurrentProfile();
    return (this.stmts.countActiveAdmins.get() as CountRow).count;
  }

  update(
    userId: string,
    partial: Partial<UserIdentityUpdateInput>,
  ): UserRecord | null {
    const email = partial.email === undefined
      ? undefined
      : this.requireCanonicalEmail(partial.email);
    return this.options.mutation(() => {
      // Read the current address only after the SQLite writer lock is held.
      // This prevents verification proof from moving to a replacement address.
      const current = email === undefined
        ? null
        : this.options.getUserById(userId);
      const emailChanged = email !== undefined
        && current !== null
        && canonicalizeEmail(current.email) !== email;

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
      if (emailChanged) mapped.email_verified_at = null;
      if (partial.emailVerificationRequired !== undefined) {
        mapped.email_verification_required = partial.emailVerificationRequired ? 1 : 0;
      }
      if (partial.mfaRequired !== undefined) {
        mapped.mfa_required = partial.mfaRequired ? 1 : 0;
      }

      if (partial.username !== undefined) {
        const existing = this.options.getUserByUsername(partial.username);
        if (existing && existing.userId !== userId) {
          throw new AuthError('Username taken', 'DUPLICATE_USERNAME', 409);
        }
      }
      if (email !== undefined) this.assertEmailAvailable(email, userId);

      let change;
      try {
        change = this.db.update('users', userId, mapped);
      } catch (error) {
        throw mapOwnerLifecycleError(error);
      }
      if (!change) return null;
      return this.options.getUserById(userId);
    });
  }

  delete(userId: string): boolean {
    let hasRetainedTenantHistory = false;
    try {
      return this.options.mutation(() => {
        // Capture history while the writer transaction is still healthy. Once
        // a managed delete fails, ReactiveDB rejects further operations.
        hasRetainedTenantHistory = this.hasRetainedTenantHistory(userId);
        return this.db.delete('users', userId) !== null;
      });
    } catch (error) {
      const ownerError = mapOwnerLifecycleError(error);
      if (ownerError !== error) throw ownerError;
      if (hasRetainedTenantHistory && isSqliteForeignKeyConstraint(error)) {
        throw userHasTenantHistoryError();
      }
      throw error;
    }
  }

  getEmailGeneration(userId: string): number {
    this.options.assertCurrentProfile();
    const columns = this.db.prepare('PRAGMA table_info(users)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'email_generation')) return 1;
    const row = this.db.prepare(
      'SELECT email_generation FROM users WHERE user_id = ?',
    ).get(userId) as { email_generation: number } | null;
    return row?.email_generation ?? 1;
  }

  recordEmailLinkMailboxProof(input: UserMailboxProofInput): string | null {
    const canonicalEmail = canonicalizeEmail(input.email);
    if (!canonicalEmail
      || !Number.isSafeInteger(input.emailGeneration)
      || input.emailGeneration < 1
      || !Number.isSafeInteger(input.provedAt)
      || !Number.isSafeInteger(input.expiresAt)
      || input.expiresAt <= input.provedAt) return null;
    return this.options.mutation(() => {
      const table = this.db.prepare(`SELECT 1 FROM sqlite_master
        WHERE type = 'table' AND name = '_auth_mailbox_proofs'`).get();
      if (!table) return null;
      const proofId = input.proofId ?? `mbp_${crypto.randomUUID()}`;
      const inserted = this.db.prepare(`
        INSERT INTO _auth_mailbox_proofs (
          proof_id, application_id, user_id, email, email_generation,
          source, proved_at, expires_at, revoked_at, created_at
        )
        SELECT ?, ?, users.user_id, lower(trim(users.email)), users.email_generation,
          'email-link', ?, ?, NULL, ?
        FROM users
        WHERE users.user_id = ?
          AND lower(trim(users.email)) = ?
          AND users.email_generation = ?
      `).run(
        proofId,
        input.applicationId,
        input.provedAt,
        input.expiresAt,
        input.provedAt,
        input.userId,
        canonicalEmail,
        input.emailGeneration,
      );
      return inserted.changes === 1 ? proofId : null;
    });
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

  private hasRetainedTenantHistory(userId: string): boolean {
    if (this.options.tenancyMode !== 'multi') return false;
    const checks = [
      ['_auth_tenants', ['created_by']],
      ['_auth_tenant_memberships', ['user_id', 'created_by']],
      ['_auth_tenant_invitations', ['issued_by', 'accepted_by_user_id']],
      ['_auth_tenant_join_requests', ['user_id', 'reviewed_by']],
    ] as const;

    for (const [table, columns] of checks) {
      if (!this.hasPrivateTable(table)) continue;
      const statement = this.db.prepare(
        `SELECT 1 FROM ${table} WHERE ${columns.map((column) => `${column} = ?`).join(' OR ')} LIMIT 1`,
      );
      if (statement.get(...columns.map(() => userId))) return true;
    }
    return false;
  }

  private hasPrivateTable(name: string): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(name));
  }

  private toUserRecord(
    row: UserRow,
    properties: Record<string, string>,
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
}

function mapOwnerLifecycleError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('AUTH_LAST_ACTIVE_APPLICATION_OWNER')) {
    return new AuthError(
      'Cannot remove access from the last active application owner',
      'LAST_ACTIVE_APPLICATION_OWNER_REQUIRED',
      409,
    );
  }
  if (message.includes('AUTH_LAST_ACTIVE_TENANT_OWNER')) {
    return new AuthError(
      'Cannot remove access from the last active organization owner',
      'LAST_ACTIVE_TENANT_OWNER_REQUIRED',
      409,
    );
  }
  return error;
}

function userHasTenantHistoryError(): AuthError {
  return new AuthError(
    'This identity has retained organization history and cannot be deleted; suspend it instead',
    'USER_HAS_TENANT_HISTORY',
    409,
  );
}

function isSqliteForeignKeyConstraint(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message : String(error);
  return code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
    || message.includes('FOREIGN KEY constraint failed');
}

function normalizeUserListOptions(
  options: UserIdentityListOptions,
): Required<Pick<UserIdentityListOptions, 'limit' | 'offset'>> &
  Omit<UserIdentityListOptions, 'limit' | 'offset'> {
  return {
    limit: normalizeListLimit(options.limit),
    offset: normalizeListOffset(options.offset),
    search: options.search?.trim() || undefined,
    role: options.role?.trim() || undefined,
    status: options.status,
  };
}

function normalizeListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return USER_IDENTITY_LIST_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(USER_IDENTITY_LIST_MAX_LIMIT, Math.floor(limit)));
}

function normalizeListOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

function hasUserListFilters(options: UserIdentityListOptions): boolean {
  return Boolean(options.search || options.role || options.status);
}

function buildUserListFilter(options: UserIdentityListOptions): {
  where: string;
  args: string[];
} {
  const clauses: string[] = [];
  const args: string[] = [];

  if (options.search) {
    const pattern = `%${escapeLikePattern(options.search)}%`;
    clauses.push(
      `(username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\')`,
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
