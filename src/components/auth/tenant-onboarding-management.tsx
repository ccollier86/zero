'use client';

import * as React from 'react';
import type {
  AuthTenantInvitation,
  AuthTenantJoinRequest,
} from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useTenantOnboardingAdministration } from '../../frontend/client/tenant-administration-hooks';
import { Button } from '#zero/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#zero/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import { cn } from '#zero/lib/utils';
import { createAuthRoleLabelMap } from './auth-role-presentation';
import { writeAuthClipboardText } from './auth-clipboard';
import { TenantDomainManagement } from './tenant-domain-management';
import { JoinRequestRow } from './tenant-join-request-row';
import { rolesForTenantKind } from './tenant-role-scope';
import {
  ManualInvitationToken,
  TenantInvitationComposer,
  TenantInvitationList,
} from './tenant-onboarding-invitations';

export {
  filterJoinRequestApprovalRoles,
  JoinRequestRow,
  joinRequestApprovalParams,
} from './tenant-join-request-row';

export interface TenantOnboardingManagementProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
}

export type OnboardingConfirmation =
  | { action: 'revoke-invitation'; invitation: AuthTenantInvitation }
  | { action: 'deny-join-request'; request: AuthTenantJoinRequest };

/** Accessible active-tenant invitation and join-request control surface. */
export function TenantOnboardingManagement(
  props: TenantOnboardingManagementProps,
) {
  const auth = useAuth();
  const boundary = JSON.stringify([
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
  ]);
  return (
    <TenantOnboardingManagementScope
      key={boundary}
      {...props}
      tenantKind={auth.activeTenant?.kind ?? null}
    />
  );
}

