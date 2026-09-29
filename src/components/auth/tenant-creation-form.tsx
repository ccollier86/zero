'use client';

import * as React from 'react';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Label } from '#zero/components/ui/label';
import { cn } from '#zero/lib/utils';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { getAuthDisplayMessage, reportAuthUiError } from './auth-error';
import { AuthConfigLoadState } from './auth-config-load-state';

export interface TenantCreationFormProps {
  /** Omit only when an existing browser refresh family proves the creator. */
  continuation?: string;
  onSuccess?: () => void;
  onBack?: () => void;
  className?: string;
}

/** Create an owned tenant and activate its atomically issued browser session. */
export function TenantCreationForm(props: TenantCreationFormProps) {
  const auth = useAuth();
  const boundary = tenantCreationFlowKey(
    auth.user?.userId,
    props.continuation,
  );
  return <TenantCreationFormScope key={boundary} {...props} />;
}

function TenantCreationFormScope({
  continuation,
  onSuccess,
  onBack,
  className,
}: TenantCreationFormProps) {
  const { createTenant } = useAuth();
  const authConfig = useAuthConfig();
  const { config } = authConfig;
  const term = config?.tenancy?.terminology?.singular ?? 'organization';
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fieldId = React.useId();
  const nameId = `${fieldId}-name`;
  const slugId = `${fieldId}-slug`;
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createTenant({
        name,
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        ...(continuation ? { continuation } : {}),
      });
      if (!result) throw new Error(`Failed to create ${term}`);
      if (mounted.current) onSuccess?.();
    } catch (cause) {
      reportAuthUiError('createTenant', cause);
      if (mounted.current) {
        setError(getAuthDisplayMessage(cause, `Failed to create ${term}`));
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-4', className)} aria-busy={submitting}>
      <AuthHeader
        title={`Create your ${term}`}
        description={`You will become the protected owner of this ${term}.`}
      />
      <AuthConfigLoadState
        state={authConfig}
        loadingMessage="Loading organization terminology…"
        unavailableMessage="Organization terminology could not be loaded. You can continue with the default label."
      />
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>{capitalize(term)} name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={120}
          autoComplete="organization"
          disabled={submitting}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={slugId}>URL name (optional)</Label>
        <Input
          id={slugId}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          maxLength={63}
          pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
          placeholder="acme"
          disabled={submitting}
        />
      </div>
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={submitting || !name.trim()}>
        {submitting && (
          <AnimateIcon animate loop>
            <Loader size={16} />
          </AnimateIcon>
        )}
        {submitting ? 'Creating…' : `Create ${term}`}
      </Button>
      {onBack && (
        <Button type="button" variant="outline" className="w-full" onClick={onBack} disabled={submitting}>
          Back to sign in
        </Button>
      )}
    </form>
  );
}

/** @internal Reset boundary for creator identity and single-use proof changes. */
export function tenantCreationFlowKey(
  userId?: string,
  continuation?: string,
): string {
  // A pre-session continuation intentionally survives the successful
  // null-user -> authenticated-user transition that this form owns.
  return JSON.stringify([continuation ? null : userId ?? null, continuation ?? null]);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
