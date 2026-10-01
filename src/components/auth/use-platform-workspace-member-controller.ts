'use client';

import * as React from 'react';
import type {
  AuthPlatformTenantStatus,
} from '../../frontend/client/auth-platform-administration-types';
import type {
  AuthTenantMember,
  AuthTenantMembershipStatus,
} from '../../frontend/client/auth-types';
import type { UsePlatformTenantsResult } from '../../frontend/client/platform-administration-hooks';
import { createAuthRoleLabelMap } from './auth-role-presentation';
import {
  resolvePlatformWorkspaceMemberError,
  retryPlatformWorkspaceMemberError,
} from './platform-workspace-error-routing';
import { buildTenantMemberNavigationActions } from './tenant-member-management-actions';
import {
  canRetainTenantMemberConfirmation,
  tenantMemberName,
  type ConfirmationAction,
  type PendingConfirmation,
} from './tenant-member-management-parts';
import { rolesForTenantKind } from './tenant-role-scope';
import { tenantConfirmationAnnouncement } from './use-tenant-member-management-controller';

export interface PlatformWorkspaceMemberControllerOptions {
  directory: UsePlatformTenantsResult;
  workspaceId: string;
  workspaceStatus: AuthPlatformTenantStatus;
  tenantSingular: string;
  searchInput: string;
  setSearchInput: React.Dispatch<React.SetStateAction<string>>;
  status: AuthTenantMembershipStatus | 'all';
  setStatus: React.Dispatch<React.SetStateAction<AuthTenantMembershipStatus | 'all'>>;
  onSelectedMemberChange?: (member: AuthTenantMember | null) => void;
}

