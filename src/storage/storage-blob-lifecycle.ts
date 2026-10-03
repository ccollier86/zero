/**
 * storage-blob-lifecycle.ts
 *
 * Owns Storage blob-reference invariants and retryable physical cleanup. The
 * caller owns object metadata transactions; this class joins those
 * transactions synchronously and performs adapter deletion only after commit.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { ReactiveDB } from '../sync/reactive-db';
import { StorageBlobLeaseCoordinator } from './storage-blob-lease-coordinator';
import { StorageDomainError, normalizeStorageError } from './storage-domain-error';
import { StorageMutationCoordinator } from './storage-mutation-coordinator';
import type { BlobRecord, StorageAdapter } from './types';
import type { StoragePendingBlobPublication } from './types';

export interface StorageBlobCleanupPass {
  readonly attempted: number;
  readonly remaining: number;
}

export interface StorageBlobCleanupOptions {
  readonly batchSize?: number;
  readonly concurrency?: number;
}

const DEFAULT_CLEANUP_BATCH_SIZE = 32;
const MAX_CLEANUP_BATCH_SIZE = 128;
const DEFAULT_CLEANUP_CONCURRENCY = 4;
const MAX_CLEANUP_CONCURRENCY = 16;

/** Build an instance-local serialization key for one logical object path. */
export function storagePathMutationKey(driveId: string, path: string): string {
  return `path\u0000${driveId}\u0000${path}`;
}

/** Build serialization keys for a path and every logical folder ancestor. */
export function storagePathMutationKeys(driveId: string, path: string): readonly string[] {
  const segments = path.split('/').filter(Boolean);
  let prefix = '';
  return segments.map((segment) => {
    prefix += `/${segment}`;
    return storagePathMutationKey(driveId, prefix);
  });
}

/** Build an instance-local serialization key for one physical blob. */
export function storageBlobMutationKey(
  checksum: string | null | undefined,
): string | null {
  return checksum ? `blob\u0000${checksum}` : null;
}

/** Coordinate reference changes with retryable physical blob cleanup. */
export class StorageBlobLifecycle {
  private readonly coordinator = new StorageMutationCoordinator();
  private readonly durableLeases: StorageBlobLeaseCoordinator;
  private readonly stmts;
  private cleanupCursor: Readonly<{ createdAt: number; checksum: string }> | null = null;
  private unsafeDeleteWarningEmitted = false;

  constructor(
    private readonly db: ReactiveDB,
    private readonly adapter: StorageAdapter,
  ) {
    this.durableLeases = new StorageBlobLeaseCoordinator(db);
    this.stmts = {
      get: db.prepare('SELECT * FROM _storage_blobs WHERE checksum = ?'),
      increment: db.prepare(
        'UPDATE _storage_blobs SET ref_count = ref_count + 1 WHERE checksum = ?',
      ),
      decrement: db.prepare(
        'UPDATE _storage_blobs SET ref_count = ref_count - 1 WHERE checksum = ? AND ref_count > 0',
      ),
      insert: db.prepare(
        'INSERT INTO _storage_blobs (checksum, size_bytes, ref_count, created_at) VALUES (?, ?, 1, ?)',
      ),
      insertZero: db.prepare(
        'INSERT OR IGNORE INTO _storage_blobs (checksum, size_bytes, ref_count, created_at) VALUES (?, ?, 0, ?)',
      ),
      deleteZero: db.prepare(
        'DELETE FROM _storage_blobs WHERE checksum = ? AND ref_count = 0',
      ),
      listZeroAfter: db.prepare(
        `SELECT * FROM _storage_blobs
         WHERE ref_count = 0
           AND (created_at > ? OR (created_at = ? AND checksum > ?))
         ORDER BY created_at, checksum LIMIT ?`,
      ),
      listZeroFirst: db.prepare(
        `SELECT * FROM _storage_blobs
         WHERE ref_count = 0 ORDER BY created_at, checksum LIMIT ?`,
      ),
      countZero: db.prepare(
        'SELECT COUNT(*) AS count FROM _storage_blobs WHERE ref_count = 0',
      ),
    };
  }

