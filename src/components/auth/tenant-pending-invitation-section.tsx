'use client';

import * as React from 'react';
import { toast } from 'sonner';
import type {
  AuthTenantInvitation,
  AuthTenantInvitationPage,
} from '../../frontend/client/auth-types';
import type { AuthConfigStatus } from '../../frontend/client/auth-hooks';
import { AlertDialog } from '#zero/components/animate-ui/components/radix/alert-dialog';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import { TenantInvitationList } from './tenant-onboarding-invitations';
import {
  OnboardingConfirmationDialog,
  TenantOnboardingSectionStatus,
  onboardingConfirmationKey,
  resolveTenantOnboardingSectionPhase,
  type OnboardingConfirmation,
} from './tenant-onboarding-management-parts';

type RevokeConfirmation = Extract<
  OnboardingConfirmation,
  { action: 'revoke-invitation' }
>;

export interface TenantPendingInvitationSectionProps {
  authConfigStatus: AuthConfigStatus;
  featureEnabled: boolean | null;
  isTenantConfigLoading: boolean;
  hasTenantConfig: boolean;
  tenantConfigError: string | null;
  isTenantConfigPermissionDenied: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isMutating: boolean;
  isPermissionDenied: boolean;
  error: string | null;
  invitations: readonly AuthTenantInvitation[];
  page: AuthTenantInvitationPage['page'] | null;
  roleLabels: ReadonlyMap<string, string>;
  canManage: boolean;
  tenantSingular: string;
  onReload(): void;
  onLoadMore(): Promise<void>;
  onRevoke(invitationId: string): Promise<AuthTenantInvitation>;
  onRevoked?(invitation: AuthTenantInvitation): void;
  onAnnounce(message: string): void;
}

/** Pending invitation history and revoke lifecycle inside the Invite dialog. */
export function TenantPendingInvitationSection({
  authConfigStatus,
  featureEnabled,
  isTenantConfigLoading,
  hasTenantConfig,
  tenantConfigError,
  isTenantConfigPermissionDenied,
  isLoading,
  isLoadingMore,
  isMutating,
  isPermissionDenied,
  error,
  invitations,
  page,
  roleLabels,
  canManage,
  tenantSingular,
  onReload,
  onLoadMore,
  onRevoke,
  onRevoked,
  onAnnounce,
}: TenantPendingInvitationSectionProps) {
  const [confirmation, setConfirmation] = React.useState<RevokeConfirmation | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const mountedRef = React.useRef(true);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const headingId = React.useId();

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (canManage) return;
    setConfirmation(null);
    setLocalError(null);
  }, [canManage]);

  React.useEffect(() => {
    if (!confirmation || isLoading) return;
    if (invitations.some((item) => (
      item.invitationId === confirmation.invitation.invitationId
    ))) return;
    setConfirmation(null);
    setLocalError(null);
  }, [confirmation, invitations, isLoading]);

  const phase = resolveTenantOnboardingSectionPhase({
    authConfigStatus,
    featureEnabled,
    isLoading,
    isTenantConfigLoading,
    hasTenantConfig,
    tenantConfigError,
    isTenantConfigPermissionDenied,
    isPermissionDenied,
    error: confirmation ? null : localError ?? error,
  });

  async function confirmRevoke() {
    if (!confirmation) return;
    const pending = confirmation;
    setLocalError(null);
    try {
      const revoked = await onRevoke(pending.invitation.invitationId);
      if (!mountedRef.current) return;
      const message = `Revoked invitation for ${pending.invitation.email}`;
      setConfirmation(null);
      toast.success(message);
      try {
        onRevoked?.(revoked);
      } catch (callbackError) {
        reportAuthUiError('tenantInvitationRevokedCallback', callbackError);
      }
      try {
        onAnnounce(message);
      } catch (callbackError) {
        reportAuthUiError('tenantInvitationAnnouncementCallback', callbackError);
      }
      requestAnimationFrameSafe(() => headingRef.current?.focus());
    } catch (cause) {
      if (!mountedRef.current) return;
      setLocalError(getAuthDisplayMessage(
        cause,
        `Unable to revoke this ${tenantSingular} invitation.`,
      ));
    }
  }

  return (
    <div className="border-t border-border/70 pt-4">
      {phase === 'ready' ? (
        <TenantInvitationList
          headingId={headingId}
          headingRef={headingRef}
          title="Pending invitations"
          emptyMessage="No pending invitations."
          invitations={invitations}
          roleLabels={roleLabels}
          canManage={canManage}
          busy={isMutating}
          hasMore={page?.hasMore === true}
          isLoadingMore={isLoadingMore}
          onLoadMore={() => { void onLoadMore(); }}
          onRevoke={(invitation, trigger) => {
            triggerRef.current = trigger;
            setLocalError(null);
            setConfirmation({ action: 'revoke-invitation', invitation });
          }}
        />
      ) : (
        <TenantOnboardingSectionStatus
          headingId={headingId}
          headingRef={headingRef}
          title="Pending invitations"
          phase={phase}
          loadingPolicyMessage="Loading invitation policy…"
          loadingMessage="Loading pending invitations…"
          configErrorMessage="Invitation policy could not be loaded."
          tenantConfigErrorMessage="Invitation access could not be loaded."
          disabledMessage="Invitations are disabled by application policy."
          permissionDeniedMessage="Pending invitation history is unavailable for your current role."
          transportError={localError ?? error}
          busy={isLoading || isMutating}
          onRetry={() => {
            setLocalError(null);
            onReload();
          }}
        />
      )}

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isMutating) {
            setConfirmation(null);
            setLocalError(null);
          }
        }}
      >
        {confirmation && (
          <OnboardingConfirmationDialog
            key={onboardingConfirmationKey(confirmation)}
            confirmation={confirmation}
            busy={isMutating}
            error={localError}
            onConfirm={() => { void confirmRevoke(); }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (triggerRef.current?.isConnected) triggerRef.current.focus();
              else headingRef.current?.focus();
            }}
          />
        )}
      </AlertDialog>
    </div>
  );
}

function requestAnimationFrameSafe(callback: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback);
    return;
  }
  callback();
}
