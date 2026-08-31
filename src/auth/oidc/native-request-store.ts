/** Hash-only persistence for pending browser authorization requests. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createOpaqueToken, hashToken } from '../../tokens/token-utils';
import type { NativeAuthorizationRequestRecord } from './native-auth-records';
import {
  NativeRequestAdmission,
  type NativeRequestStoreOptions,
} from './native-request-admission';
import { toAuthorizationRequest } from './native-row-mappers';
import { NativeRequestBindingStore } from './native-request-binding-store';
import { hashNativeRequestSource } from './native-request-source-hash';

export class NativeRequestStore {
  private readonly insert: Statement;
  private readonly getByHash: Statement;
  private readonly consumeTerminalStatement: Statement;
  private readonly admission: NativeRequestAdmission;
  private readonly bindings: NativeRequestBindingStore;

  constructor(private readonly db: ReactiveDB, options: NativeRequestStoreOptions = {}) {
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

  create(input: Omit<NativeAuthorizationRequestRecord,
    'requestId' | 'boundUserId' | 'sourceHash' | 'createdAt' | 'expiresAt' | 'consumedAt'>
    & { ttlMs: number; sourceKey?: string | null }) {
    return this.db.transaction(() => {
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
    const row = this.getByHash.get(hashToken(rawRequestId));
    return row ? toAuthorizationRequest(row as Record<string, unknown>) : null;
  }

  beginRegistration(rawRequestId: string): boolean {
    return this.bindings.beginRegistration(rawRequestId);
  }

  claimForUser(rawRequestId: string, userId: string): boolean {
    return this.bindings.claimForUser(rawRequestId, userId);
  }

  matchesUser(rawRequestId: string, userId: string): boolean {
    return this.bindings.matchesUser(rawRequestId, userId);
  }

  isAvailable(rawRequestId: string): boolean {
    return this.bindings.isAvailable(rawRequestId);
  }

  consumeTerminal(rawRequestId: string): NativeAuthorizationRequestRecord | null {
    return this.db.transaction(() => {
      const request = this.get(rawRequestId);
      if (!request) return null;
      const now = this.admission.timestamp();
      return this.consumeTerminalStatement.run(
        now, hashToken(rawRequestId), now,
      ).changes === 1 ? request : null;
    });
  }

  releaseForUser(rawRequestId: string, userId: string): boolean {
    return this.bindings.releaseForUser(rawRequestId, userId);
  }

  cleanupExpired(now = this.admission.timestamp()): number {
    return this.admission.cleanupExpired(now);
  }
}
