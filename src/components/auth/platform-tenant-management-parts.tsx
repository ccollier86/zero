'use client';

import * as React from 'react';
import type { AuthTenantMember } from '../../frontend/client/auth-types';
import { Badge } from '#zero/components/ui/badge';
import { authRoleLabel } from './auth-role-presentation';

/** Read-only customer-member rows used by the platform directory drill-in. */
export function PlatformTenantMemberRows({
  members,
  roleLabels,
}: {
  members: readonly AuthTenantMember[];
  roleLabels: ReadonlyMap<string, string>;
}) {
  return (
    <div className="mt-3 divide-y rounded-md border">
      {members.map((member) => (
        <div key={member.membershipId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{memberName(member)}</p>
            <p className="truncate text-xs text-muted-foreground">{member.identity.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{member.status}</Badge>
            {member.roles.map((role) => (
              <Badge key={role} variant="outline">{authRoleLabel(role, roleLabels)}</Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function memberName(member: AuthTenantMember): string {
  return [member.identity.firstName, member.identity.lastName].filter(Boolean).join(' ')
    || member.identity.username;
}
