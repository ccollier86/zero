'use client';

/**
 * user-management-toolbar.tsx
 *
 * Composes readiness, load errors, filters, and backend page controls above the
 * user list. It does not own user mutations or detail rendering.
 */

import { Button } from '../../ui/button';
import type { AuthAdminConfig } from '../../../frontend/client/auth-client';
import { getAdminUserPageWindow } from './user-management-pagination';
import { UserManagementListControls } from './user-management-list-controls';
import { UserManagementReadiness } from './user-management-readiness';
import type { UseAdminUsersResult, UserRoleOption } from './user-management-types';

/** Render config readiness and self-wired list controls. */
export function UserManagementToolbar({
  controlled,
  config,
  live,
  roleOptions,
  roleFieldLabel,
}: {
  controlled: boolean;
  config: AuthAdminConfig | null;
  live: UseAdminUsersResult;
  roleOptions: readonly UserRoleOption[];
  roleFieldLabel: string;
}) {
  const page = getAdminUserPageWindow(live.page);
  return (
    <>
      {live.error && (
        <div
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <span className="min-w-0">{live.error}</span>
          <Button size="sm" variant="outline" onClick={() => void live.reload().catch(() => {})}>
            Retry
          </Button>
        </div>
      )}
      <UserManagementReadiness config={config} loading={live.isLoading} />
      {!controlled && (
        <UserManagementListControls
          filters={live.filters}
          page={live.page}
          roleOptions={roleOptions}
          roleFieldLabel={roleFieldLabel}
          isLoading={live.isLoading}
          onSearchChange={live.setSearch}
          onRoleChange={live.setRole}
          onStatusChange={live.setStatus}
          onPreviousPage={() => void live.loadPage(page.previousOffset).catch(() => {})}
          onNextPage={() => page.nextOffset !== null
            && void live.loadPage(page.nextOffset).catch(() => {})}
          onRefresh={() => void live.reload().catch(() => {})}
        />
      )}
    </>
  );
}
