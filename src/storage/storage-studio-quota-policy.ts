/**
 * storage-studio-quota-policy.ts
 *
 * Owns durable concurrent-upload reservations and managed-drive object-count
 * admission. Logical mutation and byte-capacity checks remain in the Storage
 * engine; this module contributes only configured Studio ceilings.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { ResolvedStorageStudioConfig } from './storage-config';
import { StorageDomainError } from './storage-domain-error';
import {
  STORAGE_DRIVE_PROFILES_TABLE,
  STORAGE_QUOTA_RESERVATIONS_TABLE,
  type StorageStudioDriveProfile,
} from './storage-studio-schema';
import type { StorageUploadAdmission, StorageUploadLease } from './storage-upload-admission';

const RESERVATION_LEASE_MS = 120_000;
const SETTLED_RETENTION_MS = 86_400_000;

interface CountRow { count: number }
interface BytesRow { total: number }

/** Durable per-drive admission policy used by the core Storage service. */
export class StorageStudioQuotaPolicy implements StorageUploadAdmission {
  private readonly getProfile;
  private readonly countObjects;

  constructor(
    private readonly db: ReactiveDB,
    private readonly config: ResolvedStorageStudioConfig,
  ) {
    this.getProfile = db.prepare(
      `SELECT * FROM ${STORAGE_DRIVE_PROFILES_TABLE} WHERE drive_id = ?`,
    );
    this.countObjects = db.prepare(
      'SELECT COUNT(*) AS count FROM storage_objects WHERE drive_id = ?',
    );
  }

  begin(driveId: string, declaredBytes?: number): StorageUploadLease | null {
    const profile = this.profile(driveId);
    if (!profile || this.config.limits.maxConcurrentUploadBytes === 0) return null;
    assertReady(profile);
    const limit = this.config.limits.maxConcurrentUploadBytes;
    const bytes = declaredBytes === undefined
      ? limit
      : normalizeBytes(declaredBytes);
    if (bytes === 0) return null;
    const reservationId = `srq_${crypto.randomUUID()}`;
    const now = Date.now();

    this.db.transaction(() => {
      this.expireAndPrune(now);
      this.assertConcurrentBytes(driveId, bytes, limit, now);
      this.db.prepare(`
        INSERT INTO ${STORAGE_QUOTA_RESERVATIONS_TABLE} (
          reservation_id, drive_id, operation_id, reserved_bytes,
          reserved_objects, status, generation, created_at, expires_at, settled_at
        ) VALUES (?, ?, NULL, ?, 0, 'active', ?, ?, ?, NULL)
      `).run(
        reservationId,
        driveId,
        bytes,
        profile.generation,
        now,
        now + RESERVATION_LEASE_MS,
      );
    });

    return new DurableUploadLease(
      this.db,
      reservationId,
      driveId,
      limit,
      profile.generation,
    );
  }

  assertObjectCapacity(driveId: string, additionalObjects: number): void {
    if (!Number.isSafeInteger(additionalObjects) || additionalObjects < 0) {
      throw new StorageDomainError('STORAGE_INTERNAL', 'Storage object delta is invalid.');
    }
    if (additionalObjects === 0) return;
    const profile = this.profile(driveId);
    const limit = this.config.limits.maxObjectsPerDrive;
    if (!profile || limit === 0) return;
    assertReady(profile);
    const current = (this.countObjects.get(driveId) as CountRow).count;
    if (current + additionalObjects > limit) {
      throw new StorageDomainError(
        'STORAGE_QUOTA_EXCEEDED',
        'Storage object-count quota is exceeded.',
        { outcome: 'not-committed', details: { quota: 'objects' } },
      );
    }
  }

  private profile(driveId: string): StorageStudioDriveProfile | null {
    if (!this.config.enabled) return null;
    return this.getProfile.get(driveId) as StorageStudioDriveProfile | null;
  }

