import type { Statement } from 'bun:sqlite';
import { normalizeMfaVerifiedAt } from './mfa-assurance';
import type { ReactiveDB } from '../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../tokens/token-utils';
import { defineAuthSessionContinuationTables } from './auth-session-continuation-schema';
import { resolveApplicationId } from './auth-application-id';
import {
  createAuthStateInvariantError,
  type AuthPlatformCodeEmitter,
} from './auth-observability';

export type AuthSessionContinuationPurpose =
  | 'tenant_selection'
  | 'tenant_onboarding'
  | 'profile_completion';

export interface AuthSessionContinuationRecord {
  continuationId: string;
  applicationId: string;
  userId: string;
  purpose: AuthSessionContinuationPurpose;
  authGeneration: number;
  mfaVerifiedAt: number | null;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
}

export interface CreatedAuthSessionContinuation {
  /** Returned once to the browser. Only its SHA-256 hash is persisted. */
  continuation: string;
  record: AuthSessionContinuationRecord;
}

interface ContinuationRow {
  continuation_id: string;
  application_id: string;
  user_id: string;
  purpose: string;
  token_hash: string;
  auth_generation: number;
  mfa_verified_at: number | null;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

export interface AuthSessionContinuationStoreOptions {
  now?: () => number;
  applicationId?: string;
  /** App-local invariant reporting for managed auth composition. */
  emitCode?: AuthPlatformCodeEmitter;
}

/** Private hash-at-rest persistence for pre-session auth continuations. */
export class AuthSessionContinuationStore {
  readonly applicationId: string;
  private readonly now: () => number;
  private readonly insert: Statement;
  private readonly getByHash: Statement;
  private readonly consume: Statement;
  private readonly cleanup: Statement;
  private readonly profileStatements: { insert: Statement; get: Statement; consume: Statement; cleanup: Statement } | null;
  private readonly emitCode?: AuthPlatformCodeEmitter;

  constructor(
    private readonly db: ReactiveDB,
    options: AuthSessionContinuationStoreOptions = {},
  ) {
    defineAuthSessionContinuationTables(db);
    this.now = options.now ?? Date.now;
    this.emitCode = options.emitCode;
    this.applicationId = options.applicationId
      ?? resolveApplicationId(db, options.emitCode);
    this.insert = db.prepare(`
      INSERT INTO _auth_session_continuations (
        continuation_id, application_id, user_id, purpose, token_hash,
        auth_generation, mfa_verified_at, expires_at, consumed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `);
    this.getByHash = db.prepare(`
      SELECT * FROM _auth_session_continuations
      WHERE application_id = ? AND purpose = ? AND token_hash = ?
    `);
    this.consume = db.prepare(`
      UPDATE _auth_session_continuations
      SET consumed_at = ?
      WHERE continuation_id = ?
        AND application_id = ?
        AND user_id = ?
        AND purpose = ?
        AND auth_generation = ?
        AND consumed_at IS NULL
        AND expires_at > ?
    `);
    this.cleanup = db.prepare(`
      DELETE FROM _auth_session_continuations
      WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)
    `);
    // The same hash-at-rest continuation owner supports an isolated purpose
    // table without rewriting the tenant table referenced by domain proofs.
    const profileExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_auth_profile_completion_continuations'").get();
    this.profileStatements = profileExists ? {
      insert: db.prepare(`INSERT INTO _auth_profile_completion_continuations
        (continuation_id,application_id,user_id,purpose,token_hash,auth_generation,mfa_verified_at,expires_at,consumed_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,NULL,?)`),
      get: db.prepare(`SELECT * FROM _auth_profile_completion_continuations WHERE application_id = ? AND purpose = ? AND token_hash = ?`),
      consume: db.prepare(`UPDATE _auth_profile_completion_continuations SET consumed_at = ? WHERE continuation_id = ?
        AND application_id = ? AND user_id = ? AND purpose = ? AND auth_generation = ? AND consumed_at IS NULL AND expires_at > ?`),
      cleanup: db.prepare(`DELETE FROM _auth_profile_completion_continuations WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)`),
    } : null;
  }

