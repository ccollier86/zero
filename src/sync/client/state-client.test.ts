import { describe, expect, test } from 'bun:test';
import { StateClient } from './state-client';
import { createStateStore, routeStateMessage } from './state-store';
import type { JsonValue } from '../types';

function getEntry(
  entries: Readonly<Record<string, JsonValue>>,
  key: string,
): JsonValue | undefined {
  return entries[key];
}

describe('StateClient authorization lifecycle', () => {
  test('purges optimistic values and freezes writes across scope replacement', () => {
    const sent: object[] = [];
    const store = createStateStore();
    const client = new StateClient((message) => sent.push(message), store);
    client.set('private-preference', 'tenant-a');
    expect(client.get('private-preference')).toBe('tenant-a');

    client.beginAuthorizationScopeTransition();
    expect(client.getAll()).toEqual({});
    expect(client.ready).toBe(false);
    expect(() => client.set('private-preference', 'leak'))
      .toThrow('authorization scope transition');

    client.completeAuthorizationScopeTransition();
    expect(() => client.set('private-preference', 'tenant-b')).not.toThrow();
    expect(client.get('private-preference')).toBe('tenant-b');
    expect(sent).toHaveLength(2);
    client.dispose();
  });
});

describe('StateClient prototype-safe keys', () => {
  test('get, getAll, and getByPrefix distinguish stored keys from inherited names', () => {
    const store = createStateStore();
    const client = new StateClient(() => {}, store);

    for (const key of ['__proto__', 'constructor', 'toString']) {
      expect(client.get(key)).toBeUndefined();
      expect(client.get(key, 'fallback')).toBe('fallback');
    }

    const entries = JSON.parse(
      '{"__proto__":"proto","constructor":"ctor","toString":"string","pref:__proto__":"pref-proto","pref:constructor":"pref-ctor","other":1}',
    ) as Record<string, JsonValue>;
    routeStateMessage(store, { type: 'state.snapshot', entries });

    expect(client.get('__proto__')).toBe('proto');
    expect(client.get('constructor')).toBe('ctor');
    expect(client.get('toString')).toBe('string');

    const all = client.getAll();
    expect(Object.getPrototypeOf(all)).toBeNull();
    expect(Object.hasOwn(all, '__proto__')).toBe(true);
    expect(all.__proto__).toBe('proto');
    expect(getEntry(all, 'constructor')).toBe('ctor');
    expect(getEntry(all, 'toString')).toBe('string');

    const prefixed = client.getByPrefix('pref:');
    expect(Object.getPrototypeOf(prefixed)).toBeNull();
    expect(Object.keys(prefixed)).toEqual(['pref:__proto__', 'pref:constructor']);
    expect(prefixed['pref:__proto__']).toBe('pref-proto');
    expect(prefixed['pref:constructor']).toBe('pref-ctor');
    expect(getEntry(prefixed, 'constructor')).toBeUndefined();
    expect(getEntry(prefixed, 'toString')).toBeUndefined();
    client.dispose();
  });

  test('optimistic set, delete, rollback, and clear preserve special keys', () => {
    const sent: Array<{ type?: string; ref?: string }> = [];
    const store = createStateStore();
    const client = new StateClient((message) => sent.push(message), store);

    client.set('__proto__', 'proto');
    const setRef = sent.at(-1)?.ref;
    expect(client.get('__proto__')).toBe('proto');
    expect(Object.getPrototypeOf(client.getAll())).toBeNull();
    routeStateMessage(store, {
      type: 'state.ack',
      ref: setRef,
      ok: false,
    });
    expect(client.get('__proto__')).toBeUndefined();
    expect(client.get('__proto__', 'fallback')).toBe('fallback');

    client.set('constructor', 'ctor');
    const confirmedSetRef = sent.at(-1)?.ref;
    routeStateMessage(store, {
      type: 'state.ack',
      ref: confirmedSetRef,
      ok: true,
    });
    client.set('toString', 'string');
    const secondSetRef = sent.at(-1)?.ref;
    routeStateMessage(store, {
      type: 'state.ack',
      ref: secondSetRef,
      ok: true,
    });

    client.delete('constructor');
    const deleteRef = sent.at(-1)?.ref;
    expect(client.get('constructor')).toBeUndefined();
    routeStateMessage(store, {
      type: 'state.ack',
      ref: deleteRef,
      ok: false,
    });
    expect(client.get('constructor')).toBe('ctor');

    client.clear();
    const clearRef = sent.at(-1)?.ref;
    expect(client.get('constructor')).toBeUndefined();
    expect(client.get('toString')).toBeUndefined();
    routeStateMessage(store, {
      type: 'state.ack',
      ref: clearRef,
      ok: false,
    });

    const restored = client.getAll();
    expect(Object.getPrototypeOf(restored)).toBeNull();
    expect(getEntry(restored, 'constructor')).toBe('ctor');
    expect(getEntry(restored, 'toString')).toBe('string');
    client.dispose();
  });
});
