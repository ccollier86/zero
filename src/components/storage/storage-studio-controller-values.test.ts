import { describe, expect, test } from 'bun:test';
import {
  defaultStorageStudioOwner,
  storageStudioBreadcrumbs,
  storageStudioCatalogFilter,
  storageStudioDriveKey,
  storageStudioLifecycleAction,
  storageObjectPermissionGroups,
} from './storage-studio-controller-values';

describe('Storage Studio controller values', () => {
  test('builds bounded paths and stable human-readable drive keys', () => {
    expect(storageStudioBreadcrumbs('/claims/2026/october')).toEqual([
      { label: 'Root', path: null },
      { label: 'claims', path: 'claims' },
      { label: '2026', path: 'claims/2026' },
      { label: 'october', path: 'claims/2026/october' },
    ]);
    expect(storageStudioDriveKey(' Clinical Intake PDFs ')).toBe('clinical-intake-pdfs');
    expect(storageStudioDriveKey('2026')).toBe('drive');
  });

  test('chooses only server-admitted provisioning owners', () => {
    const base = {
      enabled: true as const,
      scopeKind: 'tenant' as const,
      ownerChoices: ['organization', 'personal'] as const,
      canReadCatalog: true,
      canProvisionOrganization: false,
      canProvisionPersonal: true,
      canManage: false,
      canDelete: false,
      policy: {} as never,
    };
    expect(defaultStorageStudioOwner(base)).toBe('personal');
    expect(defaultStorageStudioOwner({
      ...base,
      canProvisionOrganization: true,
    })).toBe('organization');
  });

  test('maps recovery intent and strips all-value filters', () => {
    expect(storageStudioLifecycleAction('suspended')).toBe('resume');
    expect(storageStudioLifecycleAction('deleted')).toBe('restore');
    expect(storageStudioLifecycleAction('failed')).toBe('retry');
    expect(storageStudioCatalogFilter({
      owner: 'all',
      lifecycle: 'all',
      search: '  invoices ',
    })).toEqual({ search: 'invoices' });
    expect(storageStudioCatalogFilter({
      owner: 'all',
      lifecycle: 'all',
      search: 'x'.repeat(140),
    }).search).toHaveLength(120);
  });

  test('keeps inherited ACLs read-only in the exact-object editor', () => {
    const direct = { permission_id: 'direct', object_id: 'object-one' } as never;
    const parent = { permission_id: 'parent', object_id: 'folder-one' } as never;
    const drive = { permission_id: 'drive', object_id: null } as never;

    expect(storageObjectPermissionGroups([drive, direct, parent], 'object-one')).toEqual({
      direct: [direct],
      inherited: [drive, parent],
    });
  });
});
