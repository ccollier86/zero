'use client';

/**
 * storage-drive-permissions-panel.tsx
 *
 * Renders storage drive permission grants. This file owns grant form state and
 * permission presentation only; storage policy enforcement lives in backend
 * storage routes and hooks.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import {
  useStorageActions,
  useStoragePermissions,
} from '../../storage/storage-hooks';
import type {
  GrantPermissionParams,
  PermissionRecord,
} from '../../storage/types';
import { reportStorageActionError } from './storage-observability';
import { StoragePermissionGrantForm } from './storage-permission-grant-form';
import { StoragePermissionRow } from './storage-permission-row';

export interface StorageDrivePermissionsPanelProps {
  driveId: string;
  canAdmin?: boolean;
  onChanged?: () => void;
}

/** Render drive permission controls for role, user, and auth-property grants. */
export function StorageDrivePermissionsPanel({
  driveId,
  canAdmin = false,
  onChanged,
}: StorageDrivePermissionsPanelProps) {
  const { permissions, loading, error, refresh } = useStoragePermissions(
    canAdmin ? driveId : null,
  );
  const actions = useStorageActions();
  const [busy, setBusy] = React.useState(false);

  const handleGrant = React.useCallback(
    async (grant: Omit<GrantPermissionParams, 'objectPath'>) => {
      setBusy(true);
      try {
        await actions.grantPermission(driveId, grant);
        refresh();
        onChanged?.();
        toast.success('Storage permission granted');
      } catch (err) {
        const normalized = reportStorageActionError('grantPermission', err, {
          driveId,
          grantType: grant.grantType,
          grantKey: grant.grantKey,
        });
        toast.error(normalized.message);
        throw normalized;
      } finally {
        setBusy(false);
      }
    },
    [actions, driveId, onChanged, refresh],
  );

  const revokePermission = React.useCallback(
    async (item: PermissionRecord) => {
      setBusy(true);
      try {
        await actions.revokePermission(item.permission_id);
        refresh();
        onChanged?.();
        toast.success('Storage permission revoked');
      } catch (err) {
        const normalized = reportStorageActionError('revokePermission', err, {
          driveId,
          permissionId: item.permission_id,
        });
        toast.error(normalized.message);
      } finally {
        setBusy(false);
      }
    },
    [actions, driveId, onChanged, refresh],
  );

  if (!canAdmin) {
    return (
      <div className="rounded-md border border-border/80 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
        Storage admin access is required to view and manage permission grants.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <StoragePermissionGrantForm
        title="Add access grant"
        description="Grant drive access by role, exact user ID, or a trusted auth property."
        disabled={busy}
        onGrant={handleGrant}
      />

      <div className="rounded-lg border border-border/80 bg-background">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Current grants</h3>
            <p className="text-sm text-muted-foreground">
              These rules are evaluated after owner, platform admin, and public access.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading || busy}>
            Refresh
          </Button>
        </div>
        <Separator />

        {error && (
          <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading permissions...</div>
        ) : permissions.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No explicit grants yet.</div>
        ) : (
          <div className="divide-y">
            {permissions.map((item) => (
              <StoragePermissionRow
                key={item.permission_id}
                permission={item}
                disabled={busy}
                onRevoke={revokePermission}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