  /** Serialize one async mutation by every supplied path/blob key. */
  run<T>(
    keys: readonly (string | null | undefined)[],
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.coordinator.run(
      keys,
      () => this.durableLeases.run(blobChecksums(keys), operation),
    );
  }

  /** Read the durable reference record for one checksum. */
  getRecord(checksum: string): BlobRecord | null {
    return this.stmts.get.get(checksum) as BlobRecord | null;
  }

  /** Join active provider work and stop admitting new blob mutations. */
  stop(): Promise<void> {
    return this.durableLeases.stop();
  }

  /** Add one reference inside the caller's active ReactiveDB transaction. */
  incrementInTransaction(checksum: string, size: number): void {
    this.durableLeases.assertOwned(checksum);
    const existing = this.getRecord(checksum);
    if (!existing) {
      this.stmts.insert.run(checksum, size, Date.now());
      return;
    }
    if (existing.size_bytes !== size || existing.ref_count < 0) {
      throw invalidReferenceState();
    }
    this.stmts.increment.run(checksum);
  }

  /** Remove one reference and schedule physical cleanup only after commit. */
  decrementInTransaction(checksum: string): void {
    const existing = this.getRecord(checksum);
    if (!existing || existing.ref_count < 1) throw invalidReferenceState();
    this.stmts.decrement.run(checksum);
    if (this.getRecord(checksum)?.ref_count === 0) {
      this.db.afterCommit(() => {
        // An adapter write that just resolved already has its publication
        // continuation queued. Deferring cleanup one microtask lets that
        // continuation register its blob-key lease before deletion starts.
        queueMicrotask(() => {
          void this.queueCleanup(checksum);
        });
      });
    }
  }

  /**
   * Reconcile bytes staged by an operation that did not commit metadata.
   * Existing positive references always win and preserve the physical blob.
   */
  async cleanupUnreferenced(checksum: string, size: number): Promise<void> {
    await this.run([storageBlobMutationKey(checksum)], async () => {
      this.db.transaction(() => {
        if (!this.getRecord(checksum)) {
          this.stmts.insertZero.run(checksum, size, Date.now());
        }
      });
      await this.removeZeroReference(checksum);
    });
  }

  /** Retry a bounded, rotating batch of retained zero-reference rows. */
  async retryCleanup(
    options: StorageBlobCleanupOptions = {},
  ): Promise<StorageBlobCleanupPass> {
    const batchSize = boundedPositiveInteger(
      options.batchSize,
      DEFAULT_CLEANUP_BATCH_SIZE,
      MAX_CLEANUP_BATCH_SIZE,
      'cleanup batch size',
    );
    const concurrency = boundedPositiveInteger(
      options.concurrency,
      DEFAULT_CLEANUP_CONCURRENCY,
      MAX_CLEANUP_CONCURRENCY,
      'cleanup concurrency',
    );
    let blobs = this.cleanupCursor
      ? this.stmts.listZeroAfter.all(
          this.cleanupCursor.createdAt,
          this.cleanupCursor.createdAt,
          this.cleanupCursor.checksum,
          batchSize,
        ) as BlobRecord[]
      : this.stmts.listZeroFirst.all(batchSize) as BlobRecord[];
    if (blobs.length === 0 && this.cleanupCursor) {
      this.cleanupCursor = null;
      blobs = this.stmts.listZeroFirst.all(batchSize) as BlobRecord[];
    }
    const last = blobs.at(-1);
    if (last) this.cleanupCursor = { createdAt: last.created_at, checksum: last.checksum };
    for (let index = 0; index < blobs.length; index += concurrency) {
      await Promise.all(
        blobs.slice(index, index + concurrency)
          .map((blob) => this.queueCleanup(blob.checksum)),
      );
    }
    const { count } = this.stmts.countZero.get() as { count: number };
    return Object.freeze({ attempted: blobs.length, remaining: count });
  }

