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
  private readonly revokeFamilyStatement: Statement;
  private readonly access: NativeSessionAccessStore;
  private readonly policy: NativeSessionPolicyStore;
  private assertRuntimeProfileCurrent: () => void = () => {};

  constructor(private readonly db: ReactiveDB, options: NativeSessionStoreOptions | number = {}) {
    const resolved = typeof options === 'number' ? { cleanupBatchSize: options } : options;
    this.policy = new NativeSessionPolicyStore(db, resolved);
    this.access = new NativeSessionAccessStore(db, () => this.policy.now());
    this.insertStatement = db.prepare(`INSERT INTO _auth_native_sessions
      (token_id, family_id, user_id, client_id, token_hash, scope,
       auth_generation, scope_kind, scope_id, tenant_id, membership_id,
       tenant_authorization_generation, membership_authorization_generation,
       expires_at, created_at, rotation_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.getByHash = db.prepare('SELECT * FROM _auth_native_sessions WHERE token_hash = ?');
    this.consumeStatement = db.prepare(`UPDATE _auth_native_sessions
      SET consumed_at = ?, replaced_by = ?
      WHERE token_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      RETURNING token_id`);
    this.revokeFamilyStatement = db.prepare(`UPDATE _auth_native_sessions
      SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL
      RETURNING token_id`);
  }

  setRuntimeProfileGuard(guard: () => void): void {
    this.assertRuntimeProfileCurrent = guard;
  }

  assertCurrentProfile(): void {
    this.assertRuntimeProfileCurrent();
  }

  get(rawToken: string): NativeSessionRecord | null {
    this.assertCurrentProfile();
    const row = this.getByHash.get(hashToken(rawToken));
    return row ? toNativeSession(row as Record<string, unknown>) : null;
  }

  consumeCodeAndInsert(
    consumeCode: () => boolean,
    session: PreparedNativeSession,
    admit: () => boolean = () => true,
  ): boolean {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      if (!admit()) return false;
      if (!consumeCode()) return false;
      this.policy.prepareInitial(session.userId, session.clientId);
      this.insert(session);
      return true;
    });
  }

  rotationReadiness(current: NativeSessionRecord): NativeRotationReadiness {
    this.assertCurrentProfile();
    return this.policy.rotationReadiness(current);
  }

  rotate(
    current: NativeSessionRecord,
    replacement: PreparedNativeSession,
    admit: () => boolean = () => true,
  ): NativeRotationResult {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      if (!admit()) {
        this.policy.revokeFamily(current.familyId);
        return 'reused';
      }
      const readiness = this.policy.rotationReadiness(current);
      if (readiness !== 'ready') {
        if (readiness === 'exhausted') this.policy.revokeFamily(current.familyId);
        return readiness;
      }
      const now = this.policy.now();
      const consumed = this.consumeStatement.get(
        now, replacement.tokenId, current.tokenId, now,
      ) as { token_id: string } | null;
      if (consumed?.token_id !== current.tokenId) {
        this.policy.revokeFamily(current.familyId);
        return 'reused';
      }
      this.insert(replacement);
      return 'rotated';
    });
  }

  revokeFamily(familyId: string, afterRevoke?: (deleted: number) => void): number {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      const deleted = this.policy.revokeFamily(familyId);
      if (deleted > 0) afterRevoke?.(deleted);
      return deleted;
    });
  }

  /** Resolve a native access token against its current refresh-family boundary. */
  isFamilyActive(access: NativeFamilyAccess, now = this.policy.now()): boolean {
    this.assertCurrentProfile();
    return this.access.isActive(access, now);
  }

  resolveActiveFamily(
    access: NativeFamilyAccess,
    now = this.policy.now(),
  ): NativeSessionRecord | null {
    this.assertCurrentProfile();
    return this.access.resolveActive(access, now);
  }

  /** Atomically replace a tenant binding with a new refresh family. */
  switchFamily(
    current: NativeSessionRecord,
    replacement: PreparedNativeSession,
    admit: () => boolean,
    afterSwitch?: () => void,
  ): boolean {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      const active = this.access.resolveActive({
        familyId: current.familyId,
        userId: current.userId,
        clientId: current.clientId,
        authGeneration: current.authGeneration,
      });
      if (!active || active.tokenId !== current.tokenId || !admit()) return false;
      const now = this.policy.now();
      if (this.revokeFamilyStatement.all(now, current.familyId).length < 1) return false;
      this.policy.prepareInitial(replacement.userId, replacement.clientId);
      this.insert(replacement);
      afterSwitch?.();
      return true;
    });
  }

  cleanupExpired(now = this.policy.now()): number {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.policy.cleanupExpired(now);
    });
  }

  private insert(session: PreparedNativeSession): void {
    this.insertStatement.run(
      session.tokenId, session.familyId, session.userId, session.clientId,
      session.tokenHash, session.scope, session.authGeneration,
      session.scopeKind ?? 'application', session.scopeId ?? 'application',
      session.tenantId ?? null, session.membershipId ?? null,
      session.tenantAuthorizationGeneration ?? null,
      session.membershipAuthorizationGeneration ?? null,
      session.expiresAt, session.createdAt, session.rotationCount,
    );
  }
}

export type { NativeSessionStoreOptions } from './native-session-policy-store';
