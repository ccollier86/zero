/** Atomic issuance and consumption of one-time native authorization codes. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../../tokens/token-utils';
import type { NativeAuthorizationCodeRecord } from './native-auth-records';
import type { NativeAuthoritySnapshot } from './native-tenant-authority';
import { sameNativeAuthority } from './native-tenant-authority';
import { toAuthorizationCode, toAuthorizationRequest } from './native-row-mappers';
import {
  NATIVE_STORE_CLEANUP_BATCH_SIZE,
  requireCleanupBatchSize,
} from './native-storage-policy';
import { normalizeMfaVerifiedAt } from '../mfa-assurance';
import type { AuthPlatformCodeEmitter } from '../auth-observability';
import { invokeSynchronousAuthCallback } from '../auth-synchronous-callback';

export class NativeCodeStore {
  private readonly getRequest: Statement;
  private readonly consumeRequest: Statement;
  private readonly insertCode: Statement;
  private readonly getCode: Statement;
  private readonly consumeCode: Statement;
  private readonly deleteExpiredCodes: Statement;
  private readonly cleanupBatchSize: number;
  private assertRuntimeProfileCurrent: () => void = () => {};

  constructor(
    private readonly db: ReactiveDB,
    cleanupBatchSize = NATIVE_STORE_CLEANUP_BATCH_SIZE,
    private readonly emitCode?: AuthPlatformCodeEmitter,
  ) {
    this.cleanupBatchSize = requireCleanupBatchSize(cleanupBatchSize);
    this.getRequest = db.prepare('SELECT * FROM _auth_native_requests WHERE request_hash = ?');
    this.consumeRequest = db.prepare(
      `UPDATE _auth_native_requests SET consumed_at = ?
       WHERE request_id = ? AND bound_user_id = ?
         AND (scope_kind IS NULL OR (
           scope_kind = ? AND scope_id = ? AND tenant_id IS ?
           AND membership_id IS ? AND tenant_authorization_generation IS ?
           AND membership_authorization_generation IS ?
         ))
         AND consumed_at IS NULL AND expires_at > ?`
    );
    this.insertCode = db.prepare(`INSERT INTO _auth_native_codes
      (code_id, code_hash, request_id, user_id, client_id, redirect_uri, scope,
       nonce, code_challenge, auth_generation, scope_kind, scope_id, tenant_id,
       membership_id, tenant_authorization_generation,
       membership_authorization_generation, mfa_verified_at, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.getCode = db.prepare('SELECT * FROM _auth_native_codes WHERE code_hash = ?');
    this.consumeCode = db.prepare(
      'UPDATE _auth_native_codes SET consumed_at = ? WHERE code_id = ? AND consumed_at IS NULL AND expires_at > ?'
    );
    this.deleteExpiredCodes = db.prepare(`DELETE FROM _auth_native_codes WHERE code_id IN
      (SELECT code_id FROM _auth_native_codes
       WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)`);
  }

  setRuntimeProfileGuard(guard: () => void): void {
    this.assertRuntimeProfileCurrent = guard;
  }

  assertCurrentProfile(): void {
    invokeSynchronousAuthCallback(this.assertRuntimeProfileCurrent, {
      component: 'native-code-store',
      invariant: 'runtime-profile-guard-async',
      message: '[auth] Native code runtime profile guard must be synchronous.',
      emitCode: this.emitCode,
    });
  }

  issue(
    rawRequestId: string,
    userId: string,
    authGeneration: number,
    authorityOrTtl: NativeAuthoritySnapshot | number,
    explicitTtlMs?: number,
    mfaVerifiedAt: number | null = null,
  ) {
    const legacyApplicationIssue = typeof authorityOrTtl === 'number';
    const authority = legacyApplicationIssue
      ? APPLICATION_AUTHORITY
      : authorityOrTtl;
    const ttlMs = legacyApplicationIssue
      ? authorityOrTtl
      : explicitTtlMs!;
    const assurance = normalizeMfaVerifiedAt(mfaVerifiedAt);
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      this.cleanupExpired();
      const row = this.getRequest.get(hashToken(rawRequestId)) as Record<string, unknown> | null;
      if (!row) return null;
      const request = toAuthorizationRequest(row);
      if (request.boundUserId !== userId
        || (request.scopeKind === null ? !legacyApplicationIssue : !sameNativeAuthority(authority, {
          scopeKind: request.scopeKind,
          scopeId: request.scopeId!,
          tenantId: request.tenantId,
          membershipId: request.membershipId,
          tenantAuthorizationGeneration: request.tenantAuthorizationGeneration,
          membershipAuthorizationGeneration: request.membershipAuthorizationGeneration,
        }))
        || request.consumedAt !== null || request.expiresAt <= Date.now()) return null;
      const now = Date.now();
      const consumed = this.consumeRequest.run(
        now, request.requestId, userId,
        authority.scopeKind, authority.scopeId, authority.tenantId,
        authority.membershipId, authority.tenantAuthorizationGeneration,
        authority.membershipAuthorizationGeneration, now,
      );
      if (consumed.changes !== 1) return null;

      const rawCode = createOpaqueToken();
      const codeId = crypto.randomUUID();
      const createdAt = Date.now();
      this.insertCode.run(
        codeId, hashToken(rawCode), request.requestId, userId, request.clientId,
        request.redirectUri, request.scope, request.nonce, request.codeChallenge,
        authGeneration, authority.scopeKind, authority.scopeId, authority.tenantId,
        authority.membershipId, authority.tenantAuthorizationGeneration,
        authority.membershipAuthorizationGeneration, assurance,
        createdAt, createdAt + ttlMs,
      );
      return { rawCode, request };
    });
  }

  get(rawCode: string): NativeAuthorizationCodeRecord | null {
    this.assertCurrentProfile();
    const row = this.getCode.get(hashToken(rawCode));
    return row ? toAuthorizationCode(row as Record<string, unknown>) : null;
  }

  consume(codeId: string): boolean {
    const now = Date.now();
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.consumeCode.run(now, codeId, now).changes === 1;
    });
  }

  cleanupExpired(now = Date.now()): number {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.deleteExpiredCodes.run(now, this.cleanupBatchSize).changes;
    });
  }
}

const APPLICATION_AUTHORITY: NativeAuthoritySnapshot = {
  scopeKind: 'application', scopeId: 'application', tenantId: null, membershipId: null,
  tenantAuthorizationGeneration: null, membershipAuthorizationGeneration: null,
};
