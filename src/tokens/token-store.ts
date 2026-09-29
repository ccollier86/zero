/**
 * token-store.ts
 *
 * Owns SQLite persistence for Zero platform action and resume tokens. This
 * file stores only hashed tokens and typed metadata; it does not generate raw
 * tokens, send email, or register HTTP routes.
 */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import type {
  PlatformActionTokenRecord,
  PlatformResumeResource,
  PlatformResumeTokenRecord,
  PlatformTokenSubject,
} from './token-types';
import { parseTokenMetadata } from './token-utils';

interface PlatformActionTokenRow {
  token_id: string;
  purpose: string;
  token_hash: string;
  subject_type: string | null;
  subject_id: string | null;
  scope: string | null;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
  created_by: string | null;
  metadata: string | null;
}

interface PlatformResumeTokenRow {
  token_id: string;
  flow: string;
  token_hash: string;
  resource_type: string;
  resource_id: string;
  subject_type: string | null;
  subject_id: string | null;
  expires_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
  created_at: number;
  created_by: string | null;
  rotated_from: string | null;
  metadata: string | null;
}

interface CountRow {
  count: number;
}

export interface StoredPlatformActionTokenRecord extends PlatformActionTokenRecord {
  tokenHash: string;
}

export interface StoredPlatformResumeTokenRecord extends PlatformResumeTokenRecord {
  tokenHash: string;
}

