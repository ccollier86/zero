'use client';

import * as React from 'react';
import type {
  AuthTenantJoinRequest,
  AuthTenantReviewJoinRequestParams,
} from '../../frontend/client/auth-types';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
import { TenantRolePicker } from './tenant-role-picker';

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

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
