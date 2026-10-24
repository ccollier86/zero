import { expect, test } from 'bun:test';
import { createEphemeralStore, routeEphemeralMessage } from './ephemeral-store';
import { typingIndicatorMembers } from '../../frontend/client/typing-indicator-model';

test('server freshness is observed with a local monotonic receipt, never a wire-supplied clock', () => {
  const store = createEphemeralStore(), start = performance.now();
  routeEphemeralMessage(store, { type: 'ephemeral.snapshot', topic: 'typing:room', entries: {
    'user:a': { userId: 'a', value: { updatedAt: 1 }, freshness: { ageMs: 1000, ttlMs: 5000 }, observedAt: 1e20 },
  } });
  const entry = store.getSnapshot().context.topics['typing:room']!.entries['user:a']!;
  expect(entry.observedAt).toBeGreaterThanOrEqual(start);
  expect(entry.observedAt).toBeLessThanOrEqual(performance.now());
  expect(typingIndicatorMembers({ 'user:a': entry }, { now: 2e12, idleMs: 3500 })).toHaveLength(1);
  routeEphemeralMessage(store, { type: 'ephemeral.change', topic: 'typing:room', key: 'user:a',
    userId: 'a', value: { updatedAt: 1e20 }, op: 'set', freshness: { ageMs: 3501, ttlMs: 5000 } });
  expect(typingIndicatorMembers(store.getSnapshot().context.topics['typing:room']!.entries, { now: 2e12, idleMs: 3500 })).toEqual([]);
});

test('legacy entry shape is preserved and malformed snapshot members are omitted', () => {
  const store = createEphemeralStore();
  routeEphemeralMessage(store, { type: 'ephemeral.snapshot', topic: 'custom', entries: {
    valid: { value: 'hello', userId: 'a' }, invalid: null,
  } });
  expect(store.getSnapshot().context.topics.custom!.entries).toEqual({ valid: { value: 'hello', userId: 'a' } });
  routeEphemeralMessage(store, { type: 'ephemeral.change', topic: 'custom', key: 'valid', userId: 'a', value: 'updated', op: 'set' });
  expect(store.getSnapshot().context.topics.custom!.entries.valid).toEqual({ value: 'updated', userId: 'a' });
  routeEphemeralMessage(store, { type: 'ephemeral.snapshot', topic: 'custom', entries: null });
  expect(store.getSnapshot().context.topics.custom!.entries).toEqual({});
});