/** Create or upgrade the platform token tables. */
export function definePlatformTokenTables(db: ReactiveDB): void {
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _zero_action_tokens (
      token_id     TEXT PRIMARY KEY,
      purpose      TEXT NOT NULL,
      token_hash   TEXT NOT NULL UNIQUE,
      subject_type TEXT,
      subject_id   TEXT,
      scope        TEXT,
      expires_at   INTEGER NOT NULL,
      consumed_at  INTEGER,
      created_at   INTEGER NOT NULL,
      created_by   TEXT,
      metadata     TEXT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_zero_action_tokens_hash ON _zero_action_tokens(token_hash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_zero_action_tokens_lookup ON _zero_action_tokens(purpose, subject_type, subject_id, scope, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_zero_action_tokens_expiry ON _zero_action_tokens(expires_at)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _zero_resume_tokens (
      token_id      TEXT PRIMARY KEY,
      flow          TEXT NOT NULL,
      token_hash    TEXT NOT NULL UNIQUE,
      resource_type TEXT NOT NULL,
      resource_id   TEXT NOT NULL,
      subject_type  TEXT,
      subject_id    TEXT,
      expires_at    INTEGER NOT NULL,
      revoked_at    INTEGER,
      last_used_at  INTEGER,
      created_at    INTEGER NOT NULL,
      created_by    TEXT,
      rotated_from  TEXT,
      metadata      TEXT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_zero_resume_tokens_hash ON _zero_resume_tokens(token_hash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_zero_resume_tokens_resource ON _zero_resume_tokens(flow, resource_type, resource_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_zero_resume_tokens_subject ON _zero_resume_tokens(subject_type, subject_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_zero_resume_tokens_expiry ON _zero_resume_tokens(expires_at)');
}

/** SQLite persistence boundary for platform tokens. */
export class PlatformTokenStore {
  private readonly stmts: {
    insertActionToken: Statement;
    getActionTokenByHash: Statement;
    consumeActionToken: Statement;
    revokeActionToken: Statement;
    deleteActionToken: Statement;
    countRecentActionTokens: Statement;
    deleteExpiredActionTokens: Statement;
    insertResumeToken: Statement;
    getResumeTokenByHash: Statement;
    touchResumeToken: Statement;
    revokeResumeToken: Statement;
    deleteExpiredResumeTokens: Statement;
  };

  constructor(private readonly db: ReactiveDB) {
    definePlatformTokenTables(db);

    this.stmts = {
      insertActionToken: db.prepare(
        `INSERT INTO _zero_action_tokens (
          token_id, purpose, token_hash, subject_type, subject_id, scope,
          expires_at, created_at, created_by, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      getActionTokenByHash: db.prepare(
        'SELECT * FROM _zero_action_tokens WHERE token_hash = ?'
      ),
      consumeActionToken: db.prepare(
        'UPDATE _zero_action_tokens SET consumed_at = ? WHERE token_id = ? AND consumed_at IS NULL'
      ),
      revokeActionToken: db.prepare(
        'UPDATE _zero_action_tokens SET consumed_at = ? WHERE token_id = ? AND consumed_at IS NULL'
      ),
      deleteActionToken: db.prepare(
        'DELETE FROM _zero_action_tokens WHERE token_id = ?'
      ),
      countRecentActionTokens: db.prepare(
        `SELECT COUNT(*) as count
         FROM _zero_action_tokens
         WHERE purpose = ?
           AND subject_type IS ?
           AND subject_id IS ?
           AND scope IS ?
           AND consumed_at IS NULL
           AND expires_at > ?
           AND created_at >= ?`
      ),
      deleteExpiredActionTokens: db.prepare(
        'DELETE FROM _zero_action_tokens WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)'
      ),
      insertResumeToken: db.prepare(
        `INSERT INTO _zero_resume_tokens (
          token_id, flow, token_hash, resource_type, resource_id,
          subject_type, subject_id, expires_at, created_at, created_by,
          rotated_from, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ),
      getResumeTokenByHash: db.prepare(
        'SELECT * FROM _zero_resume_tokens WHERE token_hash = ?'
      ),
      touchResumeToken: db.prepare(
        'UPDATE _zero_resume_tokens SET last_used_at = ? WHERE token_id = ? AND revoked_at IS NULL'
      ),
      revokeResumeToken: db.prepare(
        'UPDATE _zero_resume_tokens SET revoked_at = ? WHERE token_id = ? AND revoked_at IS NULL'
      ),
      deleteExpiredResumeTokens: db.prepare(
        'DELETE FROM _zero_resume_tokens WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)'
      ),
    };
  }

  /** Opaque identity for the exact ReactiveDB transaction domain. */
  getTransactionDomain(): object {
    return this.db.getTransactionDomain();
  }

  /** Coordinate token work with callers already inside the same transaction. */
  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation);
  }

  /** Publish a best-effort notification only after the outer transaction commits. */
  afterCommit(callback: () => unknown): void {
    this.db.afterCommit(callback);
  }

  /** Store a hashed consume-once action token. */
  storeActionToken(params: {
    tokenId: string;
    purpose: string;
    tokenHash: string;
    subject?: PlatformTokenSubject | null;
    scope?: string | null;
    expiresAt: number;
    createdAt: number;
    createdBy?: string | null;
    metadata?: Record<string, unknown>;
  }): StoredPlatformActionTokenRecord {
    this.stmts.insertActionToken.run(
      params.tokenId,
      params.purpose,
      params.tokenHash,
      params.subject?.type ?? null,
      params.subject?.id ?? null,
      params.scope ?? null,
      params.expiresAt,
      params.createdAt,
      params.createdBy ?? null,
      JSON.stringify(params.metadata ?? {})
    );

    return {
      tokenId: params.tokenId,
      purpose: params.purpose,
      tokenHash: params.tokenHash,
      subject: params.subject ?? null,
      scope: params.scope ?? null,
      expiresAt: params.expiresAt,
      consumedAt: null,
      createdAt: params.createdAt,
      createdBy: params.createdBy ?? null,
      metadata: params.metadata ?? {},
    };
  }

  /** Look up an action token by token hash. */
  getActionTokenByHash(tokenHash: string): StoredPlatformActionTokenRecord | null {
    const row = this.stmts.getActionTokenByHash.get(tokenHash) as PlatformActionTokenRow | null;
    return row ? toStoredActionTokenRecord(row) : null;
  }

  /** Consume an action token by id. Returns false when already consumed. */
  consumeActionToken(tokenId: string, now = Date.now()): boolean {
    const result = this.stmts.consumeActionToken.run(now, tokenId);
    return result.changes > 0;
  }

  /** Revoke an action token by id using the consumed marker. */
  revokeActionToken(tokenId: string, now = Date.now()): boolean {
    const result = this.stmts.revokeActionToken.run(now, tokenId);
    return result.changes > 0;
  }

  /** Delete an action token that was never delivered to its intended recipient. */
  deleteActionToken(tokenId: string): boolean {
    const result = this.stmts.deleteActionToken.run(tokenId);
    return result.changes > 0;
  }

  /** Count active action tokens matching a purpose/subject/scope cooldown key. */
  countRecentActionTokens(params: {
    purpose: string;
    subject?: PlatformTokenSubject | null;
    scope?: string | null;
    createdAfter: number;
    now?: number;
  }): number {
    const row = this.stmts.countRecentActionTokens.get(
      params.purpose,
      params.subject?.type ?? null,
      params.subject?.id ?? null,
      params.scope ?? null,
      params.now ?? Date.now(),
      params.createdAfter
    ) as CountRow;
    return row.count;
  }

  /** Delete expired and consumed action-token rows. */
  deleteExpiredActionTokens(now = Date.now()): number {
    const result = this.stmts.deleteExpiredActionTokens.run(now, now);
    return result.changes;
  }

  /** Store a hashed resume token. */
  storeResumeToken(params: {
    tokenId: string;
    flow: string;
    tokenHash: string;
    resource: PlatformResumeResource;
    subject?: PlatformTokenSubject | null;
    expiresAt: number;
    createdAt: number;
    createdBy?: string | null;
    rotatedFrom?: string | null;
    metadata?: Record<string, unknown>;
  }): StoredPlatformResumeTokenRecord {
    this.stmts.insertResumeToken.run(
      params.tokenId,
      params.flow,
      params.tokenHash,
      params.resource.type,
      params.resource.id,
      params.subject?.type ?? null,
      params.subject?.id ?? null,
      params.expiresAt,
      params.createdAt,
      params.createdBy ?? null,
      params.rotatedFrom ?? null,
      JSON.stringify(params.metadata ?? {})
    );

    return {
      tokenId: params.tokenId,
      flow: params.flow,
      tokenHash: params.tokenHash,
      resource: params.resource,
      subject: params.subject ?? null,
      expiresAt: params.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: params.createdAt,
      createdBy: params.createdBy ?? null,
      rotatedFrom: params.rotatedFrom ?? null,
      metadata: params.metadata ?? {},
    };
  }

  /** Look up a resume token by token hash. */
  getResumeTokenByHash(tokenHash: string): StoredPlatformResumeTokenRecord | null {
    const row = this.stmts.getResumeTokenByHash.get(tokenHash) as PlatformResumeTokenRow | null;
    return row ? toStoredResumeTokenRecord(row) : null;
  }

  /** Update last-used timestamp for a resume token and return the updated record. */
  touchResumeToken(tokenId: string, tokenHash: string, now = Date.now()): StoredPlatformResumeTokenRecord | null {
    this.stmts.touchResumeToken.run(now, tokenId);
    return this.getResumeTokenByHash(tokenHash);
  }

  /** Revoke a resume token by id. Returns false if already revoked. */
  revokeResumeToken(tokenId: string, now = Date.now()): boolean {
    const result = this.stmts.revokeResumeToken.run(now, tokenId);
    return result.changes > 0;
  }

  /** Rotate a resume token by revoking the old row and storing a replacement. */
  rotateResumeToken(params: Parameters<PlatformTokenStore['storeResumeToken']>[0] & {
    previousTokenId: string;
    now?: number;
  }): StoredPlatformResumeTokenRecord | null {
    return this.db.transaction(() => {
      const revoked = this.revokeResumeToken(params.previousTokenId, params.now ?? Date.now());
      if (!revoked) return null;
      return this.storeResumeToken(params);
    });
  }

  /** Delete expired and revoked resume-token rows. */
  deleteExpiredResumeTokens(now = Date.now()): number {
    const result = this.stmts.deleteExpiredResumeTokens.run(now, now);
    return result.changes;
  }
}

function toStoredActionTokenRecord(row: PlatformActionTokenRow): StoredPlatformActionTokenRecord {
  return {
    tokenId: row.token_id,
    purpose: row.purpose,
    tokenHash: row.token_hash,
    subject: subjectFromRow(row.subject_type, row.subject_id),
    scope: row.scope,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
    metadata: parseTokenMetadata(row.metadata),
  };
}

function toStoredResumeTokenRecord(row: PlatformResumeTokenRow): StoredPlatformResumeTokenRecord {
  return {
    tokenId: row.token_id,
    flow: row.flow,
    tokenHash: row.token_hash,
    resource: { type: row.resource_type, id: row.resource_id },
    subject: subjectFromRow(row.subject_type, row.subject_id),
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
    rotatedFrom: row.rotated_from,
    metadata: parseTokenMetadata(row.metadata),
  };
}

function subjectFromRow(type: string | null, id: string | null): PlatformTokenSubject | null {
  if (!type || !id) return null;
  return { type, id };
}