  private assertConcurrentBytes(
    driveId: string,
    bytes: number,
    limit: number,
    now: number,
    excludeReservationId?: string,
  ): void {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(reserved_bytes), 0) AS total
      FROM ${STORAGE_QUOTA_RESERVATIONS_TABLE}
      WHERE drive_id = ? AND status = 'active' AND expires_at > ?
        AND (? IS NULL OR reservation_id <> ?)
    `).get(
      driveId,
      now,
      excludeReservationId ?? null,
      excludeReservationId ?? null,
    ) as BytesRow;
    if (row.total + bytes > limit) {
      throw new StorageDomainError(
        'STORAGE_QUOTA_EXCEEDED',
        'Concurrent upload capacity is exceeded.',
        { outcome: 'not-started', details: { quota: 'concurrent-upload-bytes' } },
      );
    }
  }

  private expireAndPrune(now: number): void {
    this.db.prepare(`
      UPDATE ${STORAGE_QUOTA_RESERVATIONS_TABLE}
      SET status = 'expired', settled_at = ?
      WHERE status = 'active' AND expires_at <= ?
    `).run(now, now);
    this.db.prepare(`
      DELETE FROM ${STORAGE_QUOTA_RESERVATIONS_TABLE}
      WHERE status <> 'active' AND settled_at < ?
    `).run(now - SETTLED_RETENTION_MS);
  }
}

class DurableUploadLease implements StorageUploadLease {
  private settled = false;

  constructor(
    private readonly db: ReactiveDB,
    private readonly reservationId: string,
    private readonly driveId: string,
    private readonly limit: number,
    private readonly generation: number,
  ) {}

  adjust(bytes: number): void {
    if (this.settled) throw inactiveReservation();
    const normalized = normalizeBytes(bytes);
    if (normalized === 0) {
      this.release();
      return;
    }
    const now = Date.now();
    this.db.transaction(() => {
      this.requireCurrent(now);
      const row = this.db.prepare(`
        SELECT COALESCE(SUM(reserved_bytes), 0) AS total
        FROM ${STORAGE_QUOTA_RESERVATIONS_TABLE}
        WHERE drive_id = ? AND status = 'active' AND expires_at > ?
          AND reservation_id <> ?
      `).get(this.driveId, now, this.reservationId) as BytesRow;
      if (row.total + normalized > this.limit) {
        throw new StorageDomainError(
          'STORAGE_QUOTA_EXCEEDED',
          'Concurrent upload capacity is exceeded.',
          { outcome: 'not-committed', details: { quota: 'concurrent-upload-bytes' } },
        );
      }
      this.db.prepare(`
        UPDATE ${STORAGE_QUOTA_RESERVATIONS_TABLE}
        SET reserved_bytes = ?, expires_at = ?
        WHERE reservation_id = ? AND status = 'active'
      `).run(normalized, now + RESERVATION_LEASE_MS, this.reservationId);
    });
  }

  heartbeat(): void {
    if (this.settled) throw inactiveReservation();
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE ${STORAGE_QUOTA_RESERVATIONS_TABLE}
      SET expires_at = ?
      WHERE reservation_id = ? AND status = 'active' AND expires_at > ?
    `).run(now + RESERVATION_LEASE_MS, this.reservationId, now);
    if (result.changes !== 1) throw inactiveReservation();
  }

  assertCurrent(): void {
    if (this.settled) throw inactiveReservation();
    this.requireCurrent(Date.now());
  }

  commit(): void {
    this.settle('committed');
  }

  release(): void {
    try {
      this.settle('released');
    } catch {
      this.settled = true;
      emitPlatformCode(OBS_CODES.STORAGE_QUOTA_RESERVATION_RELEASE_FAILED, {
        metadata: { retryable: true, recovery: 'lease-expiry' },
      });
    }
  }

  private settle(status: 'committed' | 'released'): void {
    if (this.settled) return;
    const result = this.db.prepare(`
      UPDATE ${STORAGE_QUOTA_RESERVATIONS_TABLE}
      SET status = ?, settled_at = ?
      WHERE reservation_id = ? AND status = 'active'
    `).run(status, Date.now(), this.reservationId);
    this.settled = true;
    if (result.changes !== 1 && status === 'committed') throw inactiveReservation();
  }

  private requireCurrent(now: number): void {
    const current = this.db.prepare(`
      SELECT r.reservation_id
      FROM ${STORAGE_QUOTA_RESERVATIONS_TABLE} r
      JOIN ${STORAGE_DRIVE_PROFILES_TABLE} p ON p.drive_id = r.drive_id
      WHERE r.reservation_id = ? AND r.status = 'active' AND r.expires_at > ?
        AND r.generation = ? AND p.generation = ? AND p.lifecycle = 'ready'
    `).get(this.reservationId, now, this.generation, this.generation);
    if (!current) throw inactiveReservation();
  }
}

function normalizeBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StorageDomainError('STORAGE_INPUT_INVALID', 'Upload byte count is invalid.');
  }
  return value;
}

function assertReady(profile: StorageStudioDriveProfile): void {
  if (profile.lifecycle !== 'ready') {
    throw new StorageDomainError(
      'STORAGE_NOT_READY',
      'Managed storage drive is not ready for upload admission.',
    );
  }
}

function inactiveReservation(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_OPERATION_IN_PROGRESS',
    'Storage upload reservation is no longer active.',
  );
}
