/**
 * storage-studio-provisioner.ts
 *
 * Owns idempotent managed-drive reservation and readiness transitions. Catalog
 * projection, later edits, lifecycle cleanup, and HTTP transport live elsewhere.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { ResolvedStorageStudioConfig } from './storage-config';
import { StorageDomainError } from './storage-domain-error';
import type { StorageService } from './storage-service';
import type { StorageStudioAudit } from './storage-studio-audit';
import type { StorageStudioAuthority } from './storage-studio-authority';
import type { StorageStudioCatalog } from './storage-studio-catalog';
import {
  assertStorageStudioCommitAuthority,
  type StorageStudioCommitFence,
} from './storage-studio-commit-fence';
import type {
  StorageStudioDrive,
  StorageStudioMutationReceipt,
  StorageStudioProvisionRequest,
} from './storage-studio-contracts';
import {
  assertStorageIdempotency,
  normalizeStorageProvision,
  storageProvisioningGrants,
  storageStudioRequestHash,
  STORAGE_STUDIO_OPERATION_TTL_MS,
  type NormalizedStorageProvision,
} from './storage-studio-policy';
import type { StorageStudioDriveProfile } from './storage-studio-schema';
import type {
  StorageStudioOperationRecord,
  StorageStudioStore,
} from './storage-studio-store';

const RESERVED_DRIVE_ID_PATTERN = /^drv_[0-9a-f-]{36}$/iu;

export interface StorageStudioProvisionerOptions {
  readonly db: ReactiveDB;
  readonly storage: StorageService;
  readonly store: StorageStudioStore;
  readonly catalog: StorageStudioCatalog;
  readonly audit: StorageStudioAudit;
  readonly config: ResolvedStorageStudioConfig;
  readonly tenancyMode: 'single' | 'multi';
  readonly providerKey: string;
}

/** Idempotent provisioning coordinator over the canonical system database. */
export class StorageStudioProvisioner {
  constructor(private readonly options: StorageStudioProvisionerOptions) {}

  provision(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    request: StorageStudioProvisionRequest,
    commitFence?: StorageStudioCommitFence,
  ): StorageStudioMutationReceipt<StorageStudioDrive> {
    const normalized = normalizeStorageProvision(
      authority,
      request,
      this.options.config,
      this.options.tenancyMode,
    );
    const hash = storageStudioRequestHash(normalized.hashInput);
    let operation = this.options.store.getOperation(
      normalized.ownership.scopeKind,
      normalized.ownership.scopeId,
      authority.actor.userId,
      'provision',
      normalized.operationId,
    );
    let replayed = operation !== null;
    if (operation) {
      const replay = this.replay(operation, hash, authority, userProperties);
      if (replay) return replay;
    } else {
      const reservation = this.reserveReady(authority, normalized, hash, commitFence);
      operation = reservation.operation;
      replayed = !reservation.created;
      // A concurrent request may have won the idempotency-key reservation.
      // Re-read its terminal result instead of reporting the operation-key
      // collision as a drive-key conflict or publishing a second receipt.
      if (!reservation.created) {
        const replay = this.replay(operation, hash, authority, userProperties);
        if (replay) return replay;
      } else {
        return Object.freeze({
          operationId: normalized.operationId,
          replayed: false,
          value: this.options.catalog.get(
            authority,
            userProperties,
            requireReservedDriveId(operation),
          ),
        });
      }
    }

    // Pending rows can only originate from an interrupted pre-atomic build.
    // Resume them transactionally without ever clobbering a concurrent
    // terminal winner; new reservations are created ready in one transaction.
    this.finishPending(authority, operation, commitFence);

    return Object.freeze({
      operationId: normalized.operationId,
      replayed,
      value: this.options.catalog.get(
        authority,
        userProperties,
        requireReservedDriveId(operation),
      ),
    });
  }

  private replay(
    operation: StorageStudioOperationRecord,
    hash: string,
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
  ): StorageStudioMutationReceipt<StorageStudioDrive> | null {
    assertStorageIdempotency(operation, hash);
    if (operation.status === 'succeeded' && operation.drive_id) {
      return Object.freeze({
        operationId: operation.idempotency_key,
        replayed: true,
        value: this.options.catalog.get(authority, userProperties, operation.drive_id),
      });
    }
    if (operation.status === 'pending') return null;
    throw new StorageDomainError(
      operation.status === 'outcome_unknown'
        ? 'STORAGE_OPERATION_OUTCOME_UNKNOWN'
        : 'STORAGE_CONFLICT',
      'Storage provisioning did not complete.',
      operation.status === 'outcome_unknown'
        ? { outcome: 'unknown' }
        : { outcome: 'not-committed' },
    );
  }

