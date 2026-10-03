/**
 * storage-studio-ownership.ts
 *
 * Resolves public Storage Studio owner choices into canonical sidecar owners.
 * It is mode-aware policy only and performs no authorization or persistence.
 */

/** Owner choice exposed by provisioning APIs and adaptable control-plane UI. */
export type StorageStudioOwnerChoice = 'organization' | 'personal';

/** Canonical persisted owner kind. */
export type StorageStudioOwnerKind = 'application' | 'organization' | 'user';

/** Canonical scope containing a managed drive. */
export type StorageStudioScopeKind = 'application' | 'tenant';

export interface StorageStudioOwnershipInput {
  readonly tenancyMode: 'single' | 'multi';
  readonly choice: StorageStudioOwnerChoice;
  readonly userId: string;
  readonly tenantId?: string | null;
}

export interface StorageStudioOwnership {
  readonly ownerKind: StorageStudioOwnerKind;
  readonly ownerId: string;
  readonly scopeKind: StorageStudioScopeKind;
  readonly scopeId: string;
}

/**
 * Resolve an organization/personal choice without allowing caller-supplied
 * owner ids. Multi mode requires a validated tenant; single mode deterministically
 * maps organization ownership to the application control scope.
 */
export function resolveStorageStudioOwnership(
  input: StorageStudioOwnershipInput,
): Readonly<StorageStudioOwnership> {
  const userId = canonicalIdentifier(input.userId, 'userId');
  if (input.tenancyMode === 'single') {
    if (input.tenantId !== undefined && input.tenantId !== null) {
      throw new Error('Single-mode Storage Studio ownership cannot include a tenant id.');
    }
    return Object.freeze(input.choice === 'organization'
      ? {
          ownerKind: 'application' as const,
          ownerId: 'application',
          scopeKind: 'application' as const,
          scopeId: 'application',
        }
      : {
          ownerKind: 'user' as const,
          ownerId: userId,
          scopeKind: 'application' as const,
          scopeId: 'application',
        });
  }

  const tenantId = canonicalIdentifier(input.tenantId, 'tenantId');
  return Object.freeze(input.choice === 'organization'
    ? {
        ownerKind: 'organization' as const,
        ownerId: tenantId,
        scopeKind: 'tenant' as const,
        scopeId: tenantId,
      }
    : {
        ownerKind: 'user' as const,
        ownerId: userId,
        scopeKind: 'tenant' as const,
        scopeId: tenantId,
      });
}

function canonicalIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Storage Studio ${label} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 256) {
    throw new Error(`Storage Studio ${label} must contain 1-256 characters.`);
  }
  return normalized;
}
