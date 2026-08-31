/** Atomic issuance and consumption of one-time native authorization codes. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../../tokens/token-utils';
import type { NativeAuthorizationCodeRecord } from './native-auth-records';
import { toAuthorizationCode, toAuthorizationRequest } from './native-row-mappers';
import {
  NATIVE_STORE_CLEANUP_BATCH_SIZE,
  requireCleanupBatchSize,
} from './native-storage-policy';

export class NativeCodeStore {
  private readonly getRequest: Statement;
  private readonly consumeRequest: Statement;
  private readonly insertCode: Statement;
  private readonly getCode: Statement;
  private readonly consumeCode: Statement;
  private readonly deleteExpiredCodes: Statement;
  private readonly cleanupBatchSize: number;

  constructor(
    private readonly db: ReactiveDB,
    cleanupBatchSize = NATIVE_STORE_CLEANUP_BATCH_SIZE,
  ) {
    this.cleanupBatchSize = requireCleanupBatchSize(cleanupBatchSize);
    this.getRequest = db.prepare('SELECT * FROM _auth_native_requests WHERE request_hash = ?');
    this.consumeRequest = db.prepare(
      `UPDATE _auth_native_requests SET consumed_at = ?
       WHERE request_id = ? AND bound_user_id = ?
         AND consumed_at IS NULL AND expires_at > ?`
    );
    this.insertCode = db.prepare(`INSERT INTO _auth_native_codes
      (code_id, code_hash, request_id, user_id, client_id, redirect_uri, scope,
       nonce, code_challenge, auth_generation, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.getCode = db.prepare('SELECT * FROM _auth_native_codes WHERE code_hash = ?');
    this.consumeCode = db.prepare(
      'UPDATE _auth_native_codes SET consumed_at = ? WHERE code_id = ? AND consumed_at IS NULL AND expires_at > ?'
    );
    this.deleteExpiredCodes = db.prepare(`DELETE FROM _auth_native_codes WHERE code_id IN
      (SELECT code_id FROM _auth_native_codes
       WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)`);
  }

  issue(rawRequestId: string, userId: string, authGeneration: number, ttlMs: number) {
    return this.db.transaction(() => {
      this.cleanupExpired();
      const row = this.getRequest.get(hashToken(rawRequestId)) as Record<string, unknown> | null;
      if (!row) return null;
      const request = toAuthorizationRequest(row);
      if (request.boundUserId !== userId
        || request.consumedAt !== null || request.expiresAt <= Date.now()) return null;
      const now = Date.now();
      const consumed = this.consumeRequest.run(now, request.requestId, userId, now);
      if (consumed.changes !== 1) return null;

      const rawCode = createOpaqueToken();
      const codeId = crypto.randomUUID();
      const createdAt = Date.now();
      this.insertCode.run(
        codeId, hashToken(rawCode), request.requestId, userId, request.clientId,
        request.redirectUri, request.scope, request.nonce, request.codeChallenge,
        authGeneration, createdAt, createdAt + ttlMs
      );
      return { rawCode, request };
    });
  }

  get(rawCode: string): NativeAuthorizationCodeRecord | null {
    const row = this.getCode.get(hashToken(rawCode));
    return row ? toAuthorizationCode(row as Record<string, unknown>) : null;
  }

  consume(codeId: string): boolean {
    const now = Date.now();
    return this.consumeCode.run(now, codeId, now).changes === 1;
  }

  cleanupExpired(now = Date.now()): number {
    return this.deleteExpiredCodes.run(now, this.cleanupBatchSize).changes;
  }
}
