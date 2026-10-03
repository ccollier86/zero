/**
 * storage-studio-editor.ts
 *
 * Applies idempotent metadata and policy edits to managed drives. Provisioning,
 * lifecycle transitions, catalog reads, and HTTP transport live elsewhere.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { ResolvedStorageStudioConfig } from './storage-config';
import { StorageDomainError, normalizeStorageError } from './storage-domain-error';
import type { StorageService } from './storage-service';
import type { StorageStudioAudit } from './storage-studio-audit';
import type { StorageStudioAuthority } from './storage-studio-authority';
import { requireStorageStudioCapability } from './storage-studio-authority';
import type { StorageStudioCatalog } from './storage-studio-catalog';
import {
  assertStorageStudioCommitAuthority,
  type StorageStudioCommitFence,
} from './storage-studio-commit-fence';
import { isStoragePersonalOwner } from './storage-studio-catalog';
import type {
  StorageStudioDrive,
  StorageStudioDriveUpdateRequest,
  StorageStudioMutationReceipt,
} from './storage-studio-contracts';
import {
  assertStorageIdempotency,
  normalizeStorageDriveUpdate,
  storageStudioRequestHash,
  STORAGE_STUDIO_OPERATION_TTL_MS,
} from './storage-studio-policy';
import { withStorageProfileActor } from './storage-studio-provisioner';
import type {
  StorageStudioOperationRecord,
  StorageStudioStore,
} from './storage-studio-store';

export interface StorageStudioEditorOptions {
  readonly db: ReactiveDB;
  readonly storage: StorageService;
  readonly store: StorageStudioStore;
  readonly catalog: StorageStudioCatalog;
  readonly audit: StorageStudioAudit;
  readonly config: ResolvedStorageStudioConfig;
}

/** Managed-drive metadata editor with optimistic and idempotent semantics. */
export class StorageStudioEditor {
  constructor(private readonly options: StorageStudioEditorOptions) {}

  update(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
    request: StorageStudioDriveUpdateRequest,
    commitFence?: StorageStudioCommitFence,
  ): StorageStudioMutationReceipt<StorageStudioDrive> {
    const profile = this.options.catalog.requireProfile(authority, driveId);
    if (!authority.canManage && !isStoragePersonalOwner(profile, authority)) {
      requireStorageStudioCapability(authority, 'manage');
    }
    const normalized = normalizeStorageDriveUpdate(request, this.options.config);
    const hash = storageStudioRequestHash({ driveId, ...normalized });
    const existing = this.options.store.getOperation(
      profile.scope_kind,
      profile.scope_id,
      authority.actor.userId,
      'update',
      normalized.operationId,
    );
    if (existing) return this.continueUpdate(
      existing, hash, authority, userProperties, driveId, normalized,
      true, commitFence,
    );

    this.assertMutableProfile(profile, normalized.expectedRevision);

    const reservation = this.reserveOperation(
      profile.scope_kind,
      profile.scope_id,
      authority,
      normalized.operationId,
      hash,
      driveId,
      commitFence,
    );
    return this.continueUpdate(
      reservation.operation, hash, authority, userProperties, driveId, normalized,
      !reservation.created, commitFence,
    );
  }

  private continueUpdate(
    operation: StorageStudioOperationRecord,
    hash: string,
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
    normalized: ReturnType<typeof normalizeStorageDriveUpdate>,
    replayed: boolean,
    commitFence?: StorageStudioCommitFence,
  ): StorageStudioMutationReceipt<StorageStudioDrive> {
    assertStorageIdempotency(operation, hash);
    if (operation.status !== 'pending') {
      return this.resolveReplay(operation, authority, userProperties, driveId);
    }
    try {
      const outcome = this.options.db.transaction(() => {
        assertStorageStudioCommitAuthority(commitFence);
        const durable = this.options.store.getOperationById(operation.operation_id);
        if (!durable) {
          throw new StorageDomainError(
            'STORAGE_INTERNAL',
            'Storage update receipt was not found.',
          );
        }
        assertStorageIdempotency(durable, hash);
        if (durable.status !== 'pending') {
          return { operation: durable, applied: false } as const;
        }
        const current = this.options.catalog.requireProfile(authority, driveId);
        if (current.revision !== normalized.expectedRevision) {
          throw new StorageDomainError(
            'STORAGE_REVISION_CONFLICT',
            'Storage drive revision changed.',
          );
        }
        const usage = this.options.storage.getDriveUsage(driveId);
        if (normalized.maxSize !== undefined
          && normalized.maxSize > 0
          && normalized.maxSize < usage.totalBytes) {
          throw new StorageDomainError(
            'STORAGE_QUOTA_EXCEEDED',
            'Storage drive limit is below current usage.',
          );
        }
        if (normalized.public === true
          && !this.options.config.publicAccess.allowPublicDrives) {
          throw new StorageDomainError(
            'STORAGE_POLICY_VIOLATION',
            'Public storage drives are disabled.',
          );
        }
        this.options.storage.updateDriveRecord(driveId, {
          ...(normalized.name === undefined ? {} : { name: normalized.name }),
          ...(normalized.maxSize === undefined ? {} : { max_size_bytes: normalized.maxSize }),
          ...(normalized.maxFileSize === undefined
            ? {}
            : { max_file_size_bytes: normalized.maxFileSize }),
          ...(normalized.allowedMimeTypes === undefined
            ? {}
            : { allowed_mime_types: normalized.allowedMimeTypes.join(',') }),
        });
        if (normalized.public !== undefined) {
          this.options.storage.setDriveVisibilityRecord(driveId, normalized.public);
        }
        const now = Date.now();
        const updated = withStorageProfileActor(current, authority, {
          revision: current.revision + 1,
          updated_at: now,
        });
        this.options.store.updateProfile(updated);
        this.options.store.completeOperation(operation.operation_id, driveId, updated.revision, now);
        this.options.audit.append(authority, 'storage.drive-updated', 'succeeded', driveId, {
          profile_revision: updated.revision,
        });
        return {
          operation: this.options.store.getOperationById(operation.operation_id)!,
          applied: true,
        } as const;
      });
      if (outcome.operation.status !== 'succeeded') {
        return this.resolveReplay(
          outcome.operation,
          authority,
          userProperties,
          driveId,
        );
      }
      replayed ||= !outcome.applied;
    } catch (cause) {
      const error = normalizeStorageError(cause);
      if (!this.failOperation(operation.operation_id, error.code)) {
        const winner = this.options.store.getOperationById(operation.operation_id);
        if (winner) {
          assertStorageIdempotency(winner, hash);
          if (winner.status !== 'pending') {
            return this.resolveReplay(winner, authority, userProperties, driveId);
          }
        }
        throw new StorageDomainError(
          'STORAGE_OPERATION_OUTCOME_UNKNOWN',
          'Storage update outcome is unknown.',
          { outcome: 'unknown' },
        );
      }
      throw error;
    }

    return Object.freeze({
      operationId: normalized.operationId,
      replayed,
      value: this.options.catalog.get(authority, userProperties, driveId),
    });
  }

