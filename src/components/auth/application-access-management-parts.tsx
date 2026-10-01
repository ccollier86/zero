'use client';

import type {
  AuthApplicationRoleDescriptor,
  AuthApplicationUser,
} from '../../frontend/client/auth-application-administration-types';
import { Button } from '#zero/components/ui/button';
import { Checkbox } from '#zero/components/ui/checkbox';
import { cn } from '#zero/lib/utils';

export function ApplicationRoleEditor({
  user,
  roles,
  draftRoles,
  busy,
  canTransferOwnership,
  roleSelectionChanged,
  rolePanelId,
  onChange,
  onSave,
}: {
  user: AuthApplicationUser;
  roles: readonly AuthApplicationRoleDescriptor[];
  draftRoles: readonly string[];
  busy: boolean;
  canTransferOwnership: boolean;
  roleSelectionChanged: boolean;
  rolePanelId: string;
  onChange(roles: string[]): void;
  onSave(): void;
}) {
  const declaredRoleKeys = new Set(roles.map((role) => role.key));
  const retiredRoles = user.roles.filter((role) => (
    role !== 'owner' && !declaredRoleKeys.has(role)
  ));
  const retainedRetiredRoles = retiredRoles.filter((role) => draftRoles.includes(role));
  const retiredRolesRequireOwner = retiredRoles.length > 0 && !canTransferOwnership;

  return (
    <section id={rolePanelId} aria-labelledby={`${rolePanelId}-heading`} className="rounded-md border border-border/80 bg-muted/20 p-4">
      <h3 id={`${rolePanelId}-heading`} className="text-sm font-semibold">
        Roles for {applicationUserName(user)}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Select roles within your authority ceiling. Existing higher-authority roles
        remain visible but locked.
      </p>
      {user.roles.includes('owner') && (
        <p className="mt-2 text-xs text-muted-foreground">
          Ownership is protected and can move only through the transfer action.
        </p>
      )}
      {retiredRoles.length > 0 && (
        <p role="status" className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          This user has a retired role that grants no permissions.
          {retiredRolesRequireOwner
            ? ' An application owner must remove it before other role changes can be saved.'
            : ' Remove every retired role before changing declared roles.'}
        </p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {roles.map((role) => {
          const checked = draftRoles.includes(role.key);
          const disabled = busy
            || !role.grantable
            || retiredRolesRequireOwner
            || (user.status !== 'active' && !checked);
          return (
            <label
              key={role.key}
              className={cn(
                'flex items-start gap-2 rounded-md border bg-background p-3 text-sm',
                disabled && 'opacity-65',
              )}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => onChange(
                  value
                    ? [...new Set([...draftRoles, role.key])]
                    : draftRoles.filter((item) => item !== role.key),
                )}
                aria-label={`${checked ? 'Remove' : 'Assign'} ${role.label}`}
              />
              <span>
                <span className="block font-medium">
                  {role.label}{!role.grantable && checked ? ' (locked)' : ''}
                </span>
                {role.description && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {role.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
        {retiredRoles.map((roleKey) => {
          const checked = draftRoles.includes(roleKey);
          const disabled = busy || !canTransferOwnership;
          return (
            <label
              key={roleKey}
              className={cn(
                'flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm',
                disabled && 'opacity-65',
              )}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => onChange(
                  value
                    ? [...new Set([...draftRoles, roleKey])]
                    : draftRoles.filter((item) => item !== roleKey),
                )}
                aria-label={`${checked ? 'Remove' : 'Retain'} retired role ${roleKey}`}
              />
              <span>
                <span className="block font-medium">{roleKey} (retired)</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  This role is no longer declared and grants no permissions.
                  {disabled ? ' Only an application owner can remove it.' : ''}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {roles.length === 0 && retiredRoles.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No assignable application roles are configured.
        </p>
      )}
      <Button
        className="mt-3"
        size="sm"
        onClick={onSave}
        disabled={busy
          || !roleSelectionChanged
          || retiredRolesRequireOwner
          || retainedRetiredRoles.length > 0}
      >
        {busy ? 'Saving…' : 'Save roles'}
      </Button>
    </section>
  );
}

export function applicationUserName(user: AuthApplicationUser): string {
  const full = [user.identity.firstName, user.identity.lastName].filter(Boolean).join(' ');
  return full || user.identity.username;
}
