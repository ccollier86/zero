/**
 * storage-studio-controller-values.ts
 *
 * Pure view-model helpers shared by the native Storage Studio controller.
 * This module performs no React work, transport, mutation, or rendering.
 */

import type { StorageStudioCapabilities } from '../../storage/storage-studio-contracts';
import type { PermissionRecord } from '../../storage/types';
import type {
  StorageStudioBreadcrumb,
  StorageStudioLifecycleFilter,
  StorageStudioOwnerFilter,
} from './storage-management-controller';

export function storageStudioBreadcrumbs(path: string | null): readonly StorageStudioBreadcrumb[] {
  const segments = (path ?? '').split('/').filter(Boolean);
  const breadcrumbs: StorageStudioBreadcrumb[] = [{ label: 'Root', path: null }];
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    breadcrumbs.push(Object.freeze({ label: segment, path: current }));
  }
  return Object.freeze(breadcrumbs);
}

export function defaultStorageStudioOwner(
  capabilities: StorageStudioCapabilities,
): 'organization' | 'personal' | null {
  if (capabilities.canProvisionOrganization
    && capabilities.ownerChoices.includes('organization')) return 'organization';
  if (capabilities.canProvisionPersonal
    && capabilities.ownerChoices.includes('personal')) return 'personal';
  return null;
}

export function storageStudioDriveKey(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100);
  if (/^[a-z]/u.test(normalized)) return normalized;
  const suffix = normalized.replace(/^[^a-z]+/u, '').slice(0, 94);
  return suffix ? `drive-${suffix}` : 'drive';
}

export function storageStudioLifecycleAction(
  lifecycle: string,
): 'resume' | 'restore' | 'retry' {
  if (lifecycle === 'suspended') return 'resume';
  if (lifecycle === 'deleted') return 'restore';
  return 'retry';
}

export function storageStudioCatalogFilter(input: {
  readonly owner: StorageStudioOwnerFilter;
  readonly lifecycle: StorageStudioLifecycleFilter;
  readonly search: string;
}): Readonly<{
  owner?: 'organization' | 'personal';
  lifecycle?: Exclude<StorageStudioLifecycleFilter, 'all'>;
  search?: string;
}> {
  const search = input.search.trim().slice(0, 120);
  return Object.freeze({
    ...(input.owner === 'all' ? {} : { owner: input.owner }),
    ...(input.lifecycle === 'all' ? {} : { lifecycle: input.lifecycle }),
    ...(search ? { search } : {}),
  });
}

/** Separate exact-object grants from inherited drive/ancestor grants. */
export function storageObjectPermissionGroups(
  permissions: readonly PermissionRecord[],
  objectId: string,
): Readonly<{
  direct: readonly PermissionRecord[];
  inherited: readonly PermissionRecord[];
}> {
  return Object.freeze({
    direct: Object.freeze(permissions.filter((permission) => permission.object_id === objectId)),
    inherited: Object.freeze(permissions.filter((permission) => permission.object_id !== objectId)),
  });
}
