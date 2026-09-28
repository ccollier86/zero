'use client';

import * as React from 'react';
import { AuthClientError } from './auth-errors';
import type {
  AuthApplicationAdministrationConfig,
  AuthApplicationAdminSdkSurface,
  AuthApplicationOwnershipTransferResult,
  AuthApplicationRoleMutationResult,
  AuthApplicationUser,
  AuthApplicationUserListParams,
  AuthApplicationUserPage,
} from './auth-application-administration-types';
import { useAuth, useAuthConfig } from './auth-hooks';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';

export interface UseApplicationAccessOptions
  extends Omit<AuthApplicationUserListParams, 'cursor'> {
  enabled?: boolean;
}

export interface UseApplicationAccessResult {
  isAvailable: boolean;
  isDenied: boolean;
  config: AuthApplicationAdministrationConfig | null;
  readonly users: readonly AuthApplicationUser[];
  page: AuthApplicationUserPage['page'] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isMutating: boolean;
  error: string | null;
  reload(): void;
  loadMore(): Promise<void>;
  replaceUserRoles(
    userId: string,
    roles: readonly string[],
  ): Promise<AuthApplicationRoleMutationResult>;
  transferOwnership(userId: string): Promise<AuthApplicationOwnershipTransferResult>;
}

interface ApplicationAccessCachedSnapshot {
  config: AuthApplicationAdministrationConfig | null;
  users: readonly AuthApplicationUser[];
  page: AuthApplicationUserPage['page'] | null;
  isDenied: boolean;
  error: string | null;
}

const EMPTY_APPLICATION_USERS = Object.freeze([]) as readonly AuthApplicationUser[];

/** @internal Pure identity boundary used by the hook and its regression tests. */
export function projectApplicationAccessSnapshot(
  actorUserId: string | null,
  loadedActorUserId: string | null,
  cached: ApplicationAccessCachedSnapshot,
): ApplicationAccessCachedSnapshot & { isCurrent: boolean } {
  const isCurrent = actorUserId !== null && loadedActorUserId === actorUserId;
  return isCurrent
    ? { ...cached, isCurrent }
    : {
        config: null,
        users: EMPTY_APPLICATION_USERS,
        page: null,
        isDenied: false,
        error: null,
        isCurrent,
      };
}

