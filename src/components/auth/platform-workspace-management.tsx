'use client';

/**
 * Compact platform workspace directory built on Zero's standard master/detail
 * organism. Data access remains behind the protected platform SDK hook.
 */

import * as React from 'react';
import type {
  AuthPlatformTenantCreateResult,
} from '../../frontend/client/auth-platform-administration-types';
import type { AuthTenantMember, AuthTenantMembershipStatus } from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { usePlatformTenants } from '../../frontend/client/platform-administration-hooks';
import { MasterDetailPage } from '../master-detail';
import type { NavigationAction } from '#zero/components/ui/record-navigation-bar';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
import { AuthConfigLoadState } from './auth-config-load-state';
import { createAuthRoleLabelMap } from './auth-role-presentation';
import {
  PlatformWorkspaceLoadError,
  PlatformWorkspaceReadDenied,
  PlatformWorkspaceUnavailable,
} from './platform-workspace-access-states';
import {
  PlatformWorkspaceDetail,
  PlatformWorkspaceDetailHeader,
} from './platform-workspace-detail';
import {
  resolvePlatformWorkspaceDirectoryError,
  retryPlatformWorkspaceDirectoryError,
} from './platform-workspace-error-routing';
import { PlatformWorkspaceMemberManagement } from './platform-workspace-member-management';
import {
  platformWorkspaceListColumns,
  platformWorkspaceSchema,
  toPlatformWorkspaceRows,
} from './platform-workspace-schema';
import {
  PlatformWorkspaceToolbar,
  type PlatformWorkspaceStatusFilter,
} from './platform-workspace-toolbar';
import {
  boundedPlatformWorkspacePageSize,
  resolvePlatformWorkspaceSelectedId,
  resolvePlatformWorkspaceTerminology,
  type PlatformWorkspaceTerminology,
} from './platform-workspace-policy';
import { usePlatformWorkspaceCreateDialog } from './use-platform-workspace-create-dialog';
import { usePlatformWorkspaceLifecycleActions } from './use-platform-workspace-lifecycle-actions';

export interface PlatformWorkspaceManagementProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
  /** Controlled workspace selection; invalid values are reported through the change callback. */
  selectedWorkspaceId?: string | null;
  /** Called for table, navigation, and create-result selection changes. */
  onSelectedWorkspaceIdChange?: (workspaceId: string | null) => void;
  /** Compose application-account information below selected customer membership access. */
  memberDetailContent?: (member: AuthTenantMember) => React.ReactNode;
  /** Compose application-account operations into the customer-member bottom action bar. */
  memberNavigationActions?: (member: AuthTenantMember | null) => NavigationAction[];
  /** Receives customer-member selection changes for account augmentation. */
  onSelectedMemberChange?: (member: AuthTenantMember | null) => void;
}

type PlatformWorkspacePeopleTriggerRef = Readonly<{
  current: Pick<HTMLButtonElement, 'focus'> | null;
}>;

/** Restore focus through one management instance's exact people trigger. */
export function restorePlatformWorkspacePeopleTriggerFocus(
  triggerRef: PlatformWorkspacePeopleTriggerRef,
): boolean {
  if (!triggerRef.current) return false;
  triggerRef.current.focus();
  return true;
}

/** Customer workspace management for an active administration organization. */
export function PlatformWorkspaceManagement(props: PlatformWorkspaceManagementProps) {
  const authConfig = useAuthConfig();
  const authorizationBoundary = useAuthorizationScopeBoundary();
  const terminology = resolvePlatformWorkspaceTerminology(
    authConfig.config?.tenancy?.terminology,
  );

  return (
    <PlatformWorkspaceManagementScope
      key={authorizationBoundary.key}
      {...props}
      terminology={terminology}
      configState={authConfig}
    />
  );
}

