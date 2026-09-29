'use client';

import * as React from 'react';
import type { AuthTenantAdministrationConfig } from './auth-types';
import type { InternalClient } from './sdk';
import type { TenantAdministrationBoundaryFence } from './tenant-administration-boundary';
import {
  isCurrentTenantOnboardingRequest,
  projectTenantOnboardingConfigSettlement,
  settleTenantOnboardingFailure,
  type TenantOnboardingConfigProjection,
} from './tenant-onboarding-slice-core';

type AuthSdk = NonNullable<InternalClient['auth']>;

export interface TenantOnboardingConfigSliceOptions {
  authClient: AuthSdk | null;
  boundaryFence: TenantAdministrationBoundaryFence;
  boundaryRevision: number;
  scopeEnabled: boolean;
}

export interface TenantOnboardingConfigSlice {
  config: AuthTenantAdministrationConfig | null;
  projection: TenantOnboardingConfigProjection;
  reload(): void;
}

/** Protected active-tenant policy, independent of public onboarding switches. */
export function useTenantOnboardingConfigSlice({
  authClient,
  boundaryFence,
  boundaryRevision,
  scopeEnabled,
}: TenantOnboardingConfigSliceOptions): TenantOnboardingConfigSlice {
  const [config, setConfig] = React.useState<AuthTenantAdministrationConfig | null>(null);
  const [loadedBoundaryRevision, setLoadedBoundaryRevision] = React.useState(-1);
  const [isLoading, setLoading] = React.useState(false);
  const [isPermissionDenied, setPermissionDenied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const generationRef = React.useRef(0);

  React.useEffect(() => {
    const generation = ++generationRef.current;
    const requestBoundary = boundaryRevision;
    setConfig(null);
    setPermissionDenied(false);
    setError(null);

    if (!scopeEnabled || !authClient) {
      setLoadedBoundaryRevision(requestBoundary);
      setLoading(false);
      return;
    }

    setLoadedBoundaryRevision(-1);
    setLoading(true);
    void authClient.getTenantAdministrationConfig().then((nextConfig) => {
      if (!isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) return;
      setConfig(nextConfig);
    }).catch((cause) => {
      if (!isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) return;
      settleTenantOnboardingFailure(
        cause,
        'tenantOnboardingConfig',
        setPermissionDenied,
        setError,
      );
    }).finally(() => {
      if (!isCurrentTenantOnboardingRequest(
        boundaryFence,
        requestBoundary,
        generationRef,
        generation,
      )) return;
      setLoadedBoundaryRevision(requestBoundary);
      setLoading(false);
    });
  }, [
    authClient,
    boundaryFence,
    boundaryRevision,
    revision,
    scopeEnabled,
  ]);

  const projection = projectTenantOnboardingConfigSettlement(
    scopeEnabled,
    boundaryRevision,
    loadedBoundaryRevision,
    { isLoading, isPermissionDenied, error },
  );
  const reload = React.useCallback(() => {
    if (boundaryFence.isCurrent(boundaryRevision)) {
      setRevision((value) => value + 1);
    }
  }, [boundaryFence, boundaryRevision]);

  return {
    config: projection.isCurrent ? config : null,
    projection,
    reload,
  };
}