/** Adapt the protected platform directory to the shared member-management surface. */
export function usePlatformWorkspaceMemberController({
  directory,
  workspaceId,
  workspaceStatus,
  tenantSingular,
  searchInput,
  setSearchInput,
  status,
  setStatus,
  onSelectedMemberChange,
}: PlatformWorkspaceMemberControllerOptions) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draftRoles, setDraftRoles] = React.useState<string[]>([]);
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [addRoles, setAddRoles] = React.useState<string[]>([]);
  const [confirmation, setConfirmation] = React.useState<PendingConfirmation | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const rolePanelBaseId = React.useId();
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const dialogTriggerRef = React.useRef<HTMLElement | null>(null);
  const selectedIdRef = React.useRef<string | null>(null);
  const selectionCallbackRef = React.useRef(onSelectedMemberChange);
  const mounted = React.useRef(true);
  selectionCallbackRef.current = onSelectedMemberChange;

  const selectMember = React.useCallback((member: AuthTenantMember | null) => {
    const nextId = member?.membershipId ?? null;
    if (selectedIdRef.current === nextId) return;
    selectedIdRef.current = nextId;
    setSelectedId(nextId);
    selectionCallbackRef.current?.(member);
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionCallbackRef.current?.(null);
    };
  }, []);
  React.useEffect(() => {
    selectMember(null);
    setConfirmation(null);
    setLocalError(null);
    directory.clearMutationError();
  }, [directory.clearMutationError, selectMember, status, workspaceId]);

  const members = directory.selectedTenantMembers;
  const memberBusy = directory.isMutating || directory.isLoadingMembers;
  const capabilities = platformMemberCapabilities(directory, workspaceStatus);
  const roles = rolesForTenantKind(directory.config?.customerRoles ?? [], 'organization');
  const roleLabels = createAuthRoleLabelMap(roles);
  const roleChoices = roles.filter((role) => role.assignable);
  const simpleMode = directory.config?.authorization === 'simple';
  const addRoleChoices = roleChoices.filter((role) => (
    role.grantable && !role.system && role.key !== 'owner'
  ));
  const canChooseAddRoles = capabilities.canManageRoles && addRoleChoices.length > 0;
  const canAddMember = capabilities.canManageMembers;
  const selectedMember = members.find((member) => member.membershipId === selectedId) ?? null;
  const selectedIndex = selectedMember
    ? members.findIndex((member) => member.membershipId === selectedMember.membershipId)
    : -1;
  const roleSelectionChanged = selectedMember
    ? !sameRoleSelection(
        selectedMember.roles.filter((role) => role !== 'owner'),
        draftRoles,
      )
    : false;
  const visibleConfirmation = canRetainTenantMemberConfirmation(confirmation, capabilities)
    ? confirmation
    : null;

  React.useEffect(() => {
    if (directory.isLoadingMembers) return;
    if (!capabilities.canReadMembers || members.length === 0) {
      if (selectedId !== null) selectMember(null);
      return;
    }
    if (!selectedId || !members.some((member) => member.membershipId === selectedId)) {
      selectMember(members[0]!);
    }
  }, [capabilities.canReadMembers, directory.isLoadingMembers, members, selectMember, selectedId]);
  React.useEffect(() => {
    setDraftRoles(selectedMember?.roles.filter((role) => role !== 'owner') ?? []);
    setLocalError(null);
  }, [selectedMember?.membershipId, selectedMember?.roleRevision, selectedMember?.roles.join('|')]);
  React.useEffect(() => {
    if (!confirmation || visibleConfirmation) return;
    setConfirmation(null);
    setLocalError(null);
    dialogTriggerRef.current = null;
  }, [confirmation, visibleConfirmation]);
  React.useEffect(() => {
    if (!canChooseAddRoles) {
      setAddRoles([]);
      return;
    }
    const allowed = new Set(addRoleChoices.map((role) => role.key));
    setAddRoles((current) => {
      const retained = current.filter((role) => allowed.has(role));
      if ((simpleMode && retained.length === 1) || (!simpleMode && retained.length > 0)) {
        return retained;
      }
      const initial = addRoleChoices.find((role) => role.key === 'member') ?? addRoleChoices[0];
      return initial ? [initial.key] : [];
    });
  }, [addRoleChoices.map((role) => role.key).join('|'), canChooseAddRoles, simpleMode]);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return;
    beginOperation();
    try {
      await directory.addTenantMember(workspaceId, {
        email: normalizedEmail,
        ...(canChooseAddRoles ? { roles: addRoles } : {}),
      });
      if (!mounted.current) return;
      setEmail('');
      setAddDialogOpen(false);
      setAnnouncement(`Added ${normalizedEmail} to this ${tenantSingular}`);
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function saveRoles() {
    if (!selectedMember) return;
    const name = tenantMemberName(selectedMember);
    beginOperation();
    try {
      await directory.updateTenantMember(workspaceId, selectedMember.membershipId, {
        roles: draftRoles,
      });
      if (mounted.current) setAnnouncement(`Updated ${tenantSingular} roles for ${name}`);
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function reactivate(member: AuthTenantMember) {
    beginOperation();
    try {
      await directory.updateTenantMember(workspaceId, member.membershipId, { status: 'active' });
      if (mounted.current) setAnnouncement(`Reactivated ${tenantMemberName(member)}`);
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function confirmAction() {
    if (!visibleConfirmation) return;
    const pending = visibleConfirmation;
    beginOperation();
    try {
      if (pending.action === 'suspend') {
        await directory.updateTenantMember(
          workspaceId,
          pending.member.membershipId,
          { status: 'suspended' },
        );
      } else if (pending.action === 'remove') {
        await directory.removeTenantMember(workspaceId, pending.member.membershipId);
      } else {
        await directory.transferTenantOwnership(workspaceId, pending.member.membershipId);
      }
      if (!mounted.current) return;
      setConfirmation(null);
      setAnnouncement(tenantConfirmationAnnouncement(
        pending.action,
        tenantMemberName(pending.member),
        tenantSingular,
      ));
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  function beginOperation() {
    setLocalError(null);
    directory.clearMutationError();
    setAnnouncement('');
  }
  function rememberDialogTrigger() {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      dialogTriggerRef.current = document.activeElement;
    }
  }
  function requestConfirmation(action: ConfirmationAction, member: AuthTenantMember) {
    rememberDialogTrigger();
    setLocalError(null);
    setConfirmation({ action, member });
  }
  function restoreDialogFocus(event: Event) {
    event.preventDefault();
    if (dialogTriggerRef.current?.isConnected) dialogTriggerRef.current.focus();
    else searchInputRef.current?.focus();
    dialogTriggerRef.current = null;
  }
  function openAddDialog() {
    rememberDialogTrigger();
    setLocalError(null);
    setAddDialogOpen(true);
  }
  function selectRelative(offset: -1 | 1) {
    const next = members[selectedIndex + offset];
    if (next) selectMember(next);
  }

  const visibleError = resolvePlatformWorkspaceMemberError({
    localError,
    mutationError: directory.mutationError,
    membersError: directory.selectedTenantMembersError,
  });
  const retry = React.useCallback(() => {
    retryPlatformWorkspaceMemberError(visibleError, {
      clearLocalError: () => setLocalError(null),
      clearMutationError: directory.clearMutationError,
      reloadMembers: directory.reloadSelectedTenantMembers,
    });
  }, [
    directory.clearMutationError,
    directory.reloadSelectedTenantMembers,
    visibleError,
  ]);

  return {
    tenant: {
      config: directory.config,
      members,
      page: directory.selectedTenantMemberPage,
      isLoading: directory.isLoadingMembers,
      isLoadingMore: directory.isLoadingMoreMembers,
      isMutating: memberBusy,
      error: directory.selectedTenantMembersError,
      reload: directory.reloadSelectedTenantMembers,
      loadMore: directory.loadMoreMembers,
    },
    capabilities,
    actorMembershipId: undefined,
    roles,
    roleLabels,
    roleChoices,
    simpleMode,
    addRoleChoices,
    canChooseAddRoles,
    canAddMember,
    selectedId,
    selectedMember,
    selectedIndex,
    selectMember,
    selectPrevious: () => selectRelative(-1),
    selectNext: () => selectRelative(1),
    draftRoles,
    setDraftRoles,
    roleSelectionChanged,
    rolePanelBaseId,
    searchInput,
    setSearchInput,
    status,
    setStatus,
    searchInputRef,
    addDialogOpen,
    email,
    setEmail,
    addRoles,
    setAddRoles,
    addMember,
    openAddDialog,
    setAddDialogOpen,
    visibleConfirmation,
    setConfirmation,
    confirmAction,
    restoreDialogFocus,
    saveRoles,
    membershipActions: buildTenantMemberNavigationActions({
      member: selectedMember,
      canManageMembers: capabilities.canManageMembers,
      canTransferOwnership: capabilities.canTransferOwnership,
      busy: memberBusy,
      onReactivate: reactivate,
      onConfirm: requestConfirmation,
    }),
    localError,
    visibleError: visibleError?.message ?? null,
    retry,
    announcement,
  };
}

/** @internal Exact platform capabilities projected into the shared UI contract. */
export function platformMemberCapabilities(
  directory: UsePlatformTenantsResult,
  workspaceStatus: AuthPlatformTenantStatus,
) {
  const canReadMembers = directory.config?.capabilities.canReadTenantMembers === true;
  const canManageMembers = canReadMembers
    && directory.config?.capabilities.canManageTenantMembers === true
    && workspaceStatus === 'active';
  return {
    canReadMembers,
    canManageMembers,
    canManageRoles: canManageMembers,
    canTransferOwnership: canManageMembers,
  };
}

function sameRoleSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((role) => rightSet.has(role));
}

function errorMessage(cause: unknown, tenantSingular: string): string {
  return cause instanceof Error
    ? cause.message
    : `${capitalize(tenantSingular)} member update failed`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
