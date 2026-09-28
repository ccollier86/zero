/** Storage quotas and cadence for native refresh-token families. */

import type { Statement } from 'bun:sqlite';
import type { ResolvedNativeRefreshRotationPolicy } from '../native/policy-types';
import { DEFAULT_NATIVE_REFRESH_POLICY } from '../native/policy-config';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { NativeSessionRecord } from './native-auth-records';

export interface NativeSessionStoreOptions extends Partial<ResolvedNativeRefreshRotationPolicy> {
  now?: () => number;
}

export type NativeRotationReadiness = 'ready' | 'throttled' | 'exhausted';

export class NativeSessionPolicyStore {
  readonly config: ResolvedNativeRefreshRotationPolicy;
  private readonly deleteExpired: Statement;
  private readonly deleteFamily: Statement;
  private readonly evictFamilies: Statement;
  private readonly clock: () => number;

  constructor(db: ReactiveDB, options: NativeSessionStoreOptions = {}) {
    const { now, ...configured } = options;
    this.config = { ...DEFAULT_NATIVE_REFRESH_POLICY, ...configured };
    validate(this.config);
    this.clock = now ?? Date.now;
    this.deleteExpired = db.prepare(`DELETE FROM _auth_native_sessions WHERE token_id IN
      (SELECT token_id FROM _auth_native_sessions
       WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)
      RETURNING token_id`);
    this.deleteFamily = db.prepare(
      'DELETE FROM _auth_native_sessions WHERE family_id = ? RETURNING token_id',
    );
    this.evictFamilies = db.prepare(`DELETE FROM _auth_native_sessions WHERE family_id IN
      (SELECT family_id FROM _auth_native_sessions
       WHERE user_id = ? AND client_id = ? AND consumed_at IS NULL
         AND revoked_at IS NULL AND expires_at > ?
       GROUP BY family_id ORDER BY MAX(created_at) DESC LIMIT -1 OFFSET ?)`);
  }

  now(): number {
    return this.clock();
  }

  prepareInitial(userId: string, clientId: string): void {
    const now = this.now();
    this.cleanupExpired(now);
    this.evictFamilies.run(
      userId, clientId, now, this.config.maxActiveFamiliesPerUserClient - 1,
    );
  }

  rotationReadiness(current: NativeSessionRecord): NativeRotationReadiness {
    if (current.rotationCount >= this.config.maxRotationsPerFamily) return 'exhausted';
    if (current.rotationCount > 0
      && current.createdAt + this.config.minRotationIntervalMs > this.now()) return 'throttled';
    return 'ready';
  }

  revokeFamily(familyId: string): number {
    return this.deleteFamily.all(familyId).length;
  }

  cleanupExpired(now = this.now()): number {
    return this.deleteExpired.all(now, this.config.cleanupBatchSize).length;
  }
}

function validate(config: ResolvedNativeRefreshRotationPolicy): void {
  for (const value of Object.values(config)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('[native-auth] Native refresh storage policy is invalid.');
    }
  }
  if (!config.cleanupBatchSize || !config.maxRotationsPerFamily
    || !config.maxActiveFamiliesPerUserClient) {
    throw new Error('[native-auth] Native refresh storage limits must be positive.');
  }
}