  create(input: {
    userId: string;
    purpose: AuthSessionContinuationPurpose;
    authGeneration: number;
    mfaVerifiedAt?: number | null;
    ttlMs: number;
  }): CreatedAuthSessionContinuation {
    const now = this.now();
    const continuation = `zct_${createOpaqueToken()}`;
    const record: AuthSessionContinuationRecord = {
      continuationId: `actc_${crypto.randomUUID()}`,
      applicationId: this.applicationId,
      userId: input.userId,
      purpose: input.purpose,
      authGeneration: input.authGeneration,
      mfaVerifiedAt: normalizeMfaVerifiedAt(input.mfaVerifiedAt, now),
      expiresAt: now + input.ttlMs,
      consumedAt: null,
      createdAt: now,
    };
    const insert = input.purpose === 'profile_completion' ? this.requireProfileStatements().insert : this.insert;
    insert.run(
      record.continuationId,
      record.applicationId,
      record.userId,
      record.purpose,
      hashToken(continuation),
      record.authGeneration,
      record.mfaVerifiedAt,
      record.expiresAt,
      record.createdAt,
    );
    return { continuation, record };
  }

  inspect(
    raw: string,
    purpose: AuthSessionContinuationPurpose,
  ): AuthSessionContinuationRecord | null {
    if (!raw) return null;
    const statement = purpose === 'profile_completion' ? this.requireProfileStatements().get : this.getByHash;
    const row = statement.get(
      this.applicationId,
      purpose,
      hashToken(raw),
    ) as ContinuationRow | null;
    if (!row || row.consumed_at !== null || row.expires_at <= this.now()) return null;
    if (purpose === 'profile_completion' && (!Number.isSafeInteger(row.auth_generation) || row.auth_generation < 0
      || !Number.isSafeInteger(row.created_at) || row.created_at < 0
      || !Number.isSafeInteger(row.expires_at) || row.expires_at <= row.created_at
      || row.expires_at - row.created_at > 1_800_000
      || (row.mfa_verified_at !== null && (!Number.isSafeInteger(row.mfa_verified_at)
        || row.mfa_verified_at < 0 || row.mfa_verified_at > row.created_at)))) {
      throw createAuthStateInvariantError(this.emitCode, { component: 'auth-session-continuation-store',
        invariant: 'profile-continuation-row-invalid', message: '[auth] Profile completion continuation state is invalid.' });
    }
    return mapContinuation(row);
  }

  /**
   * Atomically consume the exact inspected proof. Call this inside the same
   * transaction that persists the resulting parent and refresh credential.
   */
  consumeInspected(
    record: AuthSessionContinuationRecord,
    purpose: AuthSessionContinuationPurpose,
    expectedUserId: string,
    expectedAuthGeneration: number,
  ): boolean {
    const now = this.now();
    const statement = purpose === 'profile_completion' ? this.requireProfileStatements().consume : this.consume;
    return statement.run(
      now,
      record.continuationId,
      this.applicationId,
      expectedUserId,
      purpose,
      expectedAuthGeneration,
      now,
    ).changes === 1;
  }

  deleteExpired(now = this.now()): number {
    return this.cleanup.run(now, now).changes + (this.profileStatements?.cleanup.run(now, now).changes ?? 0);
  }
  private requireProfileStatements() {
    if (!this.profileStatements) throw new Error('[auth] Profile completion continuation storage is unavailable.');
    return this.profileStatements;
  }
}

function mapContinuation(row: ContinuationRow): AuthSessionContinuationRecord {
  return {
    continuationId: row.continuation_id,
    applicationId: row.application_id,
    userId: row.user_id,
    purpose: row.purpose as AuthSessionContinuationPurpose,
    authGeneration: row.auth_generation,
    mfaVerifiedAt: row.mfa_verified_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}
