/**
 * storage-studio-lifecycle-store.ts
 *
 * Defines the narrow persistence port used by lifecycle coordinators. The
 * concrete StorageStudioStore owns SQL and satisfies this contract directly.
 */

import type {
  StorageStudioDriveProfile,
  StorageStudioOperationKind,
} from './storage-studio-schema';
import type {
  StorageStudioOperationInsert,
  StorageStudioOperationRecord,
} from './storage-studio-store';

/** Persistence needed by lifecycle policy, deliberately smaller than the catalog store. */
export interface StorageStudioLifecycleStore {
  getProfile(driveId: string): StorageStudioDriveProfile | null;
  getOperation(
    scopeKind: 'application' | 'tenant',
    scopeId: string,
    actorUserId: string,
    kind: StorageStudioOperationKind,
    idempotencyKey: string,
  ): StorageStudioOperationRecord | null;
  getOperationById(operationId: string): StorageStudioOperationRecord | null;
  insertOperation(input: StorageStudioOperationInsert): StorageStudioOperationRecord;
  completeOperation(
    operationId: string,
    driveId: string,
    profileRevision: number,
    completedAt: number,
  ): void;
  failOperation(
    operationId: string,
    status: 'failed' | 'outcome_unknown',
    errorCode: string,
    completedAt: number,
  ): void;
  /** Replace exactly one expected profile revision, returning false after a race. */
  updateProfileAtRevision(
    profile: StorageStudioDriveProfile,
    expectedRevision: number,
  ): boolean;
}
