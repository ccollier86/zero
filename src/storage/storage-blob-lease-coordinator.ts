/** Durable, cross-runtime serialization for shared content-addressed blobs. */

import type { ReactiveDB } from '../sync/reactive-db';
import { StorageDomainError } from './storage-domain-error';

const LEASE_TTL_MS = 60_000;
const LEASE_RENEW_MS = 10_000;
const LEASE_ACQUIRE_TIMEOUT_MS = 30_000;
const LEASE_RETRY_MS = 10;

interface ActiveLease {
  readonly token: string;
  lost: boolean;
  renewal: ReturnType<typeof setInterval>;
}

/**
 * Serializes physical provider mutation with blob-reference publication across
 * every StorageService sharing the same SQLite file.
 */
export class StorageBlobLeaseCoordinator {
  private readonly active = new Map<string, ActiveLease>();
  private readonly inFlight = new Set<Promise<unknown>>();
  private stopping = false;
  private readonly stmts;

  constructor(private readonly db: ReactiveDB) {
    this.stmts = {
      insert: db.prepare(`
        INSERT OR IGNORE INTO _storage_blob_leases
          (checksum, lease_token, acquired_at, expires_at)
        VALUES (?, ?, ?, ?)
      `),
      reclaim: db.prepare(`
        UPDATE _storage_blob_leases
        SET lease_token = ?, acquired_at = ?, expires_at = ?
        WHERE checksum = ? AND expires_at <= ?
      `),
      renew: db.prepare(`
        UPDATE _storage_blob_leases SET expires_at = ?
        WHERE checksum = ? AND lease_token = ? AND expires_at > ?
      `),
      release: db.prepare(`
        DELETE FROM _storage_blob_leases
        WHERE checksum = ? AND lease_token = ?
      `),
      get: db.prepare(`
        SELECT lease_token, expires_at FROM _storage_blob_leases
        WHERE checksum = ?
      `),
    };
  }

  /** Acquire every checksum in canonical order, run work, and always release. */
  run<T>(checksums: readonly string[], operation: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(leaseUnavailable());
    const execution = this.execute(checksums, operation);
    this.inFlight.add(execution);
    void execution.finally(() => this.inFlight.delete(execution)).catch(() => {});
    return execution;
  }

  /**
   * Attempt one non-yielding recovery mutation without waiting. This is used
   * during startup publication-receipt reconciliation where blocking on a
   * live replica would delay service admission; a later bounded pass retries.
   */
  tryRunImmediate<T>(
    checksum: string,
    operation: () => T,
  ): { readonly acquired: false } | { readonly acquired: true; readonly value: T } {
    if (this.stopping || this.active.has(checksum)) return { acquired: false };
    const token = `sbl_${crypto.randomUUID()}`;
    const now = Date.now();
    let claimed = false;
    try {
      claimed = this.db.transaction(() => {
        const expiresAt = now + LEASE_TTL_MS;
        if (this.stmts.insert.run(checksum, token, now, expiresAt).changes === 1) return true;
        return this.stmts.reclaim.run(token, now, expiresAt, checksum, now).changes === 1;
      });
    } catch {
      return { acquired: false };
    }
    if (!claimed) return { acquired: false };
    const lease: ActiveLease = {
      token,
      lost: false,
      renewal: setInterval(() => this.renew(checksum, token), LEASE_RENEW_MS),
    };
    lease.renewal.unref?.();
    this.active.set(checksum, lease);
    try {
      return { acquired: true, value: operation() };
    } finally {
      this.release(checksum);
    }
  }

  /** Stop admitting work and join every lease holder before service teardown. */
  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled([...this.inFlight]);
  }

  private async execute<T>(
    checksums: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const unique = [...new Set(checksums.filter(Boolean))].sort();
    const acquired: string[] = [];
    try {
      for (const checksum of unique) {
        await this.acquire(checksum);
        acquired.push(checksum);
      }
      return await operation();
    } finally {
      for (const checksum of acquired.reverse()) this.release(checksum);
    }
  }

  /** Assert lease ownership synchronously inside the caller's commit txn. */
  assertOwned(checksum: string): void {
    const lease = this.active.get(checksum);
    const now = Date.now();
    const row = this.stmts.get.get(checksum) as {
      lease_token: string;
      expires_at: number;
    } | null;
    if (!lease || lease.lost || !row
      || row.lease_token !== lease.token || row.expires_at <= now) {
      throw leaseUnavailable();
    }
  }

  private async acquire(checksum: string): Promise<void> {
    const token = `sbl_${crypto.randomUUID()}`;
    const deadline = Date.now() + LEASE_ACQUIRE_TIMEOUT_MS;
    while (true) {
      const now = Date.now();
      let claimed = false;
      try {
        claimed = this.db.transaction(() => {
          const expiresAt = now + LEASE_TTL_MS;
          if (this.stmts.insert.run(
            checksum, token, now, expiresAt,
          ).changes === 1) return true;
          return this.stmts.reclaim.run(
            token, now, expiresAt, checksum, now,
          ).changes === 1;
        });
      } catch {
        // A concurrent SQLite writer may briefly own the transaction boundary.
        // Retrying remains bounded by the same acquisition deadline.
      }
      if (claimed) {
        const lease: ActiveLease = {
          token,
          lost: false,
          renewal: setInterval(() => this.renew(checksum, token), LEASE_RENEW_MS),
        };
        (lease.renewal as unknown as { unref?: () => void }).unref?.();
        this.active.set(checksum, lease);
        return;
      }
      if (Date.now() >= deadline) throw leaseUnavailable();
      await Bun.sleep(LEASE_RETRY_MS);
    }
  }

  private renew(checksum: string, token: string): void {
    const lease = this.active.get(checksum);
    if (!lease || lease.token !== token || lease.lost) return;
    const now = Date.now();
    try {
      if (this.stmts.renew.run(
        now + LEASE_TTL_MS, checksum, token, now,
      ).changes === 1) return;
    } catch {
      // Conservatively fence the operation after any renewal uncertainty.
    }
    lease.lost = true;
  }

  private release(checksum: string): void {
    const lease = this.active.get(checksum);
    if (!lease) return;
    clearInterval(lease.renewal);
    this.active.delete(checksum);
    try {
      this.stmts.release.run(checksum, lease.token);
    } catch {
      // Expiry remains the recovery boundary if release cannot be persisted.
    }
  }
}

function leaseUnavailable(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_PROVIDER_UNAVAILABLE',
    'Storage blob coordination is temporarily unavailable; retry the operation.',
    { retryable: true, outcome: 'not-committed' },
  );
}
