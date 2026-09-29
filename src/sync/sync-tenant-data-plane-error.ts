/** Closed, privacy-safe failures owned by the actor-backed tenant Sync plane. */

export const SYNC_TENANT_DATA_PLANE_ERROR_CODES = Object.freeze([
  'SYNC_TENANT_AUTHORITY_REQUIRED',
  'SYNC_TENANT_BASELINE_REQUIRED',
  'SYNC_TENANT_BINDING_CHANGED',
  'SYNC_TENANT_BINDING_INVALID',
  'SYNC_TENANT_BINDING_UNAVAILABLE',
  'SYNC_TENANT_CATALOG_INVALID',
  'SYNC_TENANT_MUTATION_RECOVERY_REQUIRED',
  'SYNC_TENANT_ORDERED_DELIVERY_FAILED',
  'SYNC_TENANT_RECEIPT_INVALID',
  'SYNC_TENANT_SNAPSHOT_CLEANUP_FAILED',
  'SYNC_TENANT_SNAPSHOT_INVALID',
  'SYNC_TENANT_SOCKET_CLOSED',
  'SYNC_TENANT_SUBSCRIPTION_SUPERSEDED',
  'SYNC_TENANT_WAKEUP_INVALID',
] as const);

export type SyncTenantDataPlaneErrorCode =
  (typeof SYNC_TENANT_DATA_PLANE_ERROR_CODES)[number];

/**
 * Internal Sync failure with a stable classifier and a fixed producer-owned
 * message. Caught values, tenant identity, row data, SQL, and paths are never
 * copied into this boundary.
 */
export class SyncTenantDataPlaneError extends Error {
  readonly code: SyncTenantDataPlaneErrorCode;

  constructor(
    code: SyncTenantDataPlaneErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SyncTenantDataPlaneError';
    this.code = code;
  }
}

export function syncTenantDataPlaneError(
  code: SyncTenantDataPlaneErrorCode,
  message: string,
): SyncTenantDataPlaneError {
  return new SyncTenantDataPlaneError(code, message);
}
