/** Atomic rotating refresh-token families for public native clients. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import { hashToken } from '../../tokens/token-utils';
import type { NativeSessionRecord, PreparedNativeSession } from './native-auth-records';
import { toNativeSession } from './native-row-mappers';
import {
  NativeSessionPolicyStore,
  type NativeRotationReadiness,
  type NativeSessionStoreOptions,
} from './native-session-policy-store';
import {
  NativeSessionAccessStore,
  type NativeFamilyAccess,
} from './native-session-access-store';

export type NativeRotationResult = 'rotated' | 'reused' | 'throttled' | 'exhausted';

export class NativeSessionStore {
  private readonly insertStatement: Statement;
  private readonly getByHash: Statement;
  private readonly consumeStatement: Statement;
  private readonly access: NativeSessionAccessStore;
  private readonly policy: NativeSessionPolicyStore;

  constructor(private readonly db: ReactiveDB, options: NativeSessionStoreOptions | number = {}) {
    const resolved = typeof options === 'number' ? { cleanupBatchSize: options } : options;
    this.policy = new NativeSessionPolicyStore(db, resolved);
    this.access = new NativeSessionAccessStore(db, () => this.policy.now());
    this.insertStatement = db.prepare(`INSERT INTO _auth_native_sessions
      (token_id, family_id, user_id, client_id, token_hash, scope,
       auth_generation, expires_at, created_at, rotation_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.getByHash = db.prepare('SELECT * FROM _auth_native_sessions WHERE token_hash = ?');
    this.consumeStatement = db.prepare(`UPDATE _auth_native_sessions
      SET consumed_at = ?, replaced_by = ?
      WHERE token_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`);
  }

  get(rawToken: string): NativeSessionRecord | null {
    const row = this.getByHash.get(hashToken(rawToken));
    return row ? toNativeSession(row as Record<string, unknown>) : null;
  }

  consumeCodeAndInsert(consumeCode: () => boolean, session: PreparedNativeSession): boolean {
    return this.db.transaction(() => {
      if (!consumeCode()) return false;
      this.policy.prepareInitial(session.userId, session.clientId);
      this.insert(session);
      return true;
    });
  }

  rotationReadiness(current: NativeSessionRecord): NativeRotationReadiness {
    return this.policy.rotationReadiness(current);
  }

  rotate(current: NativeSessionRecord, replacement: PreparedNativeSession): NativeRotationResult {
    return this.db.transaction(() => {
      const readiness = this.policy.rotationReadiness(current);
      if (readiness !== 'ready') {
        if (readiness === 'exhausted') this.policy.revokeFamily(current.familyId);
        return readiness;
      }
      const now = this.policy.now();
      const consumed = this.consumeStatement.run(now, replacement.tokenId, current.tokenId, now);
      if (consumed.changes !== 1) {
        this.policy.revokeFamily(current.familyId);
        return 'reused';
      }
      this.insert(replacement);
      return 'rotated';
    });
  }

  revokeFamily(familyId: string): void {
    this.policy.revokeFamily(familyId);
  }

  /** Resolve a native access token against its current refresh-family boundary. */
  isFamilyActive(access: NativeFamilyAccess, now = this.policy.now()): boolean {
    return this.access.isActive(access, now);
  }

  cleanupExpired(now = this.policy.now()): number {
    return this.policy.cleanupExpired(now);
  }

  private insert(session: PreparedNativeSession): void {
    this.insertStatement.run(
      session.tokenId, session.familyId, session.userId, session.clientId,
      session.tokenHash, session.scope, session.authGeneration, session.expiresAt,
      session.createdAt, session.rotationCount,
    );
  }
}

export type { NativeSessionStoreOptions } from './native-session-policy-store';
