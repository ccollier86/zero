'use client';

/** Exact-object ACL editor with inherited grants rendered read-only. */

import * as React from 'react';
import { toast } from 'sonner';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type {
  FileInfo,
  GrantPermissionParams,
  PermissionRecord,
  StorageAccessCapabilities,
} from '../../storage/types';
import {
  useStorageActions,
  useStoragePermissions,
} from '../../storage/storage-hooks';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { reportStorageActionError } from './storage-observability';
import { storageObjectPermissionGroups } from './storage-studio-controller-values';
import { StoragePermissionGrantForm } from './storage-permission-grant-form';
import { StoragePermissionList } from './storage-permission-list';
import { useStoragePermissionOperationSession } from './use-storage-permission-operation-session';

export interface StorageObjectPermissionsPanelProps {
  readonly driveId: string;
  readonly file: FileInfo;
  readonly access: StorageAccessCapabilities | null;
  readonly onChanged?: () => void;
}

/** Manage only grants bound to `file`; inherited grants cannot be revoked here. */
export function StorageObjectPermissionsPanel({
  driveId,
  file,
  access,
  onChanged,
}: StorageObjectPermissionsPanelProps) {
  const canAdmin = access?.canAdmin === true;
  const { permissions, loading, error, refresh } = useStoragePermissions(
    canAdmin ? driveId : null,
    canAdmin ? file.path : undefined,
  );
  const actions = useStorageActions();
  const session = useStoragePermissionOperationSession({ targetKey: JSON.stringify([driveId, file.id, file.path]),
    canAdmin, boundary: useAuthorizationScopeBoundary() });
  const busy = session.busy;
  const { direct, inherited } = React.useMemo(
    () => storageObjectPermissionGroups(permissions, file.id),
    [file.id, permissions],
  );

  const grant = React.useCallback(async (
    value: Omit<GrantPermissionParams, 'objectPath'>,
  ) => {
    const ticket = session.begin();
    if (!ticket) throw new Error('This permission editor cannot start another operation right now.');
    try {
      await actions.grantPermission(driveId, { ...value, objectPath: file.path });
      if (!ticket.isCurrent()) return;
      refresh();
      ticket.notifyChanged(onChanged);
      if (ticket.isCurrent()) toast.success('Object permission granted');
    } catch (cause) {
      const normalized = reportStorageActionError('grantObjectPermission', cause, {
        driveId,
        objectId: file.id,
        objectType: file.type,
      });
      if (ticket.isCurrent()) toast.error(normalized.message);
      throw normalized;
    } finally {
      ticket.finish();
    }
  }, [actions, driveId, file.id, file.path, file.type, onChanged, refresh, session.begin]);

  const revoke = React.useCallback(async (permission: PermissionRecord) => {
    if (permission.object_id !== file.id) return;
    const ticket = session.begin();
    if (!ticket) return;
    try {
      await actions.revokePermission(permission.permission_id);
      if (!ticket.isCurrent()) return;
      refresh();
      ticket.notifyChanged(onChanged);
      if (ticket.isCurrent()) toast.success('Object permission revoked');
    } catch (cause) {
      const normalized = reportStorageActionError('revokeObjectPermission', cause, {
        driveId,
        objectId: file.id,
        permissionId: permission.permission_id,
      });
      if (ticket.isCurrent()) toast.error(normalized.message);
    } finally {
      ticket.finish();
    }
  }, [actions, driveId, file.id, onChanged, refresh, session.begin]);

  return (
    <div className="min-w-0 space-y-3">
      <EffectiveObjectAccess access={access} />
      {!canAdmin ? (
        <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          Storage admin access is required to inspect or change this object&apos;s grants.
        </div>
      ) : (
        <>
          <StoragePermissionGrantForm
            key={session.key}
            title="Add object grant"
            description={file.type === 'folder'
              ? 'Grant access to this folder and its descendants. Parent and drive grants remain unchanged.'
              : 'Grant access to this file only. Parent and drive grants remain unchanged.'}
            disabled={busy}
            onGrant={grant}
          />
          <PermissionGroup
            title="Direct grants"
              description={file.type === 'folder'
                ? 'These grants originate on this folder, apply to its descendants, and can be revoked here.'
                : 'These grants are bound to this exact file and can be revoked here.'}
            permissions={direct}
            empty="No grants are bound directly to this object."
            loading={loading}
            error={error}
            busy={busy}
            onRefresh={refresh}
            onRevoke={revoke}
          />
          {inherited.length > 0 && (
            <PermissionGroup
              title="Inherited grants"
              description="Drive and parent-folder grants apply here but must be managed at their source."
              permissions={inherited}
              empty=""
              loading={false}
              error={null}
              busy={busy}
              onRefresh={refresh}
            />
          )}
        </>
      )}
    </div>
  );
}

function EffectiveObjectAccess({ access }: { access: StorageAccessCapabilities | null }) {
  const values = [
    ['Read', access?.canRead === true],
    ['Write', access?.canWrite === true],
    ['Admin', access?.canAdmin === true],
    ['Public', access?.isPublic === true],
  ] as const;
  return (
    <section>
      <h3 className="text-sm font-semibold">Effective access</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Resolved from ownership, public access, and hierarchical grants.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {values.map(([label, enabled]) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-border/80 px-3 py-2 text-xs">
            <span>{label}</span>
            <span className={enabled ? 'font-medium text-success' : 'text-muted-foreground'}>
              {enabled ? 'Allowed' : 'No'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PermissionGroup({
  title,
  description,
  permissions,
  empty,
  loading,
  error,
  busy,
  onRefresh,
  onRevoke,
}: {
  title: string;
  description: string;
  permissions: readonly PermissionRecord[];
  empty: string;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onRefresh: () => void;
  onRevoke?: (permission: PermissionRecord) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/80 bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading || busy}>Refresh</Button>
      </div>
      <Separator />
      {error ? (
        <p role="alert" className="m-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : loading ? (
        <p className="p-4 text-sm text-muted-foreground">Loading permissions…</p>
      ) : permissions.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <StoragePermissionList permissions={permissions} label={title} disabled={busy}
          scopeLabel={(permission) => onRevoke ? 'This object' : permission.object_id ? 'Parent object' : 'Drive'} onRevoke={onRevoke} />
      )}
    </section>
  );
}