function PlatformWorkspaceManagementScope({
  className,
  pageSize = 25,
  title,
  description,
  selectedWorkspaceId: controlledSelectedId,
  onSelectedWorkspaceIdChange,
  memberDetailContent,
  memberNavigationActions,
  onSelectedMemberChange,
  terminology,
  configState,
}: PlatformWorkspaceManagementProps & {
  terminology: PlatformWorkspaceTerminology;
  configState: ReturnType<typeof useAuthConfig>;
}) {
  const auth = useAuth();
  const controlled = controlledSelectedId !== undefined;
  const [internalSelectedId, setInternalSelectedId] = React.useState<string | null>(null);
  const selectedWorkspaceId = controlled ? controlledSelectedId : internalSelectedId;
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<PlatformWorkspaceStatusFilter>('all');
  const [memberSearchInput, setMemberSearchInput] = React.useState('');
  const [memberSearch, setMemberSearch] = React.useState('');
  const [memberStatus, setMemberStatus] = React.useState<AuthTenantMembershipStatus | 'all'>('all');
  const [memberManagementOpen, setMemberManagementOpen] = React.useState(false);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [pendingCreatedWorkspaceId, setPendingCreatedWorkspaceId] = React.useState<string | null>(null);
  const peopleTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const shouldRestorePeopleTriggerFocus = React.useRef(false);
  const headingId = React.useId();
  const descriptionId = `${headingId}-description`;
  const limit = boundedPlatformWorkspacePageSize(pageSize);
  const directory = usePlatformTenants({
    limit,
    search,
    status: status === 'all' ? undefined : status,
    selectedTenantId: selectedWorkspaceId,
    memberLimit: limit,
    memberSearch,
    memberStatus: memberStatus === 'all'
      ? undefined
      : memberStatus as AuthTenantMembershipStatus,
  });
  const rows = React.useMemo(
    () => toPlatformWorkspaceRows(directory.tenants),
    [directory.tenants],
  );
  const workspaceIds = React.useMemo(
    () => rows.map((workspace) => workspace.tenantId),
    [rows],
  );
  const canResolveSelection = !controlled || onSelectedWorkspaceIdChange !== undefined;
  const resolvedSelectedWorkspaceId = canResolveSelection
    ? resolvePlatformWorkspaceSelectedId(
        selectedWorkspaceId,
        workspaceIds,
        pendingCreatedWorkspaceId,
      )
    : selectedWorkspaceId ?? null;
  const roleLabels = React.useMemo(
    () => createAuthRoleLabelMap(directory.config?.customerRoles ?? []),
    [directory.config?.customerRoles],
  );
  const selectedWorkspace = rows.find((workspace) => (
    workspace.tenantId === resolvedSelectedWorkspaceId
  )) ?? null;
  const capabilities = directory.config?.capabilities;
  const resolvedTitle = title ?? `Customer ${terminology.plural}`;
  const resolvedDescription = description
    ?? `Browse customer ${terminology.plural} and inspect their access.`;
  const directorySurfaceError = resolvePlatformWorkspaceDirectoryError(directory);

  const selectWorkspace = React.useCallback((workspaceId: string | null) => {
    if (workspaceId !== selectedWorkspaceId) setMemberManagementOpen(false);
    if (!controlled) setInternalSelectedId(workspaceId);
    onSelectedWorkspaceIdChange?.(workspaceId);
  }, [controlled, onSelectedWorkspaceIdChange, selectedWorkspaceId]);

  React.useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  React.useEffect(() => {
    const timeout = setTimeout(() => setMemberSearch(memberSearchInput.trim()), 250);
    return () => clearTimeout(timeout);
  }, [memberSearchInput]);

  React.useEffect(() => {
    setMemberSearchInput('');
    setMemberSearch('');
    setMemberStatus('all');
  }, [resolvedSelectedWorkspaceId]);

  React.useEffect(() => {
    if (!selectedWorkspace) setMemberManagementOpen(false);
  }, [selectedWorkspace]);

  React.useEffect(() => {
    if (memberManagementOpen || !shouldRestorePeopleTriggerFocus.current) return;
    shouldRestorePeopleTriggerFocus.current = false;
    restorePlatformWorkspacePeopleTriggerFocus(peopleTriggerRef);
  }, [memberManagementOpen]);

  React.useEffect(() => {
    if (directory.isLoading
      || directory.config?.capabilities.canReadTenants !== true) return;
    if (pendingCreatedWorkspaceId) {
      if (!workspaceIds.includes(pendingCreatedWorkspaceId)) return;
      selectWorkspace(pendingCreatedWorkspaceId);
      setPendingCreatedWorkspaceId(null);
      return;
    }
    if (resolvedSelectedWorkspaceId === selectedWorkspaceId) return;
    selectWorkspace(resolvedSelectedWorkspaceId);
  }, [
    directory.config?.capabilities.canReadTenants,
    directory.isLoading,
    canResolveSelection,
    pendingCreatedWorkspaceId,
    resolvedSelectedWorkspaceId,
    selectWorkspace,
    selectedWorkspaceId,
    workspaceIds,
  ]);

  const handleCreated = React.useCallback((result: AuthPlatformTenantCreateResult) => {
    setSearchInput('');
    setSearch('');
    setStatus('all');
    setPendingCreatedWorkspaceId(result.tenant.tenantId);
  }, []);
  const openCreateDialog = usePlatformWorkspaceCreateDialog({
    singular: terminology.singular,
    create: directory.createTenant,
    onCreated: handleCreated,
    onOpenChange: setCreateDialogOpen,
  });
  const navigationActions = usePlatformWorkspaceLifecycleActions({
    singular: terminology.singular,
    directory,
  });
  const closeMemberManagement = React.useCallback(() => {
    shouldRestorePeopleTriggerFocus.current = true;
    directory.clearMutationError();
    setMemberManagementOpen(false);
    setMemberSearchInput('');
    setMemberSearch('');
    setMemberStatus('all');
  }, [directory.clearMutationError]);
  const openMemberManagement = React.useCallback(() => {
    directory.clearMutationError();
    setMemberManagementOpen(true);
  }, [directory.clearMutationError]);
  const retryDirectory = React.useCallback(() => {
    retryPlatformWorkspaceDirectoryError(directorySurfaceError, {
      clearMutationError: directory.clearMutationError,
      reloadDirectory: directory.reloadDirectory,
    });
  }, [
    directory.clearMutationError,
    directory.reloadDirectory,
    directorySurfaceError,
  ]);

  if (!directory.isAvailable) {
    return (
      <PlatformWorkspaceUnavailable
        className={className}
        title={resolvedTitle}
        description={resolvedDescription}
        plural={terminology.plural}
      />
    );
  }

  return (
    <section
      className={cn(
        'flex h-full min-h-[32rem] flex-col overflow-hidden rounded-lg border border-border bg-background',
        className,
      )}
      aria-busy={directory.isLoading || directory.isMutating}
      aria-labelledby={memberManagementOpen ? undefined : headingId}
      aria-describedby={memberManagementOpen ? undefined : descriptionId}
    >
      {memberManagementOpen && selectedWorkspace ? (
        <PlatformWorkspaceMemberManagement
          workspace={selectedWorkspace}
          tenantSingular={terminology.singular}
          directory={directory}
          configState={configState}
          searchInput={memberSearchInput}
          setSearchInput={setMemberSearchInput}
          status={memberStatus}
          setStatus={setMemberStatus}
          onBack={closeMemberManagement}
          detailContent={memberDetailContent}
          navigationActions={memberNavigationActions}
          onSelectedMemberChange={onSelectedMemberChange}
        />
      ) : (
        <>
          <PlatformWorkspaceToolbar
            titleId={headingId}
            descriptionId={descriptionId}
            title={resolvedTitle}
            description={resolvedDescription}
            scopeName={auth.activeTenant?.name ?? 'Platform administration'}
            singular={terminology.singular}
            plural={terminology.plural}
            search={searchInput}
            status={status}
            canRead={capabilities?.canReadTenants === true}
            isLoading={directory.isLoading}
            isLoadingMore={directory.isLoadingMore}
            hasMore={directory.page?.hasMore === true}
            onSearchChange={setSearchInput}
            onStatusChange={setStatus}
            onReload={directory.reloadDirectory}
            onLoadMore={() => { void directory.loadMore(); }}
          />

          <AuthConfigLoadState
            state={configState}
            loadingMessage="Loading workspace terminology…"
            unavailableMessage="Workspace terminology could not be loaded. Default labels remain in use."
            className="mx-3 mt-3 shrink-0"
          />

          {directorySurfaceError
            && (rows.length > 0 || directorySurfaceError.source === 'mutation')
            && !createDialogOpen && (
            <div
              role="alert"
              className="mx-3 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <span>{directorySurfaceError.message}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={directory.isLoading || directory.isMutating}
                onClick={retryDirectory}
              >
                Retry
              </Button>
            </div>
          )}

          {capabilities && !capabilities.canReadTenants ? (
            <PlatformWorkspaceReadDenied
              singular={terminology.singular}
              plural={terminology.plural}
              canCreate={capabilities.canCreateTenants}
              isMutating={directory.isMutating}
              onCreate={openCreateDialog}
            />
          ) : (
            <MasterDetailPage
              schema={platformWorkspaceSchema}
              listColumns={platformWorkspaceListColumns}
              primaryKey="tenantId"
              source={{
                type: 'data',
                data: rows,
                isLoading: directory.isLoading,
                error: createDialogOpen ? null : directory.directoryError,
                refresh: directory.reloadDirectory,
              }}
              selectedId={resolvedSelectedWorkspaceId}
              onSelectedIdChange={(workspaceId) => selectWorkspace(workspaceId)}
              searchable={false}
              sortable
              errorState={(error, retry) => (
                <PlatformWorkspaceLoadError error={error} onRetry={retry} />
              )}
              detailHeader={PlatformWorkspaceDetailHeader}
              emptyStateText={`Select a customer ${terminology.singular} to inspect it.`}
              renderDetail={(workspace) => (
                <PlatformWorkspaceDetail
                  key={workspace.tenantId}
                  workspace={workspace}
                  singular={terminology.singular}
                  members={directory.selectedTenantMembers}
                  roleLabels={roleLabels}
                  canReadMembers={capabilities?.canReadTenantMembers === true}
                  canManageMembers={capabilities?.canManageTenantMembers === true
                    && workspace.status === 'active'}
                  isLoadingMembers={directory.isLoadingMembers}
                  membersError={directory.selectedTenantMembersError}
                  onRetryMembers={directory.reloadSelectedTenantMembers}
                  peopleTriggerRef={peopleTriggerRef}
                  onOpenMembers={openMemberManagement}
                />
              )}
              navigationActions={navigationActions}
              primaryAction={capabilities?.canCreateTenants ? {
                label: `Create ${terminology.singular}`,
                ariaHasPopup: 'dialog',
                disabled: directory.isMutating,
                onClick: openCreateDialog,
              } : undefined}
              className="min-h-0 flex-1"
            />
          )}
        </>
      )}
    </section>
  );
}