  private reserveReady(
    authority: StorageStudioAuthority,
    normalized: NormalizedStorageProvision,
    hash: string,
    commitFence?: StorageStudioCommitFence,
  ): { readonly operation: StorageStudioOperationRecord; readonly created: boolean } {
    const now = Date.now();
    const driveId = `drv_${crypto.randomUUID()}`;
    if (!RESERVED_DRIVE_ID_PATTERN.test(driveId)) {
      throw new StorageDomainError('STORAGE_INTERNAL', 'Storage drive reservation failed.');
    }
    try {
      return {
        operation: this.options.db.transaction(() => {
          assertStorageStudioCommitAuthority(commitFence);
          this.assertCapacity(normalized);
          // The operation receipt references the canonical drive row. Create
          // it first so immediate SQLite foreign keys remain valid; the outer
          // transaction still rolls every row back together.
          this.options.storage.createDriveRecord({
            driveId,
            ownerId: normalized.owner === 'personal' ? authority.actor.userId : null,
            params: {
              name: normalized.name,
              maxSize: normalized.maxSize,
              maxFileSize: normalized.maxFileSize,
              allowedMimeTypes: [...normalized.allowedMimeTypes],
              public: normalized.public,
            },
            scope: authority.scope,
          });
          const operation = this.options.store.insertOperation({
            operationId: `stop_${crypto.randomUUID()}`,
            idempotencyKey: normalized.operationId,
            kind: 'provision',
            scopeKind: normalized.ownership.scopeKind,
            scopeId: normalized.ownership.scopeId,
            actorUserId: authority.actor.userId,
            actorMembershipId: authority.actor.membershipId ?? null,
            requestHash: hash,
            driveId,
            createdAt: now,
            expiresAt: now + STORAGE_STUDIO_OPERATION_TTL_MS,
          });
          const provisioning = createProvisioningProfile(
            driveId,
            now,
            authority,
            normalized,
            this.options.providerKey,
            this.options.config.isolation,
          );
          const ready = withStorageProfileActor(provisioning, authority, {
            lifecycle: 'ready',
            revision: provisioning.revision + 1,
            ready_at: now,
            updated_at: now,
          });
          this.options.store.insertProfile(ready);
          // Persist the complete ACL intent with the drive/profile reservation
          // so recovery never reconstructs policy from changed configuration.
          for (const grant of storageProvisioningGrants(
            this.options.config,
            normalized,
            authority,
          )) this.options.storage.grantPermission(driveId, grant);
          this.options.audit.append(
            authority,
            'storage.drive-provision-requested',
            'succeeded',
            driveId,
            { owner_kind: normalized.ownership.ownerKind },
          );
          this.options.store.completeOperation(
            operation.operation_id,
            driveId,
            ready.revision,
            now,
          );
          this.options.audit.append(
            authority,
            'storage.drive-provisioned',
            'succeeded',
            driveId,
            {
              owner_kind: ready.owner_kind,
              profile_revision: ready.revision,
            },
          );
          return this.options.store.getOperationById(operation.operation_id) ?? operation;
        }),
        created: true,
      };
    } catch (cause) {
      if (isSqliteUniqueConflict(cause)) {
        const concurrent = this.options.store.getOperation(
          normalized.ownership.scopeKind,
          normalized.ownership.scopeId,
          authority.actor.userId,
          'provision',
          normalized.operationId,
        );
        if (concurrent) {
          assertStorageIdempotency(concurrent, hash);
          return { operation: concurrent, created: false };
        }
        throw new StorageDomainError(
          'STORAGE_DRIVE_KEY_CONFLICT',
          'Storage drive key or operation id is already in use.',
          { outcome: 'not-committed' },
        );
      }
      throw cause;
    }
  }

  private assertCapacity(normalized: NormalizedStorageProvision): void {
    const count = this.options.store.countOwnerDrives(
      normalized.ownership.scopeKind,
      normalized.ownership.scopeId,
      normalized.ownership.ownerKind,
      normalized.ownership.ownerId,
    );
    const max = normalized.owner === 'personal'
      ? this.options.config.limits.maxPersonalDrivesPerUser
      : this.options.config.limits.maxOrganizationDrives;
    if (count >= max) {
      throw new StorageDomainError(
        'STORAGE_QUOTA_EXCEEDED',
        'Storage drive count limit is reached.',
      );
    }
    if (this.options.store.getProfileByKey(
      normalized.ownership.scopeKind,
      normalized.ownership.scopeId,
      normalized.ownership.ownerKind,
      normalized.ownership.ownerId,
      normalized.key,
    )) {
      throw new StorageDomainError(
        'STORAGE_DRIVE_KEY_CONFLICT',
        'Storage drive key is already in use.',
      );
    }
  }

