/**
 * mfa-challenge-store.ts
 *
 * Owns SQLite persistence for MFA OTP challenges. This store does not generate
 * codes, send email, verify TOTP secrets, or issue auth tokens.
 */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type {
  AuthMfaChallengeRecord,
  AuthMfaMethodType,
} from './types';

interface MfaChallengeRow {
  challenge_id: string;
  user_id: string;
  method_id: string | null;
  method_type: AuthMfaMethodType;
  code_hash: string | null;
  expires_at: number;
  attempts: number;
  max_attempts: number;
  consumed_at: number | null;
  created_at: number;
  metadata: string | null;
}

/** SQLite operations for MFA challenge state. */
export class MfaChallengeStore {
  private stmts: {
    insertChallenge: Statement;
    getChallenge: Statement;
    consumeChallenge: Statement;
    incrementAttempts: Statement;
    invalidateUserChallenges: Statement;
    countRecentActive: Statement;
    deleteExpiredChallenges: Statement;
  };

  constructor(private readonly db: ReactiveDB) {
    this.stmts = {
      insertChallenge: db.prepare(
        `INSERT INTO _auth_mfa_challenges (
          challenge_id,
          user_id,
          method_id,
          method_type,
          code_hash,
          expires_at,
          attempts,
          max_attempts,
          consumed_at,
          created_at,
          metadata
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`
      ),
      getChallenge: db.prepare(
        'SELECT * FROM _auth_mfa_challenges WHERE challenge_id = ?'
      ),
      consumeChallenge: db.prepare(
        `UPDATE _auth_mfa_challenges
         SET consumed_at = ?
         WHERE challenge_id = ? AND consumed_at IS NULL`
      ),
      incrementAttempts: db.prepare(
        'UPDATE _auth_mfa_challenges SET attempts = attempts + 1 WHERE challenge_id = ?'
      ),
      invalidateUserChallenges: db.prepare(
        `UPDATE _auth_mfa_challenges
         SET consumed_at = ?
         WHERE user_id = ? AND consumed_at IS NULL`
      ),
      countRecentActive: db.prepare(
        `SELECT COUNT(*) as count
         FROM _auth_mfa_challenges
         WHERE user_id = ?
           AND method_type = ?
           AND consumed_at IS NULL
           AND expires_at > ?
           AND created_at >= ?`
      ),
      deleteExpiredChallenges: db.prepare(
        `DELETE FROM _auth_mfa_challenges
         WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)`
      ),
    };
  }

  /** Create a new MFA challenge row. */
  createChallenge(params: {
    userId: string;
    methodId?: string | null;
    methodType: AuthMfaMethodType;
    codeHash?: string | null;
    expiresAt: number;
    maxAttempts: number;
    metadata?: Record<string, unknown>;
  }): AuthMfaChallengeRecord {
    const challengeId = `mfach_${crypto.randomUUID()}`;
    const now = Date.now();

    this.stmts.insertChallenge.run(
      challengeId,
      params.userId,
      params.methodId ?? null,
      params.methodType,
      params.codeHash ?? null,
      params.expiresAt,
      params.maxAttempts,
      now,
      JSON.stringify(params.metadata ?? {})
    );

    return this.getChallenge(challengeId)!;
  }

  /** Return a challenge by id. */
  getChallenge(challengeId: string): AuthMfaChallengeRecord | null {
    const row = this.stmts.getChallenge.get(challengeId) as MfaChallengeRow | null;
    return row ? toMfaChallengeRecord(row) : null;
  }

  /** Mark a challenge consumed after successful verification. */
  consumeChallenge(challengeId: string, consumedAt = Date.now()): boolean {
    const result = this.stmts.consumeChallenge.run(consumedAt, challengeId);
    return result.changes > 0;
  }

  /** Increment failed attempts for a challenge. */
  incrementAttempts(challengeId: string): void {
    this.stmts.incrementAttempts.run(challengeId);
  }

  /** Invalidate every unfinished MFA challenge for one user. */
  invalidateUserChallenges(userId: string, invalidatedAt = Date.now()): number {
    const result = this.stmts.invalidateUserChallenges.run(invalidatedAt, userId);
    return result.changes;
  }

  /** Count active recent challenges for cooldown enforcement. */
  countRecentActive(params: {
    userId: string;
    methodType: AuthMfaMethodType;
    now: number;
    since: number;
  }): number {
    const row = this.stmts.countRecentActive.get(
      params.userId,
      params.methodType,
      params.now,
      params.since
    ) as { count: number };
    return row.count;
  }

  /** Delete expired/consumed challenge rows. */
  cleanupExpired(retainConsumedMs = 86_400_000, now = Date.now()): number {
    const result = this.stmts.deleteExpiredChallenges.run(now, now - retainConsumedMs);
    return result.changes;
  }
}

function toMfaChallengeRecord(row: MfaChallengeRow): AuthMfaChallengeRecord {
  return {
    challengeId: row.challenge_id,
    userId: row.user_id,
    methodId: row.method_id,
    methodType: row.method_type,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
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