  private reserveOperation(
    scopeKind: 'application' | 'tenant',
    scopeId: string,
    authority: StorageStudioAuthority,
    operationId: string,
    hash: string,
    driveId: string,
    commitFence?: StorageStudioCommitFence,
  ): { readonly operation: StorageStudioOperationRecord; readonly created: boolean } {
    const now = Date.now();
    try {
      return {
        operation: this.options.db.transaction(() => {
          assertStorageStudioCommitAuthority(commitFence);
          return this.options.store.insertOperation({
            operationId: `stop_${crypto.randomUUID()}`,
            idempotencyKey: operationId,
            kind: 'update',
            scopeKind,
            scopeId,
            actorUserId: authority.actor.userId,
            actorMembershipId: authority.actor.membershipId ?? null,
            requestHash: hash,
            driveId,
            createdAt: now,
            expiresAt: now + STORAGE_STUDIO_OPERATION_TTL_MS,
          });
        }),
        created: true,
      };
    } catch (cause) {
      if (!isSqliteUniqueConflict(cause)) throw cause;
      const concurrent = this.options.store.getOperation(
        scopeKind,
        scopeId,
        authority.actor.userId,
        'update',
        operationId,
      );
      if (!concurrent) throw cause;
      assertStorageIdempotency(concurrent, hash);
      return { operation: concurrent, created: false };
    }
  }

  private resolveReplay(
    operation: StorageStudioOperationRecord,
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
  ): StorageStudioMutationReceipt<StorageStudioDrive> {
    if (operation.status === 'succeeded') {
      return Object.freeze({
        operationId: operation.idempotency_key,
        replayed: true,
        value: this.options.catalog.get(authority, userProperties, driveId),
      });
    }
    if (operation.status === 'outcome_unknown') {
      throw new StorageDomainError(
        'STORAGE_OPERATION_OUTCOME_UNKNOWN',
        'Storage update outcome is unknown.',
        { outcome: 'unknown' },
      );
    }
    if (operation.status === 'failed') {
      throw new StorageDomainError(
        'STORAGE_CONFLICT',
        'Storage update did not complete.',
        { outcome: 'not-committed' },
      );
    }
    throw new StorageDomainError(
      'STORAGE_OPERATION_IN_PROGRESS',
      'Storage update is already in progress.',
    );
  }

  private assertMutableProfile(
    profile: ReturnType<StorageStudioCatalog['requireProfile']>,
    expectedRevision: number,
  ): void {
    if (profile.revision !== expectedRevision) {
      throw new StorageDomainError(
        'STORAGE_REVISION_CONFLICT',
        'Storage drive revision changed.',
      );
    }
    if (profile.lifecycle !== 'ready' && profile.lifecycle !== 'suspended') {
      throw new StorageDomainError(
        'STORAGE_CONFLICT',
        'Storage drive cannot be updated in its current lifecycle.',
      );
    }
  }

  private failOperation(operationId: string, errorCode: string): boolean {
    try {
      return this.options.db.transaction(() => (
        this.options.store.failPendingOperation(
          operationId,
          'failed',
          errorCode,
          Date.now(),
        )
      ));
    } catch {
      throw new StorageDomainError(
        'STORAGE_OPERATION_OUTCOME_UNKNOWN',
        'Storage update outcome is unknown.',
        { outcome: 'unknown' },
      );
    }
  }
}

function isSqliteUniqueConflict(cause: unknown): boolean {
  return cause instanceof Error && /\bUNIQUE constraint failed\b/iu.test(cause.message);
}
