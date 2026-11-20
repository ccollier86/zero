'use client';

/** One mounted private preview, never a user-id cache or an image-element bearer URL. */
import { useLayoutEffect, useRef, useState } from 'react';
import type { UserAvatarPresentation } from '../../auth/auth-user-avatar-types';
import { useClientMaybe } from './client-context';
import type { InternalClient } from './sdk';
import { isUserAvatarPresentation } from './auth-user-avatar-parser';
import {
  isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary,
} from './authorization-scope-hooks';

interface PreviewOwner { key: string; controller: AbortController; url: string | null; active: boolean }
function retire(owner: PreviewOwner): void {
  owner.active = false; owner.controller.abort();
  if (owner.url) { URL.revokeObjectURL(owner.url); owner.url = null; }
}

/**
 * Render only an already admitted server projection. Guardian rechecks byte
 * authority; callers must retire/replace the projection when their live read
 * loses admission. Each mounted consumer owns its requests and object URL.
 */
export function useUserAvatarPresentation(subjectId: string, presentation: UserAvatarPresentation | null | undefined): string | null {
  const client = useClientMaybe() as InternalClient | null, boundary = useAuthorizationScopeBoundary(client);
  const valid = isUserAvatarPresentation(presentation), asset = valid ? presentation.asset : null;
  const enabled = Boolean(subjectId && asset && client?.auth?.isAuthenticated && boundary.ready);
  const key = JSON.stringify([boundary.key, subjectId, valid ? presentation.revision : null, asset]);
  const latest = useRef({ key, enabled }); latest.current = { key, enabled };
  const owner = useRef<PreviewOwner | null>(null), [image, setImage] = useState<{ key: string; url: string } | null>(null);

  useLayoutEffect(() => {
    if (!client || !enabled || !asset) return;
    const currentOwner: PreviewOwner = { key, controller: new AbortController(), url: null, active: true };
    owner.current = currentOwner;
    const current = () => {
      const auth = client.auth, revision = client._authorizationDataBoundary?.revision ?? 0;
      return Boolean(currentOwner.active && !currentOwner.controller.signal.aborted && latest.current.enabled && latest.current.key === key
        && auth?.isAuthenticated && readAuthorizationScopeBoundaryKey(auth, revision) === boundary.key
        && isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
        && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated));
    };
    // Retire bytes synchronously with SDK authority publication, not only after
    // React eventually commits a replacement render.
    const authorityChanged = () => { if (!current()) { retire(currentOwner); setImage(null); } };
    const unsubscribers = [client.auth?.subscribe(authorityChanged), client.auth?.subscribeAuthorization(authorityChanged),
      client._authorizationDataBoundary?.subscribe(authorityChanged)];
    void Promise.resolve().then(() => {
      if (!current()) return null;
      return client.userAvatar.deliver(asset, currentOwner.controller.signal);
    }).then(bytes => {
      if (!bytes || !current()) return;
      const url = URL.createObjectURL(bytes);
      if (!current()) { URL.revokeObjectURL(url); return; }
      currentOwner.url = url; setImage({ key, url });
    }).catch(() => {
      // Optional private media failures are initials, never stale cached bytes.
      if (current()) { retire(currentOwner); setImage(null); }
    });
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
      retire(currentOwner); if (owner.current === currentOwner) owner.current = null;
    };
  }, [client, boundary.key, enabled, key]);

  const auth = client?.auth, revision = client?._authorizationDataBoundary?.revision ?? 0;
  return enabled && image?.key === key && owner.current?.active && auth?.isAuthenticated
    && readAuthorizationScopeBoundaryKey(auth, revision) === boundary.key ? image.url : null;
}
