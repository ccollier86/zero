'use client';

import * as React from 'react';
import type {
  AuthAuditEvent,
  AuthAuditExport,
  AuthAuditPage,
  AuthAuditQuery,
  AuthAuditReadScope,
} from './auth-audit-types';
import { AuthClientError } from './auth-errors';
import { useAuth } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import type { InternalClient } from './sdk';
import {
  isTenantAdministrationScopeStable,
  TenantAdministrationBoundaryFence,
} from './tenant-administration-hooks';

export interface UseAuthAuditOptions extends Omit<AuthAuditQuery, 'cursor'> {
  scope: AuthAuditReadScope;
  enabled?: boolean;
}

export interface UseAuthAuditResult {
  events: readonly AuthAuditEvent[];
  page: AuthAuditPage['page'] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isExporting: boolean;
  isDenied: boolean;
  error: string | null;
  reload(): void;
  loadMore(): Promise<void>;
  exportEvents(limit?: number): Promise<AuthAuditExport>;
}

/** Identity- and active-tenant-fenced pagination for the durable audit routes. */
export function useAuthAudit(options: UseAuthAuditOptions): UseAuthAuditResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const auth = useAuth();
  const tenantScopeStable = isTenantAdministrationScopeStable(auth.sessionTransition);
  const tenantScopeTransitioning = options.scope === 'tenant'
    && auth.isAuthenticated
    && !tenantScopeStable;
  const enabled = options.enabled !== false && Boolean(
    authClient
      && auth.isAuthenticated
      && (options.scope === 'platform' || (auth.activeTenant && tenantScopeStable)),
  );
  const [events, setEvents] = React.useState<readonly AuthAuditEvent[]>([]);
  const [page, setPage] = React.useState<AuthAuditPage['page'] | null>(null);
  const [isLoading, setLoading] = React.useState(enabled);
  const [isLoadingMore, setLoadingMore] = React.useState(false);
  const [isExporting, setExporting] = React.useState(false);
  const [isDenied, setDenied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadedBoundaryRevision, setLoadedBoundaryRevision] = React.useState(-1);
  const [revision, setRevision] = React.useState(0);
  const requestRevision = React.useRef(0);
  const boundaryFenceRef = React.useRef<TenantAdministrationBoundaryFence | null>(null);
  if (!boundaryFenceRef.current) {
    boundaryFenceRef.current = new TenantAdministrationBoundaryFence();
  }
  const boundaryFence = boundaryFenceRef.current;

  const query = React.useMemo<AuthAuditQuery>(() => ({
    limit: options.limit,
    action: options.action,
    outcome: options.outcome,
    from: options.from,
    to: options.to,
    targetType: options.targetType,
  }), [
    options.action,
    options.from,
    options.limit,
    options.outcome,
    options.targetType,
    options.to,
  ]);
  const boundaryKey = authAuditBoundaryKey({
    enabled,
    userId: auth.user?.userId,
    tenantId: options.scope === 'tenant' ? auth.activeTenant?.tenantId : undefined,
    scope: options.scope,
    query,
    authorizationScopeKey: authorizationBoundary.key,
  });
  const boundaryRevision = boundaryFence.update(boundaryKey);

  React.useEffect(() => {
    const operation = ++requestRevision.current;
    const operationBoundary = boundaryRevision;
    setLoadedBoundaryRevision(operationBoundary);
    setEvents([]);
    setPage(null);
    setLoadingMore(false);
    setExporting(false);
    setDenied(false);
    setError(null);
    if (!enabled || !authClient) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void authClient.audit.list(options.scope, query).then((result) => {
      if (operation !== requestRevision.current
        || !boundaryFence.isCurrent(operationBoundary)) return;
      setEvents(result.events);
      setPage(result.page);
    }).catch((cause) => {
      if (operation !== requestRevision.current
        || !boundaryFence.isCurrent(operationBoundary)) return;
      setDenied(cause instanceof AuthClientError && cause.status === 403);
      setError(errorMessage(cause));
    }).finally(() => {
      if (operation === requestRevision.current
        && boundaryFence.isCurrent(operationBoundary)) setLoading(false);
    });
  }, [authClient, boundaryFence, boundaryRevision, enabled, options.scope, query, revision]);

  const reload = React.useCallback(() => {
    if (boundaryFence.isCurrent(boundaryRevision)) {
      setRevision((value) => value + 1);
    }
  }, [boundaryFence, boundaryRevision]);

  const loadMore = React.useCallback(async () => {
    if (!boundaryFence.isCurrent(boundaryRevision)
      || !authClient || !page?.nextCursor || isLoadingMore
      || loadedBoundaryRevision !== boundaryRevision) return;
    const operation = requestRevision.current;
    const operationBoundary = boundaryRevision;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await authClient.audit.list(options.scope, {
        ...query,
        cursor: page.nextCursor,
      });
      if (operation !== requestRevision.current
        || !boundaryFence.isCurrent(operationBoundary)) return;
      setEvents((current) => mergeEvents(current, result.events));
      setPage(result.page);
    } catch (cause) {
      if (operation === requestRevision.current
        && boundaryFence.isCurrent(operationBoundary)) {
        setDenied(cause instanceof AuthClientError && cause.status === 403);
        setError(errorMessage(cause));
      }
    } finally {
      if (operation === requestRevision.current
        && boundaryFence.isCurrent(operationBoundary)) setLoadingMore(false);
    }
  }, [authClient, boundaryFence, boundaryRevision, isLoadingMore,
    loadedBoundaryRevision, options.scope, page?.nextCursor, query]);

  const exportEvents = React.useCallback(async (limit = 1_000) => {
    if (!authClient || !enabled) {
      throw new Error('Auth audit is unavailable while authorization scope is changing.');
    }
    const operationBoundary = boundaryRevision;
    if (!boundaryFence.isCurrent(operationBoundary)) {
      throw new Error('Authorization scope changed before export started.');
    }
    setExporting(true);
    setError(null);
    try {
      const normalizedLimit = Number.isFinite(limit)
        ? Math.max(1, Math.min(1_000, Math.trunc(limit)))
        : 1_000;
      const result = await authClient.audit.export(options.scope, {
        ...query,
        limit: normalizedLimit,
      });
      if (!boundaryFence.isCurrent(operationBoundary)) {
        throw new Error('Authorization scope changed before export completed.');
      }
      return result;
    } catch (cause) {
      if (boundaryFence.isCurrent(operationBoundary)) {
        setDenied(cause instanceof AuthClientError && cause.status === 403);
        setError(errorMessage(cause));
      }
      throw cause;
    } finally {
      if (boundaryFence.isCurrent(operationBoundary)) setExporting(false);
    }
  }, [authClient, boundaryFence, boundaryRevision, enabled, options.scope, query]);

  const current = enabled && loadedBoundaryRevision === boundaryRevision;

  return {
    events: current ? events : [],
    page: current ? page : null,
    isLoading: tenantScopeTransitioning || (enabled && (!current || isLoading)),
    isLoadingMore: current && isLoadingMore,
    isExporting: current && isExporting,
    isDenied: current && isDenied,
    error: current ? error : null,
    reload,
    loadMore,
    exportEvents,
  };
}

/** @internal Synchronous cache partition for identity, scope, and applied filters. */
export function authAuditBoundaryKey(input: {
  enabled: boolean;
  userId?: string;
  tenantId?: string;
  scope: AuthAuditReadScope;
  query: AuthAuditQuery;
  authorizationScopeKey?: string;
}): string | null {
  if (!input.enabled || !input.userId
    || (input.scope === 'tenant' && !input.tenantId)) return null;
  return JSON.stringify([
    input.authorizationScopeKey ?? null,
    input.userId,
    input.scope,
    input.scope === 'tenant' ? input.tenantId : null,
    input.query.limit ?? null,
    input.query.action ?? null,
    input.query.outcome ?? null,
    input.query.from ?? null,
    input.query.to ?? null,
    input.query.targetType ?? null,
  ]);
}

function mergeEvents(
  current: readonly AuthAuditEvent[],
  incoming: readonly AuthAuditEvent[],
): readonly AuthAuditEvent[] {
  const seen = new Set(current.map((event) => event.eventId));
  return [...current, ...incoming.filter((event) => !seen.has(event.eventId))];
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Authorization audit request failed.';
}
