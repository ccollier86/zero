'use client';

import * as React from 'react';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';

export interface TenantJoinRequestFormProps {
  tenantSlug: string;
  /** Fully completed pre-session proof from `result.onboarding.continuation`. */
  continuation?: string;
  signInHref?: string;
  onSubmitted?: () => void;
  className?: string;
}

/** Non-enumerating request-access control for an app-owned tenant page. */
export function TenantJoinRequestForm(props: TenantJoinRequestFormProps) {
  const auth = useAuth();
  return (
    <TenantJoinRequestFormScope
      key={tenantJoinRequestFlowKey(
        props.tenantSlug,
        props.continuation,
        auth.user?.userId,
      )}
      {...props}
    />
  );
}

function TenantJoinRequestFormScope({
  tenantSlug,
  continuation,
  signInHref = '/login',
  onSubmitted,
  className,
}: TenantJoinRequestFormProps) {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const auth = useAuth();
  const config = useAuthConfig();
  const term = config.config?.tenancy?.terminology?.singular ?? 'organization';
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  const canSubmit = auth.isAuthenticated || Boolean(continuation);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function submit() {
    if (!authClient || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authClient.submitTenantJoinRequest(
        tenantSlug,
        auth.isAuthenticated ? undefined : continuation,
      );
      if (mounted.current) {
        setSubmitted(true);
        onSubmitted?.();
      }
    } catch (cause) {
      reportAuthUiError('submitTenantJoinRequest', cause);
      if (mounted.current) {
        setError(getAuthDisplayMessage(cause, `Failed to request ${term} access`));
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <div
      className={cn('space-y-4', className)}
      role={submitted ? 'status' : undefined}
      aria-live={submitted ? 'polite' : undefined}
      aria-busy={submitting}
    >
      <AuthHeader
        title={submitted ? 'Request submitted' : `Request ${term} access`}
        description={submitted
          ? `If this ${term} accepts access requests, an authorized reviewer can now decide it.`
          : `The response is intentionally the same even when the ${term} is unavailable.`}
      />
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!submitted && canSubmit && (
        <Button className="w-full" disabled={submitting || !tenantSlug} onClick={() => void submit()}>
          {submitting ? 'Submitting…' : 'Request access'}
        </Button>
      )}
      {!submitted && !canSubmit && (
        <Button asChild className="w-full">
          <a href={signInHref}>Sign in to request access</a>
        </Button>
      )}
    </div>
  );
}

/** @internal Reset boundary for tenant, proof, and signed-in identity changes. */
export function tenantJoinRequestFlowKey(
  tenantSlug: string,
  continuation?: string,
  userId?: string,
): string {
  return JSON.stringify([tenantSlug, continuation ?? null, userId ?? null]);
}
