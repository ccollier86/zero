'use client';

import * as React from 'react';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { useTenantOnboardingAdministration } from '../../frontend/client/tenant-administration-hooks';
import { Button } from '#zero/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#zero/components/ui/card';
import { AlertDialog } from '#zero/components/animate-ui/components/radix/alert-dialog';
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
import {
  OnboardingConfirmationDialog,
  onboardingConfirmationKey,
  canSubmitTenantInvitation,
  resolveInvitationDeliveryMode,
  resolveTenantOnboardingSectionPhase,
  tenantOnboardingManagementBoundaryKey,
  tenantOnboardingConfirmationAnnouncement,
  TenantOnboardingSectionStatus,
  TenantOnboardingTenantKindNotice,
  type OnboardingConfirmation,
} from './tenant-onboarding-management-parts';

export {
  filterJoinRequestApprovalRoles,
  JoinRequestRow,
  joinRequestApprovalParams,
} from './tenant-join-request-row';
export {
  onboardingConfirmationKey,
  canSubmitTenantInvitation,
  resolveInvitationDeliveryMode,
  resolveTenantOnboardingSectionPhase,
  tenantOnboardingManagementBoundaryKey,
  tenantOnboardingConfirmationAnnouncement,
  TenantOnboardingSectionStatus,
  TenantOnboardingTenantKindNotice,
  type OnboardingConfirmation,
  type TenantOnboardingSectionPhase,
} from './tenant-onboarding-management-parts';

export interface TenantOnboardingManagementProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
}

