'use client';

import * as React from 'react';
import { useAuth, useAuthConfig } from '../../../frontend/client/auth-hooks';
import { useAuthorization } from '../../../frontend/client/authorization-hooks';
import { hasAuthorizationPermission } from '../../../frontend/client/auth-authorization-types';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import { IdentityUserManagement } from './user-management';
import { PlatformWorkspaceUserManagement } from './platform-workspace-user-management';
import type { UserManagementProps } from './user-management-props';
import {
  resolvePlatformManagementNavigation,
  resolvePlatformUserManagementMode,
} from './platform-user-management-mode';
import { SingleAdvancedUserManagement } from './single-advanced-user-management';
import { TenantScopedUserManagement } from './tenant-scoped-user-management';
import {
  UserManagementControlBar,
  type PlatformManagementView,
  type PlatformPeopleScope,
} from './user-management-control-bar';

export type { UserManagementProps } from './user-management-props';

/**
 * Zero's adaptive people/access control plane. Single/simple and controlled
 * callers keep the established identity manager; richer auth profiles add
 * their access context inside the same bounded workspace.
 */
export function UserManagement(props: UserManagementProps) {
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const mode = resolvePlatformUserManagementMode({
    controlled: props.data !== undefined,
    configStatus: authConfig.status,
    tenancyMode: authConfig.config?.tenancy?.mode,
    authorizationMode: authConfig.config?.authorization?.mode,
    activeTenantKind: auth.activeTenant?.kind ?? null,
  });

  if (mode === 'identity') return <IdentityUserManagement {...props} />;
  if (mode === 'single-advanced') {
    return (
      <SingleAdvancedUserManagement
        {...props}
        onActorAuthorizationChanged={props.onActorAuthorizationChanged}
      />
    );
  }
  if (mode === 'organization') {
    return (
      <TenantScopedUserManagement
        className={props.className}
        pageSize={props.pageSize}
        onActorSessionInvalidated={props.onActorSessionInvalidated}
        detailContent={props.additionalTenantMemberDetailContent}
        navigationActions={props.additionalTenantMemberNavigationActions}
        onSelectedMemberChange={props.onSelectedTenantMemberChange}
      />
    );
  }
  if (mode === 'platform') {
    return (
      <PlatformAdministrationControlPlane
        {...props}
        administrationName={auth.activeTenant?.name ?? 'Administration organization'}
        workspaceSingular={authConfig.config?.tenancy?.terminology?.singular ?? 'organization'}
        workspacePlural={authConfig.config?.tenancy?.terminology?.plural ?? 'organizations'}
      />
    );
  }

  return (
    <UserManagementState
      loading={mode === 'loading'}
      error={authConfig.error}
      onRetry={() => { void authConfig.reload(); }}
      className={props.className}
    />
  );
}

/** Explicit name retained for platform-oriented call sites. */
export const PlatformUserManagement = UserManagement;

function PlatformAdministrationControlPlane({
  administrationName,
  workspaceSingular,
  workspacePlural,
  defaultManagementView = 'people',
  defaultPeopleScope = 'administration',
  className,
  ...identityProps
}: UserManagementProps & {
  administrationName: string;
  workspaceSingular: string;
  workspacePlural: string;
}) {
  const authorization = useAuthorization();
  const [view, setView] = React.useState<PlatformManagementView>(defaultManagementView);
  const [peopleScope, setPeopleScope] = React.useState<PlatformPeopleScope>(defaultPeopleScope);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState<string | null>(null);
  const { canReadIdentities, canOpenWorkspaceControlPlane } =
    resolvePlatformManagementNavigation({
      ready: authorization.isReady,
      hasPermission: (permission) => hasAuthorizationPermission(
        authorization.authorization,
        permission,
      ),
    });
  const visibleView = view === 'workspaces' && !canOpenWorkspaceControlPlane ? 'people' : view;
  const visiblePeopleScope = peopleScope === 'identities' && !canReadIdentities
    ? 'administration'
    : peopleScope;

  return (
    <section className={cn('flex h-full min-h-[32rem] flex-col gap-3', className)}>
      <UserManagementControlBar
        view={visibleView}
        peopleScope={visiblePeopleScope}
        administrationName={administrationName}
        workspaceSingular={workspaceSingular}
        workspacePlural={workspacePlural}
        showWorkspaces={canOpenWorkspaceControlPlane}
        showIdentities={canReadIdentities}
        onViewChange={setView}
        onPeopleScopeChange={setPeopleScope}
      />

      <div className="min-h-0 flex-1">
        {visibleView === 'workspaces' ? (
          <PlatformWorkspaceUserManagement
            className="h-full"
            pageSize={identityProps.pageSize}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelectedWorkspaceIdChange={setSelectedWorkspaceId}
            memberDetailContent={identityProps.additionalTenantMemberDetailContent}
            memberNavigationActions={identityProps.additionalTenantMemberNavigationActions}
            onSelectedMemberChange={identityProps.onSelectedTenantMemberChange}
          />
        ) : visiblePeopleScope === 'administration' ? (
          <TenantScopedUserManagement
            className="h-full"
            pageSize={identityProps.pageSize}
            title={`${administrationName} people`}
            description="Manage administrator membership, roles, and account access from one people workspace."
            onActorSessionInvalidated={identityProps.onActorSessionInvalidated}
            detailContent={identityProps.additionalTenantMemberDetailContent}
            navigationActions={identityProps.additionalTenantMemberNavigationActions}
            onSelectedMemberChange={identityProps.onSelectedTenantMemberChange}
          />
        ) : (
          <IdentityUserManagement
            {...identityProps}
            className="h-full"
            accountEditMode="dialog"
          />
        )}
      </div>
    </section>
  );
}

function UserManagementState({
  loading,
  error,
  onRetry,
  className,
}: {
  loading: boolean;
  error: string | null;
  onRetry(): void;
  className?: string;
}) {
  return (
    <div className={cn(
      'flex min-h-[32rem] items-center justify-center rounded-lg border border-dashed bg-background p-6',
      className,
    )}>
      <div className="max-w-md text-center text-sm text-muted-foreground">
        <p>{loading
          ? 'Loading account and organization controls…'
          : error ?? 'Choose an organization before managing its people and access.'}</p>
        {!loading && error && (
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
