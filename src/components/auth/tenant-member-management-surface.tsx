'use client';

import * as React from 'react';
import type { AuthTenantMember } from '../../frontend/client/auth-types';
import type { useAuthConfig } from '../../frontend/client/auth-hooks';
import { AlertDialog } from '#zero/components/animate-ui/components/radix/alert-dialog';
import { Button } from '#zero/components/ui/button';
import { ListDetailLayout } from '#zero/components/ui/list-detail-layout';
import {
  RecordNavigationBar,
  type NavigationAction,
  type RecordPrimaryAction,
} from '#zero/components/ui/record-navigation-bar';
import { cn } from '#zero/lib/utils';
import { AuthConfigLoadState } from './auth-config-load-state';
import { TenantMemberAddDialog } from './tenant-member-add-dialog';
import { TenantMemberDetail } from './tenant-member-detail';
import { TenantMemberList, TenantMemberListControls } from './tenant-member-list';
import { ConfirmationDialog } from './tenant-member-management-parts';
import { reduceTenantMemberMobileDetail } from './tenant-member-mobile-detail-state';
import type { TenantMemberManagementController } from './use-tenant-member-management-controller';

export interface TenantMemberManagementSurfaceProps {
  controller: TenantMemberManagementSurfaceController;
  configState: ReturnType<typeof useAuthConfig>;
  className?: string;
  title: string;
  description: string;
  /** Compact leading control, such as returning to a parent directory. */
  headerLeading?: React.ReactNode;
  tenantSingular: string;
  tenantKind: 'administration' | 'organization' | null;
  detailContent?: (member: AuthTenantMember) => React.ReactNode;
  navigationActions?: (member: AuthTenantMember | null) => NavigationAction[];
  secondaryPrimaryAction?: RecordPrimaryAction;
  /** Override active-tenant ownership copy for cross-tenant platform administration. */
  transferDescription?: string;
}

/** Minimal presentation contract shared by active-tenant and platform-workspace controllers. */
export interface TenantMemberManagementSurfaceController {
  tenant: {
    config: unknown | null;
    members: AuthTenantMember[];
    page: { hasMore: boolean } | null;
    isLoading: boolean;
    isLoadingMore: boolean;
    isMutating: boolean;
    error: string | null;
    reload(): void;
    loadMore(): Promise<void>;
  };
  capabilities: {
    canReadMembers: boolean;
    canManageMembers: boolean;
    canManageRoles: boolean;
    canTransferOwnership: boolean;
  } | null | undefined;
  actorMembershipId?: string;
  roles: TenantMemberManagementController['roles'];
  roleLabels: TenantMemberManagementController['roleLabels'];
  roleChoices: TenantMemberManagementController['roleChoices'];
  simpleMode: boolean;
  addRoleChoices: TenantMemberManagementController['addRoleChoices'];
  canChooseAddRoles: boolean;
  canAddMember: boolean;
  selectedId: string | null;
  selectedMember: AuthTenantMember | null;
  selectedIndex: number;
  selectMember(member: AuthTenantMember | null): void;
  selectPrevious(): void;
  selectNext(): void;
  draftRoles: string[];
  setDraftRoles: React.Dispatch<React.SetStateAction<string[]>>;
  roleSelectionChanged: boolean;
  rolePanelBaseId: string;
  searchInput: string;
  setSearchInput: React.Dispatch<React.SetStateAction<string>>;
  status: TenantMemberManagementController['status'];
  setStatus: React.Dispatch<React.SetStateAction<TenantMemberManagementController['status']>>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  addDialogOpen: boolean;
  email: string;
  setEmail: React.Dispatch<React.SetStateAction<string>>;
  addRoles: string[];
  setAddRoles: React.Dispatch<React.SetStateAction<string[]>>;
  addMember(event: React.FormEvent): Promise<void>;
  openAddDialog(): void;
  setAddDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  visibleConfirmation: TenantMemberManagementController['visibleConfirmation'];
  setConfirmation: TenantMemberManagementController['setConfirmation'];
  confirmAction(): Promise<void>;
  restoreDialogFocus(event: Event): void;
  saveRoles(): Promise<void>;
  membershipActions: NavigationAction[];
  localError: string | null;
  visibleError: string | null;
  retry(): void;
  announcement: string;
}

