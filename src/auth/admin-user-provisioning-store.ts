/** Exact lifecycle, rollback, and crash recovery for admin-created accounts. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { createOpaqueToken, hashToken } from '../tokens/token-utils';
import type { AuthAuditService } from './auth-audit-service';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { ADMIN_USER_PROVISIONING_TABLE } from './admin-user-provisioning-schema';
import { AuthError, type UserRecord } from './types';

export const ADMIN_USER_PROVISIONING_LEASE_MS = 5 * 60_000;
const LEASE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Process-held capability for one administrator-created provisional account. */
export interface AdminUserProvisioningReceipt {
  readonly provisioningId: string;
  readonly userId: string;
  /** Raw capability; SQLite persists only its SHA-256 digest. */
  readonly leaseToken: string;
}

export interface PreparedAdminUserProvisioning {
  readonly provisioningId: string;
  readonly leaseToken: string;
  readonly leaseOwnerHash: string;
}

interface AdminUserProvisioningRow {
  provisioning_id: string;
  user_id: string;
  user_fingerprint: string;
  auth_generation: number;
  setup_token_id: string | null;
  lease_owner_hash: string;
  lease_expires_at: number;
  created_at: number;
}

interface AdminUserProvisioningDependencies {
  mutation: <T>(operation: () => T) => T;
  afterCommit: (callback: () => unknown) => void;
  assertCurrentProfile: () => void;
  getUserById: (userId: string) => UserRecord | null;
  getAuthGeneration: (userId: string) => number;
  auditService: AuthAuditService | null;
  emitCode?: AuthPlatformCodeEmitter;
}

interface StoredSetupToken {
  readonly backend: 'legacy' | 'platform';
  readonly tokenId: string;
  readonly userId: string;
  readonly purpose: string;
  readonly expiresAt: number;
  readonly consumedAt: number | null;
}

/** Prepare an unguessable receipt without writing caller-controlled state. */
export function prepareAdminUserProvisioning(): PreparedAdminUserProvisioning {
  const leaseToken = createOpaqueToken();
  return Object.freeze({
    provisioningId: `auprov_${crypto.randomUUID()}`,
    leaseToken,
    leaseOwnerHash: hashToken(leaseToken),
  });
}

/** Stable, secret-free fingerprint of the identity created provisionally. */
export function fingerprintAdminProvisionedUser(user: UserRecord): string {
  return JSON.stringify([
    user.userId,
    user.username,
    user.email,
    user.firstName,
    user.lastName,
    user.role,
    user.status,
    user.passwordChangeRequired,
    user.emailVerifiedAt,
    user.emailVerificationRequired,
    user.mfaRequired,
    user.createdAt,
    user.updatedAt,
    Object.entries(user.properties).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    )),
  ]);
}

/** Owns the private admin-provisioning marker and its exact compensation. */
export class AdminUserProvisioningStore {
  private readonly stmts: {
    acquireWriteLock: Statement;
    insert: Statement;
    get: Statement;
    getByIdentity: Statement;
    listRecoverable: Statement;
    renewLease: Statement;
    bindSetupToken: Statement;
    delete: Statement;
    deleteByIdentity: Statement;
  };

