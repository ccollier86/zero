'use client';

import * as React from 'react';
import type {
  AuthCompletionResult,
  AuthTenantOnboardingRequiredResult,
} from '../../frontend/client/auth-client';
import { Button } from '#zero/components/ui/button';
import { AuthHeader } from '#zero/components/auth/auth-header';
import { cn } from '#zero/lib/utils';
import {
  type AuthFlowContinuationResult,
  isAuthFlowContinuationResult,
  isMfaContinuationResult,
  isTenantOnboardingRequiredResult,
  isTenantSelectionRequiredResult,
} from './auth-continuation';
import { MFAContinuation } from './mfa-continuation';
import { TenantSelectionForm, tenantSelectionFlowKey } from './tenant-selection-form';
import { TenantCreationForm } from './tenant-creation-form';
import { DomainOnboarding } from './domain-onboarding';
import { useAuthConfig } from '../../frontend/client/auth-hooks';

export type TenantOnboardingOption = 'create' | 'verified-domain';

export interface AuthFlowContinuationProps {
  result: AuthFlowContinuationResult;
  onSuccess?: () => void;
  onBack?: () => void;
  onTenantOnboardingRequired?: (result: AuthTenantOnboardingRequiredResult) => void;
  className?: string;
}

/** Coordinate MFA and tenant binding without letting either bypass the other. */
export function AuthFlowContinuation(props: AuthFlowContinuationProps) {
  return (
    <AuthFlowContinuationScope
      key={authFlowContinuationKey(props.result)}
      {...props}
    />
  );
}

function AuthFlowContinuationScope({
  result,
  onSuccess,
  onBack,
  onTenantOnboardingRequired,
  className,
}: AuthFlowContinuationProps) {
  const [current, setCurrent] = React.useState<AuthFlowContinuationResult>(result);
  const [onboardingOption, setOnboardingOption] = React.useState<
    TenantOnboardingOption | null
  >(null);
  const { config, isLoading: configLoading } = useAuthConfig();

  function handleMfaComplete(next: AuthCompletionResult) {
    if (isAuthFlowContinuationResult(next)) {
      setCurrent(next);
      if (isTenantOnboardingRequiredResult(next)) {
        onTenantOnboardingRequired?.(next);
      }
    }
  }

  if (isMfaContinuationResult(current)) {
    return (
      <MFAContinuation
        result={current}
        onComplete={handleMfaComplete}
        onSuccess={onSuccess}
        onBack={onBack}
        className={className}
      />
    );
  }

  if (configLoading) {
    return (
      <p role="status" aria-live="polite" className={cn('text-sm text-muted-foreground', className)}>
        Loading access options…
      </p>
    );
  }

  if (isTenantSelectionRequiredResult(current)) {
    return (
      <TenantSelectionForm
        result={current}
        onSuccess={onSuccess}
        onBack={onBack}
        className={className}
        terminology={config?.tenancy?.terminology}
      />
    );
  }

  const options = tenantOnboardingOptions(current, config?.tenancy?.onboarding
    ?.verifiedDomains?.enabled === true);
  if (options.create && options.verifiedDomain && onboardingOption === null) {
    const term = config?.tenancy?.terminology?.singular ?? 'organization';
    return (
      <div className={cn('space-y-4', className)}>
        <AuthHeader
          title={`Choose ${term} access`}
          description={`Create a new ${term}, or verify your company email to request access to an existing one.`}
        />
        <div className="grid gap-3">
          <Button type="button" onClick={() => setOnboardingOption('create')}>
            Create a new {term}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOnboardingOption('verified-domain')}
          >
            Request access with company email
          </Button>
        </div>
        {onBack && (
          <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
            Back to sign in
          </Button>
        )}
      </div>
    );
  }

  if (options.create && (!options.verifiedDomain || onboardingOption === 'create')) {
    return (
      <div className={cn('space-y-3', className)}>
        <TenantCreationForm
          continuation={current.onboarding.tenantCreation!.continuation!}
          onSuccess={onSuccess}
          onBack={options.verifiedDomain ? () => setOnboardingOption(null) : onBack}
        />
      </div>
    );
  }

  if (options.verifiedDomain) {
    return (
      <div className={cn('space-y-3', className)}>
        <DomainOnboarding identityContinuation={current.onboarding.continuation} />
        {(options.create || onBack) && (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={options.create ? () => setOnboardingOption(null) : onBack}
          >
            {options.create ? 'Choose another option' : 'Back to sign in'}
          </Button>
        )}
      </div>
    );
  }

  const term = config?.tenancy?.terminology?.singular ?? 'organization';
  const creationMode = config?.tenancy?.creation?.mode;
  const guidance = creationMode === 'platform-admin'
    ? `${capitalize(term)} access must be created by a platform administrator, or an existing ${term} administrator can invite you.`
    : `Ask an existing ${term} administrator for an invitation or access approval.`;

  return (
    <div className={cn('space-y-4', className)}>
      <AuthHeader
        title={`${capitalize(term)} access required`}
        description={`Your account is verified, but it does not have an active ${term} membership yet.`}
      />
      <p className="rounded-md border border-border bg-muted/25 px-3 py-3 text-sm text-muted-foreground">
        {guidance}
      </p>
      {onBack && (
        <Button type="button" variant="outline" className="w-full" onClick={onBack}>
          Back to sign in
        </Button>
      )}
    </div>
  );
}

/** @internal Synchronous reset boundary for single-use auth continuations. */
export function authFlowContinuationKey(result: AuthFlowContinuationResult): string {
  if (isTenantSelectionRequiredResult(result)) {
    return `tenant-selection:${tenantSelectionFlowKey(result)}`;
  }
  if (isTenantOnboardingRequiredResult(result)) {
    return `tenant-onboarding:${JSON.stringify([
      result.onboarding.continuation,
      result.onboarding.tenantCreation?.allowed ?? false,
      result.onboarding.tenantCreation?.continuation ?? null,
    ])}`;
  }
  if ('mfaChallenge' in result) {
    return `mfa-challenge:${JSON.stringify([
      result.mfaChallenge.challengeToken,
      result.mfaChallenge.method,
      result.mfaChallenge.challenge?.challengeId ?? null,
    ])}`;
  }
  return `mfa-setup:${JSON.stringify([
    result.mfaSetupToken,
    result.mfa.methods,
    result.mfa.allowUserChoice,
  ])}`;
}

/** Pure option resolver used by the packaged continuation UI and its tests. */
export function tenantOnboardingOptions(
  result: AuthTenantOnboardingRequiredResult,
  verifiedDomainsEnabled: boolean,
): Readonly<{ create: boolean; verifiedDomain: boolean }> {
  return Object.freeze({
    create: Boolean(
      result.onboarding.tenantCreation?.allowed
      && result.onboarding.tenantCreation.continuation,
    ),
    verifiedDomain: verifiedDomainsEnabled && Boolean(result.onboarding.continuation),
  });
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
