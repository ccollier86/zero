'use client';

import type {
  AuthTenantMember,
  AuthTenantRoleDescriptor,
} from '../../frontend/client/auth-types';
import { Button } from '#zero/components/ui/button';
import { Checkbox } from '#zero/components/ui/checkbox';
import { cn } from '#zero/lib/utils';
import { tenantMemberName } from './tenant-member-management-parts';
import { TenantRolePicker } from './tenant-role-picker';

export function TenantMemberRoleEditor({
  member,
  declaredRoles,
  assignableRoles,
  simple,
  draftRoles,
  busy,
  canTransferOwnership,
  requireAtLeastOneRole = false,
  tenantSingular,
  rolePanelId,
  roleSelectionChanged,
  onChange,
  onSave,
}: {
  member: AuthTenantMember;
  declaredRoles: readonly AuthTenantRoleDescriptor[];
  assignableRoles: readonly AuthTenantRoleDescriptor[];
  simple: boolean;
  draftRoles: readonly string[];
  busy: boolean;
  canTransferOwnership: boolean;
  requireAtLeastOneRole?: boolean;
  tenantSingular: string;
  rolePanelId: string;
  roleSelectionChanged: boolean;
  onChange(roles: string[]): void;
  onSave(): void;
}) {
  const displayedRoleChoices = projectTenantMemberRoleChoices(
    assignableRoles,
    member.roles,
    simple,
  );
  const lockedAssignedRoles = assignedRolesAboveGrantCeiling(
    assignableRoles,
    member.roles,
  );
  const assignableRoleKeys = new Set(assignableRoles.map((role) => role.key));
  const declaredRolesByKey = new Map(declaredRoles.map((role) => [role.key, role]));
  const declaredRoleKeys = new Set(declaredRoles.map((role) => role.key));
  const retiredRoles = member.roles.filter((role) => (
    role !== 'owner' && !declaredRoleKeys.has(role)
  ));
  const outOfScopeRoles = member.roles.filter((roleKey) => {
    const role = declaredRolesByKey.get(roleKey);
    return roleKey !== 'owner'
      && role !== undefined
      && !role.system
      && !assignableRoleKeys.has(roleKey);
  });
  const retainedRetiredRoles = retiredRoles.filter((role) => draftRoles.includes(role));
  const retainedOutOfScopeRoles = outOfScopeRoles.filter((role) => (
    draftRoles.includes(role)
  ));
  const retiredRolesRequireOwner = retiredRoles.length > 0 && !canTransferOwnership;
  const outOfScopeRolesRequireOwner = outOfScopeRoles.length > 0
    && !canTransferOwnership;

  return (
    <section id={rolePanelId} aria-labelledby={`${rolePanelId}-heading`} className="rounded-md border border-border/80 bg-muted/20 p-4">
      <h3 id={`${rolePanelId}-heading`} className="text-sm font-semibold">
        Roles for {tenantMemberName(member)}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {simple
          ? `Choose the member’s single ${tenantSingular} role.`
          : 'Choose the roles within your own authority ceiling.'}
      </p>
      {retiredRoles.length > 0 && (
        <p role="status" className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          This member has a retired role that grants no permissions.
          {retiredRolesRequireOwner
            ? ` The ${tenantSingular} owner must remove it before other role changes can be saved.`
            : ' Remove every retired role before changing declared roles.'}
        </p>
      )}
      {lockedAssignedRoles.length > 0 && (
        <p role="status" className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          This member&apos;s current role is above your assignment ceiling. An
          authorized {tenantSingular} manager must change it.
        </p>
      )}
      {outOfScopeRoles.length > 0 && (
        <p role="status" className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          This member has a declared role that is not valid in this organization.
          It grants no authority here and must be removed before other role changes
          can be saved.
          {outOfScopeRolesRequireOwner
            ? ` Only the ${tenantSingular} owner can remove it.`
            : ''}
        </p>
      )}
      {simple ? (
        <div className="mt-3">
          <TenantRolePicker
            roles={displayedRoleChoices}
            selected={draftRoles.filter((role) => assignableRoleKeys.has(role))}
            simple
            disabled={busy
              || retainedRetiredRoles.length > 0
              || retainedOutOfScopeRoles.length > 0
              || lockedAssignedRoles.length > 0}
            legend={`Member ${tenantSingular} role`}
            selectLabel={`${capitalize(tenantSingular)} role for ${tenantMemberName(member)}`}
            selectPlaceholder={`Choose ${tenantSingular} role`}
            actionContext={`for ${tenantMemberName(member)}`}
            onChange={(nextRoles) => onChange([
              ...draftRoles.filter((role) => !assignableRoleKeys.has(role)),
              ...nextRoles,
            ])}
          />
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {displayedRoleChoices.map((role) => {
            const checked = draftRoles.includes(role.key);
            const disabled = busy
              || !role.grantable
              || retainedRetiredRoles.length > 0
              || retainedOutOfScopeRoles.length > 0;
            return (
              <label key={role.key} className={cn(
                'flex items-start gap-2 rounded-md border bg-background p-3 text-sm',
                disabled && 'opacity-65',
              )}>
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
        </div>
      )}
      {retiredRoles.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {retiredRoles.map((roleKey) => {
            const checked = draftRoles.includes(roleKey);
            const disabled = busy || !canTransferOwnership;
            return (
              <label key={roleKey} className={cn(
                'flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm',
                disabled && 'opacity-65',
              )}>
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
                    {disabled ? ` Only the ${tenantSingular} owner can remove it.` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {outOfScopeRoles.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {outOfScopeRoles.map((roleKey) => {
            const role = declaredRolesByKey.get(roleKey)!;
            const checked = draftRoles.includes(roleKey);
            const disabled = busy || !canTransferOwnership;
            return (
              <label key={roleKey} className={cn(
                'flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm',
                disabled && 'opacity-65',
              )}>
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(value) => onChange(
                    value
                      ? [...new Set([...draftRoles, roleKey])]
                      : draftRoles.filter((item) => item !== roleKey),
                  )}
                  aria-label={`${checked ? 'Remove' : 'Retain'} invalid ${tenantSingular} role ${role.label}`}
                />
                <span>
                  <span className="block font-medium">{role.label} (not valid here)</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    This declared role cannot be used in {tenantSingular}.
                    {disabled ? ` Only the ${tenantSingular} owner can remove it.` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {displayedRoleChoices.length === 0
        && retiredRoles.length === 0
        && outOfScopeRoles.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No assignable roles are within your current authority.
        </p>
      )}
      <Button
        type="button"
        className="mt-3"
        size="sm"
        onClick={onSave}
        disabled={busy
          || !roleSelectionChanged
          || retiredRolesRequireOwner
          || outOfScopeRolesRequireOwner
          || retainedRetiredRoles.length > 0
          || retainedOutOfScopeRoles.length > 0
          || (simple && lockedAssignedRoles.length > 0)
          || (requireAtLeastOneRole && draftRoles.length === 0)
          || (simple && draftRoles.length !== 1)}
      >
        Save roles
      </Button>
    </section>
  );
}

/**
 * In simple mode, expose only roles the actor may grant. Keep an already
 * assigned above-ceiling role visible so the locked state is understandable.
 */
export function projectTenantMemberRoleChoices(
  roles: readonly AuthTenantRoleDescriptor[],
  assignedRoles: readonly string[],
  simple: boolean,
): AuthTenantRoleDescriptor[] {
  if (!simple) return [...roles];
  const assigned = new Set(assignedRoles);
  return roles.filter((role) => (
    role.key !== 'owner' && (role.grantable || assigned.has(role.key))
  ));
}

/** @internal Declared assigned roles the actor cannot add or remove. */
export function assignedRolesAboveGrantCeiling(
  roles: readonly AuthTenantRoleDescriptor[],
  assignedRoles: readonly string[],
): string[] {
  const assigned = new Set(assignedRoles);
  return roles
    .filter((role) => role.key !== 'owner' && assigned.has(role.key) && !role.grantable)
    .map((role) => role.key);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
