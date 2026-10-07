'use client';

/**
 * mfa-management-panel.tsx
 *
 * Renders current-user MFA status and setup entry points. This file owns
 * account-settings UI only; MFA policy and method persistence remain backend
 * responsibilities.
 */

import * as React from 'react';

import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import type { AuthActions } from '../../frontend/client/auth-hooks';
import { AuthorizationScopeBoundaryFence, useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { cn } from '#zero/lib/utils';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { Card, CardContent } from '#zero/components/ui/card';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { MFAEnrollmentForm } from '#zero/components/auth/mfa-enrollment-form';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { CircleCheck } from '#zero/components/animate-ui/icons/circle-check';
import { CircleX } from '#zero/components/animate-ui/icons/circle-x';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import { AuthConfigLoadState } from './auth-config-load-state';
import { resolveMfaManagementCapability, type MfaManagementCapability } from './mfa-management-policy';
import { useMfaManagementMethods } from './use-mfa-management-methods';

export interface MFAManagementPanelProps {
  className?: string;
}
/** Display and enroll current-user MFA methods. */
export function MFAManagementPanel({ className }: MFAManagementPanelProps) {
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const boundary = useAuthorizationScopeBoundary();
  const capability = resolveMfaManagementCapability(authConfig);
  const scopeKey = JSON.stringify([boundary.key, boundary.ready, auth.user?.userId ?? null,
    auth.isAuthenticated, capability.kind, capability.kind === 'enabled' ? capability.key : null]);
  const fence = React.useRef(new AuthorizationScopeBoundaryFence());
  const revision = fence.current.update(scopeKey);
  const canReadScope = boundary.ready && auth.isAuthenticated && auth.user !== null;
  const isCurrentScope = React.useCallback(() => fence.current.isCurrent(revision)
    && canReadScope, [revision, canReadScope]);

  if (capability.kind === 'disabled') return null;
  if (capability.kind !== 'enabled') {
    // Public config refresh retains its previous snapshot. Never let that
    // retained snapshot authorize setup while the current request is pending.
    return <AuthConfigLoadState
      state={{ ...authConfig, config: null,
        status: capability.kind === 'loading' ? 'loading' : 'error',
        isLoading: capability.kind === 'loading',
        error: capability.kind === 'unavailable' ? authConfig.error ?? 'MFA policy was unavailable.' : null }}
      loadingMessage="Loading MFA policy…" unavailableMessage="MFA policy could not be loaded."
      showUnknown className={className} />;
  }
  if (!boundary.ready || auth.isLoading) {
    return <p role="status" aria-live="polite" className={cn('text-sm text-muted-foreground', className)}>Loading account security…</p>;
  }
  if (!auth.isAuthenticated || !auth.user) return null;
  return <MFAManagementPanelScope key={revision} className={className}
    capability={capability} listMfaMethods={auth.listMfaMethods} isCurrentScope={isCurrentScope} />;
}

function MFAManagementPanelScope({ className, capability, listMfaMethods, isCurrentScope }: MFAManagementPanelProps & {
  capability: Extract<MfaManagementCapability, { kind: 'enabled' }>;
  listMfaMethods: AuthActions['listMfaMethods'];
  isCurrentScope: () => boolean;
}) {
  const { methods, required, loading, error, reload } = useMfaManagementMethods(listMfaMethods, isCurrentScope);
  const [enrolling, setEnrolling] = React.useState(false);
  const activeMethods = methods.filter((method) => method.status === 'active');
  const canEnroll = capability.canEnroll && !loading && !error && activeMethods.length === 0;
  if (enrolling && canEnroll) {
    return (
      <MFAEnrollmentForm
        methods={capability.methods}
        allowUserChoice={capability.config.allowUserChoice}
        onSuccess={async () => {
          if (!isCurrentScope()) return;
          setEnrolling(false);
          await reload();
        }}
        onBack={() => { if (isCurrentScope()) setEnrolling(false); }}
        className={className}
      />
    );
  }

  return (
    <Card className={cn(className)}>
      <CardContent className="space-y-4 p-5">
        <AuthHeader
          title="Two-factor authentication"
          description="Protect this account with an email code or authenticator app."
        />

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" role="status" aria-live="polite">
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
            Loading MFA settings
          </div>
        ) : error ? (
          <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span className="flex items-start gap-2">
              <AnimateIcon animate>
                <CircleX size={16} />
              </AnimateIcon>
              {error}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
              Retry
            </Button>
          </div>
        ) : activeMethods.length > 0 ? (
          <div className="space-y-2">
            {activeMethods.map((method) => (
              <div
                key={method.methodId}
                className="flex items-center justify-between rounded-md border border-border/75 bg-muted/25 px-3 py-2"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AnimateIcon animate>
                    <CircleCheck size={16} className="text-success" />
                  </AnimateIcon>
                  {method.type === 'totp' ? 'Authenticator app' : 'Email code'}
                </div>
                <Badge variant={required ? 'default' : 'outline'}>
                  {required ? 'Required' : 'Active'}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-border/75 bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
            Two-factor authentication is not set up for this account.
          </div>
        )}

        {!capability.canEnroll && !loading && !error && activeMethods.length === 0 && (
          <p role="status" className="text-sm text-muted-foreground">Two-factor setup is currently unavailable. Contact an administrator.</p>
        )}
        {canEnroll && (
          <Button type="button" className="w-full" onClick={() => { if (isCurrentScope()) setEnrolling(true); }}>
            Set up two-factor
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
