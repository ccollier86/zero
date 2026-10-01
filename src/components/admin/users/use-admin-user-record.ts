'use client';

/**
 * Loads one global auth account for an already-selected management record.
 * Permission discovery stays with the caller so tenant-only managers never
 * probe the application-user API.
 */

import * as React from 'react';
import { useClientMaybe } from '../../../frontend/client/hooks';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../../../frontend/client/authorization-scope-hooks';
import { reportAdminUserError } from './admin-user-error';
import { mapAuthUserToManagementUser } from './user-management-mappers';
import type { UserManagementUser } from './user-management-types';

interface AdminUserRecordCallbackBoundary {
  currentBoundaryKey: string;
  boundaryReady: boolean;
  callbackBoundaryKey: string;
  currentUserId: string | null;
  targetUserId: string;
  enabled: boolean;
}

/** Keep retained callbacks bound to both their auth scope and selected account. */
export function isAdminUserRecordCallbackCurrent({
  currentBoundaryKey,
  boundaryReady,
  callbackBoundaryKey,
  currentUserId,
  targetUserId,
  enabled,
}: AdminUserRecordCallbackBoundary): boolean {
  return enabled
    && currentUserId === targetUserId
    && isAuthorizationScopeCallbackCurrent(
      currentBoundaryKey,
      boundaryReady,
      callbackBoundaryKey,
    );
}

export interface AdminUserRecordState {
  user: UserManagementUser | null;
  isLoading: boolean;
  error: string | null;
  reload(): Promise<UserManagementUser | null>;
  replace(user: UserManagementUser): void;
}

/** Load the exact global account without listing unrelated identities. */
export function useAdminUserRecord({
  userId,
  enabled,
}: {
  userId: string | null;
  enabled: boolean;
}): AdminUserRecordState {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const boundaryKeyRef = React.useRef(boundary.key);
  const boundaryReadyRef = React.useRef(boundary.ready);
  boundaryKeyRef.current = boundary.key;
  boundaryReadyRef.current = boundary.ready;
  const selectionRef = React.useRef({ userId, enabled });
  selectionRef.current = { userId, enabled };
  const callbackBoundaryKey = boundary.key;
  const requestId = React.useRef(0);
  const [state, setState] = React.useState<{
    scopeKey: string;
    userId: string | null;
    user: UserManagementUser | null;
    loading: boolean;
    error: string | null;
  }>({
    scopeKey: boundary.key,
    userId: null,
    user: null,
    loading: false,
    error: null,
  });

  const isCurrentTarget = React.useCallback(
    (targetUserId: string) => isAdminUserRecordCallbackCurrent({
      currentBoundaryKey: boundaryKeyRef.current,
      boundaryReady: boundaryReadyRef.current,
      callbackBoundaryKey,
      currentUserId: selectionRef.current.userId,
      targetUserId,
      enabled: selectionRef.current.enabled,
    }),
    [callbackBoundaryKey],
  );

  const reload = React.useCallback(async (): Promise<UserManagementUser | null> => {
    const targetUserId = userId;
    if (!targetUserId || !boundary.ready || !client || !isCurrentTarget(targetUserId)) {
      return null;
    }

    const currentRequest = ++requestId.current;
    setState((current) => isCurrentTarget(targetUserId) ? {
      scopeKey: callbackBoundaryKey,
      userId: targetUserId,
      user: current.scopeKey === callbackBoundaryKey
        && current.userId === targetUserId ? current.user : null,
      loading: true,
      error: null,
    } : current);
    try {
      const user = mapAuthUserToManagementUser(
        await client.getAuthAdminUser(targetUserId),
      );
      if (!isCurrentTarget(targetUserId) || currentRequest !== requestId.current) return null;
      if (user.userId !== targetUserId) {
        throw new Error('The account response did not match the selected member.');
      }
      setState((current) => isCurrentTarget(targetUserId) ? {
        scopeKey: callbackBoundaryKey,
        userId: targetUserId,
        user,
        loading: false,
        error: null,
      } : current);
      return user;
    } catch (value) {
      if (!isCurrentTarget(targetUserId) || currentRequest !== requestId.current) return null;
      const error = reportAdminUserError('loadExact', value, { targetUserId });
      setState((current) => isCurrentTarget(targetUserId) ? {
        scopeKey: callbackBoundaryKey,
        userId: targetUserId,
        user: null,
        loading: false,
        error: error.message,
      } : current);
      throw error;
    }
  }, [boundary.ready, callbackBoundaryKey, client, isCurrentTarget, userId]);

  React.useEffect(() => {
    requestId.current += 1;
    setState({
      scopeKey: callbackBoundaryKey,
      userId,
      user: null,
      loading: false,
      error: null,
    });
    if (enabled && userId && boundary.ready && client) {
      void reload().catch(() => {});
    }
  }, [boundary.ready, callbackBoundaryKey, client, enabled, reload, userId]);

  React.useEffect(() => () => {
    requestId.current += 1;
  }, []);

  const visible = boundary.ready
    && state.scopeKey === boundary.key
    && state.userId === userId;
  const replace = React.useCallback((user: UserManagementUser) => {
    const targetUserId = userId;
    if (!targetUserId || user.userId !== targetUserId || !isCurrentTarget(targetUserId)) return;
    setState((current) => isCurrentTarget(targetUserId) ? {
      scopeKey: callbackBoundaryKey,
      userId: targetUserId,
      user,
      loading: false,
      error: null,
    } : current);
  }, [callbackBoundaryKey, isCurrentTarget, userId]);

  return {
    user: visible ? state.user : null,
    isLoading: visible && state.loading,
    error: visible ? state.error : null,
    reload,
    replace,
  };
}