/** Accessible active-tenant invitation and join-request control surface. */
export function TenantOnboardingManagement(
  props: TenantOnboardingManagementProps,
) {
  const auth = useAuth();
  const authorizationBoundary = useAuthorizationScopeBoundary();
  const boundary = tenantOnboardingManagementBoundaryKey(
    authorizationBoundary.key,
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
  );
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
  const [manualTokenError, setManualTokenError] = React.useState<string | null>(null);
  const [inviteRoles, setInviteRoles] = React.useState<string[]>([]);
  const [confirmation, setConfirmation] = React.useState<OnboardingConfirmation | null>(null);
  const [focusAfterMutation, setFocusAfterMutation] = React.useState<{
    target: 'invitations' | 'join-requests';
    sawLoading: boolean;
  } | null>(null);
  const [invitationLocalError, setInvitationLocalError] =
    React.useState<string | null>(null);
  const [joinRequestLocalError, setJoinRequestLocalError] =
    React.useState<string | null>(null);
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
    if (!canSubmitTenantInvitation(
      email,
      canChooseInvitationRoles,
      inviteRoles,
    )) return;
    const invitedEmail = email.trim();
    setInvitationLocalError(null);
    setManualToken(null);
    setManualTokenError(null);
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
      setInvitationLocalError(errorMessage(cause, tenantSingular));
    }
  }

  async function mutateInvitation(
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> {
    setInvitationLocalError(null);
    setAnnouncement('');
    try {
      await operation();
      setAnnouncement(success);
      return true;
    } catch (cause) {
      setInvitationLocalError(errorMessage(cause, tenantSingular));
      return false;
    }
  }

  async function mutateJoinRequest(
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> {
    setJoinRequestLocalError(null);
    setAnnouncement('');
    try {
      await operation();
      setAnnouncement(success);
      return true;
    } catch (cause) {
      setJoinRequestLocalError(errorMessage(cause, tenantSingular));
      return false;
    }
  }

  async function confirmOnboardingAction() {
    if (!confirmation) return;
    const pending = confirmation;
    const succeeded = pending.action === 'revoke-invitation'
      ? await mutateInvitation(
          () => onboarding.revokeInvitation(pending.invitation.invitationId),
          tenantOnboardingConfirmationAnnouncement(pending),
        )
      : await mutateJoinRequest(
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
    setManualTokenError(null);
    setAnnouncement('');
    try {
      await writeAuthClipboardText(manualToken);
      setAnnouncement('Copied one-time invitation token');
    } catch (cause) {
      setManualTokenError(errorMessage(cause, tenantSingular));
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
    && onboarding.invitationsEnabled === true
    && availableModes.length > 0
    && (!administrationScope || canChooseInvitationRoles);
  const canReviewJoinRequests = !administrationScope
    && onboarding.joinRequestsEnabled === true
    && capabilities?.canReviewJoinRequests === true;

  const invitationPhase = resolveTenantOnboardingSectionPhase({
    authConfigStatus: onboarding.authConfigStatus,
    featureEnabled: onboarding.invitationsEnabled,
    isLoading: onboarding.isLoadingInvitations,
    isTenantConfigLoading: onboarding.isLoadingConfig,
    hasTenantConfig: onboarding.config !== null,
    tenantConfigError: onboarding.configError,
    isTenantConfigPermissionDenied: onboarding.isConfigPermissionDenied,
    isPermissionDenied: onboarding.isInvitationsPermissionDenied,
    error: confirmation?.action === 'revoke-invitation'
      ? null
      : invitationLocalError ?? onboarding.invitationsError,
  });
  const joinRequestPhase = administrationScope
    ? 'disabled'
    : resolveTenantOnboardingSectionPhase({
        authConfigStatus: onboarding.authConfigStatus,
        featureEnabled: onboarding.joinRequestsEnabled,
        isLoading: onboarding.isLoadingJoinRequests,
        isTenantConfigLoading: onboarding.isLoadingConfig,
        hasTenantConfig: onboarding.config !== null,
        tenantConfigError: onboarding.configError,
        isTenantConfigPermissionDenied: onboarding.isConfigPermissionDenied,
        isPermissionDenied: onboarding.isJoinRequestsPermissionDenied,
        error: confirmation?.action === 'deny-join-request'
          ? null
          : joinRequestLocalError ?? onboarding.joinRequestsError,
      });
  const effectiveJoinRequestPhase = joinRequestPhase === 'ready'
    && !canReviewJoinRequests
    ? 'permission-denied'
    : joinRequestPhase;

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
    const targetLoading = focusAfterMutation.target === 'invitations'
      ? onboarding.isLoadingInvitations
      : onboarding.isLoadingJoinRequests;
    if (targetLoading && !focusAfterMutation.sawLoading) {
      setFocusAfterMutation((current) => current && ({ ...current, sawLoading: true }));
      return;
    }
    if (!targetLoading && focusAfterMutation.sawLoading) {
      const target = focusAfterMutation.target === 'invitations'
        ? invitationsHeadingRef.current
        : joinRequestsHeadingRef.current;
      target?.focus();
      setFocusAfterMutation(null);
    }
  }, [
    focusAfterMutation,
    onboarding.isLoadingInvitations,
    onboarding.isLoadingJoinRequests,
  ]);

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
        </CardHeader>
        <CardContent className="space-y-6 pt-5">
          <TenantOnboardingTenantKindNotice kind={tenantKind} />

          <AlertDialog
            open={confirmation !== null}
            onOpenChange={(open) => {
              const confirmationBusy = confirmation?.action === 'revoke-invitation'
                ? onboarding.isMutatingInvitations
                : onboarding.isMutatingJoinRequests;
              if (!open && !confirmationBusy) setConfirmation(null);
            }}
          >
            {confirmation && (
              <OnboardingConfirmationDialog
                key={onboardingConfirmationKey(confirmation)}
                confirmation={confirmation}
                busy={confirmation.action === 'revoke-invitation'
                  ? onboarding.isMutatingInvitations
                  : onboarding.isMutatingJoinRequests}
                error={confirmation.action === 'revoke-invitation'
                  ? invitationLocalError
                  : joinRequestLocalError}
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

          {tenantKind === null ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {capitalize(tenantSingular)} onboarding controls require signing
              in with active {tenantSingular} access.
            </div>
          ) : (
            <>
              {manualToken && (
                <ManualInvitationToken
                  token={manualToken}
                  headingId={manualInvitationHeadingId}
                  copyError={manualTokenError}
                  onCopy={() => void copyManualInvitationToken()}
                  onDismiss={() => {
                    setManualToken(null);
                    setManualTokenError(null);
                  }}
                />
              )}
              {invitationPhase === 'ready' ? (
                <div className="space-y-4">
                  {canIssueInvitations && (
                    <TenantInvitationComposer
                      email={email}
                      mode={effectiveMode}
                      emailDelivery={delivery?.email === true}
                      manualDelivery={delivery?.manual === true}
                      busy={onboarding.isMutatingInvitations}
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
                      Inviting a platform administrator requires authority to
                      grant at least one administration role.
                    </p>
                  )}
                  <TenantInvitationList
                    headingId={invitationsHeadingId}
                    headingRef={invitationsHeadingRef}
                    invitations={onboarding.invitations}
                    roleLabels={roleLabels}
                    canManage={capabilities?.canManageInvitations === true}
                    busy={onboarding.isMutatingInvitations}
                    hasMore={onboarding.invitationPage?.hasMore === true}
                    isLoadingMore={onboarding.isLoadingMoreInvitations}
                    onLoadMore={() => void onboarding.loadMoreInvitations()}
                    onRevoke={(invitation, trigger) => {
                      confirmationTriggerRef.current = trigger;
                      setInvitationLocalError(null);
                      setConfirmation({ action: 'revoke-invitation', invitation });
                    }}
                  />
                </div>
              ) : (
                <TenantOnboardingSectionStatus
                  headingId={invitationsHeadingId}
                  headingRef={invitationsHeadingRef}
                  title="Invitations"
                  phase={invitationPhase}
                  loadingPolicyMessage="Loading invitation policy…"
                  loadingMessage="Loading invitations…"
                  configErrorMessage="Invitation policy could not be loaded."
                  tenantConfigErrorMessage="Tenant onboarding access could not be loaded."
                  disabledMessage="Invitations are disabled by application policy."
                  permissionDeniedMessage="Invitation history is not available for your current role."
                  transportError={invitationLocalError ?? onboarding.invitationsError}
                  busy={onboarding.isLoadingConfig
                    || onboarding.isLoadingInvitations
                    || onboarding.isMutatingInvitations}
                  onRetry={() => {
                    setInvitationLocalError(null);
                    onboarding.reloadInvitations();
                  }}
                />
              )}

              {effectiveJoinRequestPhase === 'ready' ? (
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
                          busy={onboarding.isMutatingJoinRequests}
                          tenantSingular={tenantSingular}
                          onApprove={(params) =>
                            mutateJoinRequest(
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
                            setJoinRequestLocalError(null);
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
              ) : (
                <TenantOnboardingSectionStatus
                  headingId={joinRequestsHeadingId}
                  headingRef={joinRequestsHeadingRef}
                  title="Join requests"
                  phase={effectiveJoinRequestPhase}
                  loadingPolicyMessage="Loading join-request policy…"
                  loadingMessage="Loading join requests…"
                  configErrorMessage="Join-request policy could not be loaded."
                  tenantConfigErrorMessage="Tenant onboarding access could not be loaded."
                  disabledMessage={administrationScope
                    ? 'Join requests are unavailable in the protected administration scope.'
                    : 'Join requests are disabled by application policy.'}
                  permissionDeniedMessage="Join-request review is not available for your current role."
                  transportError={joinRequestLocalError ?? onboarding.joinRequestsError}
                  busy={onboarding.isLoadingConfig
                    || onboarding.isLoadingJoinRequests
                    || onboarding.isMutatingJoinRequests}
                  onRetry={() => {
                    setJoinRequestLocalError(null);
                    onboarding.reloadJoinRequests();
                  }}
                />
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

function errorMessage(cause: unknown, tenantSingular: string): string {
  return cause instanceof Error
    ? cause.message
    : `${capitalize(tenantSingular)} onboarding request failed`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
