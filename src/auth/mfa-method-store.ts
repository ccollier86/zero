/**
 * mfa-method-store.ts
 *
 * Owns SQLite persistence for enrolled MFA methods. This store hides MFA SQL
 * details from Elysia routes and auth services; it does not verify OTP codes,
 * send email, or issue auth tokens.
 */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type {
  AuthMfaMethodRecord,
  AuthMfaMethodStatus,
  AuthMfaMethodType,
} from './types';

interface MfaMethodRow {
  method_id: string;
  user_id: string;
  type: AuthMfaMethodType;
  label: string | null;
  status: AuthMfaMethodStatus;
  is_primary: number;
  secret_ciphertext: string | null;
  created_at: number;
  verified_at: number | null;
  disabled_at: number | null;
  last_used_at: number | null;
  metadata: string | null;
}

/** Options for activating an enrolled MFA method. */
export interface ActivateMfaMethodOptions {
  /** Timestamp used for `verified_at` and primary state updates. */
  verifiedAt?: number;
  /** Whether this method should become the user's preferred challenge method. */
  makePrimary?: boolean;
  /** Disable other active methods for Zero's current single-method MFA mode. */
  singleActive?: boolean;
}

/** SQLite operations for MFA method enrollment state. */
export class MfaMethodStore {
  private stmts: {
    insertMethod: Statement;
    getMethod: Statement;
    listMethods: Statement;
    listPublicMethods: Statement;
    getActivePreferredMethod: Statement;
    clearPrimary: Statement;
    disableOtherActive: Statement;
    activateMethod: Statement;
    preferMethod: Statement;
    disableMethod: Statement;
    recordUse: Statement;
    deleteUserMethods: Statement;
  };

