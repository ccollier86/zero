'use client';

import type { AuthRoleAccessPresentation } from './auth-role-presentation';
import { Badge } from '#zero/components/ui/badge';

export interface TenantMemberAccessSummaryProps {
  access: AuthRoleAccessPresentation;
  tenantSingular: string;
  headingId: string;
}

/** Compact, read-only explanation of one membership's resulting authority. */
export function TenantMemberAccessSummary({
  access,
  tenantSingular,
  headingId,
}: TenantMemberAccessSummaryProps) {
  const hasRetiredRole = access.assignedRoles.some((role) => role.retired);
  return (
    <section className="border-t border-border/70 pt-4" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold">
        {capitalize(tenantSingular)} access
      </h3>
      <p className="mt-2 text-xs font-medium text-muted-foreground">Assigned roles</p>
      {access.assignedRoles.length > 0 ? (
        <ul aria-label="Assigned roles" className="mt-1.5 flex flex-wrap gap-1.5">
          {access.assignedRoles.map((role) => (
            <li key={role.key}>
              <Badge
                variant="outline"
                className={role.retired ? 'border-warning/50 text-muted-foreground' : undefined}
              >
                {role.label}{role.retired ? ' (retired)' : ''}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No roles assigned</p>
      )}
      <p className="mt-3 text-xs font-medium text-muted-foreground">
        Effective permissions
      </p>
      {access.allPermissions ? (
        <p className="mt-1 text-xs">All permissions</p>
      ) : access.permissions.length > 0 ? (
        <ul aria-label="Effective permissions" className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {access.permissions.map((permission) => (
            <li key={permission} className="font-mono text-[11px] text-muted-foreground">
              {permission}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No permissions granted</p>
      )}
      {hasRetiredRole && (
        <p className="mt-2 text-xs text-muted-foreground">
          Retired roles remain visible for cleanup and grant no permissions.
        </p>
      )}
    </section>
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