  /** Reconcile one crash receipt under the same durable checksum fence. */
  recoverPendingPublication(publication: StoragePendingBlobPublication): boolean {
    if (!this.adapter.removeBlobSync) return false;
    const attempt = this.durableLeases.tryRunImmediate(publication.checksum, () => (
      this.db.transaction(() => {
        this.durableLeases.assertOwned(publication.checksum);
        const current = this.getRecord(publication.checksum);
        if (current && current.ref_count > 0) return;
        this.adapter.removeBlobSync!(publication.checksum);
        if (current?.ref_count === 0) this.stmts.deleteZero.run(publication.checksum);
      })
    ));
    return attempt.acquired;
  }

  private queueCleanup(checksum: string): Promise<void> {
    return this.run(
      [storageBlobMutationKey(checksum)],
      () => this.removeZeroReference(checksum),
    ).catch((cause) => {
      const error = blobCleanupProviderError(cause);
      emitPlatformCode(OBS_CODES.STORAGE_BLOB_CLEANUP_FAILED, {
        error,
        metadata: { retryable: true, phase: 'coordination' },
      });
    });
  }

  private async removeZeroReference(checksum: string): Promise<void> {
    this.durableLeases.assertOwned(checksum);
    const before = this.getRecord(checksum);
    if (!before || before.ref_count !== 0) return;
    if (this.adapter.removeBlobSync) {
      let removed = false;
      try {
        removed = this.db.transaction(() => {
          this.durableLeases.assertOwned(checksum);
          const current = this.getRecord(checksum);
          if (!current || current.ref_count !== 0) return false;
          // BEGIN IMMEDIATE prevents another runtime from reclaiming the
          // checksum lease between this fence and the non-yielding unlink.
          this.adapter.removeBlobSync!(checksum);
          this.stmts.deleteZero.run(checksum);
          return true;
        });
      } catch (cause) {
        const error = blobCleanupProviderError(cause);
        emitPlatformCode(OBS_CODES.STORAGE_BLOB_CLEANUP_FAILED, {
          error,
          metadata: { retryable: true, phase: 'provider' },
        });
        return;
      }
      if (removed) this.emitCleanupCompleted();
      return;
    }
    // An arbitrary awaited provider delete cannot be made safe by an
    // expiring process lease: a paused deleter could resume after another
    // runtime publishes a positive reference. Retain the durable zero row
    // until the adapter offers the non-yielding fenced boundary above.
    if (!this.unsafeDeleteWarningEmitted) {
      this.unsafeDeleteWarningEmitted = true;
      const error = new StorageDomainError(
        'STORAGE_PROVIDER_UNAVAILABLE',
        'Storage adapter does not provide an atomic shared-CAS deletion boundary.',
        { retryable: false, outcome: 'not-committed' },
      );
      emitPlatformCode(OBS_CODES.STORAGE_BLOB_CLEANUP_FAILED, {
        error,
        metadata: { retryable: false, phase: 'provider-capability' },
      });
    }
  }

  private emitCleanupCompleted(): void {
    emitPlatformCode(OBS_CODES.STORAGE_BLOB_CLEANUP_COMPLETED, {
      metadata: { retryable: false },
    });
  }
}

function blobChecksums(
  keys: readonly (string | null | undefined)[],
): string[] {
  const prefix = 'blob\u0000';
  return keys.flatMap((key) => (
    typeof key === 'string' && key.startsWith(prefix)
      ? [key.slice(prefix.length)]
      : []
  ));
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new TypeError(`Storage ${label} must be an integer from 1 to ${maximum}.`);
  }
  return normalized;
}

function invalidReferenceState(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_INTERNAL',
    'Storage blob reference state is invalid.',
    { outcome: 'not-committed' },
  );
}

function blobCleanupProviderError(cause: unknown): StorageDomainError {
  const normalized = normalizeStorageError(cause);
  return new StorageDomainError(
    'STORAGE_PROVIDER_UNAVAILABLE',
    'Storage blob cleanup did not complete.',
    { retryable: true, outcome: 'not-committed', cause: normalized },
  );
}
