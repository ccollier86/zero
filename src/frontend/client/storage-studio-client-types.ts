/**
 * storage-studio-client-types.ts
 *
 * Browser-safe contracts for Storage Studio's authenticated SDK surface.
 * This module owns public transport types only; response validation, HTTP
 * binding, React state, and presentation remain in focused peers.
 */

import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
  StorageStudioDriveListRequest,
  StorageStudioDrivePage,
  StorageStudioDriveUpdateRequest,
  StorageStudioLifecycleRequest,
  StorageStudioJobPage,
  StorageStudioMutationReceipt,
  StorageStudioProvisionRequest,
} from '../../storage/storage-studio-contracts';

export interface StorageStudioRequestOptions {
  readonly signal?: AbortSignal;
}

export interface StorageStudioMutationOptions extends StorageStudioRequestOptions {
  /** Reuse this value when retrying a mutation whose outcome is unknown. */
  readonly operationId?: string;
}

export interface StorageStudioMutationFailureBody {
  readonly error?: unknown;
  readonly code?: unknown;
  readonly retryable?: unknown;
  readonly outcome?: unknown;
  readonly requiresSameIdempotencyKey?: unknown;
}

/** Authenticated, authorization-scope-fenced Storage Studio HTTP surface. */
export interface StorageStudioSdkSurface {
  /** Partition in-flight response acceptance by the current Guardian scope. */
  setScope(scopeKey: string): void;
  /** Invalidate all responses captured before this call. */
  clear(): void;
  getCapabilities(options?: StorageStudioRequestOptions): Promise<StorageStudioCapabilities>;
  listDrives(
    request?: StorageStudioDriveListRequest,
    options?: StorageStudioRequestOptions,
  ): Promise<StorageStudioDrivePage>;
  getDrive(
    driveId: string,
    options?: StorageStudioRequestOptions,
  ): Promise<StorageStudioDrive>;
  getDriveByKey(
    key: string,
    owner?: 'organization' | 'personal',
    options?: StorageStudioRequestOptions,
  ): Promise<StorageStudioDrive>;
  listDriveJobs(
    driveId: string,
    request?: { readonly cursor?: string; readonly limit?: number },
    options?: StorageStudioRequestOptions,
  ): Promise<StorageStudioJobPage>;
  provisionDrive(
    request: Omit<StorageStudioProvisionRequest, 'operationId'>,
    options?: StorageStudioMutationOptions,
  ): Promise<StorageStudioMutationReceipt<StorageStudioDrive>>;
  updateDrive(
    driveId: string,
    request: Omit<StorageStudioDriveUpdateRequest, 'operationId'>,
    options?: StorageStudioMutationOptions,
  ): Promise<StorageStudioMutationReceipt<StorageStudioDrive>>;
  changeDriveLifecycle(
    driveId: string,
    request: Omit<StorageStudioLifecycleRequest, 'operationId'>,
    options?: StorageStudioMutationOptions,
  ): Promise<StorageStudioMutationReceipt<StorageStudioDrive>>;
}
