'use client';

import * as React from 'react';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { AuthClientError } from './auth-errors';
import type {
  AuthApiKeyIssueInput,
  AuthApiKeyManagementCapabilities,
  AuthApiKeyPage,
  AuthApiKeySdkSurface,
  AuthApiKeySummary,
  IssuedAuthApiKey,
} from './auth-api-key-types';
import { useAuth, useAuthConfig } from './auth-hooks';
import { useAuthorization } from './authorization-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import type { InternalClient } from './sdk';
import { TenantAdministrationBoundaryFence } from './tenant-administration-hooks';

interface UseAuthApiKeysBaseOptions {
  readonly enabled?: boolean;
  readonly limit?: number;
}

export type UseAuthApiKeysOptions = UseAuthApiKeysBaseOptions & (
  | { readonly mode: 'self' }
  | { readonly mode: 'application-admin'; readonly userId: string }
  | { readonly mode: 'tenant-admin'; readonly membershipId: string }
  | {
      readonly mode: 'platform-admin';
      /** Optional platform directory filter. */
      readonly tenantId?: string;
      readonly membershipId?: never;
    }
  | {
      readonly mode: 'platform-admin';
      readonly tenantId: string;
      readonly membershipId: string;
    }
);

export interface UseAuthApiKeysResult {
  readonly apiKeys: readonly AuthApiKeySummary[];
  readonly page: AuthApiKeyPage['page'] | null;
  readonly isAvailable: boolean;
  readonly canIssue: boolean;
  readonly canRotate: boolean;
  readonly canRevoke: boolean;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly isMutating: boolean;
  readonly isDenied: boolean;
  readonly error: string | null;
  reload(): void;
  loadMore(): Promise<void>;
  issue(input: AuthApiKeyIssueInput): Promise<IssuedAuthApiKey>;
  rotate(keyId: string, input: AuthApiKeyIssueInput): Promise<IssuedAuthApiKey>;
  revoke(keyId: string): Promise<AuthApiKeySummary>;
}

