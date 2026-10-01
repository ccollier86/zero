'use client';

import * as React from 'react';
import { toast } from 'sonner';
import type { AuthTenantIssueInvitationResult } from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { useTenantOnboardingAdministration } from '../../frontend/client/tenant-administration-hooks';
import type { RecordPrimaryAction } from '#zero/components/ui/record-navigation-bar';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import { writeAuthClipboardText } from './auth-clipboard';
import { createAuthRoleLabelMap } from './auth-role-presentation';
import {
  boundedTenantInvitationPageSize,
  projectTenantInvitationRoles,
  resolveTenantInvitationActionPolicy,
  type TenantInvitationDeliveryMode,
} from './tenant-invitation-action-policy';
import { TenantInvitationDialog } from './tenant-invitation-dialog';
import { TenantPendingInvitationSection } from './tenant-pending-invitation-section';
import {
  canSubmitTenantInvitation,
  tenantOnboardingManagementBoundaryKey,
} from './tenant-onboarding-management-parts';

export interface UseTenantInvitationActionOptions {
  label?: string;
  pageSize?: number;
  /** Receives only a current-scope result after the SDK's mutation fence settles. */
  onInvitationIssued?: (result: AuthTenantIssueInvitationResult) => void;
}

export interface UseTenantInvitationActionResult {
  secondaryPrimaryAction: RecordPrimaryAction | undefined;
  dialog: React.ReactNode;
  canInvite: boolean;
  canViewPendingInvitations: boolean;
}

/**
 * Compose tenant invitation into a member control plane without introducing a
 * second page-level management surface. The protected SDK hook owns authority,
 * mutation fencing, standardized errors, and refresh behavior.
 */
