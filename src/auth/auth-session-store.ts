import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import { defineAuthSessionTables } from './auth-session-schema';
import type { AuthSessionRecord } from './auth-session-types';

interface AuthSessionRow {
  session_id: string;
  user_id: string;
  kind: string;
  status: string;
  generation: number;
  scope_kind: string;
  scope_id: string;
  tenant_id: string | null;
  membership_id: string | null;
  tenant_authorization_generation: number | null;
  membership_authorization_generation: number | null;
  provenance: string;
  authenticated_at: number;
  mfa_verified_at: number | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
  revocation_reason: string | null;
}

/** Private SQLite persistence owner for durable parent sessions. */
export class AuthSessionStore {
  private readonly insertSession: Statement;
  private readonly getSession: Statement;
  private readonly revokeSession: Statement;
  private readonly revokeUserSessions: Statement;
  private readonly touchSession: Statement;
  private readonly adoptLegacyRefresh: Statement;
  private readonly deleteExpiredSessions: Statement;

  constructor(private readonly db: ReactiveDB) {
    defineAuthSessionTables(db);
    this.insertSession = db.prepare(`
      INSERT INTO _auth_sessions (
        session_id, user_id, kind, status, generation, scope_kind, scope_id,
        tenant_id, membership_id, tenant_authorization_generation,
        membership_authorization_generation, provenance, authenticated_at,
        mfa_verified_at, created_at, last_seen_at, expires_at, revoked_at,
        revocation_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getSession = db.prepare(
      'SELECT * FROM _auth_sessions WHERE session_id = ?',
    );
    this.revokeSession = db.prepare(`
      UPDATE _auth_sessions
      SET status = 'revoked', generation = generation + 1,
          revoked_at = ?, revocation_reason = ?
      WHERE session_id = ? AND status = 'active'
      RETURNING session_id
    `);
    this.revokeUserSessions = db.prepare(`
      UPDATE _auth_sessions
      SET status = 'revoked', generation = generation + 1,
          revoked_at = ?, revocation_reason = ?
      WHERE user_id = ? AND status = 'active'
      RETURNING session_id
    `);
    this.touchSession = db.prepare(`
      UPDATE _auth_sessions
      SET last_seen_at = ?, expires_at = ?
      WHERE session_id = ? AND user_id = ? AND status = 'active'
        AND generation = ?
      RETURNING session_id
    `);
    this.adoptLegacyRefresh = db.prepare(`
      UPDATE _refresh_tokens
      SET session_id = ?
      WHERE token_id = ? AND user_id = ? AND session_id IS NULL
        AND revoked_at IS NULL AND expires_at > ?
      RETURNING token_id
    `);
    this.deleteExpiredSessions = db.prepare(`
      DELETE FROM _auth_sessions
      WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)
      RETURNING session_id
    `);
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation);
  }

  insert(record: AuthSessionRecord): void {
    this.insertSession.run(
      record.sessionId,
      record.userId,
      record.kind,
      record.status,
      record.generation,
      record.scopeKind,
      record.scopeId,
      record.tenantId,
      record.membershipId,
      record.tenantAuthorizationGeneration,
      record.membershipAuthorizationGeneration,
      record.provenance,
      record.authenticatedAt,
      record.mfaVerifiedAt,
      record.createdAt,
      record.lastSeenAt,
      record.expiresAt,
      record.revokedAt,
      record.revocationReason,
    );
  }

  getById(sessionId: string): AuthSessionRecord | null {
    const row = this.getSession.get(sessionId) as AuthSessionRow | null;
    return row ? mapSession(row) : null;
  }

  revoke(sessionId: string, reason: string, now = Date.now()): boolean {
    const row = this.revokeSession.get(now, reason, sessionId) as {
      session_id: string;
    } | null;
    return row?.session_id === sessionId;
  }

  revokeAllForUser(userId: string, reason: string, now = Date.now()): number {
    return this.revokeUserSessions.all(now, reason, userId).length;
  }

  touch(
    sessionId: string,
    userId: string,
    generation: number,
    expiresAt: number,
    now = Date.now(),
  ): boolean {
    const row = this.touchSession.get(
      now,
      expiresAt,
      sessionId,
      userId,
      generation,
    ) as { session_id: string } | null;
    return row?.session_id === sessionId;
  }

  linkLegacyRefresh(
    sessionId: string,
    tokenId: string,
    userId: string,
    now = Date.now(),
  ): boolean {
    const row = this.adoptLegacyRefresh.get(
      sessionId,
      tokenId,
      userId,
      now,
    ) as { token_id: string } | null;
    return row?.token_id === tokenId;
  }

  deleteExpired(now = Date.now()): number {
    return this.deleteExpiredSessions.all(now, now).length;
  }
}

function mapSession(row: AuthSessionRow): AuthSessionRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    kind: row.kind as AuthSessionRecord['kind'],
    status: row.status as AuthSessionRecord['status'],
    generation: row.generation,
    scopeKind: row.scope_kind as AuthSessionRecord['scopeKind'],
    scopeId: row.scope_id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    tenantAuthorizationGeneration: row.tenant_authorization_generation,
    membershipAuthorizationGeneration: row.membership_authorization_generation,
    provenance: row.provenance as AuthSessionRecord['provenance'],
    authenticatedAt: row.authenticated_at,
    mfaVerifiedAt: row.mfa_verified_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason,
  };
}
