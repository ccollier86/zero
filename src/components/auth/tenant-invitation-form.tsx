'use client';

import * as React from 'react';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { AuthFlowContinuation } from '#zero/components/auth/auth-flow-continuation';
import { PasswordInput } from '#zero/components/auth/password-input';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import { cn } from '#zero/lib/utils';
import type {
  AuthTenantInvitationAcceptanceResult,
  AuthTenantInvitationInspection,
} from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import {
  type AuthFlowContinuationResult,
  isAuthFlowContinuationResult,
} from './auth-continuation';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';

export interface TenantInvitationFormProps {
  /** Exact `zinv_...` token read from the app-owned invitation landing route. */
  token: string;
  /** Post-login/MFA onboarding proof when no Bearer session exists yet. */
  continuation?: string;
  signInHref?: string;
  onSuccess?: (result: AuthTenantInvitationAcceptanceResult) => void;
  className?: string;
}

/** Public invitation inspection, exact-email account creation, and acceptance UI. */
export function TenantInvitationForm(props: TenantInvitationFormProps) {
  return (
    <TenantInvitationFormScope
      key={tenantInvitationFlowKey(
        props.token,
        props.continuation,
      )}
      {...props}
    />
  );
}

function TenantInvitationFormScope({
  token,
  continuation,
  signInHref = '/login',
  onSuccess,
  className,
}: TenantInvitationFormProps) {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const term = authConfig.config?.tenancy?.terminology?.singular ?? 'organization';
  const [inspection, setInspection] = React.useState<AuthTenantInvitationInspection | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [finalizing, setFinalizing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [flow, setFlow] = React.useState<AuthFlowContinuationResult | null>(null);
  const [form, setForm] = React.useState({
    email: '',
    username: '',
    firstName: '',
    lastName: '',
    password: '',
  });
  const fieldId = React.useId();
  const fieldIds = {
    email: `${fieldId}-email`,
    username: `${fieldId}-username`,
    firstName: `${fieldId}-first-name`,
    lastName: `${fieldId}-last-name`,
    password: `${fieldId}-password`,
  } as const;
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  React.useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    if (!authClient || !token) {
      setInspection({ available: false });
      setLoading(false);
      return () => { current = false; };
    }
    void authClient.inspectTenantInvitation(token).then((result) => {
      if (current) setInspection(result);
    }).catch((cause) => {
      if (current) setError(getAuthDisplayMessage(cause, 'Invitation is unavailable'));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [authClient, token]);

  async function accept(params: Parameters<NonNullable<typeof authClient>['acceptTenantInvitation']>[0]) {
    if (!authClient || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.acceptTenantInvitation(params);
      if (!mounted.current) return;
      if ('invitationAccepted' in result && result.invitationAccepted) {
        setSuccess(true);
        setFlow(null);
        onSuccess?.(result);
        return;
      }
      if (isAuthFlowContinuationResult(result)) {
        setFlow(result);
        return;
      }
      throw new Error('Invitation acceptance requires another authentication step');
    } catch (cause) {
      reportAuthUiError('acceptTenantInvitation', cause);
      if (mounted.current) {
        setError(getAuthDisplayMessage(cause, 'Failed to accept invitation'));
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  async function finishAfterAuthentication(nextContinuation: string) {
    setFinalizing(true);
    try {
      await accept({ token, continuation: nextContinuation });
    } finally {
      if (mounted.current) setFinalizing(false);
    }
  }

  if (flow) {
    if (finalizing) return status('Finishing invitation acceptance…', className);
    return (
      <AuthFlowContinuation
        result={flow}
        className={className}
        onTenantOnboardingRequired={(result) => {
          void finishAfterAuthentication(result.onboarding.continuation);
        }}
      />
    );
  }

  if (loading) return status('Checking invitation…', className);
  if (success) {
    return (
      <div className={cn('space-y-4', className)} role="status" aria-live="polite">
        <AuthHeader
          title="Invitation accepted"
          description={`Your ${term} session is ready.`}
        />
      </div>
    );
  }
  if (!inspection?.available) {
    return (
      <div className={cn('space-y-4', className)}>
        <AuthHeader
          title="Invitation unavailable"
          description="This invitation is invalid, expired, revoked, or already used."
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  const canAcceptExisting = auth.isAuthenticated || Boolean(continuation);
  return (
    <div
      className={cn('space-y-4', className)}
      aria-busy={submitting || finalizing}
    >
      <AuthHeader
        title={`Join ${inspection.tenant.name}`}
        description={`This invitation is for ${inspection.emailHint}.`}
      />
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {inspection.account === 'create' ? (
        <form className="space-y-3" aria-busy={submitting} onSubmit={(event) => {
          event.preventDefault();
          void accept({
            token,
            email: form.email,
            username: form.username || form.email,
            password: form.password,
            ...(form.firstName ? { firstName: form.firstName } : {}),
            ...(form.lastName ? { lastName: form.lastName } : {}),
          });
        }}>
          <Field id={fieldIds.email} label="Email">
            <Input id={fieldIds.email} type="email" autoComplete="email" required
              disabled={submitting} value={form.email}
              onChange={(event) => setForm((value) => ({ ...value, email: event.target.value }))} />
          </Field>
          <Field id={fieldIds.username} label="Username (optional)">
            <Input id={fieldIds.username} autoComplete="username" disabled={submitting}
              value={form.username}
              onChange={(event) => setForm((value) => ({ ...value, username: event.target.value }))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={fieldIds.firstName} label="First name (optional)">
              <Input id={fieldIds.firstName} autoComplete="given-name" disabled={submitting}
                value={form.firstName}
                onChange={(event) => setForm((value) => ({ ...value, firstName: event.target.value }))} />
            </Field>
            <Field id={fieldIds.lastName} label="Last name (optional)">
              <Input id={fieldIds.lastName} autoComplete="family-name" disabled={submitting}
                value={form.lastName}
                onChange={(event) => setForm((value) => ({ ...value, lastName: event.target.value }))} />
            </Field>
          </div>
          <Field id={fieldIds.password} label="Password">
            <PasswordInput id={fieldIds.password} autoComplete="new-password" required
              disabled={submitting} value={form.password}
              onChange={(event) => setForm((value) => ({ ...value, password: event.target.value }))} />
          </Field>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Creating account…' : `Create account and join ${term}`}
          </Button>
        </form>
      ) : canAcceptExisting ? (
        <Button className="w-full" disabled={submitting} onClick={() => {
          void accept(auth.isAuthenticated ? { token } : { token, continuation });
        }}>
          {submitting ? 'Accepting…' : `Accept and join ${term}`}
        </Button>
      ) : (
        <Button asChild className="w-full">
          <a href={signInHref}>Sign in as the invited account</a>
        </Button>
      )}
    </div>
  );
}

/** @internal Reset boundary for invitation, proof, and signed-in identity changes. */
export function tenantInvitationFlowKey(
  token: string,
  continuation?: string,
): string {
  // Do not include the signed-in user here: invitation acceptance may itself
  // establish that user session before the completion callback runs.
  return JSON.stringify([token, continuation ?? null]);
}

function Field({
  id,
  label,
  children,
}: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function status(message: string, className?: string) {
  return (
    <div className={cn('rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground', className)}
      role="status" aria-live="polite">
      {message}
    </div>
  );
}
