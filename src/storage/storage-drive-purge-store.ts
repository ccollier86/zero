/** Bounded transactional deletion of one drive's object metadata and references. */

import type { ReactiveDB } from '../sync/reactive-db';
import { StorageBlobLifecycle } from './storage-blob-lifecycle';
import type { ObjectRecord } from './types';

const DEFAULT_PURGE_BATCH = 128;
const MAX_PURGE_BATCH = 256;

export interface StorageDrivePurgeBatchResult {
  readonly deleted: number;
  readonly remaining: boolean;
}

/** Owns the bounded SQL work used by durable managed-drive cleanup jobs. */
export class StorageDrivePurgeStore {
  private readonly selectBatch;
  private readonly countRemaining;
  private readonly deletePermissionsByObject;
  private readonly deletePermissionsByDrive;

  constructor(
    private readonly db: ReactiveDB,
    private readonly blobs: StorageBlobLifecycle,
  ) {
    this.selectBatch = db.prepare(`
      SELECT * FROM storage_objects
      WHERE drive_id = ?
      ORDER BY length(path) DESC, path ASC, object_id ASC
      LIMIT ?
    `);
    this.countRemaining = db.prepare(
      'SELECT COUNT(*) AS count FROM storage_objects WHERE drive_id = ?',
    );
    this.deletePermissionsByObject = db.prepare(
      'DELETE FROM _storage_permissions WHERE object_id = ?',
    );
    this.deletePermissionsByDrive = db.prepare(
      'DELETE FROM _storage_permissions WHERE drive_id = ?',
    );
  }

  /** Delete at most one bounded batch inside the caller's active transaction. */
  purgeBatchInTransaction(
    driveId: string,
    options: {
      readonly limit?: number;
      readonly retainDriveGrants?: boolean;
    } = {},
  ): StorageDrivePurgeBatchResult {
    const limit = normalizePurgeLimit(options.limit);
    const objects = this.selectBatch.all(driveId, limit) as ObjectRecord[];
    for (const object of objects) {
      if (object.type === 'file' && object.checksum) {
        this.blobs.decrementInTransaction(object.checksum);
      }
      this.deletePermissionsByObject.run(object.object_id);
      this.db.delete('storage_objects', object.object_id);
    }
    const { count } = this.countRemaining.get(driveId) as { count: number };
    const remaining = count > 0;
    if (!remaining && !options.retainDriveGrants) {
      this.deletePermissionsByDrive.run(driveId);
    }
    return Object.freeze({ deleted: objects.length, remaining });
  }
}

function normalizePurgeLimit(value: number | undefined): number {
  const normalized = value ?? DEFAULT_PURGE_BATCH;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > MAX_PURGE_BATCH) {
    throw new TypeError(`Storage purge batch must be an integer from 1 to ${MAX_PURGE_BATCH}.`);
  }
  return normalized;
}
