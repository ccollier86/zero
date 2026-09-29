'use client';

import * as React from 'react';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import { useLocalReturnToHref } from './use-local-return-to-href';
import { AuthConfigLoadState } from './auth-config-load-state';
import type { AuthPublicConfig } from '../../frontend/client/auth-types';

export interface TenantJoinRequestFormProps {
  tenantSlug: string;
  /** Fully completed pre-session proof from `result.onboarding.continuation`. */
  continuation?: string;
  /** Host-owned override; omitted values return from `/login` to this local page. */
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
  signInHref,
  onSubmitted,
  className,
}: TenantJoinRequestFormProps) {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const auth = useAuth();
  const resolvedSignInHref = useLocalReturnToHref(signInHref);
  const config = useAuthConfig();
  const term = config.config?.tenancy?.terminology?.singular ?? 'organization';
  const policy = tenantJoinRequestPolicy(config.config, config.error);
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
        title={submitted
          ? 'Request submitted'
          : policy === 'disabled' ? 'Access requests unavailable' : `Request ${term} access`}
        description={submitted
          ? `If this ${term} accepts access requests, an authorized reviewer can now decide it.`
          : policy === 'disabled'
            ? `This app does not accept ${term} join requests.`
          : `The response is intentionally the same even when the ${term} is unavailable.`}
      />
      {!submitted && policy !== 'disabled' && (
        <AuthConfigLoadState
          state={config}
          loadingMessage="Loading access-request policy…"
          unavailableMessage="Access-request policy could not be loaded."
        />
      )}
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!submitted && policy !== 'disabled' && canSubmit && (
        <Button
          className="w-full"
          disabled={submitting || !tenantSlug || policy !== 'enabled'}
          onClick={() => void submit()}
        >
          {submitting ? 'Submitting…' : 'Request access'}
        </Button>
      )}
      {!submitted && policy !== 'disabled' && !canSubmit && (
        <Button asChild className="w-full">
          <a href={resolvedSignInHref}>Sign in to request access</a>
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

/** @internal Public capability state; missing legacy flags preserve server authority. */
export function tenantJoinRequestPolicy(
  config: AuthPublicConfig | null,
  error: string | null,
): 'unknown' | 'error' | 'enabled' | 'disabled' {
  if (!config) return error ? 'error' : 'unknown';
  return config.tenancy?.onboarding?.joinRequests.enabled === false
    ? 'disabled'
    : 'enabled';
}