/** Identity-fenced, mode-aware API-key state for optional packaged controls. */
export function useAuthApiKeys(options: UseAuthApiKeysOptions): UseAuthApiKeysResult {
  const client = useClientMaybe() as InternalClient | null;
  const surface = client?.auth?.apiKeys ?? null;
  const auth = useAuth();
  const config = useAuthConfig();
  const authorization = useAuthorization();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const capability = config.config?.apiKeys;
  const tenancyMode = config.config?.tenancy?.mode ?? 'single';
  const activeTenantKind = auth.activeTenant?.kind ?? null;
  const modeAvailable = isAuthApiKeyManagementModeAvailable({
    mode: options.mode,
    selfService: capability?.selfService === true,
    tenancyMode,
    activeTenantKind,
  });
  const isAvailable = capability?.enabled === true && modeAvailable;
  const enabled = options.enabled !== false
    && isAvailable
    && auth.isAuthenticated
    && authorizationBoundary.ready
    && authorization.isReady
    && surface !== null;
  const boundaryFenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!boundaryFenceRef.current) {
    boundaryFenceRef.current = new TenantAdministrationBoundaryFence();
  }
  const boundaryFence = boundaryFenceRef.current;
  const boundaryKey = authApiKeyBoundaryKey({
    enabled,
    userId: auth.user?.userId,
    activeTenantId: auth.activeTenant?.tenantId,
    authorizationScopeKey: authorizationBoundary.key,
    authorizationStatus: authApiKeyAuthorizationPhase(authorization.status),
    authorizationRevision: authorization.authorization?.revision,
    options,
  });
  const boundaryRevision = boundaryFence.update(boundaryKey);
  const [apiKeys, setApiKeys] = React.useState<readonly AuthApiKeySummary[]>([]);
  const [capabilities, setCapabilities] = React.useState<
    AuthApiKeyManagementCapabilities | null
  >(null);
  const [page, setPage] = React.useState<AuthApiKeyPage['page'] | null>(null);
  const [loadedBoundary, setLoadedBoundary] = React.useState(-1);
  const [isLoading, setLoading] = React.useState(enabled);
  const [isLoadingMore, setLoadingMore] = React.useState(false);
  const [isMutating, setMutating] = React.useState(false);
  const [isDenied, setDenied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = React.useState(0);
  const requestRevision = React.useRef(0);
  const activeMutations = React.useRef(0);
  const baseLoadInFlight = React.useRef(enabled);
  const loadMoreFenceRef = React.useRef<AuthApiKeyLoadMoreFence | null>(null);
  if (!loadMoreFenceRef.current) {
    loadMoreFenceRef.current = new AuthApiKeyLoadMoreFence();
  }
  const loadMoreFence = loadMoreFenceRef.current;
  const stateBoundaryRevision = React.useRef<number | null>(null);
  const modeKey = targetKey(options);
  const limit = options.limit;

  React.useEffect(() => {
    const request = ++requestRevision.current;
    const requestBoundary = boundaryRevision;
    baseLoadInFlight.current = enabled && surface !== null;
    loadMoreFence.cancel();
    const boundaryChanged = stateBoundaryRevision.current !== requestBoundary;
    stateBoundaryRevision.current = requestBoundary;
    setLoadedBoundary(requestBoundary);
    setLoadingMore(false);
    if (boundaryChanged) {
      setApiKeys([]);
      setCapabilities(null);
      setPage(null);
      activeMutations.current = 0;
      setMutating(false);
    }
    setDenied(false);
    setError(null);
    if (!enabled || !surface) {
      baseLoadInFlight.current = false;
      setLoading(false);
      return;
    }
    setLoading(true);
    void listFor(surface, options, { limit }).then((result) => {
      if (request !== requestRevision.current
        || !boundaryFence.isCurrent(requestBoundary)) return;
      setApiKeys(result.apiKeys);
      setCapabilities(result.capabilities);
      setPage(result.page);
    }).catch((cause) => {
      if (request !== requestRevision.current
        || !boundaryFence.isCurrent(requestBoundary)) return;
      publishAuthApiKeyFailure('read', cause, setDenied, setError);
    }).finally(() => {
      if (request === requestRevision.current
        && boundaryFence.isCurrent(requestBoundary)) {
        baseLoadInFlight.current = false;
        setLoading(false);
      }
    });
  }, [boundaryFence, boundaryRevision, enabled, limit, modeKey,
    loadMoreFence, reloadRevision, surface]);

  const current = enabled && loadedBoundary === boundaryRevision;
  const capabilitiesReady = current
    && page !== null
    && capabilities !== null
    && !isDenied;
  const canIssue = capabilitiesReady && capabilities?.canIssue === true;
  const canRotate = capabilitiesReady && capabilities?.canRotate === true;
  const canRevoke = capabilitiesReady && capabilities?.canRevoke === true;
  const actionsReady = capabilitiesReady
    && error === null
    && !isLoading
    && !isLoadingMore
    && !isMutating;
  const reload = React.useCallback(() => {
    if (config.config === null && config.error !== null) {
      void config.reload();
      return;
    }
    if (authorization.error !== null) {
      void authorization.refresh().catch(() => {});
      return;
    }
    if (boundaryFence.isCurrent(boundaryRevision)) {
      baseLoadInFlight.current = true;
      loadMoreFence.cancel();
      setLoadingMore(false);
      setLoading(true);
      setReloadRevision((value) => value + 1);
    }
  }, [authorization.error, authorization.refresh, boundaryFence, boundaryRevision,
    config.config, config.error, config.reload, loadMoreFence]);

  const loadMore = React.useCallback(async () => {
    if (!surface || !current || !page?.nextCursor || isLoadingMore
      || !boundaryFence.isCurrent(boundaryRevision)) return;
    const operation = loadMoreFence.tryStart(
      baseLoadInFlight.current || activeMutations.current > 0,
    );
    if (operation === null) return;
    const request = requestRevision.current;
    const requestBoundary = boundaryRevision;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await listFor(surface, options, {
        limit,
        cursor: page.nextCursor,
      });
      if (request !== requestRevision.current
        || !loadMoreFence.isCurrent(operation)
        || !boundaryFence.isCurrent(requestBoundary)) return;
      setApiKeys((currentKeys) => mergeKeys(currentKeys, result.apiKeys));
      setCapabilities(result.capabilities);
      setPage(result.page);
    } catch (cause) {
      if (request === requestRevision.current
        && loadMoreFence.isCurrent(operation)
        && boundaryFence.isCurrent(requestBoundary)) {
        publishAuthApiKeyFailure('read', cause, setDenied, setError);
      }
    } finally {
      if (loadMoreFence.finish(operation)
        && request === requestRevision.current
        && boundaryFence.isCurrent(requestBoundary)) setLoadingMore(false);
    }
  }, [boundaryFence, boundaryRevision, current, isLoadingMore, limit, options,
    loadMoreFence, page?.nextCursor, surface]);

  const mutate = React.useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (!surface || !current || !boundaryFence.isCurrent(boundaryRevision)) {
      throw unavailable();
    }
    if (baseLoadInFlight.current || loadMoreFence.isActive) {
      throw listRequestInProgress();
    }
    if (activeMutations.current > 0) throw mutationInProgress();
    const operationBoundary = boundaryRevision;
    activeMutations.current += 1;
    setMutating(true);
    setDenied(false);
    setError(null);
    try {
      const result = await operation();
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      reload();
      return result;
    } catch (cause) {
      if (!boundaryFence.isCurrent(operationBoundary)) throw staleOperation();
      publishAuthApiKeyFailure('mutation', cause, setDenied, setError);
      throw cause;
    } finally {
      if (boundaryFence.isCurrent(operationBoundary)) {
        activeMutations.current = Math.max(0, activeMutations.current - 1);
        if (activeMutations.current === 0) setMutating(false);
      }
    }
  }, [boundaryFence, boundaryRevision, current, loadMoreFence, reload, surface]);

  return {
    apiKeys: current ? apiKeys : [],
    page: current ? page : null,
    isAvailable,
    canIssue,
    canRotate,
    canRevoke,
    isLoading: config.isLoading
      || (options.enabled !== false
        && capability?.enabled === true
        && auth.isLoading)
      || (options.enabled !== false
        && isAvailable
        && auth.isAuthenticated
        && surface !== null
        && (!authorizationBoundary.ready || authorization.status === 'loading'))
      || (enabled && (!current || isLoading)),
    isLoadingMore: current && isLoadingMore,
    isMutating: current && isMutating,
    isDenied: current && isDenied,
    error: config.error ?? authorization.error ?? (current ? error : null),
    reload,
    loadMore,
    issue: React.useCallback((input) => {
      if (!surface || !canIssue || !actionsReady) return Promise.reject(unavailable());
      return mutate(() => issueFor(surface, options, input));
    }, [actionsReady, canIssue, mutate, options, surface]),
    rotate: React.useCallback((keyId, input) => {
      if (!surface || !canRotate || !actionsReady) return Promise.reject(unavailable());
      return mutate(() => rotateFor(surface, options.mode, keyId, input));
    }, [actionsReady, canRotate, mutate, options.mode, surface]),
    revoke: React.useCallback((keyId) => {
      if (!surface || !canRevoke || !actionsReady) return Promise.reject(unavailable());
      return mutate(() => revokeFor(surface, options.mode, keyId));
    }, [actionsReady, canRevoke, mutate, options.mode, surface]),
  };
}

