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
import type { AuthMfaMethod } from '../../frontend/client/auth-client';
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
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';

export interface MFAManagementPanelProps {
  className?: string;
}
/** Display and enroll current-user MFA methods. */
export function MFAManagementPanel({ className }: MFAManagementPanelProps) {
  const { listMfaMethods } = useAuth();
  const authConfig = useAuthConfig();
  const [methods, setMethods] = React.useState<AuthMfaMethod[]>([]);
  const [required, setRequired] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [enrolling, setEnrolling] = React.useState(false);

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listMfaMethods();
      setMethods(result?.methods ?? []);
      setRequired(result?.required ?? false);
    } catch (err) {
      reportAuthUiError('listMfaMethods', err);
      setError(getAuthDisplayMessage(err, 'Failed to load MFA settings'));
    } finally {
      setLoading(false);
    }
  }, [listMfaMethods]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const activeMethods = methods.filter((method) => method.status === 'active');
  const mfaConfig = authConfig.config?.mfa;
  const availableMethods = mfaConfig?.availableMethods.length
    ? mfaConfig.availableMethods
    : mfaConfig?.methods ?? ['totp', 'email'];

  if (enrolling && authConfig.config) {
    return (
      <MFAEnrollmentForm
        methods={availableMethods}
        allowUserChoice={mfaConfig?.allowUserChoice ?? true}
        onSuccess={async () => {
          setEnrolling(false);
          await reload();
        }}
        onBack={() => setEnrolling(false)}
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

        <AuthConfigLoadState
          state={authConfig}
          loadingMessage="Loading MFA policy…"
          unavailableMessage="MFA policy could not be loaded."
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
        ) : authConfig.config ? (
          <div className="rounded-md border border-border/75 bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
            MFA is not enabled for this account.
          </div>
        ) : null}

        {mfaConfig?.enabled && mfaConfig.ready && activeMethods.length === 0 && (
          <Button type="button" className="w-full" onClick={() => setEnrolling(true)}>
            Set up two-factor
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
