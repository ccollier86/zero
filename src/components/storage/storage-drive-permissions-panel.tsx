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
import { RefreshCw } from 'lucide-react';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
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
import { StoragePermissionList } from './storage-permission-list';
import { useStoragePermissionOperationSession } from './use-storage-permission-operation-session';

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
  const session = useStoragePermissionOperationSession({ targetKey: driveId, canAdmin,
    boundary: useAuthorizationScopeBoundary() });
  const busy = session.busy;

  const handleGrant = React.useCallback(
    async (grant: Omit<GrantPermissionParams, 'objectPath'>) => {
      const ticket = session.begin();
      if (!ticket) throw new Error('This permission editor cannot start another operation right now.');
      try {
        await actions.grantPermission(driveId, grant);
        if (!ticket.isCurrent()) return;
        refresh();
        ticket.notifyChanged(onChanged);
        if (ticket.isCurrent()) toast.success('Storage permission granted');
      } catch (err) {
        const normalized = reportStorageActionError('grantPermission', err, {
          driveId,
          grantType: grant.grantType,
          grantKey: grant.grantKey,
        });
        if (ticket.isCurrent()) toast.error(normalized.message);
        throw normalized;
      } finally {
        ticket.finish();
      }
    },
    [actions, driveId, onChanged, refresh, session.begin],
  );

  const revokePermission = React.useCallback(
    async (item: PermissionRecord) => {
      const ticket = session.begin();
      if (!ticket) return;
      try {
        await actions.revokePermission(item.permission_id);
        if (!ticket.isCurrent()) return;
        refresh();
        ticket.notifyChanged(onChanged);
        if (ticket.isCurrent()) toast.success('Storage permission revoked');
      } catch (err) {
        const normalized = reportStorageActionError('revokePermission', err, {
          driveId,
          permissionId: item.permission_id,
        });
        if (ticket.isCurrent()) toast.error(normalized.message);
      } finally {
        ticket.finish();
      }
    },
    [actions, driveId, onChanged, refresh, session.begin],
  );

  if (!canAdmin) {
    return (
      <div className="rounded-md border border-border/80 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
        Storage admin access is required to view and manage permission grants.
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <StoragePermissionGrantForm
        key={session.key}
        title="Add access grant"
        description="Choose who can access this drive and what they can do."
        disabled={busy}
        onGrant={handleGrant}
      />

      <div className="min-w-0 overflow-hidden rounded-lg border border-border/80 bg-background">
        <div className="flex items-start justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Current grants {!loading && <span className="ml-1 text-xs font-normal text-muted-foreground">({permissions.length})</span>}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Explicit access. Ownership, platform access, and public access still apply.
            </p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Refresh grants" title="Refresh grants" onClick={refresh} disabled={loading || busy} className="shrink-0">
            <RefreshCw className="size-3.5" aria-hidden="true" />
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
          <StoragePermissionList permissions={permissions} label="Current drive grants" disabled={busy} onRevoke={revokePermission} />
        )}
      </div>
    </div>
  );
}