/** @internal Pure profile/scope gate shared with focused browser tests. */
export function isAuthApiKeyManagementModeAvailable(input: {
  readonly mode: UseAuthApiKeysOptions['mode'];
  readonly selfService: boolean;
  readonly tenancyMode: 'single' | 'multi';
  readonly activeTenantKind: 'organization' | 'administration' | null;
}): boolean {
  if (input.mode === 'application-admin') return input.tenancyMode === 'single';
  if (input.mode === 'self') {
    return input.selfService && (
      input.tenancyMode === 'single' || input.activeTenantKind === 'organization'
    );
  }
  if (input.tenancyMode !== 'multi') return false;
  return input.mode === 'tenant-admin'
    ? input.activeTenantKind === 'organization'
    : input.activeTenantKind === 'administration';
}

export function authApiKeyBoundaryKey(input: {
  readonly enabled: boolean;
  readonly userId?: string;
  readonly activeTenantId?: string;
  readonly authorizationScopeKey?: string;
  readonly authorizationStatus?: string;
  readonly authorizationRevision?: string;
  readonly options: UseAuthApiKeysOptions;
}): string | null {
  if (!input.enabled || !input.userId) return null;
  return JSON.stringify([
    input.authorizationScopeKey ?? null,
    input.authorizationStatus ?? null,
    input.authorizationRevision ?? null,
    input.userId,
    input.activeTenantId ?? null,
    targetKey(input.options),
    input.options.limit ?? null,
  ]);
}

/** Keep background refreshes stable while fencing every unusable authority phase. */
export function authApiKeyAuthorizationPhase(status: string): string {
  return status === 'ready' || status === 'refreshing' ? 'ready' : status;
}

/** @internal Synchronous single-flight fence for cursor pagination. */
export class AuthApiKeyLoadMoreFence {
  private sequence = 0;
  private active: number | null = null;

  get isActive(): boolean {
    return this.active !== null;
  }

  tryStart(blocked = false): number | null {
    if (blocked || this.active !== null) return null;
    this.active = ++this.sequence;
    return this.active;
  }

  isCurrent(operation: number): boolean {
    return this.active === operation;
  }

