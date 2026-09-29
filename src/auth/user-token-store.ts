/** Refresh/action-token persistence and replay lifecycle behind UserStore's stable API. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import { authTokenEligibleUserSql } from './auth-user-eligibility';
import type { AuthGenerationStore } from './auth-generation-store';
import type {
  AuthActionTokenRecord,
  AuthActionTokenType,
  RefreshTokenRecord,
  UserRecord,
} from './types';

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

interface CountRow { count: number }

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

export type RefreshTokenRotationResult = 'rotated' | 'replayed' | 'invalid';

interface UserTokenStoreHooks {
  mutation<T>(operation: () => T): T;
  assertCurrentProfile(): void;
  getUserById(userId: string): UserRecord | null;
  getSessionRevoker(): AuthSessionRevoker | null;
  emitCode?: AuthPlatformCodeEmitter;
}

const REFRESH_SESSION_REPLACEMENT_ROLLBACK = new Error(
  'refresh-session-replacement-rollback',
);

/**
 * Cohesive server-only bearer persistence. Identity CRUD remains in UserStore;
 * this collaborator owns refresh replay, action-token lifecycle, and cleanup.
 */
export class UserTokenStore {
  private readonly stmts: {
    insertRefreshToken: Statement;
    insertRefreshTokenIfCurrent: Statement;
    getRefreshTokenById: Statement;
    getRefreshTokenByHash: Statement;
    consumeRefreshToken: Statement;
    revokeRefreshToken: Statement;
    revokeAllUserTokens: Statement;
    deleteExpiredTokens: Statement;
    insertActionToken: Statement;
    getActionTokenByHash: Statement;
    consumeActionToken: Statement;
    deleteActionToken: Statement;
    countRecentActionTokens: Statement;
    deleteExpiredActionTokens: Statement;
  };

