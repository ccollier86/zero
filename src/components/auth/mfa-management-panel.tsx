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
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AuthHeader } from '@/components/auth/auth-header';
import { MFAEnrollmentForm } from '@/components/auth/mfa-enrollment-form';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { CircleCheck } from '@/components/animate-ui/icons/circle-check';
import { CircleX } from '@/components/animate-ui/icons/circle-x';
import { Loader } from '@/components/animate-ui/icons/loader';

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
      setError(err instanceof Error ? err.message : 'Failed to load MFA settings');
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

  if (enrolling) {
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

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <AnimateIcon animate loop>
              <Loader size={16} />
            </AnimateIcon>
            Loading MFA settings
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AnimateIcon animate>
              <CircleX size={16} />
            </AnimateIcon>
            {error}
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
                    <CircleCheck size={16} className="text-green-600" />
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
            MFA is not enabled for this account.
          </div>
        )}

        {mfaConfig?.enabled && mfaConfig.ready && activeMethods.length === 0 && (
          <Button type="button" className="w-full" onClick={() => setEnrolling(true)}>
            Set up two-factor
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
