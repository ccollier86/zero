/**
 * user-store.ts
 *
 * Owns SQLite persistence for auth users, credentials, user properties,
 * refresh tokens, and auth config. This store hides SQL details from Elysia
 * route handlers; it does not verify request tokens or make HTTP decisions.
 */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../tokens/token-utils';
import type {
  AuthActionTokenRecord,
  AuthActionTokenType,
  AuthTenancyMode,
  RefreshTokenRecord,
  UserRecord,
  UserStatus,
} from './types';
import { AuthError } from './types';
import { AuthGenerationStore } from './auth-generation-store';
import { canonicalizeEmail, isValidEmail } from './auth-email-identity';
import { defineAuthSessionTables } from './auth-session-schema';
import { defineRegistrationProvisioningTable } from './registration-provisioning-schema';
import { authTokenEligibleUserSql } from './auth-user-eligibility';
import type { AuthAuditService } from './auth-audit-service';
import type {
  AppendAuthAuditEventInput,
  AuthAuditActor,
  AuthAuditRequestContext,
} from './auth-audit-types';

export interface AuthSecurityAuditContext {
  actor: AuthAuditActor;
  request?: AuthAuditRequestContext;
}

// ─── SQL Row Types ─────────────────────────────────────────────────────────

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
  session_id: string | null;
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

/** Internal receipt for one registration awaiting downstream provisioning. */
export interface RegistrationProvisioningReceipt {
  readonly registrationId: string;
  readonly userId: string;
  readonly tenantId: string | null;
  readonly isBootstrap: boolean;
  /** Process-held capability. Only its SHA-256 digest is persisted. */
  readonly leaseToken: string;
}

export interface RegistrationProvisioningResources {
  readonly tenantId?: string;
}

interface RegistrationProvisioningRow {
  registration_id: string;
  user_id: string;
  tenant_id: string | null;
  is_bootstrap: number;
  lease_owner_hash: string | null;
  lease_expires_at: number | null;
  created_at: number;
}

export interface RefreshTokenReplacement {
  tokenId: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
}

export interface AuthSessionRevoker {
  revoke(sessionId: string, reason: string, now?: number): boolean;
  revokeAllForUser(userId: string, reason: string, now?: number): number;
  deleteExpiredSessions?(now?: number): number;
}

/** Narrow bootstrap hook implemented by the app-local advanced RBAC service. */
export interface AuthAuthorizationBootstrapper {
  establishBootstrapOwner(userId: string, registrationId?: string): void;
  hasProvisionalRegistrationAuthority?(input: {
    registrationId: string;
    userId: string;
    tenantId: string | null;
    isBootstrap: boolean;
  }): boolean;
  rollbackProvisionalApplicationOwner?(input: {
    userId: string;
    registrationId: string;
  }): boolean;
}

export type RefreshTokenRotationResult = 'rotated' | 'replayed' | 'invalid';

const REFRESH_SESSION_REPLACEMENT_ROLLBACK = new Error(
  'refresh-session-replacement-rollback',
);
const REGISTRATION_PROVISIONING_WAIT_MS = 30_000;
export const REGISTRATION_PROVISIONING_LEASE_MS = 5 * 60_000;
const REGISTRATION_PROVISIONING_LEASE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface UserStoreOptions {
  /** Defaults to single mode for direct/legacy store consumers. */
  tenancyMode?: AuthTenancyMode;
  /** Official AuthRuntime audit boundary; omitted by isolated legacy stores. */
  auditService?: AuthAuditService;
}

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
 * Three storage write patterns:
 * - Private users table → through ReactiveDB for consistent change tracking
 * - User properties table → direct SQL because it has a composite primary key
 * - Internal tables (_credentials, _refresh_tokens, _auth_config) → direct prepared statements
 *
 * All statements prepared once in constructor, reused per call.
 */
export class UserStore {
  private authorizationBootstrapper: AuthAuthorizationBootstrapper | null = null;
  private stmts: {
    // Users (private auth data — prepared reads, ReactiveDB-tracked writes)
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

    // Registration provisioning (internal durable compensation boundary)
    insertRegistrationProvisioning: Statement;
    bindRegistrationTenant: Statement;
    getRegistrationProvisioning: Statement;
    getRegistrationProvisioningByIdentity: Statement;
    getRegistrationProvisioningByUser: Statement;
    getPendingBootstrapProvisioning: Statement;
    listRecoverableRegistrationProvisioning: Statement;
    renewRegistrationProvisioningLease: Statement;
    deleteRegistrationProvisioning: Statement;
  };
  private readonly authGenerations: AuthGenerationStore;
  private authSessionRevoker: AuthSessionRevoker | null = null;
  private runtimeProfileGuard: (() => void) | null = null;
  private readonly tenancyMode: AuthTenancyMode;
  private readonly auditService: AuthAuditService | null;