  finish(operation: number): boolean {
    if (!this.isCurrent(operation)) return false;
    this.active = null;
    return true;
  }

  cancel(): void {
    this.active = null;
  }
}

/** @internal Mutation failures stay local; only failed reads alter list presentation. */
export function authApiKeyFailurePresentation(
  operation: 'read' | 'mutation',
  cause: unknown,
): { readonly denied: boolean; readonly error: string } | null {
  if (operation === 'mutation') return null;
  return {
    denied: cause instanceof AuthClientError && cause.status === 403,
    error: cause instanceof Error ? cause.message : 'Guardian API-key request failed.',
  };
}

function listFor(
  surface: AuthApiKeySdkSurface,
  options: UseAuthApiKeysOptions,
  query: { limit?: number; cursor?: string },
): Promise<AuthApiKeyPage> {
  if (options.mode === 'self') return surface.self.list(query);
  if (options.mode === 'application-admin') {
    return surface.applicationAdmin.listUser(options.userId, query);
  }
  if (options.mode === 'tenant-admin') {
    return surface.tenantAdmin.listMember(options.membershipId, query);
  }
  if (options.membershipId) {
    return surface.platformAdmin.listMember(options.tenantId, options.membershipId, query);
  }
  return surface.platformAdmin.list({ ...query, tenantId: options.tenantId });
}

function issueFor(
  surface: AuthApiKeySdkSurface,
  options: UseAuthApiKeysOptions,
  input: AuthApiKeyIssueInput,
): Promise<IssuedAuthApiKey> {
  if (options.mode === 'self') return surface.self.issue(input);
  if (options.mode === 'application-admin') {
    return surface.applicationAdmin.issueUser(options.userId, input);
  }
  if (options.mode === 'tenant-admin') {
    return surface.tenantAdmin.issueMember(options.membershipId, input);
  }
  if (options.membershipId) {
    return surface.platformAdmin.issueMember(
      options.tenantId,
      options.membershipId,
      input,
    );
  }
  return Promise.reject(unavailable());
}

function rotateFor(
  surface: AuthApiKeySdkSurface,
  mode: UseAuthApiKeysOptions['mode'],
  keyId: string,
  input: AuthApiKeyIssueInput,
): Promise<IssuedAuthApiKey> {
  if (mode === 'self') return surface.self.rotate(keyId, input);
  if (mode === 'application-admin') return surface.applicationAdmin.rotate(keyId, input);
  if (mode === 'tenant-admin') return surface.tenantAdmin.rotate(keyId, input);
  return surface.platformAdmin.rotate(keyId, input);
}

function revokeFor(
  surface: AuthApiKeySdkSurface,
  mode: UseAuthApiKeysOptions['mode'],
  keyId: string,
): Promise<AuthApiKeySummary> {
  if (mode === 'self') return surface.self.revoke(keyId);
  if (mode === 'application-admin') return surface.applicationAdmin.revoke(keyId);
  if (mode === 'tenant-admin') return surface.tenantAdmin.revoke(keyId);
  return surface.platformAdmin.revoke(keyId);
}

function targetKey(options: UseAuthApiKeysOptions): string {
  if (options.mode === 'self') return 'self';
  if (options.mode === 'application-admin') return `application:${options.userId}`;
  if (options.mode === 'tenant-admin') return `tenant:${options.membershipId}`;
  return `platform:${options.tenantId ?? '*'}:${options.membershipId ?? '*'}`;
}

function mergeKeys(
  current: readonly AuthApiKeySummary[],
  incoming: readonly AuthApiKeySummary[],
): readonly AuthApiKeySummary[] {
  const seen = new Set(current.map((key) => key.keyId));
  return [...current, ...incoming.filter((key) => !seen.has(key.keyId))];
}

function publishAuthApiKeyFailure(
  operation: 'read' | 'mutation',
  cause: unknown,
  setDenied: (denied: boolean) => void,
  setError: (error: string | null) => void,
): void {
  reportAuthClientActionFailure('guardianApiKeys', cause);
  const presentation = authApiKeyFailurePresentation(operation, cause);
  if (!presentation) return;
  setDenied(presentation.denied);
  setError(presentation.error);
}

function unavailable(): Error {
  return new Error('Guardian API-key management is unavailable for this authorization scope.');
}

function staleOperation(): Error {
  return new Error('The authorization scope changed before the API-key request completed.');
}

function mutationInProgress(): Error {
  return new Error('Wait for the current API-key request to finish before starting another.');
}

function listRequestInProgress(): Error {
  return new Error('Wait for the current API-key list request to finish before managing a key.');
}
