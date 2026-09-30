'use client';

import * as React from 'react';
import type {
  AuthApplicationUser,
  AuthApplicationUserStatus,
} from '../../frontend/client/auth-application-administration-types';
import { useApplicationAccess } from '../../frontend/client/application-administration-hooks';
import { useAuth } from '../../frontend/client/auth-hooks';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import { Button } from '#zero/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#zero/components/ui/card';
import { Input } from '#zero/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';
import { createAuthRoleLabelMap } from './auth-role-presentation';
import {
  ApplicationRoleEditor,
  ApplicationUserRow,
  applicationUserName,
} from './application-access-management-parts';

export interface ApplicationAccessManagementProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
  onActorAuthorizationChanged?: () => void;
}

/** Packaged single/advanced role administration without global account controls. */
export function ApplicationAccessManagement(props: ApplicationAccessManagementProps) {
  const auth = useAuth();
  const boundary = JSON.stringify([
    auth.user?.userId ?? null,
    auth.isAuthenticated,
  ]);
  return <ApplicationAccessManagementScope key={boundary} {...props} />;
}

function ApplicationAccessManagementScope({
  className,
  pageSize = 25,
  title = 'Application access',
  description = 'Assign application roles without changing global account or security settings.',
  onActorAuthorizationChanged,
}: ApplicationAccessManagementProps) {
  const [search, setSearch] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [status, setStatus] = React.useState<AuthApplicationUserStatus | 'all'>('all');
  const boundedPageSize = Number.isFinite(pageSize)
    ? Math.min(100, Math.max(1, Math.trunc(pageSize)))
    : 25;
  const access = useApplicationAccess({
    limit: boundedPageSize,
    search: searchQuery,
    status: status === 'all' ? undefined : status,
  });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [draftRoles, setDraftRoles] = React.useState<string[]>([]);
  const [transferTarget, setTransferTarget] = React.useState<AuthApplicationUser | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const rolePanelId = React.useId();
  const transferTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const mounted = React.useRef(true);
  const selectedUser = access.users.find((user) => user.identity.userId === selected) ?? null;
  const capabilities = access.config?.capabilities;
  const actorUserId = access.config?.actor.userId;
  const currentActorUserId = React.useRef(actorUserId);
  currentActorUserId.current = actorUserId;

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const roleSelectionChanged = selectedUser
    ? !sameRoleSelection(
        selectedUser.roles.filter((role) => role !== 'owner'),
        draftRoles,
      )
    : false;

  React.useEffect(() => {
    setDraftRoles(selectedUser?.roles.filter((role) => role !== 'owner') ?? []);
    setLocalError(null);
  }, [selectedUser?.identity.userId, selectedUser?.roleRevision,
    selectedUser?.roles.join('|')]);

  React.useEffect(() => {
    const timeout = setTimeout(() => setSearchQuery(search), 250);
    return () => clearTimeout(timeout);
  }, [search]);

  React.useEffect(() => {
    setSelected(null);
    setTransferTarget(null);
    setLocalError(null);
  }, [searchQuery, status]);

  async function saveRoles() {
    if (!selectedUser || !actorUserId) return;
    const mutationActorUserId = actorUserId;
    const changedUserName = applicationUserName(selectedUser);
    setLocalError(null);
    setAnnouncement('');
    let actorAuthorizationChanged = false;
    try {
      const result = await access.replaceUserRoles(
        selectedUser.identity.userId,
        draftRoles,
      );
      actorAuthorizationChanged = result.actorAuthorizationChanged;
    } catch (cause) {
      if (mounted.current && currentActorUserId.current === mutationActorUserId) {
        setLocalError(errorMessage(cause));
      }
      return;
    }
    if (mounted.current && currentActorUserId.current === mutationActorUserId) {
      setAnnouncement(`Updated application roles for ${changedUserName}`);
    }
    if (actorAuthorizationChanged
      && mounted.current
      && currentActorUserId.current === mutationActorUserId) {
      onActorAuthorizationChanged?.();
    }
  }

  async function confirmTransfer() {
    if (!transferTarget || !actorUserId) return;
    const mutationActorUserId = actorUserId;
    const nextOwnerName = applicationUserName(transferTarget);
    setLocalError(null);
    setAnnouncement('');
    let actorAuthorizationChanged = false;
    try {
      const result = await access.transferOwnership(transferTarget.identity.userId);
      if (mounted.current && currentActorUserId.current === mutationActorUserId) {
        setTransferTarget(null);
        setAnnouncement(`Transferred application ownership to ${nextOwnerName}`);
      }
      actorAuthorizationChanged = result.actorAuthorizationChanged;
    } catch (cause) {
      if (mounted.current && currentActorUserId.current === mutationActorUserId) {
        setLocalError(errorMessage(cause));
      }
      return;
    }
    if (actorAuthorizationChanged
      && mounted.current
      && currentActorUserId.current === mutationActorUserId) {
      onActorAuthorizationChanged?.();
    }
  }

  const configuredRoles = access.config?.roles ?? [];
  const roleLabels = createAuthRoleLabelMap(configuredRoles);
  const roles = configuredRoles.filter((role) => role.assignable);
  React.useEffect(() => {
    setSelected(null);
    setTransferTarget(null);
    setLocalError(null);
  }, [actorUserId]);

  return (
    <Card
      className={cn('overflow-hidden', className)}
      aria-busy={access.isLoading || access.isMutating}
    >
      <CardHeader className="gap-3 border-b border-border/70">
        <div>
          <CardTitle asChild><h2>{title}</h2></CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {access.isAvailable && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search application users"
              aria-label="Search application users"
              disabled={access.isLoading}
            />
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger className="sm:w-44" aria-label="Account status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {!transferTarget && (localError || (access.error && access.config !== null))
          && !access.isDenied && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">{localError ?? access.error}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={access.isLoading || access.isMutating}
              onClick={() => {
                setLocalError(null);
                access.reload();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        <AlertDialog
          open={transferTarget !== null}
          onOpenChange={(open) => {
            if (!open && !access.isMutating) setTransferTarget(null);
          }}
        >
          {transferTarget && (
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (transferTriggerRef.current?.isConnected) {
                  transferTriggerRef.current.focus();
                }
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>Transfer application ownership?</AlertDialogTitle>
                <AlertDialogDescription>
                  {applicationUserName(transferTarget)} will become the owner. Your application
                  authorization will refresh after the transfer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {localError && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {localError}
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button type="button" size="sm" variant="outline" disabled={access.isMutating}>
                    Cancel
                  </Button>
                </AlertDialogCancel>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void confirmTransfer()}
                  disabled={access.isMutating}
                >
                  {access.isMutating ? 'Transferring…' : 'Transfer ownership'}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>

        {access.isLoading ? (
          <div role="status" aria-live="polite" className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Loading application access…
          </div>
        ) : access.isDenied ? (
          <div role="alert" className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            You do not have permission to view application access.
          </div>
        ) : access.error && !access.config ? (
          <div role="alert" className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive">
            <p>Application access could not be loaded.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={access.isLoading || access.isMutating}
              onClick={access.reload}
            >
              Retry
            </Button>
          </div>
        ) : !access.isAvailable ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Application access controls require the advanced single-application authorization profile.
          </div>
        ) : !access.config ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Sign in with application access authority to manage roles.
          </div>
        ) : !capabilities?.canReadUsers ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            You do not have permission to view application users.
          </div>
        ) : access.users.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No application users match this view.
          </div>
        ) : (
          <div className="divide-y divide-border/70 rounded-md border border-border/80">
            {access.users.map((user) => (
              <ApplicationUserRow
                key={user.identity.userId}
                user={user}
                actorUserId={actorUserId}
                selected={selected === user.identity.userId}
                canManageRoles={capabilities.canManageRoles}
                canTransferOwnership={capabilities.canTransferOwnership}
                busy={access.isMutating}
                rolePanelId={rolePanelId}
                roleLabels={roleLabels}
                onSelect={() => setSelected((value) => (
                  value === user.identity.userId ? null : user.identity.userId
                ))}
                onTransfer={(trigger) => {
                  transferTriggerRef.current = trigger;
                  setLocalError(null);
                  setTransferTarget(user);
                }}
              />
            ))}
          </div>
        )}

        {!access.isLoading && selectedUser && capabilities?.canManageRoles && (
          <ApplicationRoleEditor
            user={selectedUser}
            roles={roles}
            draftRoles={draftRoles}
            busy={access.isMutating}
            canTransferOwnership={capabilities.canTransferOwnership}
            roleSelectionChanged={roleSelectionChanged}
            rolePanelId={rolePanelId}
            onChange={setDraftRoles}
            onSave={() => void saveRoles()}
          />
        )}

        {access.page?.hasMore && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => void access.loadMore()}
              disabled={access.isLoadingMore}
            >
              {access.isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </CardContent>
    </Card>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Application access update failed';
}

function sameRoleSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((role) => rightSet.has(role));
}
