'use client';

import * as React from 'react';
import type {
  AuthTenantInvitation,
  AuthTenantJoinRequest,
} from '../../frontend/client/auth-types';
import type { AuthConfigStatus } from '../../frontend/client/auth-hooks';
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#zero/components/animate-ui/components/radix/alert-dialog';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';

export type OnboardingConfirmation =
  | { action: 'revoke-invitation'; invitation: AuthTenantInvitation }
  | { action: 'deny-join-request'; request: AuthTenantJoinRequest };

export type TenantOnboardingSectionPhase =
  | 'loading-policy'
  | 'config-error'
  | 'tenant-config-error'
  | 'disabled'
  | 'loading'
  | 'permission-denied'
  | 'transport-error'
  | 'ready';

/** Remount sensitive local state for every authorization-family boundary. */
export function tenantOnboardingManagementBoundaryKey(
  authorizationBoundaryKey: string,
  userId: string | null,
  tenantId: string | null,
): string {
  return JSON.stringify([authorizationBoundaryKey, userId, tenantId]);
}

/** Match keyboard/programmatic submission to the composer's disabled state. */
export function canSubmitTenantInvitation(
  email: string,
  rolesRequired: boolean,
  roles: readonly string[],
): boolean {
  return email.trim().length > 0 && (!rolesRequired || roles.length > 0);
}

/** Deterministic state selection keeps sibling sections independent. */
export function resolveTenantOnboardingSectionPhase({
  authConfigStatus,
  featureEnabled,
  isLoading,
  isTenantConfigLoading,
  hasTenantConfig,
  tenantConfigError,
  isTenantConfigPermissionDenied,
  isPermissionDenied,
  error,
}: {
  authConfigStatus: AuthConfigStatus;
  featureEnabled: boolean | null;
  isLoading: boolean;
  isTenantConfigLoading: boolean;
  hasTenantConfig: boolean;
  tenantConfigError: string | null;
  isTenantConfigPermissionDenied: boolean;
  isPermissionDenied: boolean;
  error: string | null;
}): TenantOnboardingSectionPhase {
  if (authConfigStatus === 'unknown'
    || authConfigStatus === 'loading'
    || featureEnabled === null) return 'loading-policy';
  if (authConfigStatus === 'error') return 'config-error';
  if (!featureEnabled) return 'disabled';
  if (isTenantConfigPermissionDenied) return 'permission-denied';
  if (tenantConfigError) return 'tenant-config-error';
  if (isTenantConfigLoading || !hasTenantConfig) return 'loading';
  if (isPermissionDenied) return 'permission-denied';
  if (error) return 'transport-error';
  if (isLoading) return 'loading';
  return 'ready';
}

/** Accessible state panel shared by the two onboarding slices. */
export function TenantOnboardingSectionStatus({
  headingId,
  headingRef,
  title,
  phase,
  loadingPolicyMessage,
  loadingMessage,
  configErrorMessage,
  tenantConfigErrorMessage,
  disabledMessage,
  permissionDeniedMessage,
  transportError,
  busy,
  onRetry,
}: {
  headingId: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  title: string;
  phase: Exclude<TenantOnboardingSectionPhase, 'ready'>;
  loadingPolicyMessage: string;
  loadingMessage: string;
  configErrorMessage: string;
  tenantConfigErrorMessage: string;
  disabledMessage: string;
  permissionDeniedMessage: string;
  transportError: string | null;
  busy: boolean;
  onRetry(): void;
}) {
  const retryable = phase === 'config-error'
    || phase === 'tenant-config-error'
    || phase === 'transport-error';
  const loading = phase === 'loading-policy' || phase === 'loading';
  const message = phase === 'loading-policy'
    ? loadingPolicyMessage
    : phase === 'config-error'
      ? configErrorMessage
      : phase === 'tenant-config-error'
        ? tenantConfigErrorMessage
        : phase === 'disabled'
          ? disabledMessage
          : phase === 'permission-denied'
            ? permissionDeniedMessage
            : phase === 'transport-error'
              ? transportError ?? `${title} could not be loaded.`
              : loadingMessage;
  return (
    <section aria-labelledby={headingId}>
      <h3
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        className="text-sm font-semibold"
      >
        {title}
      </h3>
      <div
        role={retryable ? 'alert' : loading ? 'status' : undefined}
        aria-live={loading ? 'polite' : undefined}
        className={cn(
          'mt-3 flex flex-col gap-3 rounded-md border border-dashed px-4 py-5 text-sm sm:flex-row sm:items-center sm:justify-between',
          retryable
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'text-muted-foreground',
        )}
      >
        <span>{message}</span>
        {retryable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
      </div>
    </section>
  );
}

/** Makes protected-scope exclusions explicit in the generic onboarding UI. */
export function TenantOnboardingTenantKindNotice({
  kind,
}: { kind: 'administration' | 'organization' | null }) {
  if (kind !== 'administration') return null;
  return (
    <p
      className="rounded-md border border-border/70 bg-muted/25 p-3 text-sm text-muted-foreground"
      role="note"
    >
      Platform administration supports invitations only. Customer join
      requests and verified-domain onboarding are unavailable in this
      protected scope. Use PlatformAdministrationManagement for the full
      administrator membership and ownership controls.
    </p>
  );
}

export function OnboardingConfirmationDialog({
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

/** Stable dialog identity for retained onboarding decisions. */
export function onboardingConfirmationKey(
  confirmation: OnboardingConfirmation,
): string {
  return confirmation.action === 'revoke-invitation'
    ? `${confirmation.action}:${confirmation.invitation.invitationId}`
    : `${confirmation.action}:${confirmation.request.joinRequestId}:${confirmation.request.requestRevision}`;
}

/** Specific live-region copy for confirmed onboarding decisions. */
export function tenantOnboardingConfirmationAnnouncement(
  confirmation: OnboardingConfirmation,
): string {
  return confirmation.action === 'revoke-invitation'
    ? `Revoked invitation for ${confirmation.invitation.email}`
    : `Denied request from ${confirmation.request.applicant.email}`;
}

/** Keep the first submission inside the loaded delivery policy. */
export function resolveInvitationDeliveryMode(
  current: 'email' | 'manual',
  configuredDefault: 'email' | 'manual',
  available: readonly ('email' | 'manual')[],
): 'email' | 'manual' {
  if (available.includes(current)) return current;
  if (available.includes(configuredDefault)) return configuredDefault;
  return available[0] ?? current;
}
