import { useSyncExternalStore, useCallback, useRef, useEffect, useContext } from 'react';
import type { JsonValue } from '../types';
import type { EphemeralClient } from './ephemeral-client';
import type { EphemeralEntryClient } from './ephemeral-store';
import { SyncContext } from './hooks';

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
  const subscribed = useRef(false);

  // Ensure subscription
  useEffect(() => {
    if (subscribed.current) return;
    subscribed.current = true;

    const unsub = client.subscribe(topic, () => {});
    return () => {
      unsub();
      subscribed.current = false;
    };
  }, [client, topic]);

  const subscribe = useCallback(
    (cb: () => void) => {
      return client.subscribe(topic, () => cb());
    },
    [client, topic]
  );

  const getSnapshot = useCallback(
    () => (client.get(topic, key) as T) ?? defaultValue,
    [client, topic, key, defaultValue]
  );

  const value = useSyncExternalStore(subscribe, getSnapshot, () => defaultValue);

  const setValue = useCallback(
    (newValue: T) => client.set(topic, key, newValue),
    [client, topic, key]
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

  const subscribe = useCallback(
    (cb: () => void) => client.subscribe(topic, () => cb()),
    [client, topic]
  );

  const getSnapshot = useCallback(
    () => client.getEntries(topic),
    [client, topic]
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => ({}));
}