  private finishPending(
    authority: StorageStudioAuthority,
    operation: StorageStudioOperationRecord,
    commitFence?: StorageStudioCommitFence,
  ): void {
    const driveId = requireReservedDriveId(operation);
    this.options.db.transaction(() => {
      assertStorageStudioCommitAuthority(commitFence);
      const currentOperation = this.options.store.getOperationById(operation.operation_id);
      if (currentOperation?.status === 'succeeded') return;
      if (!currentOperation || currentOperation.status !== 'pending') {
        throw new StorageDomainError(
          currentOperation?.status === 'outcome_unknown'
            ? 'STORAGE_OPERATION_OUTCOME_UNKNOWN'
            : 'STORAGE_CONFLICT',
          'Storage provisioning cannot resume from its current receipt.',
          currentOperation?.status === 'outcome_unknown'
            ? { outcome: 'unknown' }
            : { outcome: 'not-committed' },
        );
      }
      const profile = this.options.catalog.requireProfile(authority, driveId);
      if (profile.lifecycle === 'ready') {
        this.options.store.completeOperation(
          operation.operation_id,
          driveId,
          profile.revision,
          Date.now(),
        );
        return;
      }
      if (profile.lifecycle !== 'provisioning') {
        throw new StorageDomainError(
          'STORAGE_CONFLICT',
          'Storage provisioning cannot resume in the current lifecycle.',
        );
      }
      const now = Date.now();
      const ready = withStorageProfileActor(profile, authority, {
        lifecycle: 'ready',
        revision: profile.revision + 1,
        ready_at: now,
        updated_at: now,
      });
      this.options.store.updateProfile(ready);
      this.options.store.completeOperation(operation.operation_id, driveId, ready.revision, now);
      this.options.audit.append(authority, 'storage.drive-provisioned', 'succeeded', driveId, {
        owner_kind: profile.owner_kind,
        profile_revision: ready.revision,
      });
    });
  }

}

export function withStorageProfileActor(
  profile: StorageStudioDriveProfile,
  authority: StorageStudioAuthority,
  updates: Partial<StorageStudioDriveProfile>,
): StorageStudioDriveProfile {
  return {
    ...profile,
    ...updates,
    updated_by_user_id: authority.actor.userId,
    updated_by_membership_id: authority.actor.membershipId ?? null,
  };
}

function createProvisioningProfile(
  driveId: string,
  now: number,
  authority: StorageStudioAuthority,
  input: NormalizedStorageProvision,
  providerKey: string,
  isolation: StorageStudioDriveProfile['isolation_mode'],
): StorageStudioDriveProfile {
  return {
    drive_id: driveId,
    drive_key: input.key,
    owner_kind: input.ownership.ownerKind,
    owner_id: input.ownership.ownerId,
    scope_kind: input.ownership.scopeKind,
    scope_id: input.ownership.scopeId,
    lifecycle: 'provisioning',
    revision: 1,
    provider: providerKey,
    provider_namespace: `stn_${crypto.randomUUID()}`,
    isolation_mode: isolation,
    generation: 1,
    created_by_user_id: authority.actor.userId,
    created_by_membership_id: authority.actor.membershipId ?? null,
    updated_by_user_id: authority.actor.userId,
    updated_by_membership_id: authority.actor.membershipId ?? null,
    created_at: now,
    updated_at: now,
    ready_at: null,
    degraded_at: null,
    suspended_at: null,
    deleting_at: null,
    deleted_at: null,
    restoring_at: null,
    failed_at: null,
    failure_code: null,
  };
}

function requireReservedDriveId(operation: StorageStudioOperationRecord): string {
  if (operation.drive_id) return operation.drive_id;
  throw new StorageDomainError(
    'STORAGE_INTERNAL',
    'Storage provisioning receipt has no drive reservation.',
  );
}

function isSqliteUniqueConflict(cause: unknown): boolean {
  return cause instanceof Error && /\bUNIQUE constraint failed\b/iu.test(cause.message);
}
