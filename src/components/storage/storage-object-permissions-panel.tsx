'use client';

/** Exact-object ACL editor with inherited grants rendered read-only. */

import * as React from 'react';
import { toast } from 'sonner';
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
import { StoragePermissionRow } from './storage-permission-row';

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
  const [busy, setBusy] = React.useState(false);
  const { direct, inherited } = React.useMemo(
    () => storageObjectPermissionGroups(permissions, file.id),
    [file.id, permissions],
  );

  const grant = React.useCallback(async (
    value: Omit<GrantPermissionParams, 'objectPath'>,
  ) => {
    setBusy(true);
    try {
      await actions.grantPermission(driveId, { ...value, objectPath: file.path });
      refresh();
      onChanged?.();
      toast.success('Object permission granted');
    } catch (cause) {
      const normalized = reportStorageActionError('grantObjectPermission', cause, {
        driveId,
        objectId: file.id,
        objectType: file.type,
      });
      toast.error(normalized.message);
      throw normalized;
    } finally {
      setBusy(false);
    }
  }, [actions, driveId, file.id, file.path, file.type, onChanged, refresh]);

  const revoke = React.useCallback(async (permission: PermissionRecord) => {
    if (permission.object_id !== file.id) return;
    setBusy(true);
    try {
      await actions.revokePermission(permission.permission_id);
      refresh();
      onChanged?.();
      toast.success('Object permission revoked');
    } catch (cause) {
      const normalized = reportStorageActionError('revokeObjectPermission', cause, {
        driveId,
        objectId: file.id,
        permissionId: permission.permission_id,
      });
      toast.error(normalized.message);
    } finally {
      setBusy(false);
    }
  }, [actions, driveId, file.id, onChanged, refresh]);

  return (
    <div className="space-y-5">
      <EffectiveObjectAccess access={access} />
      {!canAdmin ? (
        <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          Storage admin access is required to inspect or change this object&apos;s grants.
        </div>
      ) : (
        <>
          <StoragePermissionGrantForm
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
        <div className="divide-y divide-border/80">
          {permissions.map((permission) => (
            <StoragePermissionRow
              key={permission.permission_id}
              permission={permission}
              scopeLabel={onRevoke ? 'This object' : permission.object_id ? 'Parent object' : 'Drive'}
              disabled={busy}
              onRevoke={onRevoke}
            />
          ))}
        </div>
      )}
    </section>
  );
}