  constructor(private db: ReactiveDB) {
    this.stmts = {
      insertMethod: db.prepare(
        `INSERT INTO _auth_mfa_methods (
          method_id,
          user_id,
          type,
          label,
          status,
          is_primary,
          secret_ciphertext,
          created_at,
          verified_at,
          disabled_at,
          last_used_at,
          metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      getMethod: db.prepare('SELECT * FROM _auth_mfa_methods WHERE method_id = ?'),
      listMethods: db.prepare(
        `SELECT * FROM _auth_mfa_methods
         WHERE user_id = ?
         ORDER BY is_primary DESC, created_at DESC`
      ),
      listPublicMethods: db.prepare(
        `SELECT * FROM _auth_mfa_methods
         WHERE user_id = ? AND status != 'disabled'
         ORDER BY is_primary DESC, created_at DESC`
      ),
      getActivePreferredMethod: db.prepare(
        `SELECT * FROM _auth_mfa_methods
         WHERE user_id = ? AND status = 'active'
         ORDER BY is_primary DESC, last_used_at DESC, verified_at DESC, created_at DESC
         LIMIT 1`
      ),
      clearPrimary: db.prepare(
        'UPDATE _auth_mfa_methods SET is_primary = 0 WHERE user_id = ?'
      ),
      disableOtherActive: db.prepare(
        `UPDATE _auth_mfa_methods
         SET status = 'disabled', disabled_at = ?, is_primary = 0
         WHERE user_id = ? AND method_id != ? AND status = 'active'`
      ),
      activateMethod: db.prepare(
        `UPDATE _auth_mfa_methods
         SET status = 'active', verified_at = ?, disabled_at = NULL, is_primary = ?
         WHERE method_id = ? AND status = 'pending'`
      ),
      preferMethod: db.prepare(
        `UPDATE _auth_mfa_methods
         SET is_primary = 1
         WHERE method_id = ? AND user_id = ? AND status = 'active'`
      ),
      disableMethod: db.prepare(
        `UPDATE _auth_mfa_methods
         SET status = 'disabled', disabled_at = ?, is_primary = 0
         WHERE method_id = ? AND status != 'disabled'`
      ),
      recordUse: db.prepare(
        'UPDATE _auth_mfa_methods SET last_used_at = ? WHERE method_id = ?'
      ),
      deleteUserMethods: db.prepare('DELETE FROM _auth_mfa_methods WHERE user_id = ?'),
    };
  }

  /** Share this store's SQLite boundary with coordinated MFA mutations. */
  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation);
  }

  /**
   * Create a pending or active MFA method.
   *
   * TOTP methods may include encrypted secret material. Email methods should
   * leave `secretCiphertext` empty because the user's verified email is used.
   */
  createMethod(params: {
    userId: string;
    type: AuthMfaMethodType;
    label?: string | null;
    status?: AuthMfaMethodStatus;
    isPrimary?: boolean;
    secretCiphertext?: string | null;
    verifiedAt?: number | null;
    metadata?: Record<string, unknown>;
  }): AuthMfaMethodRecord {
    const methodId = `mfa_${crypto.randomUUID()}`;
    const now = Date.now();
    const status = params.status ?? 'pending';
    const isPrimary = params.isPrimary ?? false;

    this.stmts.insertMethod.run(
      methodId,
      params.userId,
      params.type,
      params.label ?? null,
      status,
      isPrimary ? 1 : 0,
      params.secretCiphertext ?? null,
      now,
      params.verifiedAt ?? null,
      status === 'disabled' ? now : null,
      null,
      JSON.stringify(params.metadata ?? {})
    );

    return this.getMethod(methodId)!;
  }

  /** Return one MFA method by id. */
  getMethod(methodId: string): AuthMfaMethodRecord | null {
    const row = this.stmts.getMethod.get(methodId) as MfaMethodRow | null;
    return row ? toMfaMethodRecord(row) : null;
  }

  /** List all MFA methods for a user, including disabled methods. */
  listMethods(userId: string): AuthMfaMethodRecord[] {
    return (this.stmts.listMethods.all(userId) as MfaMethodRow[])
      .map(toMfaMethodRecord);
  }

  /** List non-disabled MFA methods safe for current-user/admin UI summaries. */
  listPublicMethods(userId: string): AuthMfaMethodRecord[] {
    return (this.stmts.listPublicMethods.all(userId) as MfaMethodRow[])
      .map(toMfaMethodRecord);
  }

  /** Return the user's active preferred MFA method, if one exists. */
  getActivePreferredMethod(userId: string): AuthMfaMethodRecord | null {
    const row = this.stmts.getActivePreferredMethod.get(userId) as MfaMethodRow | null;
    return row ? toMfaMethodRecord(row) : null;
  }

  /** Activate a method after enrollment verification succeeds. */
  activateMethod(
    methodId: string,
    options: ActivateMfaMethodOptions = {}
  ): AuthMfaMethodRecord | null {
    const existing = this.getMethod(methodId);
    if (!existing || existing.status !== 'pending') return null;

    const verifiedAt = options.verifiedAt ?? Date.now();
    const makePrimary = options.makePrimary ?? true;
    let transitioned = false;

    this.db.transaction(() => {
      const result = this.stmts.activateMethod.run(verifiedAt, 0, methodId);
      if (result.changes === 0) return;

      if (options.singleActive) {
        this.stmts.disableOtherActive.run(verifiedAt, existing.userId, methodId);
      }
      if (makePrimary) {
        this.stmts.clearPrimary.run(existing.userId);
        this.stmts.preferMethod.run(methodId, existing.userId);
      }
      transitioned = true;
    });

    return transitioned ? this.getMethod(methodId) : null;
  }

  /** Make an active method the user's preferred MFA challenge method. */
  preferMethod(userId: string, methodId: string): AuthMfaMethodRecord | null {
    const existing = this.getMethod(methodId);
    if (!existing || existing.userId !== userId || existing.status !== 'active') {
      return null;
    }

    this.db.transaction(() => {
      this.stmts.clearPrimary.run(userId);
      this.stmts.preferMethod.run(methodId, userId);
    });

    return this.getMethod(methodId);
  }

  /** Disable one enrolled MFA method. */
  disableMethod(methodId: string, disabledAt = Date.now()): boolean {
    const result = this.stmts.disableMethod.run(disabledAt, methodId);
    return result.changes > 0;
  }

  /** Mark a method used after a successful MFA challenge. */
  recordUse(methodId: string, usedAt = Date.now()): void {
    this.stmts.recordUse.run(usedAt, methodId);
  }

  /** Delete all MFA methods for a user, intended for admin reset flows. */
  deleteUserMethods(userId: string): number {
    const result = this.stmts.deleteUserMethods.run(userId);
    return result.changes;
  }
}

function toMfaMethodRecord(row: MfaMethodRow): AuthMfaMethodRecord {
  return {
    methodId: row.method_id,
    userId: row.user_id,
    type: row.type,
    label: row.label,
    status: row.status,
    isPrimary: Boolean(row.is_primary),
    secretCiphertext: row.secret_ciphertext,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
    disabledAt: row.disabled_at,
    lastUsedAt: row.last_used_at,
    metadata: parseMetadata(row.metadata),
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