/** Capability-driven state for the single/advanced application control plane. */
export function useApplicationAccess(
  options: UseApplicationAccessOptions = {},
): UseApplicationAccessResult {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const actorUserId = auth.user?.userId ?? null;
  const applicationAdmin = client && 'applicationAdmin' in client
    ? client.applicationAdmin as AuthApplicationAdminSdkSurface
    : null;
  const isAvailable = authConfig.config?.tenancy?.mode === 'single'
    && authConfig.config.authorization?.mode === 'advanced';
  const enabled = options.enabled !== false
    && isAvailable
    && auth.isAuthenticated
    && actorUserId !== null
    && applicationAdmin !== null;
  const [config, setConfig] = React.useState<AuthApplicationAdministrationConfig | null>(null);
  const [users, setUsers] = React.useState<AuthApplicationUser[]>([]);
  const [page, setPage] = React.useState<AuthApplicationUserPage['page'] | null>(null);
  const [isLoading, setLoading] = React.useState(enabled);
  const [isLoadingMore, setLoadingMore] = React.useState(false);
  const [mutatingActorUserId, setMutatingActorUserId] = React.useState<string | null>(null);
  const [isDenied, setDenied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadedActorUserId, setLoadedActorUserId] = React.useState<string | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const queryRevision = React.useRef(0);
  const currentActorUserId = React.useRef(actorUserId);
  const boundaryKeyRef = React.useRef(authorizationBoundary.key);
  const boundaryReadyRef = React.useRef(authorizationBoundary.ready);
  currentActorUserId.current = actorUserId;
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const isCurrentScope = React.useCallback(
    () => isAuthorizationScopeCallbackCurrent(
      boundaryKeyRef.current,
      boundaryReadyRef.current,
      callbackBoundaryKey,
    ),
    [callbackBoundaryKey],
  );
  const limit = options.limit;
  const search = options.search ?? '';
  const status = options.status;

  React.useEffect(() => {
    let current = true;
    const requestRevision = ++queryRevision.current;
    setLoadingMore(false);
    if (!enabled || !applicationAdmin) {
      setLoadedActorUserId(null);
      setLoadedBoundaryKey(null);
      setConfig(null);
      setUsers([]);
      setPage(null);
      setDenied(false);
      setError(null);
      setLoading(false);
      return () => { current = false; };
    }

    // Mask the previous identity's capabilities and user projection before
    // this identity's request can commit. The returned snapshot is also
    // actor-keyed, so there is no stale-data paint before this effect runs.
    setLoadedActorUserId(null);
    setLoadedBoundaryKey(null);
    setLoading(true);
    setDenied(false);
    setError(null);
    void applicationAdmin.getConfig().then(async (nextConfig) => {
      if (!current || requestRevision !== queryRevision.current) return;
      if (!isCurrentScope()) return;
      setConfig(nextConfig);
      if (!nextConfig.capabilities.canReadUsers) {
        setUsers([]);
        setPage(null);
        setDenied(true);
        setLoadedActorUserId(actorUserId);
        setLoadedBoundaryKey(callbackBoundaryKey);
        return;
      }
      const result = await applicationAdmin.listUsers({ limit, search, status });
      if (!current || requestRevision !== queryRevision.current || !isCurrentScope()) return;
      setUsers(result.users);
      setPage(result.page);
      setLoadedActorUserId(actorUserId);
      setLoadedBoundaryKey(callbackBoundaryKey);
    }).catch((cause) => {
      if (!current || requestRevision !== queryRevision.current || !isCurrentScope()) return;
      setDenied(cause instanceof AuthClientError && cause.status === 403);
      setError(errorMessage(cause));
      setConfig(null);
      setUsers([]);
      setPage(null);
      setLoadedActorUserId(actorUserId);
      setLoadedBoundaryKey(callbackBoundaryKey);
    }).finally(() => {
      if (current && requestRevision === queryRevision.current && isCurrentScope()) {
        setLoading(false);
      }
    });
    return () => { current = false; };
  }, [
    actorUserId,
    applicationAdmin,
    authorizationBoundary.key,
    authorizationBoundary.ready,
    callbackBoundaryKey,
    enabled,
    isCurrentScope,
    limit,
    revision,
    search,
    status,
  ]);

  const visible = projectApplicationAccessSnapshot(actorUserId, loadedActorUserId, {
    config,
    users,
    page,
    isDenied,
    error,
  });
  const actorSnapshotCurrent = visible.isCurrent
    && authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  const visibleConfig = actorSnapshotCurrent ? visible.config : null;
  const visibleUsers = actorSnapshotCurrent ? visible.users : EMPTY_APPLICATION_USERS;
  const visiblePage = actorSnapshotCurrent ? visible.page : null;

  const reload = React.useCallback(() => {
    if (isCurrentScope()) setRevision((value) => value + 1);
  }, [isCurrentScope]);
  const loadMore = React.useCallback(async () => {
    if (!applicationAdmin || !actorSnapshotCurrent || !isCurrentScope()
      || !visiblePage?.nextCursor || isLoadingMore) return;
    const requestRevision = queryRevision.current;
    const requestBoundaryKey = callbackBoundaryKey;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await applicationAdmin.listUsers({
        limit,
        search,
        status,
        cursor: visiblePage.nextCursor,
      });
      if (requestRevision !== queryRevision.current
        || !boundaryReadyRef.current
        || boundaryKeyRef.current !== requestBoundaryKey) return;
      setUsers((current) => mergeUsers(current, result.users));
      setPage(result.page);
    } catch (cause) {
      if (requestRevision !== queryRevision.current
        || !boundaryReadyRef.current
        || boundaryKeyRef.current !== requestBoundaryKey) return;
      setDenied(cause instanceof AuthClientError && cause.status === 403);
      setError(errorMessage(cause));
    } finally {
      if (requestRevision === queryRevision.current
        && boundaryReadyRef.current
        && boundaryKeyRef.current === requestBoundaryKey) setLoadingMore(false);
    }
  }, [actorSnapshotCurrent, applicationAdmin, callbackBoundaryKey, isCurrentScope,
    isLoadingMore, limit, visiblePage?.nextCursor, search, status]);

  const mutate = React.useCallback(async <T,>(
    mutationActorUserId: string,
    operation: () => Promise<T>,
    allowsOwnedScopeReplacement: (result: T) => boolean = () => false,
  ) => {
    if (!isCurrentScope() || currentActorUserId.current !== mutationActorUserId) {
      throw staleApplicationOperation();
    }
    const operationBoundaryKey = callbackBoundaryKey;
    setMutatingActorUserId(mutationActorUserId);
    setError(null);
    try {
      const result = await operation();
      const scopeRemainsCurrent = boundaryReadyRef.current
        && boundaryKeyRef.current === operationBoundaryKey
        && currentActorUserId.current === mutationActorUserId;
      if (!scopeRemainsCurrent
        && !allowsOwnedScopeReplacement(result)) {
        throw staleApplicationOperation();
      }
      if (scopeRemainsCurrent) reload();
      return result;
    } catch (cause) {
      if (!boundaryReadyRef.current
        || boundaryKeyRef.current !== operationBoundaryKey
        || currentActorUserId.current !== mutationActorUserId) {
        throw staleApplicationOperation();
      }
      if (currentActorUserId.current === mutationActorUserId) {
        setDenied(cause instanceof AuthClientError && cause.status === 403);
        setError(errorMessage(cause));
        if (cause instanceof AuthClientError
          && cause.code === 'APPLICATION_ROLE_REVISION_CONFLICT') reload();
      }
      throw cause;
    } finally {
      if (boundaryReadyRef.current
        && boundaryKeyRef.current === operationBoundaryKey) {
        setMutatingActorUserId((current) => (
          current === mutationActorUserId ? null : current
        ));
      }
    }
  }, [callbackBoundaryKey, isCurrentScope, reload]);

  return {
    isAvailable,
    isDenied: actorSnapshotCurrent && visible.isDenied,
    config: visibleConfig,
    users: visibleUsers,
    page: visiblePage,
    isLoading: authConfig.isLoading || (enabled && !actorSnapshotCurrent) || isLoading,
    isLoadingMore: actorSnapshotCurrent && isLoadingMore,
    isMutating: actorSnapshotCurrent && mutatingActorUserId === actorUserId,
    error: actorSnapshotCurrent ? visible.error : null,
    reload,
    loadMore,
    replaceUserRoles: React.useCallback(async (userId, roles) => {
      if (!applicationAdmin || !actorSnapshotCurrent) throw unavailable();
      const target = visibleUsers.find((user) => user.identity.userId === userId);
      if (!target) throw staleTarget();
      if (!actorUserId) throw unavailable();
      return mutate(actorUserId, () => applicationAdmin.replaceUserRoles(
        userId,
        roles,
        target.roleRevision,
      ), (result) => result.actorAuthorizationChanged);
    }, [actorSnapshotCurrent, actorUserId, applicationAdmin, mutate, visibleUsers]),
    transferOwnership: React.useCallback(async (userId) => {
      if (!applicationAdmin || !actorSnapshotCurrent) throw unavailable();
      if (!actorUserId) throw unavailable();
      return mutate(
        actorUserId,
        () => applicationAdmin.transferOwnership(userId),
        (result) => result.actorAuthorizationChanged,
      );
    }, [actorSnapshotCurrent, actorUserId, applicationAdmin, mutate]),
  };
}

function mergeUsers(
  current: readonly AuthApplicationUser[],
  incoming: readonly AuthApplicationUser[],
): AuthApplicationUser[] {
  const merged = new Map(current.map((user) => [user.identity.userId, user]));
  for (const user of incoming) merged.set(user.identity.userId, user);
  return [...merged.values()];
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Application access request failed';
}

function unavailable(): Error {
  return new Error(
    'Application access administration requires an authenticated single/advanced Zero client',
  );
}

function staleTarget(): Error {
  return new Error('Reload application access before changing this user\'s roles');
}

function staleApplicationOperation(): Error {
  return new Error('The authorization scope changed before the application access request completed');
}
