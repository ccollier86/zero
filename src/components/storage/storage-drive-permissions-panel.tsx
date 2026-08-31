'use client';

/**
 * storage-drive-permissions-panel.tsx
 *
 * Renders storage drive permission grants. This file owns grant form state and
 * permission presentation only; storage policy enforcement lives in backend
 * storage routes and hooks.
 */

import * as React from 'react';
import { Shield, User, Users } from 'lucide-react';
import { toast } from 'sonner';
import { AnimateIcon } from '../animate-ui/icons/icon';
import { Trash } from '../animate-ui/icons/trash';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Separator } from '../ui/separator';
import { cn } from '../../lib/utils';
import {
  useStorageActions,
  useStoragePermissions,
} from '../../storage/storage-hooks';
import type {
  GrantType,
  PermissionLevel,
  PermissionRecord,
} from '../../storage/types';
import type { AuthAdminUserPropertyConfig } from '../../frontend/client/auth-client';
import { reportStorageActionError } from './storage-observability';
import { useStorageAuthConfig } from './use-storage-auth-config';

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
  const { config } = useStorageAuthConfig(canAdmin);
  const actions = useStorageActions();
  const [grantType, setGrantType] = React.useState<GrantType>('role');
  const [grantKey, setGrantKey] = React.useState('');
  const [grantValue, setGrantValue] = React.useState('');
  const [permission, setPermission] = React.useState<PermissionLevel>('read');
  const [busy, setBusy] = React.useState(false);

  const policyProperties = React.useMemo(
    () => Object.values(config?.userProperties ?? {})
      .filter((field) => field.useInPolicies),
    [config],
  );

  const selectedProperty = React.useMemo(
    () => policyProperties.find((field) => field.key === grantKey) ?? null,
    [grantKey, policyProperties],
  );

  React.useEffect(() => {
    if (grantType === 'property' && policyProperties.length > 0 && !grantKey) {
      setGrantKey(policyProperties[0].key);
      setGrantValue('');
    }
    if (grantType !== 'property' && grantKey) {
      setGrantKey('');
    }
  }, [grantKey, grantType, policyProperties]);

  const handleGrantTypeChange = React.useCallback((value: string) => {
    setGrantType(value as GrantType);
    setGrantValue('');
  }, []);

  const handleGrantKeyChange = React.useCallback((key: string) => {
    setGrantKey(key);
    setGrantValue('');
  }, []);

  const handleGrant = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedValue = grantValue.trim();
      if (!trimmedValue) {
        toast.error('Grant value is required');
        return;
      }
      if (grantType === 'property' && !grantKey.trim()) {
        toast.error('Property key is required');
        return;
      }

      setBusy(true);
      try {
        await actions.grantPermission(driveId, {
          grantType,
          grantKey: grantType === 'property' ? grantKey.trim() : undefined,
          grantValue: trimmedValue,
          permission,
        });
        setGrantValue('');
        refresh();
        onChanged?.();
        toast.success('Storage permission granted');
      } catch (err) {
        const normalized = reportStorageActionError('grantPermission', err, {
          driveId,
          grantType,
          grantKey,
        });
        toast.error(normalized.message);
      } finally {
        setBusy(false);
      }
    },
    [actions, driveId, grantKey, grantType, grantValue, onChanged, permission, refresh],
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
      <form className="rounded-lg border border-border/80 bg-card p-4" onSubmit={handleGrant}>
        <div className="mb-4">
          <h3 className="text-sm font-semibold">Add access grant</h3>
          <p className="text-sm text-muted-foreground">
            Grant drive access by role, exact user ID, or a trusted auth property.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[9rem_1fr_10rem_auto]">
          <PermissionField label="Grant type">
            <Select value={grantType} onValueChange={handleGrantTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="role">Role</SelectItem>
                <SelectItem value="user">User ID</SelectItem>
                <SelectItem value="property">User property</SelectItem>
              </SelectContent>
            </Select>
          </PermissionField>

          <PermissionGrantValueField
            grantType={grantType}
            grantKey={grantKey}
            grantValue={grantValue}
            selectedProperty={selectedProperty}
            policyProperties={policyProperties}
            onGrantKeyChange={handleGrantKeyChange}
            onGrantValueChange={setGrantValue}
          />

          <PermissionField label="Permission">
            <Select value={permission} onValueChange={(value) => setPermission(value as PermissionLevel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Read</SelectItem>
                <SelectItem value="write">Write</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </PermissionField>

          <div className="flex items-end">
            <Button type="submit" disabled={busy} className="w-full lg:w-auto">
              {busy ? 'Saving...' : 'Grant'}
            </Button>
          </div>
        </div>
      </form>

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
              <PermissionRow
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

function PermissionGrantValueField({
  grantType,
  grantKey,
  grantValue,
  selectedProperty,
  policyProperties,
  onGrantKeyChange,
  onGrantValueChange,
}: {
  grantType: GrantType;
  grantKey: string;
  grantValue: string;
  selectedProperty: AuthAdminUserPropertyConfig | null;
  policyProperties: AuthAdminUserPropertyConfig[];
  onGrantKeyChange: (key: string) => void;
  onGrantValueChange: (value: string) => void;
}) {
  if (grantType === 'property') {
    const propertyValues = selectedProperty?.values ?? [];
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <PermissionField label="Property key">
          {policyProperties.length > 0 ? (
            <Select value={grantKey} onValueChange={onGrantKeyChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select property" />
              </SelectTrigger>
              <SelectContent>
                {policyProperties.map((field) => (
                  <SelectItem key={field.key} value={field.key}>
                    {field.label ?? field.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={grantKey}
              onChange={(event) => onGrantKeyChange(event.target.value)}
              placeholder="department"
            />
          )}
        </PermissionField>

        <PermissionField label="Property value">
          {propertyValues.length > 0 ? (
            <Select value={grantValue} onValueChange={onGrantValueChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select value" />
              </SelectTrigger>
              <SelectContent>
                {propertyValues.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={grantValue}
              onChange={(event) => onGrantValueChange(event.target.value)}
              placeholder="accounting"
            />
          )}
        </PermissionField>
      </div>
    );
  }

  return (
    <PermissionField label={grantType === 'role' ? 'Role name' : 'User ID'}>
      <Input
        value={grantValue}
        onChange={(event) => onGrantValueChange(event.target.value)}
        placeholder={grantType === 'role' ? 'admin, user, manager' : 'usr_...'}
      />
    </PermissionField>
  );
}

function PermissionRow({
  permission,
  disabled,
  onRevoke,
}: {
  permission: PermissionRecord;
  disabled?: boolean;
  onRevoke: (permission: PermissionRecord) => void;
}) {
  const Icon = permission.grant_type === 'user'
    ? User
    : permission.grant_type === 'property'
      ? Shield
      : Users;

  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium capitalize">{permission.grant_type}</span>
          <Badge variant="outline">{permission.permission}</Badge>
          {permission.object_id && <Badge variant="secondary">Object scoped</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {permission.grant_key ? `${permission.grant_key} = ` : ''}
          {permission.grant_value}
        </div>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled}
        aria-label="Revoke permission"
        onClick={() => onRevoke(permission)}
      >
        <AnimateIcon animateOnHover>
          <Trash className="size-4" />
        </AnimateIcon>
      </Button>
    </div>
  );
}

function PermissionField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