  constructor(
    db: ReactiveDB,
    private readonly authGenerations: AuthGenerationStore,
    private readonly hooks: UserTokenStoreHooks,
  ) {
    this.stmts = {
      insertRefreshToken: db.prepare(`
        INSERT INTO _refresh_tokens
          (token_id, user_id, session_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      insertRefreshTokenIfCurrent: db.prepare(`
        INSERT INTO _refresh_tokens
          (token_id, user_id, session_id, token_hash, expires_at, created_at)
        SELECT ?, users.user_id, ?, ?, ?, ? FROM users
        WHERE users.user_id = ?
          AND users.email = ?
          AND users.role = ?
          AND ${authTokenEligibleUserSql('users')}
          AND COALESCE((SELECT generation FROM _auth_user_generations
            WHERE user_id = users.user_id), 0) = ?
      `),
      getRefreshTokenById: db.prepare(
        'SELECT * FROM _refresh_tokens WHERE token_id = ?',
      ),
      getRefreshTokenByHash: db.prepare(
        'SELECT * FROM _refresh_tokens WHERE token_hash = ?',
      ),
      consumeRefreshToken: db.prepare(`
        UPDATE _refresh_tokens SET revoked_at = ?
        WHERE token_id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
          AND COALESCE((SELECT generation FROM _auth_user_generations
            WHERE user_id = _refresh_tokens.user_id), 0) = ?
          AND EXISTS (SELECT 1 FROM users
            WHERE users.user_id = _refresh_tokens.user_id
              AND ${authTokenEligibleUserSql('users')})
      `),
      revokeRefreshToken: db.prepare(
        'UPDATE _refresh_tokens SET revoked_at = ? WHERE token_id = ?',
      ),
      revokeAllUserTokens: db.prepare(
        'UPDATE _refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      ),
      deleteExpiredTokens: db.prepare(
        `DELETE FROM _refresh_tokens
         WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
      ),
      insertActionToken: db.prepare(`
        INSERT INTO _auth_action_tokens (
          token_id, user_id, type, token_hash, expires_at,
          created_at, created_by, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getActionTokenByHash: db.prepare(
        'SELECT * FROM _auth_action_tokens WHERE token_hash = ?',
      ),
      consumeActionToken: db.prepare(
        `UPDATE _auth_action_tokens SET consumed_at = ?
         WHERE token_id = ? AND consumed_at IS NULL`,
      ),
      deleteActionToken: db.prepare(
        'DELETE FROM _auth_action_tokens WHERE token_id = ?',
      ),
      countRecentActionTokens: db.prepare(`
        SELECT COUNT(*) as count FROM _auth_action_tokens
        WHERE user_id = ? AND type = ? AND consumed_at IS NULL
          AND expires_at > ? AND created_at >= ?
      `),
      deleteExpiredActionTokens: db.prepare(`
        DELETE FROM _auth_action_tokens
        WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)
      `),
    };
  }

  rotateRefreshTokenAtomically(
    current: RefreshTokenRecord,
    replacement: RefreshTokenReplacement,
    expectedAuthGeneration: number,
    now = Date.now(),
  ): RefreshTokenRotationResult {
    return this.hooks.mutation(() => {
      const consumed = this.stmts.consumeRefreshToken.run(
        now, current.tokenId, current.userId, now, expectedAuthGeneration,
      );
      if (consumed.changes === 1) {
        this.insertRefresh(current.userId, current.sessionId, replacement);
        return 'rotated';
      }
      return this.resolveFailedRotation(current, now);
    });
  }

  replaceRefreshSessionAtomically(
    current: RefreshTokenRecord,
    replacement: RefreshTokenReplacement,
    replacementSessionId: string,
    expectedAuthGeneration: number,
    replaceParent: () => boolean,
    now = Date.now(),
  ): RefreshTokenRotationResult {
    try {
      return this.hooks.mutation(() => {
        const consumed = this.stmts.consumeRefreshToken.run(
          now, current.tokenId, current.userId, now, expectedAuthGeneration,
        );
        if (consumed.changes === 1) {
          if (!invokeSynchronousAuthCallback(replaceParent, {
            component: 'user-token-store',
            invariant: 'refresh-parent-replacement-async',
            message: '[auth] Refresh parent replacement must be synchronous.',
            emitCode: this.hooks.emitCode,
          })) throw REFRESH_SESSION_REPLACEMENT_ROLLBACK;
          this.insertRefresh(current.userId, replacementSessionId, replacement);
          return 'rotated';
        }
        return this.resolveFailedRotation(current, now);
      });
    } catch (error) {
      if (error === REFRESH_SESSION_REPLACEMENT_ROLLBACK) return 'invalid';
      throw error;
    }
  }

  invalidateRefreshTokenReplay(userId: string, now = Date.now()): void {
    this.hooks.mutation(() => this.invalidateRefreshReplay(userId, now));
  }

  storeRefreshToken(
    tokenId: string,
    userId: string,
    tokenHash: string,
    expiresAt: number,
  ): void {
    this.hooks.mutation(() => this.stmts.insertRefreshToken.run(
      tokenId, userId, null, tokenHash, expiresAt, Date.now(),
    ));
  }

  storeRefreshTokenIfCurrent(
    tokenId: string,
    user: Pick<UserRecord, 'userId' | 'email' | 'role'>,
    tokenHash: string,
    expiresAt: number,
    createdAt: number,
    expectedAuthGeneration: number,
    sessionId: string | null = null,
  ): boolean {
    return this.hooks.mutation(() => this.stmts.insertRefreshTokenIfCurrent.run(
      tokenId,
      sessionId,
      tokenHash,
      expiresAt,
      createdAt,
      user.userId,
      user.email,
      user.role,
      expectedAuthGeneration,
    ).changes === 1);
  }

  getRefreshTokenById(tokenId: string): RefreshTokenRecord | null {
    this.hooks.assertCurrentProfile();
    const row = this.stmts.getRefreshTokenById.get(tokenId) as RefreshTokenRow | null;
    return row ? toRefreshTokenRecord(row) : null;
  }

  getRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null {
    this.hooks.assertCurrentProfile();
    const row = this.stmts.getRefreshTokenByHash.get(tokenHash) as RefreshTokenRow | null;
    return row ? toRefreshTokenRecord(row) : null;
  }

  revokeRefreshToken(tokenId: string): void {
    this.hooks.mutation(() => {
      const now = Date.now();
      const record = this.getRefreshTokenById(tokenId);
      this.stmts.revokeRefreshToken.run(now, tokenId);
      const revoker = this.hooks.getSessionRevoker();
      if (record?.sessionId && revoker) {
        this.invokeSessionRevoker(
          () => revoker.revoke(record.sessionId!, 'refresh-revoked', now),
          'single-session-revoker-async',
          '[auth] Session revocation callback must be synchronous.',
        );
      }
    });
  }

  revokeAllUserTokens(userId: string): void {
    this.hooks.mutation(() => {
      this.stmts.revokeAllUserTokens.run(Date.now(), userId);
      this.authGenerations.bump(userId);
      const revoker = this.hooks.getSessionRevoker();
      if (revoker) {
        this.invokeSessionRevoker(
          () => revoker.revokeAllForUser(userId, 'security-state-changed'),
          'user-session-revoker-async',
          '[auth] User session revocation callback must be synchronous.',
        );
      }
    });
  }

  getAuthGeneration(userId: string): number {
    this.hooks.assertCurrentProfile();
    return this.authGenerations.get(userId);
  }

  deleteExpiredTokens(): number {
    return this.hooks.mutation(() => {
      const now = Date.now();
      const result = this.stmts.deleteExpiredTokens.run(now, now);
      const revoker = this.hooks.getSessionRevoker();
      if (revoker?.deleteExpiredSessions) {
        this.invokeSessionRevoker(
          () => revoker.deleteExpiredSessions!(now),
          'session-cleanup-callback-async',
          '[auth] Session cleanup callback must be synchronous.',
        );
      }
      return result.changes;
    });
  }

  private invokeSessionRevoker<T>(
    callback: () => T,
    invariant: string,
    message: string,
  ): T {
    return invokeSynchronousAuthCallback(callback, {
      component: 'user-token-store',
      invariant,
      message,
      emitCode: this.hooks.emitCode,
    });
  }

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
    return this.hooks.mutation(() => {
      this.stmts.insertActionToken.run(
        params.tokenId,
        params.userId,
        params.type,
        params.tokenHash,
        params.expiresAt,
        params.createdAt,
        params.createdBy ?? null,
        JSON.stringify(params.metadata ?? {}),
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

  getActionTokenByHash(tokenHash: string): AuthActionTokenRecord | null {
    this.hooks.assertCurrentProfile();
    const row = this.stmts.getActionTokenByHash.get(tokenHash) as AuthActionTokenRow | null;
    return row ? toActionTokenRecord(row) : null;
  }

  consumeActionToken(tokenId: string): boolean {
    return this.hooks.mutation(() => (
      this.stmts.consumeActionToken.run(Date.now(), tokenId).changes > 0
    ));
  }

  deleteActionToken(tokenId: string): boolean {
    return this.hooks.mutation(() => this.stmts.deleteActionToken.run(tokenId).changes > 0);
  }

  countRecentActionTokens(params: {
    userId: string;
    type: AuthActionTokenType;
    createdAfter: number;
    now?: number;
  }): number {
    this.hooks.assertCurrentProfile();
    const row = this.stmts.countRecentActionTokens.get(
      params.userId,
      params.type,
      params.now ?? Date.now(),
      params.createdAfter,
    ) as CountRow;
    return row.count;
  }

  deleteExpiredActionTokens(): number {
    return this.hooks.mutation(() => {
      const now = Date.now();
      return this.stmts.deleteExpiredActionTokens.run(now, now).changes;
    });
  }

  private resolveFailedRotation(
    current: RefreshTokenRecord,
    now: number,
  ): RefreshTokenRotationResult {
    const latest = this.getRefreshTokenById(current.tokenId);
    if (latest?.userId === current.userId && latest.revokedAt !== null) {
      this.invalidateRefreshReplay(current.userId, now);
      return 'replayed';
    }
    if (latest?.userId === current.userId) {
      this.stmts.revokeRefreshToken.run(now, current.tokenId);
    }
    return 'invalid';
  }

  private invalidateRefreshReplay(userId: string, now: number): void {
    const user = this.hooks.getUserById(userId);
    if (!user || user.passwordChangeRequired) return;
    this.stmts.revokeAllUserTokens.run(now, userId);
    this.authGenerations.bump(userId);
    this.hooks.getSessionRevoker()?.revokeAllForUser(userId, 'refresh-replay', now);
  }

  private insertRefresh(
    userId: string,
    sessionId: string | null,
    replacement: RefreshTokenReplacement,
  ): void {
    this.stmts.insertRefreshToken.run(
      replacement.tokenId,
      userId,
      sessionId,
      replacement.tokenHash,
      replacement.expiresAt,
      replacement.createdAt,
    );
  }
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

function toActionTokenRecord(row: AuthActionTokenRow): AuthActionTokenRecord {
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
