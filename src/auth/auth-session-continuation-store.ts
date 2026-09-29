import type { Statement } from 'bun:sqlite';
import { normalizeMfaVerifiedAt } from './mfa-assurance';
import type { ReactiveDB } from '../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../tokens/token-utils';
import { defineAuthSessionContinuationTables } from './auth-session-continuation-schema';
import {
  createAuthStateInvariantError,
  type AuthPlatformCodeEmitter,
} from './auth-observability';

export type AuthSessionContinuationPurpose =
  | 'tenant_selection'
  | 'tenant_onboarding';

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

  constructor(
    private readonly db: ReactiveDB,
    options: AuthSessionContinuationStoreOptions = {},
  ) {
    defineAuthSessionContinuationTables(db);
    this.now = options.now ?? Date.now;
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
    this.insert.run(
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
    const row = this.getByHash.get(
      this.applicationId,
      purpose,
      hashToken(raw),
    ) as ContinuationRow | null;
    if (!row || row.consumed_at !== null || row.expires_at <= this.now()) return null;
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
    return this.consume.run(
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
    return this.cleanup.run(now, now).changes;
  }
}

function resolveApplicationId(
  db: ReactiveDB,
  emitCode?: AuthPlatformCodeEmitter,
): string {
  const key = 'auth.application.id';
  db.prepare(`
    INSERT INTO _auth_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run(key, `app_${crypto.randomUUID()}`);
  const row = db.prepare('SELECT value FROM _auth_config WHERE key = ?')
    .get(key) as { value: string } | null;
  if (!row?.value) {
    throw createAuthStateInvariantError(emitCode, {
      component: 'auth-session-continuation-store',
      invariant: 'application-id-resolution-missing',
      message: '[auth] Failed to resolve the auth application id.',
    });
  }
  return row.value;
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
