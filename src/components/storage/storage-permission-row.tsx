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
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium capitalize">{permission.grant_type}</span>
          <Badge variant="outline">{permission.permission}</Badge>
          {scopeLabel && <Badge variant="secondary">{scopeLabel}</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {permission.grant_key ? `${permission.grant_key} = ` : ''}
          {permission.grant_value}
        </div>
      </div>
      {onRevoke && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={disabled}
          aria-label="Revoke permission"
          onClick={() => onRevoke(permission)}
        >
          <AnimateIcon animateOnHover><Trash className="size-4" /></AnimateIcon>
        </Button>
      )}
    </div>
  );
}
