'use client';

/** Selected-account private photo lifecycle. Uses the Guardian SDK, not public URLs or private table subscriptions. */
import { useEffect, useRef, useState } from 'react';
import { useClientMaybe } from '../../../frontend/client/client-context';
import type { InternalClient } from '../../../frontend/client/sdk';
import {
  isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary,
} from '../../../frontend/client/authorization-scope-hooks';
import { AuthClientError } from '../../../frontend/client/auth-errors';
import { reportAuthClientActionFailure } from '../../../frontend/client/auth-action-observability';
import type { UserManagementUser } from './user-management-types';

/** Observe accepted same-client avatar changes; re-read when the selected account projection changes. */
export function useUserDetailAvatar(user: UserManagementUser): string | null {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  const enabled = Boolean((client as InternalClient | null)?.auth?.isAuthenticated)
    && boundary.ready && user.status === 'active';
  const key = JSON.stringify([boundary.key, user.userId, user.updatedAt]);
  const latest = useRef({ key, enabled }); latest.current = { key, enabled };
  const [image, setImage] = useState<{ key: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!client || !enabled) return;
    const internal = client as InternalClient;
    let active = true, sequence = 0, request: AbortController | undefined, objectUrl: string | null = null;
    const current = () => {
      const auth = internal.auth, revision = internal._authorizationDataBoundary?.revision ?? 0;
      return Boolean(auth && active && latest.current.enabled && latest.current.key === key && auth.isAuthenticated
        && readAuthorizationScopeBoundaryKey(auth, revision) === boundary.key
        && isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
        && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated));
    };
    const replace = (next: string | null) => {
      if (!current()) { if (next) URL.revokeObjectURL(next); return; }
      const previous = objectUrl; objectUrl = next; setImage({ key, url: next });
      if (previous) URL.revokeObjectURL(previous);
    };
    const load = async () => {
      if (!current()) return;
      const ticket = ++sequence; request?.abort();
      const controller = new AbortController(); request = controller;
      const accepted = () => !controller.signal.aborted && ticket === sequence && current();
      try {
        const entry = await client.userAvatar.directory(user.userId, controller.signal);
        if (!accepted()) return;
        if (!entry.asset) { replace(null); return; }
        const bytes = await client.userAvatar.deliver(entry.asset, controller.signal);
        if (accepted()) replace(URL.createObjectURL(bytes));
      } catch (cause) {
        if (!accepted()) return;
        replace(null);
        // Optional/denied directory photos keep the ordinary identity fallback.
        if (cause instanceof AuthClientError && (cause.status === 403 || cause.status === 404
          || cause.code === 'AUTH_AVATAR_NOT_READY')) return;
        reportAuthClientActionFailure('userManagementAvatar', cause, { codeOnly: true });
      }
    };
    const unsubscribe = client.userAvatar.subscribe(snapshot => {
      if (snapshot.userId === user.userId && current()) void load();
    });
    void load();
    return () => {
      active = false; ++sequence; unsubscribe(); request?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [boundary.key, client, enabled, key, user.userId]);

  return enabled && image?.key === key ? image.url : null;
}