function TenantOnboardingManagementScope({
  className,
  pageSize = 50,
  title,
  description,
  tenantKind,
}: TenantOnboardingManagementProps & {
  tenantKind: 'administration' | 'organization' | null;
}) {
  const boundedPageSize = Number.isFinite(pageSize)
    ? Math.min(100, Math.max(1, Math.trunc(pageSize)))
    : 50;
  const publicConfig = useAuthConfig().config;
  const configuredTenantSingular =
    publicConfig?.tenancy?.terminology?.singular ?? 'organization';
  const administrationScope = tenantKind === 'administration';
  const tenantSingular = administrationScope
    ? 'platform administration'
    : configuredTenantSingular;
  const resolvedTitle = title ?? (administrationScope
    ? 'Platform administrator invitations'
    : `${capitalize(tenantSingular)} onboarding`);
  const resolvedDescription =
    description ?? (administrationScope
      ? 'Invite people into the protected administration organization.'
      : `Invite people and review retained requests to join this ${tenantSingular}.`);
  const onboarding = useTenantOnboardingAdministration({
    limit: boundedPageSize,
  });
  const delivery = publicConfig?.tenancy?.onboarding?.invitations.delivery;
  const availableModes = [
    ...(delivery?.email ? ['email' as const] : []),
    ...(delivery?.manual ? ['manual' as const] : []),
  ];
  const [email, setEmail] = React.useState('');
  const [mode, setMode] = React.useState<'email' | 'manual'>(
    delivery?.default ?? 'manual',
  );
  const configuredDefaultMode = delivery?.default ?? 'manual';
  const effectiveMode = resolveInvitationDeliveryMode(
    mode,
    configuredDefaultMode,
    availableModes,
  );
  const [manualToken, setManualToken] = React.useState<string | null>(null);
  const [inviteRoles, setInviteRoles] = React.useState<string[]>([]);
  const [confirmation, setConfirmation] = React.useState<OnboardingConfirmation | null>(null);
  const [focusAfterMutation, setFocusAfterMutation] = React.useState<{
    target: 'invitations' | 'join-requests';
    sawLoading: boolean;
  } | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const sectionId = React.useId();
  const manualInvitationHeadingId = `${sectionId}-manual-invitation`;
  const invitationsHeadingId = `${sectionId}-invitations`;
  const joinRequestsHeadingId = `${sectionId}-join-requests`;
  const confirmationTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const invitationsHeadingRef = React.useRef<HTMLHeadingElement | null>(null);
  const joinRequestsHeadingRef = React.useRef<HTMLHeadingElement | null>(null);

  React.useEffect(() => {
    if (availableModes.includes(delivery?.default ?? 'manual')) {
      setMode(delivery?.default ?? 'manual');
    } else if (availableModes[0]) {
      setMode(availableModes[0]);
    }
  }, [delivery?.default, delivery?.email, delivery?.manual]);

  async function issue(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || (administrationScope && inviteRoles.length === 0)) return;
    const invitedEmail = email.trim();
    setLocalError(null);
    setManualToken(null);
    setAnnouncement('');
    try {
      const result = await onboarding.issueInvitation({
        email: invitedEmail,
        delivery: effectiveMode,
        ...(canChooseInvitationRoles ? { roles: inviteRoles } : {}),
      });
      setEmail('');
      if ('token' in result) setManualToken(result.token);
      setAnnouncement(`Created invitation for ${invitedEmail}`);
    } catch (cause) {
      setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function mutate(operation: () => Promise<unknown>, success: string): Promise<boolean> {
    setLocalError(null);
    setAnnouncement('');
    try {
      await operation();
      setAnnouncement(success);
      return true;
    } catch (cause) {
      setLocalError(errorMessage(cause, tenantSingular));
      return false;
    }
  }

  async function confirmOnboardingAction() {
    if (!confirmation) return;
    const pending = confirmation;
    const succeeded = pending.action === 'revoke-invitation'
      ? await mutate(
          () => onboarding.revokeInvitation(pending.invitation.invitationId),
          tenantOnboardingConfirmationAnnouncement(pending),
        )
      : await mutate(
          () => onboarding.denyJoinRequest(
            pending.request.joinRequestId,
            { expectedRequestRevision: pending.request.requestRevision },
          ),
          tenantOnboardingConfirmationAnnouncement(pending),
        );
    if (succeeded) {
      setFocusAfterMutation({
        target: pending.action === 'revoke-invitation'
          ? 'invitations'
          : 'join-requests',
        sawLoading: false,
      });
      setConfirmation(null);
    }
  }

  async function copyManualInvitationToken() {
    if (!manualToken) return;
    setLocalError(null);
    setAnnouncement('');
    try {
      await writeAuthClipboardText(manualToken);
      setAnnouncement('Copied one-time invitation token');
    } catch (cause) {
      setLocalError(errorMessage(cause, tenantSingular));
    }
  }

  const capabilities = onboarding.config?.capabilities;
  const simpleMode = onboarding.config?.authorization === 'simple';
  const scopedRoles = rolesForTenantKind(onboarding.config?.roles ?? [], tenantKind);
  const roleLabels = createAuthRoleLabelMap(scopedRoles);
  const invitationRoleChoices = scopedRoles.filter(
    (role) =>
      role.assignable && role.grantable && !role.system && role.key !== 'owner',
  );
  const canChooseInvitationRoles =
    capabilities?.canManageRoles === true && invitationRoleChoices.length > 0;
  const canIssueInvitations = capabilities?.canManageInvitations === true
    && availableModes.length > 0
    && (!administrationScope || canChooseInvitationRoles);
  const canReviewJoinRequests = !administrationScope
    && capabilities?.canReviewJoinRequests === true;

  React.useEffect(() => {
    if (!canChooseInvitationRoles) {
      setInviteRoles([]);
      return;
    }
    const allowed = new Set(invitationRoleChoices.map((role) => role.key));
    setInviteRoles((current) => {
      const retained = current.filter((role) => allowed.has(role));
      if (
        (simpleMode && retained.length === 1) ||
        (!simpleMode && retained.length > 0)
      ) {
        return retained;
      }
      const defaultRole =
        invitationRoleChoices.find((role) => role.key === 'member') ??
        invitationRoleChoices[0];
      return defaultRole ? [defaultRole.key] : [];
    });
  }, [
    canChooseInvitationRoles,
    simpleMode,
    invitationRoleChoices.map((role) => role.key).join('|'),
  ]);

  React.useEffect(() => {
    if (!focusAfterMutation) return;
    if (onboarding.isLoading && !focusAfterMutation.sawLoading) {
      setFocusAfterMutation((current) => current && ({ ...current, sawLoading: true }));
      return;
    }
    if (!onboarding.isLoading && focusAfterMutation.sawLoading) {
      const target = focusAfterMutation.target === 'invitations'
        ? invitationsHeadingRef.current
        : joinRequestsHeadingRef.current;
      target?.focus();
      setFocusAfterMutation(null);
    }
  }, [focusAfterMutation, onboarding.isLoading]);

  return (
    <div className={cn('grid gap-6', className)}>
      <Card
        className="overflow-hidden"
        aria-busy={onboarding.isLoading || onboarding.isMutating}
      >
        <CardHeader className="gap-3 border-b border-border/70">
          <div>
            <CardTitle>{resolvedTitle}</CardTitle>
            <CardDescription>{resolvedDescription}</CardDescription>
          </div>
          {canIssueInvitations && (
            <TenantInvitationComposer
              email={email}
              mode={effectiveMode}
              emailDelivery={delivery?.email === true}
              manualDelivery={delivery?.manual === true}
              busy={onboarding.isMutating}
              canChooseRoles={canChooseInvitationRoles}
              roles={invitationRoleChoices}
              selectedRoles={inviteRoles}
              simple={simpleMode}
              tenantSingular={tenantSingular}
              onEmailChange={setEmail}
              onModeChange={setMode}
              onRolesChange={setInviteRoles}
              onSubmit={issue}
            />
          )}
          {capabilities?.canManageInvitations && administrationScope
            && !canChooseInvitationRoles && (
            <p className="text-sm text-muted-foreground" role="status">
              Inviting a platform administrator requires authority to grant at
              least one administration role.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-6 pt-5">
          <TenantOnboardingTenantKindNotice kind={tenantKind} />
          {!confirmation && (onboarding.error || localError) && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">{localError ?? onboarding.error}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={onboarding.isLoading || onboarding.isMutating}
                onClick={() => {
                  setLocalError(null);
                  onboarding.reload();
                }}
              >
                Retry
              </Button>
            </div>
          )}

          <AlertDialog
            open={confirmation !== null}
            onOpenChange={(open) => {
              if (!open && !onboarding.isMutating) setConfirmation(null);
            }}
          >
            {confirmation && (
              <OnboardingConfirmationDialog
                key={onboardingConfirmationKey(confirmation)}
                confirmation={confirmation}
                busy={onboarding.isMutating}
                error={localError}
                onConfirm={() => void confirmOnboardingAction()}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  if (confirmationTriggerRef.current?.isConnected) {
                    confirmationTriggerRef.current.focus();
                    return;
                  }
                  const fallback = confirmation.action === 'revoke-invitation'
                    ? invitationsHeadingRef.current
                    : joinRequestsHeadingRef.current;
                  fallback?.focus();
                }}
              />
            )}
          </AlertDialog>

          {manualToken && (
            <ManualInvitationToken
              token={manualToken}
              headingId={manualInvitationHeadingId}
              onCopy={() => void copyManualInvitationToken()}
              onDismiss={() => setManualToken(null)}
            />
          )}

          {onboarding.isLoading ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
            >
              Loading onboarding controls…
            </div>
          ) : !onboarding.config ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {capitalize(tenantSingular)} onboarding controls require signing
              in with active {tenantSingular} access.
            </div>
          ) : !capabilities?.canReadInvitations && !canReviewJoinRequests ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              Invitation history and join-request review are not available for
              your current role.
            </div>
          ) : (
            <>
              {capabilities?.canReadInvitations && (
                <TenantInvitationList
                  headingId={invitationsHeadingId}
                  headingRef={invitationsHeadingRef}
                  invitations={onboarding.invitations}
                  roleLabels={roleLabels}
                  canManage={capabilities.canManageInvitations}
                  busy={onboarding.isMutating}
                  hasMore={onboarding.invitationPage?.hasMore === true}
                  isLoadingMore={onboarding.isLoadingMoreInvitations}
                  onLoadMore={() => void onboarding.loadMoreInvitations()}
                  onRevoke={(invitation, trigger) => {
                    confirmationTriggerRef.current = trigger;
                    setLocalError(null);
                    setConfirmation({ action: 'revoke-invitation', invitation });
                  }}
                />
              )}

              {canReviewJoinRequests && (
                <section aria-labelledby={joinRequestsHeadingId}>
                  <h3
                    ref={joinRequestsHeadingRef}
                    id={joinRequestsHeadingId}
                    tabIndex={-1}
                    className="text-sm font-semibold"
                  >
                    Join requests
                  </h3>
                  <div className="mt-3 divide-y rounded-md border">
                    {onboarding.joinRequests.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">
                        No requests awaiting review.
                      </p>
                    ) : (
                      onboarding.joinRequests.map((request) => (
                        <JoinRequestRow
                          key={`${request.joinRequestId}:${request.requestRevision}`}
                          request={request}
                          busy={onboarding.isMutating}
                          tenantSingular={tenantSingular}
                          onApprove={(params) =>
                            mutate(
                              () =>
                                onboarding.approveJoinRequest(
                                  request.joinRequestId,
                                  params,
                                ),
                              `${request.reactivationRequired ? 'Re-admitted' : 'Approved'} ${request.applicant.email}`,
                            )
                          }
                          onDeny={(trigger) => {
                            confirmationTriggerRef.current = trigger;
                            setLocalError(null);
                            setConfirmation({ action: 'deny-join-request', request });
                          }}
                        />
                      ))
                    )}
                  </div>
                  {onboarding.joinRequestPage?.hasMore && (
                    <Button
                      type="button"
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      disabled={onboarding.isLoadingMoreJoinRequests}
                      onClick={() => void onboarding.loadMoreJoinRequests()}
                    >
                      {onboarding.isLoadingMoreJoinRequests
                        ? 'Loading…'
                        : 'Load more requests'}
                    </Button>
                  )}
                </section>
              )}
            </>
          )}

          <p
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {announcement}
          </p>
        </CardContent>
      </Card>
      {!administrationScope && <TenantDomainManagement />}
    </div>
  );
}

