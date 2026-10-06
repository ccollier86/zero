'use client';

/** Bounded, keyboard-scrollable ACL list shared by drive and object inspectors. */

import type { PermissionRecord } from '../../storage/types';
import { StoragePermissionRow } from './storage-permission-row';

/** Keep long grant lists inside their inspector instead of stretching the workspace. */
export function StoragePermissionList({
  permissions,
  label,
  scopeLabel,
  disabled,
  onRevoke,
}: {
  readonly permissions: readonly PermissionRecord[];
  readonly label: string;
  readonly scopeLabel?: (permission: PermissionRecord) => string;
  readonly disabled?: boolean;
  readonly onRevoke?: (permission: PermissionRecord) => void;
}) {
  return (
    <div data-slot="storage-permission-list" role="region" aria-label={label} tabIndex={0}
      className="max-h-80 min-w-0 overflow-y-auto overscroll-contain divide-y divide-border/70 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50">
      {permissions.map((permission) => (
        <StoragePermissionRow key={permission.permission_id} permission={permission}
          scopeLabel={scopeLabel?.(permission)} disabled={disabled} onRevoke={onRevoke} />
      ))}
    </div>
  );
}
