import { useSyncExternalStore, useCallback, useRef, useEffect, useContext } from 'react';
import type { JsonValue } from '../types';
import type { EphemeralClient } from './ephemeral-client';
import type { EphemeralErrorMessage } from '../ephemeral-policy';
import type { EphemeralEntryClient } from './ephemeral-store';
import { SyncContext } from './hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../../frontend/client/authorization-scope-hooks';

const NOOP_UNSUBSCRIBE = () => {};
const EMPTY_EPHEMERAL_ENTRIES: Record<string, EphemeralEntryClient> = {};

/**
 * Get the EphemeralClient from context.
 * Throws if not available.
 */
function useEphemeralClient(): EphemeralClient {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error('useEphemeral must be used within a <SyncProvider> or <ClientProvider>');
  }
  if (!ctx.ephemeralClient) {
    throw new Error('Ephemeral client is not available.');
  }
  return ctx.ephemeralClient;
}

/** Observe authorization/validation failures from ephemeral operations. */
export function useEphemeralErrors(
  listener: (error: EphemeralErrorMessage) => void,
): void {
  const client = useEphemeralClient();
  const platformClient = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(platformClient);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  useEffect(() => {
    if (!authorizationBoundary.ready) return;
    return client.onError((error) => {
      if (isAuthorizationScopeCallbackCurrent(
        boundaryKeyRef.current,
        boundaryReadyRef.current,
        callbackBoundaryKey,
      )) listener(error);
    });
  }, [authorizationBoundary.key, authorizationBoundary.ready, callbackBoundaryKey, client, listener]);
}

/**
 * Subscribe to a single key in an ephemeral topic.
 * Returns `[value, setValue]` similar to useState.
 *
 * @param topic - The ephemeral topic name
 * @param key - The key within the topic
 * @param defaultValue - Default value when key doesn't exist
 *
 * @example
 * ```tsx
 * function LivePoll() {
 *   const [votes, setVotes] = useEphemeral('poll:best-framework', 'votes', {});
 *   const vote = (choice: string) => setVotes({ ...votes, [me.id]: choice });
 * }
 * ```
 */
export function useEphemeral<T extends JsonValue>(
  topic: string,
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const client = useEphemeralClient();
  const platformClient = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(platformClient);
  const subscribed = useRef(false);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  // Ensure subscription
  useEffect(() => {
    if (!authorizationBoundary.ready) return;
    if (subscribed.current) return;
    subscribed.current = true;

    const unsub = client.subscribe(topic, () => {});
    return () => {
      unsub();
      subscribed.current = false;
    };
  }, [authorizationBoundary.key, authorizationBoundary.ready, client, topic]);

  const subscribe = useCallback(
    (cb: () => void) => {
      return authorizationBoundary.ready
        ? client.subscribe(topic, () => cb())
        : NOOP_UNSUBSCRIBE;
    },
    [authorizationBoundary.key, authorizationBoundary.ready, client, topic]
  );

  const getSnapshot = useCallback(
    () => authorizationBoundary.ready
      ? (client.get(topic, key) as T) ?? defaultValue
      : defaultValue,
    [authorizationBoundary.ready, client, topic, key, defaultValue]
  );

  const value = useSyncExternalStore(subscribe, getSnapshot, () => defaultValue);

  const setValue = useCallback(
    (newValue: T) => {
      if (!isAuthorizationScopeCallbackCurrent(
        boundaryKeyRef.current,
        boundaryReadyRef.current,
        callbackBoundaryKey,
      )) return;
      client.set(topic, key, newValue);
    },
    [callbackBoundaryKey, client, topic, key]
  );

  return [value as T, setValue];
}

/**
 * Subscribe to all entries in an ephemeral topic.
 * Returns the full entries map.
 *
 * @example
 * ```tsx
 * function CursorOverlay({ topic }: { topic: string }) {
 *   const entries = useEphemeralTopic(topic);
 *   return (
 *     <>
 *       {Object.entries(entries).map(([key, { value, userId }]) => (
 *         <Cursor key={key} position={value} userId={userId} />
 *       ))}
 *     </>
 *   );
 * }
 * ```
 */
export function useEphemeralTopic(topic: string): Record<string, EphemeralEntryClient> {
  const client = useEphemeralClient();
  const platformClient = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(platformClient);

  const subscribe = useCallback(
    (cb: () => void) => authorizationBoundary.ready
      ? client.subscribe(topic, () => cb())
      : NOOP_UNSUBSCRIBE,
    [authorizationBoundary.key, authorizationBoundary.ready, client, topic]
  );

  const getSnapshot = useCallback(
    () => {
      if (!authorizationBoundary.ready) return EMPTY_EPHEMERAL_ENTRIES;
      const entries = client.getEntries(topic);
      return Object.keys(entries).length > 0 ? entries : EMPTY_EPHEMERAL_ENTRIES;
    },
    [authorizationBoundary.ready, client, topic]
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_EPHEMERAL_ENTRIES);
}
