'use client';

import * as React from 'react';
import type {
  AuthTenantMember,
  AuthTenantMembershipStatus,
} from '../../frontend/client/auth-types';
import { useTenantMembers } from '../../frontend/client/tenant-administration-hooks';
import { createAuthRoleLabelMap } from './auth-role-presentation';
import { buildTenantMemberNavigationActions } from './tenant-member-management-actions';
import {
  canRetainTenantMemberConfirmation,
  tenantMemberName,
  type ConfirmationAction,
  type PendingConfirmation,
} from './tenant-member-management-parts';
import { rolesForTenantKind } from './tenant-role-scope';

export interface TenantMemberControllerOptions {
  pageSize: number;
  tenantSingular: string;
  tenantKind: 'administration' | 'organization' | null;
  onActorSessionInvalidated?: () => void;
  onSelectedMemberChange?: (member: AuthTenantMember | null) => void;
}

/** Own tenant-member query, selection, dialog, and mutation state. */
export function useTenantMemberManagementController({
  pageSize,
  tenantSingular,
  tenantKind,
  onActorSessionInvalidated,
  onSelectedMemberChange,
}: TenantMemberControllerOptions) {
  const boundedPageSize = Number.isFinite(pageSize)
    ? Math.min(100, Math.max(1, Math.trunc(pageSize)))
    : 25;
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<AuthTenantMembershipStatus | 'all'>('all');
  const tenant = useTenantMembers({
    limit: boundedPageSize,
    search,
    status: status === 'all' ? undefined : status,
  });
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
  selectionCallbackRef.current = onSelectedMemberChange;
  const mounted = React.useRef(true);
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
    const timeout = globalThis.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => globalThis.clearTimeout(timeout);
  }, [searchInput]);
  React.useEffect(() => {
    selectMember(null);
    setConfirmation(null);
    setLocalError(null);
  }, [search, selectMember, status]);

  const capabilities = tenant.config?.capabilities;
  const actorMembershipId = tenant.config?.actor.membershipId;
  const roles = rolesForTenantKind(tenant.config?.roles ?? [], tenantKind);
  const roleLabels = createAuthRoleLabelMap(roles);
  const roleChoices = roles.filter((role) => role.assignable);
  const simpleMode = tenant.config?.authorization === 'simple';
  const addRoleChoices = roleChoices.filter((role) => (
    role.grantable && !role.system && role.key !== 'owner'
  ));
  const canChooseAddRoles = capabilities?.canManageRoles === true
    && addRoleChoices.length > 0;
  const canAddMember = capabilities?.canManageMembers === true
    && (tenantKind !== 'administration' || canChooseAddRoles);
  const selectedMember = tenant.members.find((member) => (
    member.membershipId === selectedId
  )) ?? null;
  const selectedIndex = selectedMember
    ? tenant.members.findIndex((member) => member.membershipId === selectedMember.membershipId)
    : -1;
  const roleSelectionChanged = selectedMember
    ? !sameRoleSelection(
        selectedMember.roles.filter((role) => role !== 'owner'),
        draftRoles,
      )
    : false;
  const canRetainConfirmation = canRetainTenantMemberConfirmation(confirmation, capabilities);
  const visibleConfirmation = canRetainConfirmation ? confirmation : null;

  React.useEffect(() => {
    if (tenant.isLoading) return;
    if (!capabilities?.canReadMembers || tenant.members.length === 0) {
      if (selectedId !== null) selectMember(null);
      return;
    }
    if (!selectedId || !tenant.members.some((member) => member.membershipId === selectedId)) {
      selectMember(tenant.members[0]!);
    }
  }, [capabilities?.canReadMembers, selectMember, selectedId, tenant.isLoading, tenant.members]);
  React.useEffect(() => {
    setDraftRoles(selectedMember?.roles.filter((role) => role !== 'owner') ?? []);
    setLocalError(null);
  }, [selectedMember?.membershipId, selectedMember?.roleRevision, selectedMember?.roles.join('|')]);
  React.useEffect(() => {
    if (confirmation && !canRetainConfirmation) {
      setConfirmation(null);
      setLocalError(null);
      dialogTriggerRef.current = null;
    }
  }, [canRetainConfirmation, confirmation]);
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
      const defaultRole = addRoleChoices.find((role) => role.key === 'member')
        ?? addRoleChoices[0];
      return defaultRole ? [defaultRole.key] : [];
    });
  }, [canChooseAddRoles, simpleMode, addRoleChoices.map((role) => role.key).join('|')]);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    const addedEmail = email.trim();
    beginOperation();
    try {
      await tenant.addMember({
        email: addedEmail,
        ...(canChooseAddRoles ? { roles: addRoles } : {}),
      });
      if (mounted.current) {
        setEmail('');
        setAddDialogOpen(false);
        setAnnouncement(`Added ${addedEmail} to this ${tenantSingular}`);
      }
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function saveRoles() {
    if (!selectedMember) return;
    const changedMemberName = tenantMemberName(selectedMember);
    beginOperation();
    try {
      await tenant.updateMember(selectedMember.membershipId, { roles: draftRoles });
      if (mounted.current) {
        setAnnouncement(`Updated ${tenantSingular} roles for ${changedMemberName}`);
      }
      if (selectedMember.membershipId === actorMembershipId) onActorSessionInvalidated?.();
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function reactivate(member: AuthTenantMember) {
    beginOperation();
    try {
      await tenant.updateMember(member.membershipId, { status: 'active' });
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
      let actorSessionInvalidated = false;
      if (pending.action === 'suspend') {
        await tenant.updateMember(pending.member.membershipId, { status: 'suspended' });
        actorSessionInvalidated = pending.member.membershipId === actorMembershipId;
      } else if (pending.action === 'remove') {
        await tenant.removeMember(pending.member.membershipId);
        actorSessionInvalidated = pending.member.membershipId === actorMembershipId;
      } else {
        actorSessionInvalidated = (
          await tenant.transferOwnership(pending.member.membershipId)
        ).actorSessionInvalidated;
      }
      if (mounted.current) {
        setConfirmation(null);
        setAnnouncement(tenantConfirmationAnnouncement(
          pending.action,
          tenantMemberName(pending.member),
          tenantSingular,
        ));
      }
      if (actorSessionInvalidated) onActorSessionInvalidated?.();
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  function beginOperation() {
    setLocalError(null);
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
  function retry() {
    setLocalError(null);
    tenant.reload();
  }
  function selectRelative(offset: -1 | 1) {
    const next = tenant.members[selectedIndex + offset];
    if (next) selectMember(next);
  }

  const membershipActions = buildTenantMemberNavigationActions({
    member: selectedMember,
    actorMembershipId,
    canManageMembers: capabilities?.canManageMembers === true,
    canTransferOwnership: capabilities?.canTransferOwnership === true,
    busy: tenant.isMutating,
    onReactivate: reactivate,
    onConfirm: requestConfirmation,
  });

  return {
    tenant,
    capabilities,
    actorMembershipId,
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
    membershipActions,
    localError,
    visibleError: localError ?? tenant.error,
    retry,
    announcement,
  };
}

export type TenantMemberManagementController = ReturnType<
  typeof useTenantMemberManagementController
>;

/** @internal Accessible action-completion copy shared by the live region and tests. */
export function tenantConfirmationAnnouncement(
  action: ConfirmationAction,
  name: string,
  tenantSingular: string,
): string {
  if (action === 'suspend') return `Suspended ${name}`;
  if (action === 'remove') return `Removed ${name} from this ${tenantSingular}`;
  return `Transferred ${tenantSingular} ownership to ${name}`;
}

function errorMessage(cause: unknown, tenantSingular: string): string {
  return cause instanceof Error
    ? cause.message
    : `${capitalize(tenantSingular)} member update failed`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function sameRoleSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((role) => rightSet.has(role));
}
