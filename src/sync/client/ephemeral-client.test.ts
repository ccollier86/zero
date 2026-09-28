import { describe, expect, test } from 'bun:test';
import { EphemeralClient } from './ephemeral-client';
import { createEphemeralStore, routeEphemeralMessage } from './ephemeral-store';
import type { EphemeralErrorMessage } from '../ephemeral-policy';

describe('EphemeralClient authorization lifecycle', () => {
  test('clears rejected snapshots, surfaces stable errors, and allows retry', () => {
    const sent: object[] = [];
    const store = createEphemeralStore();
    const client = new EphemeralClient((message) => sent.push(message), store);
    const errors: EphemeralErrorMessage[] = [];
    client.onError((error) => errors.push(error));

    const unsubscribeFirst = client.subscribe('presence:room-a', () => {});
    routeEphemeralMessage(store, {
      type: 'ephemeral.snapshot',
      topic: 'presence:room-a',
      entries: {
        'user:alice': { value: true, userId: 'alice' },
      },
    });
    expect(client.get('presence:room-a', 'user:alice')).toBe(true);

    const denied: EphemeralErrorMessage = {
      type: 'ephemeral.error',
      operation: 'subscribe',
      code: 'EPHEMERAL_FORBIDDEN',
      message: 'Room topic is not available',
      topic: 'presence:room-a',
      revoked: true,
    };
    expect(routeEphemeralMessage(store, denied)).toBe(true);
    client.handleError(denied);

    expect(client.getEntries('presence:room-a')).toEqual({});
    expect(errors).toEqual([denied]);

    const unsubscribeRetry = client.subscribe('presence:room-a', () => {});
    expect(sent.filter((message) => (
      message as { type?: string }
    ).type === 'ephemeral.subscribe')).toHaveLength(2);

    unsubscribeFirst();
    unsubscribeRetry();
    client.dispose();
  });

  test('purges a topic from the local store after the last unsubscribe', () => {
    const sent: object[] = [];
    const store = createEphemeralStore();
    const client = new EphemeralClient((message) => sent.push(message), store);
    const unsubscribe = client.subscribe('custom:team-a', () => {});
    routeEphemeralMessage(store, {
      type: 'ephemeral.snapshot',
      topic: 'custom:team-a',
      entries: { cursor: { value: { x: 1 }, userId: 'alice' } },
    });

    unsubscribe();

    expect(client.getEntries('custom:team-a')).toEqual({});
    expect(sent.at(-1)).toEqual({
      type: 'ephemeral.unsubscribe',
      topic: 'custom:team-a',
    });
    client.dispose();
  });

  test('purges retained values, freezes operations, and re-subscribes after scope replacement', () => {
    const sent: object[] = [];
    const store = createEphemeralStore();
    const client = new EphemeralClient((message) => sent.push(message), store);
    const unsubscribe = client.subscribe('presence:tenant-room', () => {});
    routeEphemeralMessage(store, {
      type: 'ephemeral.snapshot',
      topic: 'presence:tenant-room',
      entries: { member: { value: true, userId: 'old-user' } },
    });

    client.beginAuthorizationScopeTransition();
    expect(client.getEntries('presence:tenant-room')).toEqual({});
    expect(() => client.set('presence:tenant-room', 'member', true))
      .toThrow('authorization scope transition');

    client.completeAuthorizationScopeTransition();
    expect(sent.filter((message) => (
      message as { type?: string }
    ).type === 'ephemeral.subscribe')).toHaveLength(2);
    expect(() => client.set('presence:tenant-room', 'member', true)).not.toThrow();

    unsubscribe();
    client.dispose();
  });

  test('allows React subscriptions to tear down behind the transition barrier', () => {
    const sent: object[] = [];
    const store = createEphemeralStore();
    const client = new EphemeralClient((message) => sent.push(message), store);
    const unsubscribe = client.subscribe('presence:tenant-room', () => {});

    client.beginAuthorizationScopeTransition();
    expect(() => unsubscribe()).not.toThrow();
    client.completeAuthorizationScopeTransition();

    expect(sent).toEqual([{
      type: 'ephemeral.subscribe',
      topic: 'presence:tenant-room',
    }]);
    client.dispose();
  });
});
