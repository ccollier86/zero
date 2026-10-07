'use client';

/** Components observe one SDK-owned tracker; none of these hooks installs activity listeners. */
import { createElement, useCallback, useSyncExternalStore } from 'react';
import { useClientMaybe, shouldUseSsrFallback } from './client-context';
import { useAuthorizationScopeBoundary, readAuthorizationScopeBoundaryKey, isAuthorizationScopeCallbackCurrent } from './authorization-scope-hooks';
import type { InternalClient } from './sdk';
import type { UpdateAuthPresenceIntentInput } from '../../auth/auth-presence-types';
import type { AvatarPresence } from '../../components/avatar-group';
import { ZeroIcon } from '../icons';
import { EMPTY_GUARDIAN_PRESENCE } from './guardian-presence-client';

const noSubscribe = () => () => {};
const getEmpty = () => EMPTY_GUARDIAN_PRESENCE;

export function useGuardianPresence() {
  const client = useClientMaybe();
  const ssr = shouldUseSsrFallback(client, 'useGuardianPresence');
  const internal = client as InternalClient | null;
  const presence = client?.presence;
  const boundary = useAuthorizationScopeBoundary(client);
  const snapshot = useSyncExternalStore(presence?.subscribe ?? noSubscribe, presence?.getSnapshot ?? getEmpty, getEmpty);
  const assertCurrent = useCallback(() => {
    const key = readAuthorizationScopeBoundaryKey(internal?.auth ?? null, internal?._authorizationDataBoundary?.revision ?? 0);
    if (!presence || !isAuthorizationScopeCallbackCurrent(key, boundary.ready, boundary.key)
      || presence.getSnapshot().status === 'disabled') throw new DOMException('Presence scope changed.', 'AbortError');
    return presence;
  }, [presence, internal, boundary.key, boundary.ready]);
  const refresh = useCallback(() => assertCurrent().refresh(), [assertCurrent]);
  const getSelf = useCallback((signal?: AbortSignal) => assertCurrent().getSelf(signal), [assertCurrent]);
  const updateIntent = useCallback((input: UpdateAuthPresenceIntentInput, signal?: AbortSignal) => assertCurrent().updateIntent(input, signal), [assertCurrent]);
  return { ...(ssr || !boundary.ready ? EMPTY_GUARDIAN_PRESENCE : snapshot), refresh, getSelf, updateIntent };
}

/** An expired/disconnected/unconfirmed observation does not paint a misleading status ring. */
export function useAvatarPresence(userId: string): AvatarPresence | undefined {
  const presence = useGuardianPresence();
  const observation = presence.observations[userId];
  const definition = presence.capabilities?.statuses.find(status => status.key === observation?.status);
  if (!observation || observation.stale || !definition || presence.status !== 'ready') return undefined;
  return { label: definition.label, tone: definition.tone,
    ...(definition.icon ? { icon: createElement(ZeroIcon, { name: definition.icon }) } : {}), variant: 'ring' };
}
