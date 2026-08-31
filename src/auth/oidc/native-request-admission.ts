/** Persisted authorization-request admission and bounded stale-row cleanup. */

import type { Statement } from 'bun:sqlite';
import { NativeAuthorizationError } from '../native';
import type { ReactiveDB } from '../../sync/reactive-db';
import {
  nativeRequestCount as count,
  resolveNativeRequestLimits as resolveLimits,
  type NativeRequestLimits,
  type NativeRequestStoreOptions,
} from './native-request-limits';

export type { NativeRequestLimits, NativeRequestStoreOptions } from './native-request-limits';

export class NativeRequestAdmission {
  private readonly cleanup: Statement;
  private readonly activeGlobal: Statement;
  private readonly activeClient: Statement;
  private readonly recentGlobal: Statement;
  private readonly recentClient: Statement;
  private readonly activeSource: Statement;
  private readonly recentSource: Statement;
  private readonly limits: NativeRequestLimits;
  private readonly clock: () => number;

  constructor(db: ReactiveDB, options: NativeRequestStoreOptions = {}) {
    this.limits = resolveLimits(options.limits);
    this.clock = options.now ?? Date.now;
    this.cleanup = db.prepare(`DELETE FROM _auth_native_requests WHERE request_id IN
      (SELECT request.request_id FROM _auth_native_requests AS request
       WHERE request.expires_at <= ? AND request.created_at <= ?
         AND NOT EXISTS (SELECT 1 FROM _auth_native_codes AS code
           WHERE code.request_id = request.request_id
             AND code.consumed_at IS NULL AND code.expires_at > ?)
       ORDER BY request.expires_at LIMIT ?)`);
    this.activeGlobal = db.prepare(`SELECT COUNT(*) AS count FROM _auth_native_requests
      WHERE consumed_at IS NULL AND expires_at > ?`);
    this.activeClient = db.prepare(`SELECT COUNT(*) AS count FROM _auth_native_requests
      WHERE client_id = ? AND consumed_at IS NULL AND expires_at > ?`);
    this.recentGlobal = db.prepare(
      'SELECT COUNT(*) AS count FROM _auth_native_requests WHERE created_at > ?'
    );
    this.recentClient = db.prepare(`SELECT COUNT(*) AS count FROM _auth_native_requests
      WHERE client_id = ? AND created_at > ?`);
    this.activeSource = db.prepare(`SELECT COUNT(*) AS count FROM _auth_native_requests
      WHERE source_hash = ? AND consumed_at IS NULL AND expires_at > ?`);
    this.recentSource = db.prepare(`SELECT COUNT(*) AS count FROM _auth_native_requests
      WHERE source_hash = ? AND created_at > ?`);
  }

  timestamp(): number {
    return this.clock();
  }

  admit(clientId: string, sourceHash: string | null, now = this.timestamp()): void {
    this.cleanupExpired(now);
    const since = now - this.limits.rollingWindowMs;
    const exceeded = count(this.activeGlobal.get(now)) >= this.limits.maxOutstandingGlobal
      || count(this.activeClient.get(clientId, now)) >= this.limits.maxOutstandingPerClient
      || count(this.recentGlobal.get(since)) >= this.limits.maxAdmissionsGlobal
      || count(this.recentClient.get(clientId, since)) >= this.limits.maxAdmissionsPerClient
      || Boolean(sourceHash && (
        count(this.activeSource.get(sourceHash, now)) >= this.limits.maxOutstandingPerSource
        || count(this.recentSource.get(sourceHash, since)) >= this.limits.maxAdmissionsPerSource
      ));
    if (exceeded) {
      throw new NativeAuthorizationError(
        'temporarily_unavailable',
        'Authorization is temporarily busy. Try again shortly.',
        429,
      );
    }
  }

  cleanupExpired(now = this.timestamp()): number {
    return this.cleanup.run(
      now,
      now - this.limits.rollingWindowMs,
      now,
      this.limits.cleanupBatchSize,
    ).changes;
  }
}