  constructor(
    private readonly db: ReactiveDB,
    private readonly dependencies: AdminUserProvisioningDependencies,
  ) {
    this.stmts = {
      acquireWriteLock: db.prepare(`
        INSERT INTO _auth_config (key, value)
        VALUES ('auth.admin_user_provisioning.write_lock', '1')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `),
      insert: db.prepare(`
        INSERT INTO ${ADMIN_USER_PROVISIONING_TABLE} (
          provisioning_id, user_id, user_fingerprint, auth_generation,
          setup_token_id, lease_owner_hash, lease_expires_at, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
      `),
      get: db.prepare(`
        SELECT * FROM ${ADMIN_USER_PROVISIONING_TABLE}
        WHERE provisioning_id = ? AND user_id = ? AND lease_owner_hash = ?
      `),
      getByIdentity: db.prepare(`
        SELECT * FROM ${ADMIN_USER_PROVISIONING_TABLE}
        WHERE provisioning_id = ? AND user_id = ?
      `),
      listRecoverable: db.prepare(`
        SELECT * FROM ${ADMIN_USER_PROVISIONING_TABLE}
        WHERE lease_expires_at <= ?
        ORDER BY created_at ASC, provisioning_id ASC
      `),
      renewLease: db.prepare(`
        UPDATE ${ADMIN_USER_PROVISIONING_TABLE}
        SET lease_expires_at = ?
        WHERE provisioning_id = ? AND user_id = ? AND lease_owner_hash = ?
          AND lease_expires_at > ?
      `),
      bindSetupToken: db.prepare(`
        UPDATE ${ADMIN_USER_PROVISIONING_TABLE}
        SET setup_token_id = ?
        WHERE provisioning_id = ? AND user_id = ? AND lease_owner_hash = ?
          AND setup_token_id IS NULL AND lease_expires_at > ?
      `),
      delete: db.prepare(`
        DELETE FROM ${ADMIN_USER_PROVISIONING_TABLE}
        WHERE provisioning_id = ? AND user_id = ? AND lease_owner_hash = ?
      `),
      deleteByIdentity: db.prepare(`
        DELETE FROM ${ADMIN_USER_PROVISIONING_TABLE}
        WHERE provisioning_id = ? AND user_id = ?
      `),
    };
  }

  lockWrites(): void {
    this.stmts.acquireWriteLock.run();
  }

  insert(input: PreparedAdminUserProvisioning & {
    user: UserRecord;
    authGeneration: number;
    createdAt: number;
  }): AdminUserProvisioningReceipt {
    this.stmts.insert.run(
      input.provisioningId,
      input.user.userId,
      fingerprintAdminProvisionedUser(input.user),
      input.authGeneration,
      input.leaseOwnerHash,
      input.createdAt + ADMIN_USER_PROVISIONING_LEASE_MS,
      input.createdAt,
    );
    return Object.freeze({
      provisioningId: input.provisioningId,
      userId: input.user.userId,
      leaseToken: input.leaseToken,
    });
  }

  renewLease(receipt: AdminUserProvisioningReceipt): number {
    return this.dependencies.mutation(() => {
      this.lockWrites();
      const now = Date.now();
      const row = this.require(receipt, now);
      const leaseExpiresAt = now + ADMIN_USER_PROVISIONING_LEASE_MS;
      if (this.stmts.renewLease.run(
        leaseExpiresAt,
        row.provisioning_id,
        row.user_id,
        row.lease_owner_hash,
        now,
      ).changes !== 1) throw adminProvisioningLeaseLost();
      return leaseExpiresAt;
    });
  }

  /** Bind the exact setup token inside the token-creation transaction. */
  bindSetupToken(
    receipt: AdminUserProvisioningReceipt,
    setupTokenId: string,
  ): void {
    this.dependencies.mutation(() => {
      this.lockWrites();
      const now = Date.now();
      const row = this.require(receipt, now);
      if (row.setup_token_id !== null) throw staleAdminReceipt();
      const user = this.dependencies.getUserById(row.user_id);
      this.requireActiveSetupToken(setupTokenId, row.user_id, now);
      if (!user || !this.adminUserStateIsPristine(row, user, setupTokenId)) {
        throw authenticationStateChanged();
      }
      if (this.stmts.bindSetupToken.run(
        setupTokenId,
        row.provisioning_id,
        row.user_id,
        row.lease_owner_hash,
        now,
      ).changes !== 1) throw staleAdminReceipt();
    });
  }