/** Present the controller as Zero's compact list/detail management organism. */
export function TenantMemberManagementSurface({
  controller,
  configState,
  className,
  title,
  description,
  headerLeading,
  tenantSingular,
  tenantKind,
  detailContent,
  navigationActions: injectedNavigationActions,
  secondaryPrimaryAction,
  transferDescription,
}: TenantMemberManagementSurfaceProps) {
  const { tenant, capabilities, selectedMember } = controller;
  const [mobileDetailOpen, dispatchMobileDetail] = React.useReducer(
    reduceTenantMemberMobileDetail,
    false,
  );
  const selectedMembershipId = selectedMember?.membershipId ?? null;
  React.useEffect(() => {
    dispatchMobileDetail({
      type: 'selection-synchronized',
      selectedMembershipId,
    });
  }, [selectedMembershipId]);
  const selectMember = React.useCallback((member: AuthTenantMember) => {
    dispatchMobileDetail({ type: 'detail-requested' });
    controller.selectMember(member);
  }, [controller.selectMember]);
  const navigationActions = [
    ...(injectedNavigationActions?.(selectedMember) ?? []),
    ...controller.membershipActions,
  ];
  const list = tenantMemberListState(controller, tenantSingular, selectMember);

  return (
    <div
      data-slot="tenant-member-management"
      className={cn('flex min-h-[30rem] flex-col gap-3', className)}
      aria-busy={tenant.isLoading || tenant.isMutating}
    >
      <div className="flex min-w-0 items-start gap-2">
        {headerLeading}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <AuthConfigLoadState
        state={configState}
        loadingMessage="Loading organization terminology…"
        unavailableMessage="Organization terminology could not be loaded. Member controls remain available with default labels."
      />
      <TenantMemberListControls
        search={controller.searchInput}
        status={controller.status}
        loadedCount={tenant.members.length}
        hasMore={tenant.page?.hasMore === true}
        isLoading={tenant.isLoading}
        isLoadingMore={tenant.isLoadingMore}
        searchInputRef={controller.searchInputRef}
        onSearchChange={controller.setSearchInput}
        onStatusChange={controller.setStatus}
        onRefresh={tenant.reload}
        onLoadMore={() => { void tenant.loadMore(); }}
      />
      {capabilities?.canManageMembers && tenantKind === 'administration'
        && !controller.canChooseAddRoles && (
        <p className="text-sm text-muted-foreground" role="status">
          Adding a platform administrator requires authority to grant at least one
          administration role.
        </p>
      )}
      {!controller.visibleConfirmation && !controller.addDialogOpen
        && controller.visibleError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0">{controller.visibleError}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={tenant.isLoading || tenant.isMutating}
            onClick={controller.retry}
          >
            Retry
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <ListDetailLayout
          hasSelection={selectedMember !== null}
          mobileDetailOpen={mobileDetailOpen}
          onMobileBack={() => dispatchMobileDetail({ type: 'back-requested' })}
          mobileBackLabel="Back to members"
          selectedKey={selectedMember?.membershipId}
          list={list}
          detail={(
            <TenantMemberDetail
              member={selectedMember}
              actorMembershipId={controller.actorMembershipId}
              declaredRoles={controller.roles}
              assignableRoles={controller.roleChoices}
              roleLabels={controller.roleLabels}
              simple={controller.simpleMode}
              draftRoles={controller.draftRoles}
              busy={tenant.isMutating}
              canManageRoles={capabilities?.canManageRoles === true}
              canTransferOwnership={capabilities?.canTransferOwnership === true}
              tenantSingular={tenantSingular}
              rolePanelId={`${controller.rolePanelBaseId}-${selectedMember?.membershipId ?? 'empty'}`}
              roleSelectionChanged={controller.roleSelectionChanged}
              onRolesChange={controller.setDraftRoles}
              onSaveRoles={() => { void controller.saveRoles(); }}
              detailContent={selectedMember ? detailContent?.(selectedMember) : undefined}
            />
          )}
          bottomBar={(
            <RecordNavigationBar
              currentIndex={Math.max(0, controller.selectedIndex)}
              totalCount={tenant.members.length}
              onPrevious={() => {
                dispatchMobileDetail({ type: 'detail-requested' });
                controller.selectPrevious();
              }}
              onNext={() => {
                dispatchMobileDetail({ type: 'detail-requested' });
                controller.selectNext();
              }}
              actions={navigationActions}
              secondaryPrimaryAction={secondaryPrimaryAction}
              primaryAction={controller.canAddMember ? {
                label: 'Add member',
                ariaHasPopup: 'dialog',
                disabled: tenant.isLoading || tenant.isMutating,
                onClick: controller.openAddDialog,
              } : undefined}
            />
          )}
        />
      </div>
      <TenantMemberAddDialog
        open={controller.addDialogOpen}
        email={controller.email}
        roles={controller.addRoleChoices}
        selectedRoles={controller.addRoles}
        simple={controller.simpleMode}
        canChooseRoles={controller.canChooseAddRoles}
        busy={tenant.isMutating}
        error={controller.addDialogOpen ? controller.localError : null}
        tenantSingular={tenantSingular}
        onOpenChange={(open) => controller.setAddDialogOpen(open)}
        onEmailChange={controller.setEmail}
        onRolesChange={controller.setAddRoles}
        onSubmit={(event) => { void controller.addMember(event); }}
        onCloseAutoFocus={controller.restoreDialogFocus}
      />
      <AlertDialog
        open={controller.visibleConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !tenant.isMutating) controller.setConfirmation(null);
        }}
      >
        {controller.visibleConfirmation && (
          <ConfirmationDialog
            key={`${controller.visibleConfirmation.action}:${controller.visibleConfirmation.member.membershipId}`}
            confirmation={controller.visibleConfirmation}
            tenantSingular={tenantSingular}
            transferDescription={transferDescription}
            busy={tenant.isMutating}
            error={controller.localError}
            onConfirm={() => { void controller.confirmAction(); }}
            onCloseAutoFocus={controller.restoreDialogFocus}
          />
        )}
      </AlertDialog>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {controller.announcement}
      </p>
    </div>
  );
}

function tenantMemberListState(
  controller: TenantMemberManagementSurfaceController,
  tenantSingular: string,
  onSelect: (member: AuthTenantMember) => void,
): React.ReactNode {
  const { tenant, capabilities } = controller;
  if (tenant.isLoading && tenant.members.length === 0) {
    return <ListMessage live>Loading {tenantSingular} members…</ListMessage>;
  }
  if (!tenant.config) {
    return <ListMessage>{capitalize(tenantSingular)} member controls are available after signing in with active {tenantSingular} access.</ListMessage>;
  }
  if (!capabilities?.canReadMembers) {
    return <ListMessage>You do not have permission to view {tenantSingular} members.</ListMessage>;
  }
  if (tenant.members.length === 0) return <ListMessage>No members match this view.</ListMessage>;
  return (
    <TenantMemberList
      members={tenant.members}
      selectedId={controller.selectedId}
      actorMembershipId={controller.actorMembershipId}
      roleLabels={controller.roleLabels}
      busy={tenant.isMutating}
      onSelect={onSelect}
    />
  );
}

function ListMessage({ children, live = false }: { children: React.ReactNode; live?: boolean }) {
  return (
    <div role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined} className="m-3 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
