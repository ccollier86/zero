'use client';

/** Compact storage ACL row shared by drive and exact-object editors. */

import { Shield, User, Users } from 'lucide-react';
import type { PermissionRecord } from '../../storage/types';
import { AnimateIcon } from '../animate-ui/icons/icon';
import { Trash } from '../animate-ui/icons/trash';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

export function StoragePermissionRow({
  permission,
  scopeLabel,
  disabled = false,
  onRevoke,
}: {
  readonly permission: PermissionRecord;
  readonly scopeLabel?: string;
  readonly disabled?: boolean;
  readonly onRevoke?: (permission: PermissionRecord) => void;
}) {
  const Icon = permission.grant_type === 'user'
    ? User
    : permission.grant_type === 'property'
      ? Shield
      : Users;
  return (
    <div data-slot="storage-permission-row" className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-sm">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground" title={permission.grant_type}>
        <Icon className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={permission.grant_key ? `${permission.grant_key} = ${permission.grant_value}` : permission.grant_value}>
          {permission.grant_key ? `${permission.grant_key} = ` : ''}{permission.grant_value}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          <span className="capitalize">{permission.grant_type}</span>{scopeLabel && <> · {scopeLabel}</>}
        </div>
      </div>
      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[11px] capitalize">{permission.permission}</Badge>
      {onRevoke && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={disabled}
          aria-label={`Revoke ${permission.permission} access for ${permission.grant_key ? `${permission.grant_key} = ` : ''}${permission.grant_value}`}
          title="Revoke access"
          onClick={() => onRevoke(permission)}
        >
          <AnimateIcon animateOnHover><Trash className="size-4" /></AnimateIcon>
        </Button>
      )}
    </div>
  );
}