  /**
   * Fence the final password-gate transaction against identity adoption or
   * mutation after setup delivery began. The caller invokes this immediately
   * before committing that gate, while still inside the shared transaction.
   */
  assertCommitReady(receipt: AdminUserProvisioningReceipt): void {
    this.dependencies.mutation(() => {
      this.lockWrites();
      const now = Date.now();
      const row = this.require(receipt, now);
      const user = this.dependencies.getUserById(row.user_id);
      if (!user || !row.setup_token_id) throw authenticationStateChanged();
      this.requireActiveSetupToken(row.setup_token_id, row.user_id, now);
      if (!this.adminUserStateIsPristine(row, user)) {
        throw authenticationStateChanged();
      }
    });
  }

  /** Finalize only while the delivered setup token remains exact and usable. */
  finalize(receipt: AdminUserProvisioningReceipt): void {
    this.dependencies.mutation(() => {
      this.lockWrites();
      const now = Date.now();
      const row = this.require(receipt, now);
      if (!this.dependencies.getUserById(row.user_id)) {
        throw this.invariant('user-missing');
      }
      if (!row.setup_token_id) throw this.invariant('setup-token-unbound');
      this.requireActiveSetupToken(row.setup_token_id, row.user_id, now);
      if (this.stmts.delete.run(
        row.provisioning_id,
        row.user_id,
        row.lease_owner_hash,
      ).changes !== 1) throw this.invariant('marker-finalization-lost');
    });
  }

  /** Roll back only the exact untouched provisional identity. */
  rollback(receipt: AdminUserProvisioningReceipt): boolean {
    return this.dependencies.mutation(() => {
      this.lockWrites();
      const row = this.get(receipt);
      if (!row) {
        if (!this.stmts.getByIdentity.get(receipt.provisioningId, receipt.userId)
          && !this.dependencies.getUserById(receipt.userId)) return true;
        throw staleAdminReceipt();
      }
      return this.reconcileRow(row);
    });
  }

  /** Reconcile expired receipts after an interrupted administrator request. */
  recoverPending(): number {
    this.dependencies.assertCurrentProfile();
    const rows = this.stmts.listRecoverable.all(
      Date.now(),
    ) as AdminUserProvisioningRow[];
    let recovered = 0;
    for (const candidate of rows) {
      let cleanupSucceeded = false;
      const changed = this.dependencies.mutation(() => {
        this.lockWrites();
        const row = this.stmts.getByIdentity.get(
          candidate.provisioning_id,
          candidate.user_id,
        ) as AdminUserProvisioningRow | null;
        if (!row || row.lease_expires_at > Date.now()) return false;
        cleanupSucceeded = this.reconcileRow(row);
        this.appendRecoveryAudit(row.user_id, cleanupSucceeded);
        this.dependencies.afterCommit(() => this.dependencies.emitCode?.(
          OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_RECOVERED,
          { metadata: { cleanupSucceeded } },
        ));
        return true;
      });
      if (!changed) continue;
      recovered += 1;
    }
    return recovered;
  }

  private reconcileRow(row: AdminUserProvisioningRow): boolean {
    this.deleteExactSetupToken(row);
    const user = this.dependencies.getUserById(row.user_id);
    if (!user) {
      this.retireMarker(row);
      return true;
    }
    if (!this.adminUserStateIsPristine(row, user)) {
      this.retireMarker(row);
      return false;
    }
    if (!this.db.delete('users', row.user_id)) {
      throw this.invariant('user-cleanup');
    }
    if (this.stmts.getByIdentity.get(row.provisioning_id, row.user_id)) {
      throw this.invariant('marker-cleanup');
    }
    return true;
  }

  private adminUserStateIsPristine(
    row: AdminUserProvisioningRow,
    user: UserRecord,
    setupTokenId = row.setup_token_id,
  ): boolean {
    return this.originalIdentityStateIsPristine(row, user)
      && !this.hasUnexpectedUserReferences(row.user_id, setupTokenId)
      && !this.hasUnexpectedDetachedUserReferences(row.user_id, setupTokenId);
  }

  private originalIdentityStateIsPristine(
    row: AdminUserProvisioningRow,
    user: UserRecord,
  ): boolean {
    return fingerprintAdminProvisionedUser(user) === row.user_fingerprint
      && this.dependencies.getAuthGeneration(row.user_id) === row.auth_generation;
  }