export function useTenantInvitationAction(
  options: UseTenantInvitationActionOptions = {},
): UseTenantInvitationActionResult {
  const auth = useAuth();
  const publicConfig = useAuthConfig();
  const authorizationBoundary = useAuthorizationScopeBoundary();
  const onboarding = useTenantOnboardingAdministration({
    limit: boundedTenantInvitationPageSize(options.pageSize),
    invitationStatus: 'pending',
  });
  const tenantKind = auth.activeTenant?.kind ?? null;
  const configuredTenantSingular =
    publicConfig.config?.tenancy?.terminology?.singular ?? 'organization';
  const tenantSingular = tenantKind === 'administration'
    ? 'platform administration'
    : configuredTenantSingular;
  const policy = React.useMemo(() => resolveTenantInvitationActionPolicy({
    publicConfig: publicConfig.config,
    administrationConfig: onboarding.config,
    invitationsEnabled: onboarding.invitationsEnabled,
    tenantKind,
  }), [
    onboarding.config,
    onboarding.invitationsEnabled,
    publicConfig.config,
    tenantKind,
  ]);
  const roleLabels = React.useMemo(
    () => createAuthRoleLabelMap(onboarding.config?.roles ?? []),
    [onboarding.config?.roles],
  );
  const boundaryKey = tenantOnboardingManagementBoundaryKey(
    authorizationBoundary.key,
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
  );
  const boundaryRef = React.useRef(boundaryKey);
  const generationRef = React.useRef(0);
  if (boundaryRef.current !== boundaryKey) {
    boundaryRef.current = boundaryKey;
    generationRef.current += 1;
  }

  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [mode, setMode] = React.useState<TenantInvitationDeliveryMode>(
    policy.defaultMode,
  );
  const [roles, setRoles] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [manualToken, setManualToken] = React.useState<string | null>(null);
  const [manualInvitationId, setManualInvitationId] = React.useState<string | null>(null);
  const [manualTokenError, setManualTokenError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const [stateBoundaryKey, setStateBoundaryKey] = React.useState(boundaryKey);
  const stateIsCurrent = stateBoundaryKey === boundaryKey;

  const clearSensitiveState = React.useCallback(() => {
    setManualToken(null);
    setManualInvitationId(null);
    setManualTokenError(null);
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    setEmail('');
    setError(null);
    clearSensitiveState();
  }, [clearSensitiveState]);

  React.useEffect(() => {
    setOpen(false);
    setEmail('');
    setError(null);
    setAnnouncement('');
    clearSensitiveState();
    setStateBoundaryKey(boundaryKey);
  }, [boundaryKey, clearSensitiveState]);

  React.useEffect(() => {
    setMode((current) => policy.availableModes.includes(current)
      ? current
      : policy.defaultMode);
    setRoles((current) => projectTenantInvitationRoles(
      current,
      policy.roleChoices,
      policy.simple,
    ));
    if (!policy.canIssue) clearSensitiveState();
    if (!policy.canOpen) {
      setOpen(false);
    }
  }, [
    clearSensitiveState,
    policy.availableModes.join('|'),
    policy.canIssue,
    policy.canOpen,
    policy.defaultMode,
    policy.roleChoices.map((role) => role.key).join('|'),
    policy.simple,
  ]);

  const openDialog = React.useCallback(() => {
    if (!policy.canOpen) return;
    setEmail('');
    setMode(policy.defaultMode);
    setRoles(projectTenantInvitationRoles([], policy.roleChoices, policy.simple));
    setError(null);
    setAnnouncement('');
    clearSensitiveState();
    if (policy.canRead) onboarding.reloadInvitations();
    setOpen(true);
  }, [clearSensitiveState, onboarding.reloadInvitations, policy]);

  const issue = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!policy.canIssue || !canSubmitTenantInvitation(
      email,
      policy.canChooseRoles,
      roles,
    )) return;
    const operationGeneration = generationRef.current;
    const invitedEmail = email.trim();
    setError(null);
    setAnnouncement('');
    clearSensitiveState();
    try {
      const result = await onboarding.issueInvitation({
        email: invitedEmail,
        delivery: mode,
        ...(policy.canChooseRoles ? { roles } : {}),
      });
      if (generationRef.current !== operationGeneration) return;
      setEmail('');
      setAnnouncement(`Created invitation for ${invitedEmail}`);
      if ('token' in result) {
        setManualToken(result.token);
        setManualInvitationId(result.invitation.invitationId);
        toast.success(`Invitation created for ${invitedEmail}`);
      } else {
        toast.success(`Invitation email queued for ${invitedEmail}`);
      }
      try {
        options.onInvitationIssued?.(result);
      } catch (callbackError) {
        reportAuthUiError('tenantInvitationIssuedCallback', callbackError);
      }
    } catch (cause) {
      if (generationRef.current !== operationGeneration) return;
      setError(getAuthDisplayMessage(
        cause,
        `Unable to invite this person to the ${tenantSingular}.`,
      ));
    }
  }, [
    clearSensitiveState,
    email,
    mode,
    onboarding.issueInvitation,
    options.onInvitationIssued,
    policy,
    roles,
    tenantSingular,
  ]);

  const copyToken = React.useCallback(async () => {
    if (!manualToken) return;
    const operationGeneration = generationRef.current;
    setManualTokenError(null);
    try {
      await writeAuthClipboardText(manualToken);
      if (generationRef.current !== operationGeneration) return;
      setAnnouncement('Copied one-time invitation token');
      toast.success('One-time invitation token copied');
    } catch (cause) {
      if (generationRef.current !== operationGeneration) return;
      reportAuthUiError('copyTenantInvitationToken', cause);
      setManualTokenError(getAuthDisplayMessage(
        cause,
        'Clipboard access failed.',
      ));
    }
  }, [manualToken]);

  const busy = onboarding.isMutatingInvitations;
  const secondaryPrimaryAction = React.useMemo<RecordPrimaryAction | undefined>(
    () => policy.canOpen && stateIsCurrent ? {
      label: options.label ?? (policy.canIssue ? 'Invite' : 'Invitations'),
      ariaHasPopup: 'dialog',
      disabled: busy,
      onClick: openDialog,
    } : undefined,
    [busy, openDialog, options.label, policy.canIssue, policy.canOpen, stateIsCurrent],
  );

  return {
    secondaryPrimaryAction,
    canInvite: policy.canIssue && stateIsCurrent,
    canViewPendingInvitations: policy.canRead && stateIsCurrent,
    dialog: (
      <>
        <TenantInvitationDialog
          open={stateIsCurrent && open}
          email={email}
          mode={mode}
          availableModes={policy.availableModes}
          roles={policy.roleChoices}
          selectedRoles={roles}
          simple={policy.simple}
          canChooseRoles={policy.canChooseRoles}
          canIssue={policy.canIssue}
          busy={busy}
          error={error}
          manualToken={stateIsCurrent ? manualToken : null}
          manualTokenError={stateIsCurrent ? manualTokenError : null}
          pendingContent={(
            <TenantPendingInvitationSection
              authConfigStatus={onboarding.authConfigStatus}
              featureEnabled={onboarding.invitationsEnabled}
              isTenantConfigLoading={onboarding.isLoadingConfig}
              hasTenantConfig={onboarding.config !== null}
              tenantConfigError={onboarding.configError}
              isTenantConfigPermissionDenied={onboarding.isConfigPermissionDenied}
              isLoading={onboarding.isLoadingInvitations}
              isLoadingMore={onboarding.isLoadingMoreInvitations}
              isMutating={onboarding.isMutatingInvitations}
              isPermissionDenied={onboarding.isInvitationsPermissionDenied}
              error={onboarding.invitationsError}
              invitations={onboarding.invitations}
              page={onboarding.invitationPage}
              roleLabels={roleLabels}
              canManage={onboarding.config?.capabilities.canManageInvitations === true}
              tenantSingular={tenantSingular}
              onReload={onboarding.reloadInvitations}
              onLoadMore={onboarding.loadMoreInvitations}
              onRevoke={onboarding.revokeInvitation}
              onRevoked={(invitation) => {
                if (invitation.invitationId === manualInvitationId) {
                  clearSensitiveState();
                }
              }}
              onAnnounce={setAnnouncement}
            />
          )}
          tenantSingular={tenantSingular}
          onOpenChange={(nextOpen) => {
            if (nextOpen) openDialog();
            else close();
          }}
          onEmailChange={setEmail}
          onModeChange={setMode}
          onRolesChange={setRoles}
          onSubmit={(event) => { void issue(event); }}
          onCopyToken={() => { void copyToken(); }}
          onDismissToken={clearSensitiveState}
        />
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </>
    ),
  };
}
