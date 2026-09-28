'use client';

import * as React from 'react';
import type {
  AuthTenantInvitation,
  AuthTenantJoinRequest,
  AuthTenantReviewJoinRequestParams,
} from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useTenantOnboardingAdministration } from '../../frontend/client/tenant-administration-hooks';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#zero/components/ui/card';
import { Input } from '#zero/components/ui/input';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';
import {
  authRoleLabel,
  createAuthRoleLabelMap,
} from './auth-role-presentation';
import { writeAuthClipboardText } from './auth-clipboard';
import { TenantDomainManagement } from './tenant-domain-management';
import { TenantRolePicker } from './tenant-role-picker';

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
  return <TenantOnboardingManagementScope key={boundary} {...props} />;
}

function TenantOnboardingManagementScope({
  className,
  pageSize = 50,
  title,
  description,
}: TenantOnboardingManagementProps) {
  const boundedPageSize = Number.isFinite(pageSize)
    ? Math.min(100, Math.max(1, Math.trunc(pageSize)))
    : 50;
  const publicConfig = useAuthConfig().config;
  const tenantSingular =
    publicConfig?.tenancy?.terminology?.singular ?? 'organization';
  const resolvedTitle = title ?? `${capitalize(tenantSingular)} onboarding`;
  const resolvedDescription =
    description ??
    `Invite people and review retained requests to join this ${tenantSingular}.`;
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
    if (!email.trim()) return;
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
  const roleLabels = createAuthRoleLabelMap(onboarding.config?.roles ?? []);
  const invitationRoleChoices = (onboarding.config?.roles ?? []).filter(
    (role) =>
      role.assignable && role.grantable && !role.system && role.key !== 'owner',
  );
  const canChooseInvitationRoles =
    capabilities?.canManageRoles === true && invitationRoleChoices.length > 0;

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
          {capabilities?.canManageInvitations && availableModes.length > 0 && (
            <form className="space-y-3" onSubmit={issue}>
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="person@example.com"
                  aria-label="Invitation email"
                  autoComplete="email"
                  disabled={onboarding.isMutating}
                  required
                />
                <Select
                  value={effectiveMode}
                  onValueChange={(value) => setMode(value as typeof mode)}
                  disabled={onboarding.isMutating}
                >
                  <SelectTrigger aria-label="Invitation delivery">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {delivery?.email && (
                      <SelectItem value="email">Send email</SelectItem>
                    )}
                    {delivery?.manual && (
                      <SelectItem value="manual">Copy token</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="submit"
                  disabled={
                    onboarding.isMutating ||
                    !email.trim() ||
                    (canChooseInvitationRoles && inviteRoles.length === 0)
                  }
                >
                  Invite
                </Button>
              </div>
              {canChooseInvitationRoles && (
                <TenantRolePicker
                  roles={invitationRoleChoices}
                  selected={inviteRoles}
                  simple={simpleMode}
                  disabled={onboarding.isMutating}
                  legend="Roles granted when accepted"
                  selectLabel={`Invitation ${tenantSingular} role`}
                  selectPlaceholder={`Choose ${tenantSingular} role`}
                  actionContext="on invitation"
                  onChange={setInviteRoles}
                />
              )}
            </form>
          )}
        </CardHeader>
        <CardContent className="space-y-6 pt-5">
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
            <section
              aria-labelledby={manualInvitationHeadingId}
              className="rounded-md border border-warning/40 bg-warning/10 p-4 text-warning-foreground dark:border-warning/50 dark:bg-warning/15 dark:text-warning"
            >
              <h3 id={manualInvitationHeadingId} className="font-semibold">
                Copy this one-time invitation token now
              </h3>
              <p className="mt-1 text-sm">
                Zero will not show this token again. Share it only with the
                intended recipient.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <Input
                  readOnly
                  value={manualToken}
                  aria-label="One-time invitation token"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void copyManualInvitationToken();
                  }}
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setManualToken(null)}
                >
                  Dismiss
                </Button>
              </div>
            </section>
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
          ) : !capabilities?.canReadInvitations &&
            !capabilities?.canReviewJoinRequests ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              Invitation history and join-request review are not available for
              your current role.
            </div>
          ) : (
            <>
              {capabilities?.canReadInvitations && (
                <section aria-labelledby={invitationsHeadingId}>
                  <h3
                    ref={invitationsHeadingRef}
                    id={invitationsHeadingId}
                    tabIndex={-1}
                    className="text-sm font-semibold"
                  >
                    Invitations
                  </h3>
                  <div className="mt-3 divide-y rounded-md border">
                    {onboarding.invitations.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">
                        No invitations yet.
                      </p>
                    ) : (
                      onboarding.invitations.map((invitation) => (
                        <div
                          key={invitation.invitationId}
                          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {invitation.email}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Expires{' '}
                              {new Date(invitation.expiresAt).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{invitation.status}</Badge>
                            {invitation.roles.map((role) => (
                              <Badge key={role} variant="outline">
                                {authRoleLabel(role, roleLabels)}
                              </Badge>
                            ))}
                            {capabilities.canManageInvitations &&
                              invitation.status === 'pending' && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={onboarding.isMutating}
                                  aria-haspopup="dialog"
                                  onClick={(event) => {
                                    confirmationTriggerRef.current = event.currentTarget;
                                    setLocalError(null);
                                    setConfirmation({
                                      action: 'revoke-invitation',
                                      invitation,
                                    });
                                  }}
                                >
                                  Revoke
                                </Button>
                              )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {onboarding.invitationPage?.hasMore && (
                    <Button
                      type="button"
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      disabled={onboarding.isLoadingMoreInvitations}
                      onClick={() => void onboarding.loadMoreInvitations()}
                    >
                      {onboarding.isLoadingMoreInvitations
                        ? 'Loading…'
                        : 'Load more invitations'}
                    </Button>
                  )}
                </section>
              )}

              {capabilities?.canReviewJoinRequests && (
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
      <TenantDomainManagement />
    </div>
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
export function JoinRequestRow({
  request,
  busy,
  tenantSingular,
  onApprove,
  onDeny,
}: {
  request: AuthTenantJoinRequest;
  busy: boolean;
  tenantSingular: string;
  onApprove(params: AuthTenantReviewJoinRequestParams): Promise<unknown>;
  onDeny(trigger: HTMLButtonElement): void;
}) {
  const selection = request.approvalPolicy.roleSelection;
  const selectable = selection.mode === 'selectable';
  const selectionRoles = selectable ? selection.roles : [];
  const defaultRoleKeys = selectable ? selection.defaultRoleKeys : [];
  const policyKey = selectable
    ? JSON.stringify([
        selection.roles.map((role) => role.key),
        selection.defaultRoleKeys,
        selection.maxRoleCount,
      ])
    : selection.mode;
  const [selectedRoles, setSelectedRoles] = React.useState<string[]>(
    selectable ? [...defaultRoleKeys] : [],
  );

  React.useEffect(() => {
    if (!selectable) {
      setSelectedRoles([]);
      return;
    }
    const allowed = new Set(selectionRoles.map((role) => role.key));
    setSelectedRoles((current) => {
      const retained = [...new Set(current)].filter((role) =>
        allowed.has(role),
      );
      return retained.length > 0
        ? retained.slice(0, selection.maxRoleCount)
        : defaultRoleKeys
            .filter((role) => allowed.has(role))
            .slice(0, selection.maxRoleCount);
    });
  }, [policyKey]);

  const safeSelectedRoles = selectable
    ? filterJoinRequestApprovalRoles(request.approvalPolicy, selectedRoles)
    : [];
  const canApprove =
    request.approvalPolicy.canApprove &&
    (!selectable || safeSelectedRoles.length > 0);
  const applicantName =
    request.applicant.firstName || request.applicant.lastName
      ? [request.applicant.firstName, request.applicant.lastName]
          .filter(Boolean)
          .join(' ')
      : request.applicant.username;
  const approvalLabel =
    selection.mode === 'fixed' ? 'Fixed access' : 'Default access';

  function approve() {
    if (!canApprove) return;
    void onApprove(
      joinRequestApprovalParams(
        request.approvalPolicy,
        safeSelectedRoles,
        request.reactivationRequired,
        request.requestRevision,
      ),
    );
  }

  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{applicantName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {request.applicant.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{request.status}</Badge>
          {!selectable && selection.roles.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {approvalLabel}:{' '}
              {selection.roles.map((role) => role.label).join(', ')}
            </span>
          )}
          {request.status === 'pending' && !selectable && (
            <>
              <Button
                type="button"
                size="sm"
                disabled={busy || !canApprove}
                onClick={approve}
              >
                {request.reactivationRequired ? 'Re-admit' : 'Approve'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                aria-haspopup="dialog"
                onClick={(event) => onDeny(event.currentTarget)}
              >
                Deny
              </Button>
            </>
          )}
        </div>
      </div>

      {request.status === 'pending' && selectable && (
        <div className="mt-4 space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
          <TenantRolePicker
            roles={selectionRoles}
            selected={safeSelectedRoles}
            simple={false}
            maxSelected={selection.maxRoleCount}
            disabled={busy || !request.approvalPolicy.canApprove}
            legend={`Roles granted to ${applicantName}`}
            selectLabel={`${capitalize(tenantSingular)} roles for ${applicantName}`}
            actionContext={`to ${applicantName}`}
            onChange={setSelectedRoles}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !canApprove}
              onClick={approve}
            >
              {request.reactivationRequired ? 'Re-admit' : 'Approve'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              aria-haspopup="dialog"
              onClick={(event) => onDeny(event.currentTarget)}
            >
              Deny
            </Button>
          </div>
        </div>
      )}

      {request.status === 'pending' && !request.approvalPolicy.canApprove && (
        <p className="mt-3 text-xs text-muted-foreground">
          Your current role can review this request but cannot grant its
          required {tenantSingular} access.
        </p>
      )}
    </div>
  );
}

/** @internal Drop stale or injected keys before an approval mutation. */
export function filterJoinRequestApprovalRoles(
  policy: AuthTenantJoinRequest['approvalPolicy'],
  selectedRoles: readonly string[],
): string[] {
  if (policy.roleSelection.mode !== 'selectable') return [];
  const allowed = new Set(policy.roleSelection.roles.map((role) => role.key));
  return [...new Set(selectedRoles)]
    .filter((role) => allowed.has(role))
    .slice(0, policy.roleSelection.maxRoleCount);
}

/** @internal Omit roles for server-fixed/default approval contracts. */
export function joinRequestApprovalParams(
  policy: AuthTenantJoinRequest['approvalPolicy'],
  selectedRoles: readonly string[],
  reactivateMembership: boolean,
  expectedRequestRevision: number,
): AuthTenantReviewJoinRequestParams {
  const roles = filterJoinRequestApprovalRoles(policy, selectedRoles);
  return {
    expectedRequestRevision,
    ...(policy.roleSelection.mode === 'selectable' ? { roles } : {}),
    ...(reactivateMembership ? { reactivateMembership: true } : {}),
  };
}

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