/** Makes the protected-scope exclusions explicit in the generic onboarding UI. */
export function TenantOnboardingTenantKindNotice({
  kind,
}: { kind: 'administration' | 'organization' | null }) {
  if (kind !== 'administration') return null;
  return (
    <p className="rounded-md border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground" role="note">
      Platform administration supports invitations only. Customer join
      requests and verified-domain onboarding are unavailable in this
      protected scope. Use PlatformAdministrationManagement for the full
      administrator membership and ownership controls.
    </p>
  );
}

function OnboardingConfirmationDialog({
  confirmation,
  busy,
  error,
  onConfirm,
  onCloseAutoFocus,
}: {
  confirmation: OnboardingConfirmation;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onCloseAutoFocus: React.ComponentProps<typeof AlertDialogContent>['onCloseAutoFocus'];
}) {
  const invitation = confirmation.action === 'revoke-invitation';
  const subject = invitation
    ? confirmation.invitation.email
    : confirmation.request.applicant.email;
  return (
    <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {invitation ? 'Revoke invitation?' : 'Deny access request?'}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {invitation
            ? `${subject} will no longer be able to use this invitation.`
            : `${subject} will not receive access from this request. The decision is retained in the onboarding history.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button type="button" size="sm" variant="outline" disabled={busy}>
            Cancel
          </Button>
        </AlertDialogCancel>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy
            ? invitation ? 'Revoking…' : 'Denying…'
            : invitation ? 'Revoke invitation' : 'Deny request'}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

/** @internal Stable dialog identity for retained onboarding decisions. */
export function onboardingConfirmationKey(
  confirmation: OnboardingConfirmation,
): string {
  return confirmation.action === 'revoke-invitation'
    ? `${confirmation.action}:${confirmation.invitation.invitationId}`
    : `${confirmation.action}:${confirmation.request.joinRequestId}:${confirmation.request.requestRevision}`;
}

/** @internal Specific live-region copy for confirmed onboarding decisions. */
export function tenantOnboardingConfirmationAnnouncement(
  confirmation: OnboardingConfirmation,
): string {
  return confirmation.action === 'revoke-invitation'
    ? `Revoked invitation for ${confirmation.invitation.email}`
    : `Denied request from ${confirmation.request.applicant.email}`;
}

/** @internal Reviewer-safe request row exposed for focused component tests. */

function errorMessage(cause: unknown, tenantSingular: string): string {
  return cause instanceof Error
    ? cause.message
    : `${capitalize(tenantSingular)} onboarding request failed`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/** @internal Keep the first submission inside the loaded delivery policy. */
export function resolveInvitationDeliveryMode(
  current: 'email' | 'manual',
  configuredDefault: 'email' | 'manual',
  available: readonly ('email' | 'manual')[],
): 'email' | 'manual' {
  if (available.includes(current)) return current;
  if (available.includes(configuredDefault)) return configuredDefault;
  return available[0] ?? current;
}
