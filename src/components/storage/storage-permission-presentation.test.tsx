/** Shared ACL presentation preserves target identity, explicit access and read-only inheritance. */

import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PermissionRecord } from '../../storage/types';
import { StoragePermissionList } from './storage-permission-list';

const role: PermissionRecord = {
  permission_id: 'permission-1', drive_id: 'drive-1', tenant_id: 'organization-a', object_id: null,
  grant_type: 'role', grant_key: null, grant_value: 'organization-admin',
  permission: 'admin', created_at: 1,
};

test('shared grant rows put the target first with compact, distinct access and an identifiable action', () => {
  const html = renderToStaticMarkup(<StoragePermissionList permissions={[role]}
    label="Current drive grants" onRevoke={() => undefined} />);
  expect(html).toContain('data-slot="storage-permission-list"');
  expect(html).toContain('aria-label="Current drive grants"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('max-h-80');
  expect(html).toContain('overflow-y-auto');
  expect(html).toContain('data-slot="storage-permission-row"');
  expect(html).toContain('title="organization-admin"');
  expect(html).toContain('Revoke admin access for organization-admin');
  expect(html).toContain('px-3 py-2');
});

test('inherited rows expose origin and full property targets without a revoke action', () => {
  const property: PermissionRecord = { ...role, permission_id: 'permission-2',
    object_id: 'parent-folder', grant_type: 'property', grant_key: 'department',
    grant_value: 'Engineering & Operations', permission: 'read' };
  const html = renderToStaticMarkup(<StoragePermissionList permissions={[property]}
    label="Inherited grants" scopeLabel={() => 'Parent object'} />);
  expect(html).toContain('department = Engineering &amp; Operations');
  expect(html).toContain('Parent object');
  expect(html).toContain('>property</span>');
  expect(html).not.toContain('Revoke');
  expect(html).not.toContain('<button');
});

test('a busy editable grant disables its revoke control rather than offering another write', () => {
  const html = renderToStaticMarkup(<StoragePermissionList permissions={[role]}
    label="Current drive grants" disabled onRevoke={() => undefined} />);
  expect(html).toContain('disabled=""');
  expect(html).toContain('Revoke admin access for organization-admin');
});
