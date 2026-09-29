'use client';

import * as React from 'react';
import { reportAuthClientActionFailure } from './auth-action-observability';
import type { AuthTenantSummary } from './auth-types';
import { useAuth, useAuthConfig } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import {
  isTenantAdministrationScopeStable,
  TenantAdministrationBoundaryFence,
  tenantAdministrationBoundaryKey,
} from './tenant-administration-boundary';

export interface UseTenantSwitcherResult {
  isAvailable: boolean;
  terminology: { singular: string; plural: string };
  tenants: AuthTenantSummary[];
  activeTenant: AuthTenantSummary | null;
  isLoading: boolean;
  isSwitching: boolean;
  error: string | null;
  reload(): void;
  switchTenant(tenantId: string): Promise<void>;
}

/** Refresh-proof-backed tenant choices for the packaged switcher. */
export function useTenantSwitcher(): UseTenantSwitcherResult {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const scopeStable = isTenantAdministrationScopeStable(auth.sessionTransition);
  const enabled = authConfig.config?.tenancy?.mode === 'multi'
    && auth.isAuthenticated
    && Boolean(auth.activeTenant)
    && scopeStable;
  const boundaryKey = tenantAdministrationBoundaryKey(
    auth.user?.userId,
    auth.activeTenant?.tenantId,
    enabled,
    authorizationBoundary.key,
  );
  const boundaryFenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!boundaryFenceRef.current) {
    boundaryFenceRef.current = new TenantAdministrationBoundaryFence();
  }
  const boundaryFence = boundaryFenceRef.current;
  const boundaryRevision = boundaryFence.update(boundaryKey);
  const [tenants, setTenants] = React.useState<AuthTenantSummary[]>([]);
  const [loadedBoundaryRevision, setLoadedBoundaryRevision] = React.useState(-1);
  const [isLoading, setLoading] = React.useState(false);
  const [isSwitching, setSwitching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const queryRevision = React.useRef(0);
  const switchRevision = React.useRef(0);

  React.useEffect(() => {
    const requestRevision = ++queryRevision.current;
    const requestBoundary = boundaryRevision;
    setLoadedBoundaryRevision(requestBoundary);
    setTenants([]);
    setSwitching(false);
    if (!enabled) {
      setTenants([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void auth.listTenants().then((result) => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) {
        setTenants(result?.tenants ?? []);
      }
    }).catch((cause) => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setError(errorMessage(cause));
    }).finally(() => {
      if (boundaryFence.isCurrent(requestBoundary)
        && requestRevision === queryRevision.current) setLoading(false);
    });
  }, [
    auth.listTenants,
    boundaryFence,
    boundaryRevision,
    enabled,
    revision,
  ]);

  const hasCurrentData = enabled && loadedBoundaryRevision === boundaryRevision;

  return {
    isAvailable: authConfig.config?.tenancy?.mode === 'multi',
    terminology: authConfig.config?.tenancy?.terminology ?? {
      singular: 'organization',
      plural: 'organizations',
    },
    tenants: hasCurrentData ? tenants : [],
    activeTenant: enabled ? auth.activeTenant : null,
    isLoading: enabled && (!hasCurrentData || isLoading),
    isSwitching: hasCurrentData && isSwitching,
    error: hasCurrentData ? error : null,
    reload: React.useCallback(() => {
      if (boundaryFence.isCurrent(boundaryRevision)) {
        setRevision((value) => value + 1);
      }
    }, [boundaryFence, boundaryRevision]),
    switchTenant: React.useCallback(async (tenantId: string) => {
      if (!auth.activeTenant || tenantId === auth.activeTenant.tenantId) return;
      const operationBoundary = boundaryRevision;
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      const operationRevision = ++switchRevision.current;
      setSwitching(true);
      setError(null);
      try {
        await auth.switchTenant(tenantId);
      } catch (cause) {
        if (boundaryFence.isCurrent(operationBoundary)
          && operationRevision === switchRevision.current) setError(errorMessage(cause));
        throw cause;
      } finally {
        if (boundaryFence.isCurrent(operationBoundary)
          && operationRevision === switchRevision.current) setSwitching(false);
      }
    }, [
      auth.activeTenant?.tenantId,
      auth.switchTenant,
      boundaryFence,
      boundaryRevision,
    ]),
  };
}

function errorMessage(cause: unknown): string {
  reportAuthClientActionFailure('tenantSwitcher', cause);
  return cause instanceof Error ? cause.message : 'Tenant request failed';
}

function staleOperation(): Error {
  return new Error('The active tenant changed before this request completed');
}
