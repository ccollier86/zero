'use client';

import * as React from 'react';
import type {
  AuthSessionResult,
  AuthTenantSelectionRequiredResult,
} from '../../frontend/client/auth-client';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { Button } from '#zero/components/ui/button';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { cn } from '#zero/lib/utils';
import { nextAuthRovingRadioIndex } from './auth-roving-radio';

export interface TenantSelectionFormProps {
  result: AuthTenantSelectionRequiredResult;
  /** Optional already-loaded vocabulary, used by composed auth flows and SSR. */
  terminology?: { singular: string; plural: string };
  onSuccess?: (session: AuthSessionResult) => void;
  onBack?: () => void;
  className?: string;
}

/** Exchange an identity-only continuation for one tenant-bound app session. */
export function TenantSelectionForm(props: TenantSelectionFormProps) {
  if (!props.terminology) {
    return <ConfiguredTenantSelectionForm {...props} />;
  }
  return (
    <TenantSelectionFlow key={tenantSelectionFlowKey(props.result)} {...props} />
  );
}

function ConfiguredTenantSelectionForm(props: TenantSelectionFormProps) {
  const authConfig = useAuthConfig();
  if (authConfig.isLoading) {
    return (
      <p role="status" aria-live="polite" className={cn('text-sm text-muted-foreground', props.className)}>
        Loading access options…
      </p>
    );
  }
  return (
    <TenantSelectionFlow
      key={tenantSelectionFlowKey(props.result)}
      {...props}
      terminology={authConfig.config?.tenancy?.terminology ?? {
        singular: 'organization',
        plural: 'organizations',
      }}
    />
  );
}

function TenantSelectionFlow({
  result,
  onSuccess,
  onBack,
  className,
  terminology,
}: TenantSelectionFormProps) {
  const { selectTenant } = useAuth();
  const tenantSingular = terminology?.singular ?? 'organization';
  const tenantPlural = terminology?.plural ?? 'organizations';
  const [tenantId, setTenantId] = React.useState(
    result.tenantSelection.tenants[0]?.tenantId ?? '',
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>());

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!tenantId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await selectTenant(
        result.tenantSelection.continuation,
        tenantId,
      );
      if (mounted.current && session) onSuccess?.(session);
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error
          ? cause.message
          : `Failed to select ${tenantSingular}`);
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  function handleOptionKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    const nextIndex = nextAuthRovingRadioIndex(
      event.key,
      currentIndex,
      result.tenantSelection.tenants.length,
    );
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTenant = result.tenantSelection.tenants[nextIndex];
    if (!nextTenant) return;
    setTenantId(nextTenant.tenantId);
    optionRefs.current.get(nextTenant.tenantId)?.focus();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('space-y-4', className)}
      aria-busy={submitting}
    >
      <AuthHeader
        title={`Choose your ${tenantSingular}`}
        description={`Select the ${tenantSingular} to use for this session. You can switch later.`}
      />

      <div
        className="grid gap-2"
        role="radiogroup"
        aria-label={capitalize(tenantPlural)}
      >
        {result.tenantSelection.tenants.map((tenant, index) => (
          <button
            key={tenant.tenantId}
            ref={(node) => {
              if (node) optionRefs.current.set(tenant.tenantId, node);
              else optionRefs.current.delete(tenant.tenantId);
            }}
            type="button"
            role="radio"
            aria-checked={tenantId === tenant.tenantId}
            tabIndex={tenantId === tenant.tenantId ? 0 : -1}
            disabled={submitting}
            className={cn(
              'rounded-lg border border-border/80 bg-card p-4 text-left transition-colors hover:border-primary/45 hover:bg-accent/60 motion-reduce:transition-none',
              tenantId === tenant.tenantId && 'border-primary/60 bg-primary/5',
            )}
            onClick={() => setTenantId(tenant.tenantId)}
            onKeyDown={(event) => handleOptionKeyDown(event, index)}
          >
            <span className="block text-sm font-semibold">{tenant.name}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {tenant.slug}{tenant.role ? ` · ${tenant.role}` : ''}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" className="h-10 w-full" disabled={!tenantId || submitting}>
        {submitting ? `Opening ${tenantSingular}…` : 'Continue'}
      </Button>
      {onBack && (
        <button type="button" onClick={onBack} className="block w-full text-center text-xs text-primary hover:underline">
          Back to sign in
        </button>
      )}
    </form>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** @internal Stable reset key for one single-use tenant-selection continuation. */
export function tenantSelectionFlowKey(result: AuthTenantSelectionRequiredResult): string {
  return JSON.stringify([
    result.tenantSelection.continuation,
    result.tenantSelection.tenants.map((tenant) => tenant.tenantId),
  ]);
}
