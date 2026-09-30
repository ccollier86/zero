'use client';

import * as React from 'react';
import type { AuthDomainOnboardingAdmissionResult } from '../../frontend/client/auth-domain-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useDomainOnboarding } from '../../frontend/client/domain-onboarding-hooks';
import { Button } from '#zero/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#zero/components/ui/card';
import { Input } from '#zero/components/ui/input';
import { cn } from '#zero/lib/utils';
import { AuthConfigLoadState } from './auth-config-load-state';

export interface DomainOnboardingProps {
  /** Pre-session identity proof from login/registration completion, when present. */
  identityContinuation?: string;
  className?: string;
  title?: string;
  description?: string;
  onSubmitted?: (result: AuthDomainOnboardingAdmissionResult) => void;
}

/** Generic-before-proof exact-domain request-to-join flow. */
export function DomainOnboarding(props: DomainOnboardingProps) {
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const publicConfig = authConfig.config;
  if (!publicConfig) {
    return (
      <AuthConfigLoadState
        state={authConfig}
        loadingMessage="Loading company access options…"
        unavailableMessage="Company access options could not be loaded."
        className={props.className}
      />
    );
  }
  const enabled = publicConfig?.tenancy?.onboarding
    ?.verifiedDomains?.enabled === true;
  if (!enabled) return null;
  const tenantSingular = publicConfig?.tenancy?.terminology?.singular ?? 'organization';
  const tenantPlural = publicConfig?.tenancy?.terminology?.plural ?? 'organizations';
  const boundary = JSON.stringify([
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
    props.identityContinuation ?? null,
  ]);
  return (
    <DomainOnboardingScope
      key={boundary}
      {...props}
      title={props.title ?? `Find your ${tenantSingular}`}
      description={props.description
        ?? `Verify your current account email, then request access when one of your ${tenantPlural} has claimed its domain.`}
      tenantSingular={tenantSingular}
    />
  );
}

function DomainOnboardingScope({
  identityContinuation,
  className,
  title,
  description,
  tenantSingular,
  onSubmitted,
}: DomainOnboardingProps & { tenantSingular: string }) {
  const onboarding = useDomainOnboarding({ identityContinuation });
  const requestHeadingId = React.useId();
  const [proofToken, setProofToken] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);

  async function start() {
    setLocalError(null);
    try {
      await onboarding.start();
    } catch (cause) {
      setLocalError(errorMessage(cause));
    }
  }

  async function complete(event: React.FormEvent) {
    event.preventDefault();
    if (!proofToken.trim()) return;
    setLocalError(null);
    try {
      await onboarding.complete(proofToken.trim());
      setProofToken('');
    } catch (cause) {
      setLocalError(errorMessage(cause));
    }
  }

  async function admit() {
    setLocalError(null);
    try {
      const result = await onboarding.admit();
      onSubmitted?.(result);
    } catch (cause) {
      setLocalError(errorMessage(cause));
    }
  }

  const completion = onboarding.completion;
  const pendingRequest = completion?.option.action === 'request-pending'
    ? completion.option.request
    : onboarding.admission?.request;
  const pendingTenant = completion?.option.action === 'request-pending'
    ? completion.option.tenant
    : onboarding.admission?.request.tenant;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="border-b border-border/70">
        <CardTitle asChild><h2>{title}</h2></CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {(onboarding.error || localError) && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {localError ?? onboarding.error}
          </div>
        )}

        {onboarding.status === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Zero uses the primary email already bound to this identity. No {tenantSingular} is disclosed before mailbox proof succeeds.
            </p>
            <Button type="button" onClick={() => void start()}>
              Verify company email
            </Button>
          </div>
        )}

        {onboarding.status === 'starting' && (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            Starting email verification…
          </p>
        )}

        {onboarding.status === 'proof-pending' && (
          <form className="space-y-3" onSubmit={complete}>
            <p role="status" className="text-sm text-muted-foreground">
              If this identity is eligible, verification instructions were sent. Enter the proof token from that message.
            </p>
            <Input
              value={proofToken}
              onChange={(event) => setProofToken(event.target.value)}
              aria-label="Company email proof token"
              autoComplete="one-time-code"
              required
            />
            <Button type="submit" disabled={!proofToken.trim()}>
              Complete verification
            </Button>
          </form>
        )}

        {onboarding.status === 'completing' && (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            Verifying company email…
          </p>
        )}

        {completion?.option.action === 'request-to-join' && (
          <section className="space-y-3" aria-labelledby={requestHeadingId}>
            <div>
              <h3 id={requestHeadingId} className="font-semibold">
                Request access to {completion.option.tenant.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {capitalize(tenantSingular)} administrator review is required. Verification never adds you automatically.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void admit()}
              disabled={onboarding.status === 'admitting'}
            >
              {onboarding.status === 'admitting' ? 'Requesting…' : 'Request access'}
            </Button>
          </section>
        )}

        {completion?.option.action === 'unavailable' && (
          <div role="status" className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
            No verified-company request option is available for this identity.
          </div>
        )}

        {pendingRequest && pendingTenant && (
          <div role="status" aria-live="polite" className="rounded-md border border-success/35 bg-success/10 p-4 text-sm text-foreground dark:border-success/45 dark:bg-success/15">
            Your request to join {pendingTenant.name} is pending administrator review.
          </div>
        )}

        {(onboarding.status === 'ready' || onboarding.status === 'submitted'
          || onboarding.status === 'error') && (
          <Button type="button" variant="ghost" onClick={() => {
            setProofToken('');
            setLocalError(null);
            onboarding.reset();
          }}>
            Start over
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Company email verification failed';
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