  constructor(private db: ReactiveDB, options: UserStoreOptions = {}) {
    this.tenancyMode = options.tenancyMode ?? 'single';
    this.auditService = options.auditService ?? null;
    // Direct UserStore consumers may define legacy refresh tables themselves.
    // Ensure additive private lifecycle tables exist before preparing SQL.
    defineAuthSessionTables(db);
    defineRegistrationProvisioningTable(db);
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
           AND ${authTokenEligibleUserSql('users')}`
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
        `INSERT INTO _refresh_tokens
          (token_id, user_id, session_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ),
      insertRefreshTokenIfCurrent: db.prepare(
        `INSERT INTO _refresh_tokens
           (token_id, user_id, session_id, token_hash, expires_at, created_at)
         SELECT ?, users.user_id, ?, ?, ?, ? FROM users
         WHERE users.user_id = ?
           AND users.email = ?
           AND users.role = ?
           AND ${authTokenEligibleUserSql('users')}
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
               AND ${authTokenEligibleUserSql('users')})`
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

      insertRegistrationProvisioning: db.prepare(`
        INSERT INTO _auth_registration_provisioning (
          registration_id, user_id, tenant_id, is_bootstrap,
          lease_owner_hash, lease_expires_at, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?)
      `),
      bindRegistrationTenant: db.prepare(`
        UPDATE _auth_registration_provisioning SET tenant_id = ?
        WHERE registration_id = ? AND user_id = ? AND tenant_id IS NULL
      `),
      getRegistrationProvisioning: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE registration_id = ? AND user_id = ? AND lease_owner_hash = ?
      `),
      getRegistrationProvisioningByIdentity: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE registration_id = ? AND user_id = ?
      `),
      getRegistrationProvisioningByUser: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE user_id = ? LIMIT 1
      `),
      getPendingBootstrapProvisioning: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE is_bootstrap = 1
        ORDER BY created_at ASC, registration_id ASC
        LIMIT 1
      `),
      listRecoverableRegistrationProvisioning: db.prepare(`
        SELECT * FROM _auth_registration_provisioning
        WHERE lease_owner_hash IS NULL
          OR lease_expires_at IS NULL
          OR lease_expires_at <= ?
        ORDER BY created_at ASC, registration_id ASC
      `),
      renewRegistrationProvisioningLease: db.prepare(`
        UPDATE _auth_registration_provisioning
        SET lease_expires_at = ?
        WHERE registration_id = ? AND user_id = ? AND lease_owner_hash = ?
          AND lease_expires_at IS NOT NULL AND lease_expires_at > ?
      `),
      deleteRegistrationProvisioning: db.prepare(`
        DELETE FROM _auth_registration_provisioning
        WHERE registration_id = ? AND user_id = ? AND lease_owner_hash = ?
      `),
    };
  }

  /** Attach this app's durable parent-session invalidation boundary. */
  setAuthSessionRevoker(revoker: AuthSessionRevoker): void {
    this.authSessionRevoker = revoker;
  }

  /** Attach the app-local advanced authorization bootstrap boundary. */
  setAuthorizationBootstrapper(bootstrapper: AuthAuthorizationBootstrapper): void {
    this.authorizationBootstrapper = bootstrapper;
  }

  /** Fence in-flight identity/session writes against a committed profile change. */
  setRuntimeProfileGuard(guard: () => void): void {
    this.runtimeProfileGuard = guard;
  }

  /** Recheck the exact committed profile for cached/direct store consumers. */
  assertCurrentProfile(): void {
    this.assertRuntimeProfileCurrent();
  }

  /** Share this store's SQLite transaction with a coordinating auth service. */
  transaction<T>(operation: () => T): T {
    return this.mutation(operation);
  }

  /** Append through the app-local audit owner, inheriting any active transaction. */
  appendControlPlaneAudit(input: AppendAuthAuditEventInput): void {
    this.mutation(() => this.auditService?.append(input));
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
   * Writes the user row through ReactiveDB change tracking and the credential
   * through server-only SQL. Client delivery remains a separate Sync-policy
   * decision and is denied by default createApp policy.
   * Atomic — if credential insert fails, user row is rolled back.
   */
  async createUser(
    params: CreateUserInput,
    provisioning?: AuthSecurityAuditContext & { setupRequested?: boolean },
    beforeInsert?: () => void,
  ): Promise<UserRecord> {
    const prepared = await this.prepareUserCreate(params);
    return this.mutation(() => {
      this.stmts.acquireRegistrationWriteLock.run();
      beforeInsert?.();
      this.assertNoPendingBootstrapProvisioning();
      const establishesInstallation = this.isBootstrapRequired();
      if (establishesInstallation && this.tenancyMode === 'multi') {
        throw multiTenantBootstrapOrganizationRequired();
      }
      const user = this.insertPreparedUser(prepared);
      if (establishesInstallation) {
        this.authorizationBootstrapper?.establishBootstrapOwner(user.userId);
        this.markBootstrapCompleted();
        this.recordRegistrationAudit(user.userId, null, true);
      }
      if (provisioning) {
        this.auditService?.append({
          action: 'identity.provisioned-by-admin',
          outcome: 'succeeded',
          scope: { kind: 'application' },
          actor: provisioning.actor,
          request: provisioning.request,
          target: { type: 'user', id: user.userId },
          metadata: { 'setup-requested': provisioning.setupRequested === true },
        });
      }
      return user;
    });
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
    afterInsert?: (
      user: UserRecord,
      policy: TPolicy,
    ) => RegistrationProvisioningResources | void,
    options: {
      provisional?: boolean;
      auditRequest?: AuthAuditRequestContext;
    } = {},
  ): Promise<{
    user: UserRecord;
    policy: TPolicy;
    provisioning: RegistrationProvisioningReceipt | null;
  }> {
    const prepared = await this.prepareUserCreate(params);
    const registrationId = options.provisional
      ? `areg_${crypto.randomUUID()}`
      : null;
    const leaseToken = registrationId ? createOpaqueToken() : null;
    const leaseOwnerHash = leaseToken ? hashToken(leaseToken) : null;
    const waitDeadline = Date.now() + REGISTRATION_PROVISIONING_WAIT_MS;
    while (true) {
      try {
        return this.mutation(() => {
          this.stmts.acquireRegistrationWriteLock.run();
          this.assertNoPendingBootstrapProvisioning();
          const isBootstrap = this.isBootstrapRequired();
          const policy = resolvePolicy(isBootstrap);
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
          if (registrationId) {
            const createdAt = Date.now();
            this.stmts.insertRegistrationProvisioning.run(
              registrationId,
              user.userId,
              isBootstrap ? 1 : 0,
              leaseOwnerHash,
              createdAt + REGISTRATION_PROVISIONING_LEASE_MS,
              createdAt,
            );
          }
          const resources = afterInsert?.(user, policy);
          const tenantId = resources?.tenantId ?? null;
          if (isBootstrap && this.tenancyMode === 'multi' && !tenantId) {
            throw multiTenantBootstrapOrganizationRequired();
          }
          if (tenantId && (!registrationId || this.stmts.bindRegistrationTenant.run(
            tenantId,
            registrationId,
            user.userId,
          ).changes !== 1)) {
            throw new Error('[auth] Failed to bind registration provisioning to its tenant.');
          }
          if (isBootstrap) {
            this.authorizationBootstrapper?.establishBootstrapOwner(
              user.userId,
              registrationId ?? undefined,
            );
            if (!registrationId) this.markBootstrapCompleted();
          }
          if (!registrationId) {
            this.recordRegistrationAudit(
              user.userId,
              tenantId,
              isBootstrap,
              options.auditRequest,
            );
          }
          return {
            user,
            policy,
            provisioning: registrationId ? Object.freeze({
              registrationId,
              userId: user.userId,
              tenantId,
              isBootstrap,
              leaseToken: leaseToken!,
            }) : null,
          };
        });
      } catch (error) {
        if (!(error instanceof AuthError)
          || error.code !== 'BOOTSTRAP_PROVISIONING_IN_PROGRESS') throw error;
        // A process which died while holding bootstrap cannot strand the
        // installation forever. Only an expired/unowned receipt is recovered;
        // a live lease owned by another process remains authoritative.
        if (this.recoverPendingRegistrationProvisioning() > 0) continue;
        if (Date.now() >= waitDeadline) throw error;
        // The durable marker coordinates other processes; this short async
        // wait lets the winning request finalize or roll back without holding
        // a SQLite transaction across external token/email work.
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  }

  /** Whether the installation still permits its one bootstrap administrator. */
  isBootstrapRequired(): boolean {
    this.assertRuntimeProfileCurrent();
    return this.getConfig('auth.bootstrap.completed') !== '1';
  }

  /** Internal proof that this identity belongs to one unfinished registration. */
  hasPendingRegistrationProvisioning(userId: string): boolean {
    this.assertRuntimeProfileCurrent();
    return Boolean(this.stmts.getRegistrationProvisioningByUser.get(userId));
  }

  /**
   * Close bootstrap for legacy databases that already contain users.
   * Called once during auth startup so deleting every user cannot reopen the
   * public first-administrator boundary on an upgraded installation.
   */
  reconcileBootstrapState(): void {
    this.assertRuntimeProfileCurrent();
    if (this.stmts.getPendingBootstrapProvisioning.get()) return;
    if (this.getConfig('auth.bootstrap.completed') !== '1' && this.countUsers() > 0) {
      this.markBootstrapCompleted();
    }
  }

  /**
   * Extend this process's exact lease before external email/token work. An
   * expired lease is never revived: a recovery process may already own the
   * cleanup decision even if its transaction has not committed yet.
   */
  renewRegistrationProvisioningLease(
    receipt: RegistrationProvisioningReceipt,
  ): number {
    return this.mutation(() => {
      this.stmts.acquireRegistrationWriteLock.run();
      const now = Date.now();
      const row = this.requireRegistrationProvisioning(receipt, now);
      const leaseExpiresAt = now + REGISTRATION_PROVISIONING_LEASE_MS;
      if (this.stmts.renewRegistrationProvisioningLease.run(
        leaseExpiresAt,
        row.registration_id,
        row.user_id,
        row.lease_owner_hash,
        now,
      ).changes !== 1) {
        throw registrationProvisioningLeaseLost();
      }
      return leaseExpiresAt;
    });
  }

  /**
   * Commit a registration only after all token/session/email provisioning has
   * succeeded. The bootstrap marker becomes durable in this same transaction.
   */
  finalizeRegistrationProvisioning(
    receipt: RegistrationProvisioningReceipt,
    auditRequest?: AuthAuditRequestContext,
  ): void {
    this.mutation(() => {
      this.stmts.acquireRegistrationWriteLock.run();
      const row = this.requireRegistrationProvisioning(receipt, Date.now());
      if (!this.getUserById(row.user_id)) {
        throw new Error('[auth] Registration provisioning user is missing.');
      }
      if (row.tenant_id) this.assertProvisionedTenant(row);
      if (this.authorizationBootstrapper?.hasProvisionalRegistrationAuthority
        && !this.authorizationBootstrapper.hasProvisionalRegistrationAuthority({
          registrationId: row.registration_id,
          userId: row.user_id,
          tenantId: row.tenant_id,
          isBootstrap: row.is_bootstrap === 1,
        })) {
        throw new Error('[auth] Registration provisioning authority is missing.');
      }
      if (row.is_bootstrap === 1) {
        if (this.getConfig('auth.bootstrap.completed') === '1') {
          throw new Error('[auth] Bootstrap was completed by a different registration.');
        }
        this.markBootstrapCompleted();
      }
      if (this.stmts.deleteRegistrationProvisioning.run(
        row.registration_id,
        row.user_id,
        row.lease_owner_hash,
      ).changes !== 1) {
        throw new Error('[auth] Registration provisioning finalization lost its marker.');
      }
      this.recordRegistrationAudit(
        row.user_id,
        row.tenant_id,
        row.is_bootstrap === 1,
        auditRequest,
      );
    });
  }

  private recordRegistrationAudit(
    userId: string,
    tenantId: string | null,
    bootstrap: boolean,
    request?: AuthAuditRequestContext,
  ): void {
    this.auditService?.append({
      action: bootstrap ? 'application.bootstrap-completed' : 'identity.registered',
      outcome: 'succeeded',
      scope: bootstrap || !tenantId
        ? { kind: 'application' }
        : { kind: 'tenant', tenantId },
      actor: {
        userId,
        provenance: bootstrap ? 'bootstrap' : 'registration',
      },
      request,
      target: { type: 'user', id: userId },
      metadata: { 'tenant-provisioned': tenantId !== null },
    });
    if (tenantId) {
      this.auditService?.append({
        action: 'tenant.created',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId },
        actor: {
          userId,
          provenance: bootstrap ? 'bootstrap' : 'registration',
        },
        request,
        target: { type: 'tenant', id: tenantId },
        metadata: { bootstrap },
      });
    }
  }

  /**
   * Remove the complete provisional domain graph in one transaction. Exact
   * pending provenance is required before protected owner rows may disappear.
   */
  rollbackRegistrationProvisioning(receipt: RegistrationProvisioningReceipt): boolean {
    return this.mutation(() => {
      this.stmts.acquireRegistrationWriteLock.run();
      const row = this.getRegistrationProvisioning(receipt);
      if (!row) {
        // Recovery may have won the writer lock immediately before the lease
        // owner tried to compensate. Treat already-absent state as idempotent,
        // but never accept a wrong lease for a live marker or finalized user.
        if (!this.stmts.getRegistrationProvisioningByIdentity.get(
          receipt.registrationId,
          receipt.userId,
        ) && !this.getUserById(receipt.userId)) return true;
        throw new Error('[auth] Registration provisioning receipt is invalid or stale.');
      }
      this.rollbackRegistrationProvisioningRow(row);
      return true;
    });
  }

  /** Recover only abandoned work; another process's live lease is untouched. */
  recoverPendingRegistrationProvisioning(): number {
    this.assertRuntimeProfileCurrent();
    const now = Date.now();
    const rows: RegistrationProvisioningRow[] =
      this.stmts.listRecoverableRegistrationProvisioning.all(now) as any;
    let recovered = 0;
    for (const candidate of rows) {
      const changed = this.mutation(() => {
        this.stmts.acquireRegistrationWriteLock.run();
        const row = this.stmts.getRegistrationProvisioningByIdentity.get(
          candidate.registration_id,
          candidate.user_id,
        ) as RegistrationProvisioningRow | null;
        if (!row) return false;
        const leaseIsLive = row.lease_owner_hash !== null
          && row.lease_expires_at !== null
          && row.lease_expires_at > Date.now();
        if (leaseIsLive) return false;
        this.rollbackRegistrationProvisioningRow(row);
        return true;
      });
      if (changed) recovered++;
    }
    return recovered;
  }

  private markBootstrapCompleted(): void {
    this.setConfig('auth.bootstrap.completed', '1');
  }

  private assertNoPendingBootstrapProvisioning(): void {
    if (!this.stmts.getPendingBootstrapProvisioning.get()) return;
    throw new AuthError(
      'Administrator bootstrap provisioning is already in progress',
      'BOOTSTRAP_PROVISIONING_IN_PROGRESS',
      409,
    );
  }

  private requireRegistrationProvisioning(
    receipt: RegistrationProvisioningReceipt,
    activeAt?: number,
  ): RegistrationProvisioningRow {
    const row = this.getRegistrationProvisioning(receipt);
    if (!row) {
      throw new Error('[auth] Registration provisioning receipt is invalid or stale.');
    }
    if (activeAt !== undefined
      && (row.lease_expires_at === null || row.lease_expires_at <= activeAt)) {
      throw registrationProvisioningLeaseLost();
    }
    return row;
  }

  private getRegistrationProvisioning(
    receipt: RegistrationProvisioningReceipt,
  ): RegistrationProvisioningRow | null {
    const leaseOwnerHash = registrationLeaseOwnerHash(receipt.leaseToken);
    const row = this.stmts.getRegistrationProvisioning.get(
      receipt.registrationId,
      receipt.userId,
      leaseOwnerHash,
    ) as RegistrationProvisioningRow | null;
    if (row && (row.tenant_id !== receipt.tenantId
      || Boolean(row.is_bootstrap) !== receipt.isBootstrap)) {
      throw new Error('[auth] Registration provisioning receipt is invalid or stale.');
    }
    return row;
  }

  private rollbackRegistrationProvisioningRow(row: RegistrationProvisioningRow): void {
    this.releaseProvisionalNativeBindings(row.user_id);
    this.deleteProvisionalPlatformActionTokens(row.user_id);
    if (row.tenant_id) this.deleteProvisionedTenant(row);
    if (row.is_bootstrap === 1 && row.tenant_id === null
      && this.authorizationBootstrapper?.rollbackProvisionalApplicationOwner
      && !this.authorizationBootstrapper.rollbackProvisionalApplicationOwner({
        userId: row.user_id,
        registrationId: row.registration_id,
      })) {
      throw new Error('[auth] Provisional application owner cleanup failed.');
    }
    const deleted = this.db.delete('users', row.user_id);
    if (!deleted) {
      throw new Error('[auth] Registration provisioning user cleanup failed.');
    }
    if (this.stmts.getRegistrationProvisioningByIdentity.get(
      row.registration_id,
      row.user_id,
    )) {
      throw new Error('[auth] Registration provisioning marker cleanup failed.');
    }
  }

  private assertProvisionedTenant(row: RegistrationProvisioningRow): void {
    const tenant = this.db.prepare(`
      SELECT tenant_id FROM _auth_tenants
      WHERE tenant_id = ? AND created_by = ?
    `).get(row.tenant_id, row.user_id) as { tenant_id: string } | null;
    const owner = this.db.prepare(`
      SELECT membership_id FROM _auth_tenant_memberships
      WHERE tenant_id = ? AND user_id = ? AND status = 'active' AND role_key = 'owner'
    `).get(row.tenant_id, row.user_id) as { membership_id: string } | null;
    if (!tenant || !owner) {
      throw new Error('[auth] Registration provisioning tenant ownership is invalid.');
    }
  }

  private deleteProvisionedTenant(row: RegistrationProvisioningRow): void {
    this.assertProvisionedTenant(row);
    this.db.prepare(`
      DELETE FROM _auth_tenants WHERE tenant_id = ? AND created_by = ?
    `).run(row.tenant_id, row.user_id);
    // Bun reports all rows affected by the cascading tenant graph here, so
    // `changes === 1` is not a valid success check. Verify the exact protected
    // tenant is absent instead; the WHERE predicate and prior ownership proof
    // remain the authority boundary.
    if (this.db.prepare(`
      SELECT 1 FROM _auth_tenants WHERE tenant_id = ?
    `).get(row.tenant_id)) {
      throw new Error('[auth] Registration provisioning tenant cleanup failed.');
    }
  }

  private releaseProvisionalNativeBindings(userId: string): void {
    this.db.prepare(`
      UPDATE _auth_native_requests
      SET bound_user_id = NULL, scope_kind = NULL, scope_id = NULL,
          tenant_id = NULL, membership_id = NULL,
          tenant_authorization_generation = NULL,
          membership_authorization_generation = NULL
      WHERE bound_user_id = ? AND consumed_at IS NULL
    `).run(userId);
  }

  /**
   * Platform action tokens intentionally have generic subjects rather than an
   * auth-user foreign key. Remove every token for the provisional identity in
   * this transaction so provider failure or crash recovery cannot strand an
   * otherwise valid verification secret after the user graph disappears.
   */
  private deleteProvisionalPlatformActionTokens(userId: string): void {
    const table = this.db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = '_zero_action_tokens'
    `).get();
    if (!table) return;
    this.db.prepare(`
      DELETE FROM _zero_action_tokens
      WHERE subject_type = 'user' AND subject_id = ?
    `).run(userId);
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
    this.assertRuntimeProfileCurrent();
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
    this.assertRuntimeProfileCurrent();
    const row = this.stmts.getUserByUsername.get(username) as UserRow | null;
    if (!row) return null;
    return this.toUserRecord(row, this.loadProperties(row.user_id));
  }

  /**
   * Get user by email. Returns null if not found.
   */
  getUserByEmail(email: string): UserRecord | null {
    this.assertRuntimeProfileCurrent();
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
    this.assertRuntimeProfileCurrent();
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
    this.assertRuntimeProfileCurrent();
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
    this.assertRuntimeProfileCurrent();
    const row = this.stmts.countUsersByRole.get(role) as CountRow;
    return row.count;
  }

  /** Count administrators that can currently complete a normal sign-in. */
  countActiveAdmins(): number {
    this.assertRuntimeProfileCurrent();
    const row = this.stmts.countActiveAdmins.get() as CountRow;
    return row.count;
  }

  /**
   * Update user fields through ReactiveDB change tracking. Client delivery, if
   * any, is decided separately by the composed Sync policy.
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
    return this.mutation(() => {
      // Read the current address only after the SQLite writer lock is held.
      // Otherwise another process could replace and verify address B between
      // this read and our write of address A, carrying B's verification proof
      // back onto A.
      const current = email === undefined ? null : this.getUserById(userId);
      const emailChanged = email !== undefined
        && current !== null
        && canonicalizeEmail(current.email) !== email;

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
      // A verification timestamp belongs to one canonical address. Low-level
      // callers cannot carry it onto a replacement address, even if they omit
      // the explicit verification fields used by the admin service.
      if (emailChanged) mapped.email_verified_at = null;
      if (partial.emailVerificationRequired !== undefined) {
        mapped.email_verification_required = partial.emailVerificationRequired ? 1 : 0;
      }
      if (partial.mfaRequired !== undefined) {
        mapped.mfa_required = partial.mfaRequired ? 1 : 0;
      }

      // Keep friendly uniqueness errors inside the same writer transaction as
      // the update; database constraints remain the final race-safe boundary.
      if (partial.username !== undefined) {
        const existing = this.getUserByUsername(partial.username);
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
      return this.getUserById(userId);
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
   * Delete a user. Cascades identity-owned private auth state. In multi-tenant
   * mode, durable organization history is retained and blocks hard deletion;
   * callers should suspend that identity instead.
   * Returns true if deleted, false if not found.
   */
  deleteUser(userId: string): boolean {
    let hasRetainedTenantHistory = false;
    try {
      return this.mutation(() => {
        // Capture this while the immediate writer transaction is still
        // healthy. Once a managed delete fails, ReactiveDB deliberately
        // rejects every further database operation in that transaction.
        hasRetainedTenantHistory = this.hasRetainedTenantHistory(userId);
        return this.db.delete('users', userId) !== null;
      });
    } catch (error) {
      // Translate only after the transaction boundary has rolled back. This
      // keeps ReactiveDB's rollback-only contract intact while preserving the
      // stable auth errors exposed by UserStore.
      const ownerError = mapOwnerLifecycleError(error);
      if (ownerError !== error) throw ownerError;
      if (hasRetainedTenantHistory && isSqliteForeignKeyConstraint(error)) {
        throw userHasTenantHistoryError();
      }
      throw error;
    }
  }

  /** Check known retained references only while deleteUser holds the writer lock. */
  private hasRetainedTenantHistory(userId: string): boolean {
    if (this.tenancyMode !== 'multi') return false;
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
    this.assertRuntimeProfileCurrent();
    const cred = this.stmts.getCredential.get(userId) as CredentialRow | null;
    if (!cred) return false;
    const valid = await Bun.password.verify(password, cred.password_hash);
    this.assertRuntimeProfileCurrent();
    return valid;
  }

  /**
   * Change password. Verifies current password, hashes new one, revokes all refresh tokens.
   * Returns true if changed, false if current password wrong.
   */
  async updatePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    auditContext?: AuthSecurityAuditContext,
  ): Promise<boolean> {
    const valid = await this.verifyPassword(userId, currentPassword);
    if (!valid) return false;

    const newHash = await Bun.password.hash(newPassword);
    return this.mutation(() => {
      if (this.stmts.updateCredential.run(newHash, userId).changes !== 1) return false;
      if (!this.updateUser(userId, { passwordChangeRequired: false })) {
        throw new Error('[auth] Password credential lost its user row.');
      }
      // Force re-login on all devices
      this.revokeAllUserTokens(userId);
      this.recordSecurityAudit('account.password-changed', userId, auditContext, {
        userId,
        provenance: 'authenticated-request',
      });
      return true;
    });
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
    options: {
      passwordChangeRequired?: boolean;
      audit?: AuthSecurityAuditContext;
      beforeCommit?: () => void;
    } = {},
  ): Promise<boolean> {
    if (!this.getUserById(userId)) return false;

    const newHash = await Bun.password.hash(newPassword);
    return this.mutation(() => {
      options.beforeCommit?.();
      if (this.stmts.updateCredential.run(newHash, userId).changes !== 1) return false;
      if (!this.updateUser(userId, {
        passwordChangeRequired: options.passwordChangeRequired ?? false,
      })) throw new Error('[auth] Password credential lost its user row.');
      this.revokeAllUserTokens(userId);
      this.recordSecurityAudit(
        'account.password-reset-by-admin',
        userId,
        options.audit,
      );
      return true;
    });
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
    consumeActionToken: () => void,
    auditContext?: AuthSecurityAuditContext,
  ): Promise<boolean> {
    const newHash = await Bun.password.hash(newPassword);

    return this.mutation(() => {
      if (!this.getUserById(userId)) return false;
      consumeActionToken();
      this.stmts.updateCredential.run(newHash, userId);
      this.updateUser(userId, { passwordChangeRequired: false });
      this.revokeAllUserTokens(userId);
      this.recordSecurityAudit(
        'account.password-recovered',
        userId,
        auditContext,
        { userId, provenance: 'account-recovery' },
      );
      return true;
    });
  }

  /**
   * Mark an account as requiring a password change and revoke refresh tokens.
   */
  requirePasswordChange(
    userId: string,
    auditContext?: AuthSecurityAuditContext,
  ): boolean {
    return this.mutation(() => {
      const updated = this.updateUser(userId, { passwordChangeRequired: true });
      if (!updated) return false;
      this.revokeAllUserTokens(userId);
      this.recordSecurityAudit(
        'account.password-change-required',
        userId,
        auditContext,
      );
      return true;
    });
  }

  /**
   * Clear the forced password-change flag and invalidate every prior token.
   */
  clearPasswordChangeRequired(
    userId: string,
    auditContext?: AuthSecurityAuditContext,
  ): boolean {
    return this.mutation(() => {
      const updated = this.updateUser(userId, { passwordChangeRequired: false });
      if (!updated) return false;
      this.revokeAllUserTokens(userId);
      this.recordSecurityAudit(
        'account.password-change-requirement-cleared',
        userId,
        auditContext,
      );
      return true;
    });
  }

  private recordSecurityAudit(
    action: string,
    userId: string,
    context?: AuthSecurityAuditContext,
    fallbackActor: AuthAuditActor = { provenance: 'system' },
  ): void {
    this.auditService?.append({
      action,
      outcome: 'succeeded',
      scope: { kind: 'application' },
      actor: context?.actor ?? fallbackActor,
      request: context?.request,
      target: { type: 'user', id: userId },
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
    verifiedAt = Date.now(),
    afterVerify?: (user: UserRecord, verifiedAt: number) => void,
    auditContext?: AuthSecurityAuditContext,
  ): UserRecord | null {
    return this.mutation(() => {
      const current = this.getUserById(userId);
      if (!current) return null;
      if (!current.emailVerificationRequired || current.emailVerifiedAt !== null) {
        throw new AuthError('Action token is invalid', 'ACTION_TOKEN_INVALID', 400);
      }
      consumeActionToken();
      const user = this.markEmailVerified(userId, verifiedAt);
      if (!user) return null;
      afterVerify?.(user, verifiedAt);
      // Verification links complete authentication, so invalidate every
      // sibling link and pre-verification session before issuing a new one.
      this.revokeAllUserTokens(userId);
      this.recordSecurityAudit(
        'account.email-verified',
        userId,
        auditContext,
        { userId, provenance: 'registration' },
      );
      return user;
    });
  }

  /** Current primary-email generation. Migration 017 initializes existing rows at 1. */
  getEmailGeneration(userId: string): number {
    this.assertRuntimeProfileCurrent();
    const columns = this.db.prepare('PRAGMA table_info(users)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'email_generation')) return 1;
    const row = this.db.prepare(
      'SELECT email_generation FROM users WHERE user_id = ?',
    ).get(userId) as { email_generation: number } | null;
    return row?.email_generation ?? 1;
  }

  /** Record explicit email-link provenance; administrative verification never calls this. */
  recordEmailLinkMailboxProof(input: {
    proofId?: string;
    applicationId: string;
    userId: string;
    email: string;
    emailGeneration: number;
    provedAt: number;
    expiresAt: number;
  }): string | null {
    return this.mutation(() => {
      const table = this.db.prepare(`SELECT 1 FROM sqlite_master
        WHERE type = 'table' AND name = '_auth_mailbox_proofs'`).get();
      if (!table) return null;
      const proofId = input.proofId ?? `mbp_${crypto.randomUUID()}`;
      this.db.prepare(`
        INSERT INTO _auth_mailbox_proofs (
          proof_id, application_id, user_id, email, email_generation,
          source, proved_at, expires_at, revoked_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'email-link', ?, ?, NULL, ?)
      `).run(
        proofId,
        input.applicationId,
        input.userId,
        canonicalizeEmail(input.email),
        input.emailGeneration,
        input.provedAt,
        input.expiresAt,
        input.provedAt,
      );
      return proofId;
    });
  }

  // ─── Properties KV ───────────────────────────────────────────────────

  /**
   * Set a user property. INSERT OR REPLACE semantics.
   * Uses prepared statement (composite PK — not managed by ReactiveDB defineTable).
   */
  setProperty(userId: string, key: string, value: string): void {
    this.mutation(() => this.stmts.insertProperty.run(userId, key, value));
  }

  /**
   * Set multiple user properties.
   */
  setProperties(userId: string, properties: Record<string, string>): void {
    this.mutation(() => {
      for (const [key, value] of Object.entries(properties)) {
        this.stmts.insertProperty.run(userId, key, value);
      }
    });
  }

  /**
   * Get a single property value. Returns null if not found.
   */
  getProperty(userId: string, key: string): string | null {
    this.assertRuntimeProfileCurrent();
    const row = this.stmts.getProperty.get(userId, key) as {
      value: string | null;
    } | null;
    return row?.value ?? null;
  }

  /**
   * Get all properties for a user as a key-value map.
   */
  getProperties(userId: string): Record<string, string> {
    this.assertRuntimeProfileCurrent();
    return this.loadProperties(userId);
  }

  /**
   * Delete a single property. Uses prepared statement (composite PK).
   */
  deleteProperty(userId: string, key: string): void {
    this.mutation(() => this.stmts.deleteProperty.run(userId, key));
  }

  // ─── Refresh Tokens ──────────────────────────────────────────────────

  /** Atomically consume a live refresh token and persist its replacement. */
  rotateRefreshTokenAtomically(
    current: RefreshTokenRecord,
    replacement: RefreshTokenReplacement,
    expectedAuthGeneration: number,
    now = Date.now()
  ): RefreshTokenRotationResult {
    return this.mutation(() => {
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
          current.sessionId,
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

  /**
   * Consume a live refresh credential while atomically replacing its durable
   * parent. `replaceParent` runs inside this same transaction before the new
   * refresh row is inserted, preserving its foreign-key boundary.
   */
  replaceRefreshSessionAtomically(
    current: RefreshTokenRecord,
    replacement: RefreshTokenReplacement,
    replacementSessionId: string,
    expectedAuthGeneration: number,
    replaceParent: () => boolean,
    now = Date.now(),
  ): RefreshTokenRotationResult {
    try {
      return this.mutation(() => {
        const consumed = this.stmts.consumeRefreshToken.run(
          now,
          current.tokenId,
          current.userId,
          now,
          expectedAuthGeneration,
        );
        if (consumed.changes === 1) {
          if (!replaceParent()) throw REFRESH_SESSION_REPLACEMENT_ROLLBACK;
          this.stmts.insertRefreshToken.run(
            replacement.tokenId,
            current.userId,
            replacementSessionId,
            replacement.tokenHash,
            replacement.expiresAt,
            replacement.createdAt,
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
    } catch (error) {
      if (error === REFRESH_SESSION_REPLACEMENT_ROLLBACK) return 'invalid';
      throw error;
    }
  }

  /** Apply family invalidation when a presented refresh token was already used. */
  invalidateRefreshTokenReplay(userId: string, now = Date.now()): void {
    this.mutation(() => this.invalidateRefreshReplay(userId, now));
  }

  /** Store a hashed refresh token. Internal table — no broadcast. */
  storeRefreshToken(
    tokenId: string,
    userId: string,
    tokenHash: string,
    expiresAt: number
  ): void {
    this.mutation(() => this.stmts.insertRefreshToken.run(
      tokenId,
      userId,
      null,
      tokenHash,
      expiresAt,
      Date.now()
    ));
  }

  /** Insert a refresh session only while its signed user state is still current. */
  storeRefreshTokenIfCurrent(
    tokenId: string,
    user: Pick<UserRecord, 'userId' | 'email' | 'role'>,
    tokenHash: string,
    expiresAt: number,
    createdAt: number,
    expectedAuthGeneration: number,
    sessionId: string | null = null,
  ): boolean {
    return this.mutation(() => this.stmts.insertRefreshTokenIfCurrent.run(
      tokenId,
      sessionId,
      tokenHash,
      expiresAt,
      createdAt,
      user.userId,
      user.email,
      user.role,
      expectedAuthGeneration
    ).changes === 1);
  }

  /**
   * Look up a refresh token by its server-generated session id.
   * Returns revoked and expired records so the caller can fail closed using
   * the same lifecycle rules as refresh-token rotation.
   */
  getRefreshTokenById(tokenId: string): RefreshTokenRecord | null {
    this.assertRuntimeProfileCurrent();
    const row = this.stmts.getRefreshTokenById.get(tokenId) as RefreshTokenRow | null;
    return row ? toRefreshTokenRecord(row) : null;
  }

  /**
   * Look up a refresh token by its hash.
   * Returns the record EVEN IF REVOKED — caller handles revocation logic.
   * This is deliberate for replay detection.
   */
  getRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null {
    this.assertRuntimeProfileCurrent();
    const row = this.stmts.getRefreshTokenByHash.get(
      tokenHash
    ) as RefreshTokenRow | null;
    return row ? toRefreshTokenRecord(row) : null;
  }

  /**
   * Revoke a single refresh token (set revoked_at).
   */
  revokeRefreshToken(tokenId: string): void {
    this.mutation(() => {
      const now = Date.now();
      const record = this.getRefreshTokenById(tokenId);
      this.stmts.revokeRefreshToken.run(now, tokenId);
      if (record?.sessionId) {
        this.authSessionRevoker?.revoke(record.sessionId, 'refresh-revoked', now);
      }
    });
  }

  /**
   * Revoke ALL non-revoked refresh tokens for a user (family rotation / password change).
   */
  revokeAllUserTokens(userId: string): void {
    this.mutation(() => {
      this.stmts.revokeAllUserTokens.run(Date.now(), userId);
      this.authGenerations.bump(userId);
      this.authSessionRevoker?.revokeAllForUser(
        userId,
        'security-state-changed',
      );
    });
  }

  private invalidateRefreshReplay(userId: string, now: number): void {
    const user = this.getUserById(userId);
    if (!user || user.passwordChangeRequired) return;
    this.stmts.revokeAllUserTokens.run(now, userId);
    this.authGenerations.bump(userId);
    this.authSessionRevoker?.revokeAllForUser(userId, 'refresh-replay', now);
  }

  /** Return the security generation embedded in newly issued auth tokens. */
  getAuthGeneration(userId: string): number {
    this.assertRuntimeProfileCurrent();
    return this.authGenerations.get(userId);
  }

  /**
   * Delete expired and revoked tokens. Cleanup operation.
   * Returns number of deleted rows.
   */
  deleteExpiredTokens(): number {
    return this.mutation(() => {
      const now = Date.now();
      const result = this.stmts.deleteExpiredTokens.run(now, now);
      this.authSessionRevoker?.deleteExpiredSessions?.(now);
      return result.changes;
    });
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
    return this.mutation(() => {
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
    });
  }

  /**
   * Look up a one-time auth action token by hash.
   */
  getActionTokenByHash(tokenHash: string): AuthActionTokenRecord | null {
    this.assertRuntimeProfileCurrent();
    const row = this.stmts.getActionTokenByHash.get(tokenHash) as AuthActionTokenRow | null;
    if (!row) return null;
    return this.toActionTokenRecord(row);
  }

  /**
   * Mark an action token consumed. Returns false if it was already consumed.
   */
  consumeActionToken(tokenId: string): boolean {
    return this.mutation(() => (
      this.stmts.consumeActionToken.run(Date.now(), tokenId).changes > 0
    ));
  }

  /** Delete an action token that failed before delivery completed. */
  deleteActionToken(tokenId: string): boolean {
    return this.mutation(() => this.stmts.deleteActionToken.run(tokenId).changes > 0);
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
    this.assertRuntimeProfileCurrent();
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
    return this.mutation(() => {
      const now = Date.now();
      return this.stmts.deleteExpiredActionTokens.run(now, now).changes;
    });
  }

  // ─── Auth Config ─────────────────────────────────────────────────────

  /**
   * Get a config value from _auth_config. Returns null if not found.
   */
  getConfig(key: string): string | null {
    this.assertRuntimeProfileCurrent();
    const row = this.stmts.getConfig.get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  /**
   * Set a config value in _auth_config. INSERT OR REPLACE.
   */
  setConfig(key: string, value: string): void {
    this.mutation(() => this.stmts.setConfig.run(key, value));
  }

  // ─── Internal Helpers ────────────────────────────────────────────────

  private mutation<T>(operation: () => T): T {
    return this.db.transaction(() => {
      this.assertRuntimeProfileCurrent();
      return operation();
    });
  }

  private assertRuntimeProfileCurrent(): void {
    this.runtimeProfileGuard?.();
  }

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

  private hasPrivateTable(name: string): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(name));
  }
}

function registrationLeaseOwnerHash(leaseToken: string): string {
  if (!REGISTRATION_PROVISIONING_LEASE_TOKEN_PATTERN.test(leaseToken)) {
    throw new Error('[auth] Registration provisioning receipt is invalid or stale.');
  }
  return hashToken(leaseToken);
}

function registrationProvisioningLeaseLost(): AuthError {
  return new AuthError(
    'Registration provisioning lease is no longer active',
    'REGISTRATION_PROVISIONING_LEASE_LOST',
    409,
  );
}

function multiTenantBootstrapOrganizationRequired(): AuthError {
  return new AuthError(
    'Multi-tenant bootstrap requires atomic organization provisioning',
    'MULTI_TENANT_BOOTSTRAP_ORGANIZATION_REQUIRED',
    409,
  );
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

function toRefreshTokenRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    sessionId: row.session_id,
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
