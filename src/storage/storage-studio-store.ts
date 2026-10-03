/**
 * storage-studio-store.ts
 *
 * Composes the focused profile and operation stores behind the stable domain
 * persistence port. It contains no SQL, policy, authorization, or projection.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type {
  StorageStudioDriveListRequest,
} from './storage-studio-contracts';
import {
  StorageStudioOperationStore,
  type StorageStudioOperationInsert,
  type StorageStudioOperationRecord,
} from './storage-studio-operation-store';
import type {
  StorageStudioOwnerKind,
  StorageStudioScopeKind,
} from './storage-studio-ownership';
import {
  StorageStudioProfileStore,
  type StorageStudioListScope,
  type StorageStudioProfilePage,
} from './storage-studio-profile-store';
import type {
  StorageStudioDriveProfile,
  StorageStudioOperationKind,
  StorageStudioOperationStatus,
} from './storage-studio-schema';

export type {
  StorageStudioOperationInsert,
  StorageStudioOperationRecord,
} from './storage-studio-operation-store';
export type {
  StorageStudioListScope,
  StorageStudioProfilePage,
} from './storage-studio-profile-store';

/** Stable persistence port consumed by Storage Studio domain services. */
export class StorageStudioStore {
  private readonly profiles: StorageStudioProfileStore;
  private readonly operations: StorageStudioOperationStore;

  constructor(db: ReactiveDB) {
    this.profiles = new StorageStudioProfileStore(db);
    this.operations = new StorageStudioOperationStore(db);
  }

  getProfile(driveId: string): StorageStudioDriveProfile | null {
    return this.profiles.get(driveId);
  }

  getProfileByKey(
    scopeKind: StorageStudioScopeKind,
    scopeId: string,
    ownerKind: StorageStudioOwnerKind,
    ownerId: string,
    key: string,
  ): StorageStudioDriveProfile | null {
    return this.profiles.getByKey(scopeKind, scopeId, ownerKind, ownerId, key);
  }

  countOwnerDrives(
    scopeKind: StorageStudioScopeKind,
    scopeId: string,
    ownerKind: StorageStudioOwnerKind,
    ownerId: string,
  ): number {
    return this.profiles.countForOwner(scopeKind, scopeId, ownerKind, ownerId);
  }

  listProfiles(
    scope: StorageStudioListScope,
    request: StorageStudioDriveListRequest,
  ): StorageStudioProfilePage {
    return this.profiles.list(scope, request);
  }

  insertProfile(profile: StorageStudioDriveProfile): void {
    this.profiles.insert(profile);
  }

  updateProfile(profile: StorageStudioDriveProfile): void {
    this.profiles.update(profile);
  }

  updateProfileAtRevision(
    profile: StorageStudioDriveProfile,
    expectedRevision: number,
  ): boolean {
    return this.profiles.updateAtRevision(profile, expectedRevision);
  }

  getOperation(
    scopeKind: StorageStudioScopeKind,
    scopeId: string,
    actorUserId: string,
    kind: StorageStudioOperationKind,
    idempotencyKey: string,
  ): StorageStudioOperationRecord | null {
    return this.operations.get(scopeKind, scopeId, actorUserId, kind, idempotencyKey);
  }

  getOperationById(operationId: string): StorageStudioOperationRecord | null {
    return this.operations.getById(operationId);
  }

  insertOperation(input: StorageStudioOperationInsert): StorageStudioOperationRecord {
    return this.operations.insert(input);
  }

  completeOperation(
    operationId: string,
    driveId: string,
    profileRevision: number,
    completedAt: number,
  ): void {
    this.operations.complete(operationId, driveId, profileRevision, completedAt);
  }

  failOperation(
    operationId: string,
    status: Extract<StorageStudioOperationStatus, 'failed' | 'outcome_unknown'>,
    errorCode: string,
    completedAt: number,
  ): void {
    this.operations.fail(operationId, status, errorCode, completedAt);
  }

  failPendingOperation(
    operationId: string,
    status: Extract<StorageStudioOperationStatus, 'failed' | 'outcome_unknown'>,
    errorCode: string,
    completedAt: number,
  ): boolean {
    return this.operations.failPending(operationId, status, errorCode, completedAt);
  }

  pruneExpiredTerminalOperations(now: number, limit?: number): number {
    return this.operations.pruneExpiredTerminal(now, limit);
  }
}
