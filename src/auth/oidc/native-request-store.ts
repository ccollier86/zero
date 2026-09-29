/** Hash-only persistence for pending browser authorization requests. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../../tokens/token-utils';
import type {
  NativeAuthorizationRequestRecord,
  StoredNativeAuthority,
} from './native-auth-records';
import type { NativeAuthoritySnapshot } from './native-tenant-authority';
import {
  NativeRequestAdmission,
  type NativeRequestStoreOptions,
} from './native-request-admission';
import { toAuthorizationRequest } from './native-row-mappers';
import { NativeRequestBindingStore } from './native-request-binding-store';
import { hashNativeRequestSource } from './native-request-source-hash';
import type { AuthPlatformCodeEmitter } from '../auth-observability';
import { invokeSynchronousAuthCallback } from '../auth-synchronous-callback';

export class NativeRequestStore {
  private readonly insert: Statement;
  private readonly getByHash: Statement;
  private readonly consumeTerminalStatement: Statement;
  private readonly admission: NativeRequestAdmission;
  private readonly bindings: NativeRequestBindingStore;
  private assertRuntimeProfileCurrent: () => void = () => {};

  constructor(
    private readonly db: ReactiveDB,
    options: NativeRequestStoreOptions = {},
    private readonly emitCode?: AuthPlatformCodeEmitter,
  ) {
    this.insert = db.prepare(`INSERT INTO _auth_native_requests
      (request_id, request_hash, client_id, redirect_uri, scope, state, nonce,
       code_challenge, prompt, source_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.getByHash = db.prepare(
      'SELECT * FROM _auth_native_requests WHERE request_hash = ?'
    );
    this.consumeTerminalStatement = db.prepare(`UPDATE _auth_native_requests
      SET consumed_at = ? WHERE request_hash = ? AND consumed_at IS NULL AND expires_at > ?`);
    this.admission = new NativeRequestAdmission(db, options);
    this.bindings = new NativeRequestBindingStore(db, () => this.admission.timestamp());
  }

  setRuntimeProfileGuard(guard: () => void): void {
    this.assertRuntimeProfileCurrent = guard;
  }

  assertCurrentProfile(): void {
    invokeSynchronousAuthCallback(this.assertRuntimeProfileCurrent, {
      component: 'native-request-store',
      invariant: 'runtime-profile-guard-async',
      message: '[auth] Native request runtime profile guard must be synchronous.',
      emitCode: this.emitCode,
    });
  }

  create(input: Omit<NativeAuthorizationRequestRecord,
    | 'requestId'
    | 'boundUserId'
    | 'sourceHash'
    | 'createdAt'
    | 'expiresAt'
    | 'consumedAt'
    | keyof StoredNativeAuthority>
    & { ttlMs: number; sourceKey?: string | null }) {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      const createdAt = this.admission.timestamp();
      const sourceHash = input.sourceKey ? hashNativeRequestSource(input.sourceKey) : null;
      this.admission.admit(input.clientId, sourceHash, createdAt);
      const rawRequestId = createOpaqueToken();
      const requestId = crypto.randomUUID();
      const expiresAt = createdAt + input.ttlMs;
      this.insert.run(
        requestId, hashToken(rawRequestId), input.clientId, input.redirectUri,
        input.scope, input.state, input.nonce, input.codeChallenge, input.prompt,
        sourceHash, createdAt, expiresAt
      );
      return { rawRequestId, requestId, expiresAt };
    });
  }

  get(rawRequestId: string): NativeAuthorizationRequestRecord | null {
    this.assertCurrentProfile();
    const row = this.getByHash.get(hashToken(rawRequestId));
    return row ? toAuthorizationRequest(row as Record<string, unknown>) : null;
  }

  beginRegistration(rawRequestId: string): boolean {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.bindings.beginRegistration(rawRequestId);
    });
  }

  claimForUser(rawRequestId: string, userId: string): boolean {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.bindings.claimForUser(rawRequestId, userId);
    });
  }

  matchesUser(rawRequestId: string, userId: string): boolean {
    this.assertCurrentProfile();
    return this.bindings.matchesUser(rawRequestId, userId);
  }

  claimForAuthority(
    rawRequestId: string,
    userId: string,
    authority: NativeAuthoritySnapshot,
  ): boolean {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.bindings.claimForAuthority(rawRequestId, userId, authority);
    });
  }

  matchesAuthority(
    rawRequestId: string,
    userId: string,
    authority: NativeAuthoritySnapshot,
  ): boolean {
    this.assertCurrentProfile();
    return this.bindings.matchesAuthority(rawRequestId, userId, authority);
  }

  isAvailable(rawRequestId: string): boolean {
    this.assertCurrentProfile();
    return this.bindings.isAvailable(rawRequestId);
  }

  consumeTerminal(rawRequestId: string): NativeAuthorizationRequestRecord | null {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      const request = this.get(rawRequestId);
      if (!request) return null;
      const now = this.admission.timestamp();
      return this.consumeTerminalStatement.run(
        now, hashToken(rawRequestId), now,
      ).changes === 1 ? request : null;
    });
  }

  releaseForUser(rawRequestId: string, userId: string): boolean {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.bindings.releaseForUser(rawRequestId, userId);
    });
  }

  cleanupExpired(now = this.admission.timestamp()): number {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.admission.cleanupExpired(now);
    });
  }
}
