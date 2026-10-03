/**
 * storage-studio-ingress-policy.ts
 *
 * Seals legacy Storage HTTP and bearer-capability entry points around managed
 * drive lifecycle, generation, and public-object policy. Provisioning and
 * lifecycle transitions remain owned by Storage Studio domain services.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { ResolvedStorageStudioConfig } from './storage-config';
import { StorageDomainError } from './storage-domain-error';
import {
  STORAGE_DRIVE_PROFILES_TABLE,
  type StorageStudioDriveProfile,
} from './storage-studio-schema';

export interface StorageCapabilityContext {
  readonly generation?: number;
}

/** Request-ingress policy for the optional managed-drive control plane. */
export class StorageStudioIngressPolicy {
  private readonly getProfileStatement;

  constructor(
    db: ReactiveDB,
    private readonly config: ResolvedStorageStudioConfig,
  ) {
    this.getProfileStatement = db.prepare(
      `SELECT * FROM ${STORAGE_DRIVE_PROFILES_TABLE} WHERE drive_id = ?`,
    );
  }

  /** Legacy drive creation is not an alternate unmanaged provisioning path. */
  assertLegacyDriveCreationAllowed(): void {
    if (!this.config.enabled) return;
    throw new StorageDomainError(
      'STORAGE_POLICY_VIOLATION',
      'Managed storage drives must be provisioned through Storage Studio.',
    );
  }

  /** Managed drive settings/lifecycle mutate only through Studio operations. */
  assertLegacyDriveControlAllowed(driveId: string): void {
    if (!this.profile(driveId)) return;
    throw new StorageDomainError(
      'STORAGE_POLICY_VIOLATION',
      'Managed storage drives must be controlled through Storage Studio.',
    );
  }

  /** Managed object traffic is admitted only while the current generation is ready. */
  assertObjectAccessAllowed(driveId: string): StorageStudioDriveProfile | null {
    const profile = this.profile(driveId);
    if (!profile) return null;
    assertReady(profile);
    return profile;
  }

  /** Capture a generation fence for a staged object mutation. */
  captureObjectAccess(driveId: string): StorageCapabilityContext {
    const profile = this.assertObjectAccessAllowed(driveId);
    return Object.freeze(profile ? { generation: profile.generation } : {});
  }

  /** Revalidate an admitted mutation against suspend/resume generation changes. */
  assertObjectAccessCurrent(driveId: string, generation: number | undefined): void {
    const profile = this.assertObjectAccessAllowed(driveId);
    if ((!profile && generation === undefined)
      || (profile && generation === profile.generation)) return;
    throw new StorageDomainError(
      'STORAGE_AUTHORITY_CHANGED',
      'Managed storage authority changed before object publication.',
      { outcome: 'not-committed' },
    );
  }

  /** Public object writes also obey the server-owned Studio public policy. */
  assertObjectVisibilityAllowed(driveId: string, isPublic: boolean): void {
    const profile = this.assertObjectAccessAllowed(driveId);
    if (profile && isPublic && !this.config.publicAccess.allowPublicObjects) {
      throw new StorageDomainError(
        'STORAGE_POLICY_VIOLATION',
        'Storage Studio policy does not allow public objects.',
      );
    }
  }

  /** Capture the managed generation into a newly issued bearer capability. */
  capabilityForIssue(driveId: string, expiresIn: number): StorageCapabilityContext {
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 1) {
      throw new StorageDomainError('STORAGE_INPUT_INVALID', 'Capability expiry is invalid.');
    }
    const profile = this.assertObjectAccessAllowed(driveId);
    if (!profile) return Object.freeze({});
    if (expiresIn > this.config.maxCapabilityTTL) {
      throw new StorageDomainError(
        'STORAGE_POLICY_VIOLATION',
        'Capability expiry exceeds Storage Studio policy.',
      );
    }
    return Object.freeze({ generation: profile.generation });
  }

  /** Reject missing/stale managed generations and every non-ready lifecycle. */
  assertCapabilityCurrent(driveId: string, generation: number | undefined): void {
    const profile = this.assertObjectAccessAllowed(driveId);
    if (!profile) return;
    if (!Number.isSafeInteger(generation) || generation !== profile.generation) {
      throw new StorageDomainError(
        'STORAGE_CAPABILITY_INVALID',
        'Storage capability generation is stale.',
      );
    }
  }

  profile(driveId: string): StorageStudioDriveProfile | null {
    if (!this.config.enabled) return null;
    return this.getProfileStatement.get(driveId) as StorageStudioDriveProfile | null;
  }
}

function assertReady(profile: StorageStudioDriveProfile): void {
  if (profile.lifecycle === 'ready') return;
  const terminal = profile.lifecycle === 'suspended'
    || profile.lifecycle === 'deleting'
    || profile.lifecycle === 'deleted';
  throw new StorageDomainError(
    terminal ? 'STORAGE_POLICY_VIOLATION' : 'STORAGE_NOT_READY',
    'Managed storage drive is not ready for object access.',
    { retryable: !terminal },
  );
}