  private hasUnexpectedUserReferences(
    userId: string,
    setupTokenId: string | null,
  ): boolean {
    const allowed = new Set([
      ADMIN_USER_PROVISIONING_TABLE,
      '_auth_user_generations',
      '_credentials',
      'user_properties',
    ]);
    const tables = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all() as Array<{ name: string }>;
    for (const { name } of tables) {
      if (allowed.has(name.toLowerCase())) continue;
      const table = quoteSqlIdentifier(name);
      const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(${table})`)
        .all() as Array<{ table: string; from: string }>;
      for (const foreignKey of foreignKeys) {
        if (foreignKey.table.toLowerCase() !== 'users') continue;
        const column = quoteSqlIdentifier(foreignKey.from);
        if (name.toLowerCase() === '_auth_action_tokens' && setupTokenId) {
          if (this.db.prepare(`
            SELECT 1 FROM ${table}
            WHERE ${column} = ? AND token_id <> ?
            LIMIT 1
          `).get(userId, setupTokenId)) return true;
          continue;
        }
        if (this.db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`)
          .get(userId)) return true;
      }
    }
    return false;
  }

  /**
   * Platform token tables deliberately have no foreign key to app-owned user
   * tables. Ignore only the exact bound action token during the pre-commit
   * fence; recovery removes that token before reaching this check. Every
   * other action or resume-token subject reference is account adoption.
   */
  private hasUnexpectedDetachedUserReferences(
    userId: string,
    setupTokenId: string | null,
  ): boolean {
    for (const table of ['_zero_action_tokens', '_zero_resume_tokens'] as const) {
      if (!this.tableExists(table)) continue;
      if (table === '_zero_action_tokens' && setupTokenId) {
        if (this.db.prepare(`
          SELECT 1 FROM ${table}
          WHERE subject_type = 'user' AND subject_id = ? AND token_id <> ?
          LIMIT 1
        `).get(userId, setupTokenId)) return true;
        continue;
      }
      if (this.db.prepare(`
        SELECT 1 FROM ${table}
        WHERE subject_type = 'user' AND subject_id = ?
        LIMIT 1
      `).get(userId)) return true;
    }
    return false;
  }

  private requireActiveSetupToken(
    tokenId: string,
    userId: string,
    now: number,
  ): StoredSetupToken {
    const token = this.readExactSetupToken(tokenId, userId);
    if (!token || token.consumedAt !== null || token.expiresAt <= now) {
      throw authenticationStateChanged();
    }
    return token;
  }

  private deleteExactSetupToken(row: AdminUserProvisioningRow): void {
    if (!row.setup_token_id) return;
    const token = this.readExactSetupToken(row.setup_token_id, row.user_id);
    if (!token) return;
    const table = token.backend === 'legacy'
      ? '_auth_action_tokens'
      : '_zero_action_tokens';
    const userColumn = token.backend === 'legacy' ? 'user_id' : 'subject_id';
    const result = this.db.prepare(`
      DELETE FROM ${table}
      WHERE token_id = ? AND ${userColumn} = ?
    `).run(token.tokenId, token.userId);
    if (result.changes !== 1) throw this.invariant('setup-token-cleanup-lost');
  }

  private readExactSetupToken(
    tokenId: string,
    userId: string,
  ): StoredSetupToken | null {
    const matches: StoredSetupToken[] = [];
    if (this.tableExists('_auth_action_tokens')) {
      const row = this.db.prepare(`
        SELECT token_id, user_id, type, expires_at, consumed_at
        FROM _auth_action_tokens WHERE token_id = ?
      `).get(tokenId) as {
        token_id: string;
        user_id: string;
        type: string;
        expires_at: number;
        consumed_at: number | null;
      } | null;
      if (row) {
        if (row.user_id !== userId || row.type !== 'account_setup') {
          throw this.invariant('legacy-setup-token-mismatch');
        }
        matches.push({
          backend: 'legacy',
          tokenId: row.token_id,
          userId: row.user_id,
          purpose: row.type,
          expiresAt: row.expires_at,
          consumedAt: row.consumed_at,
        });
      }
    }
    if (this.tableExists('_zero_action_tokens')) {
      const row = this.db.prepare(`
        SELECT token_id, purpose, subject_type, subject_id, expires_at, consumed_at
        FROM _zero_action_tokens WHERE token_id = ?
      `).get(tokenId) as {
        token_id: string;
        purpose: string;
        subject_type: string | null;
        subject_id: string | null;
        expires_at: number;
        consumed_at: number | null;
      } | null;
      if (row) {
        if (row.subject_type !== 'user'
          || row.subject_id !== userId
          || row.purpose !== 'account_setup') {
          throw this.invariant('platform-setup-token-mismatch');
        }
        matches.push({
          backend: 'platform',
          tokenId: row.token_id,
          userId: row.subject_id,
          purpose: row.purpose,
          expiresAt: row.expires_at,
          consumedAt: row.consumed_at,
        });
      }
    }
    if (matches.length > 1) throw this.invariant('setup-token-ambiguous');
    return matches[0] ?? null;
  }

  private tableExists(table: string): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(table));
  }

  private appendRecoveryAudit(userId: string, cleanupSucceeded: boolean): void {
    this.dependencies.auditService?.append({
      action: cleanupSucceeded
        ? 'identity.provisioning-rolled-back'
        : 'identity.provisioning-reconciled',
      outcome: 'succeeded',
      reason: cleanupSucceeded ? 'provisioning-recovery' : 'newer-state-preserved',
      scope: { kind: 'application' },
      actor: { provenance: 'system' },
      target: { type: 'user', id: userId },
      metadata: { 'cleanup-succeeded': cleanupSucceeded },
    });
  }

  private require(
    receipt: AdminUserProvisioningReceipt,
    activeAt?: number,
  ): AdminUserProvisioningRow {
    const row = this.get(receipt);
    if (!row) throw staleAdminReceipt();
    if (activeAt !== undefined && row.lease_expires_at <= activeAt) {
      throw adminProvisioningLeaseLost();
    }
    return row;
  }

  private get(
    receipt: AdminUserProvisioningReceipt,
  ): AdminUserProvisioningRow | null {
    return this.stmts.get.get(
      receipt.provisioningId,
      receipt.userId,
      leaseOwnerHash(receipt.leaseToken),
    ) as AdminUserProvisioningRow | null;
  }

  private retireMarker(row: AdminUserProvisioningRow): void {
    if (this.stmts.deleteByIdentity.run(
      row.provisioning_id,
      row.user_id,
    ).changes !== 1) throw this.invariant('marker-retirement-lost');
  }

  private invariant(invariant: string): AuthError {
    this.dependencies.emitCode?.(OBS_CODES.AUTH_STATE_INVARIANT_FAILED, {
      metadata: { component: 'admin-user-provisioning', invariant },
    });
    return new AuthError(
      '[auth] Administrator user provisioning state is inconsistent.',
      'AUTH_STATE_INVARIANT_FAILED',
      500,
    );
  }
}

function leaseOwnerHash(leaseToken: string): string {
  if (!LEASE_TOKEN_PATTERN.test(leaseToken)) throw staleAdminReceipt();
  return hashToken(leaseToken);
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function staleAdminReceipt(): AuthError {
  return new AuthError(
    'Administrator user provisioning receipt is invalid or stale',
    'ADMIN_USER_PROVISIONING_RECEIPT_INVALID',
    409,
  );
}

function adminProvisioningLeaseLost(): AuthError {
  return new AuthError(
    'Administrator user provisioning lease is no longer active',
    'ADMIN_USER_PROVISIONING_LEASE_LOST',
    409,
  );
}

function authenticationStateChanged(): AuthError {
  return new AuthError(
    'Authentication state changed; retry the administrator action',
    'AUTH_STATE_CHANGED',
    409,
  );
}
