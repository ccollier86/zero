/** Strict opt-in policy and bounded catalog tests; no application/configuration reads. */
import { describe, expect, test } from 'bun:test';
import { normalizeAuthPresence } from './auth-config-presence';
import type { AuthPresenceConfig } from './auth-presence-types';

describe('Guardian presence configuration', () => {
  test('defaults are opt-in, stable, bounded and detached', () => {
    expect(normalizeAuthPresence()).toEqual({ enabled: false, idleAfterMs: 300_000, awayAfterMs: 900_000,
      heartbeatIntervalMs: 10_000, leaseDurationMs: 30_000, ownerCheckpointIntervalMs: 10_000,
      ownerLeaseDurationMs: 45_000, onCallEnabled: false, customStatuses: [] });
    const input: AuthPresenceConfig = { enabled: true, customStatuses: [{ key: 'focus', label: 'Focused', tone: 'primary', icon: 'pause' }] };
    const resolved = normalizeAuthPresence(input);
    expect(resolved.customStatuses).not.toBe(input.customStatuses);
    expect(Object.isFrozen(resolved)).toBe(true); expect(Object.isFrozen(resolved.customStatuses[0])).toBe(true);
  });
  test('rejects malformed flags, fields, timing and ordering without coercion', () => {
    for (const input of [null, [], { enabled: 'yes' }, { enabled: 1 }, { topology: 'distributed' },
      { idleAfterMs: '300000' }, { idleAfterMs: null }, { heartbeatIntervalMs: 0 }, { idleAfterMs: NaN },
      { awayAfterMs: 2000, idleAfterMs: 3000 }, { heartbeatIntervalMs: 20000 },
      { ownerCheckpointIntervalMs: 20000 }]) {
      expect(() => normalizeAuthPresence(input as unknown as AuthPresenceConfig)).toThrow();
    }
  });
  test('custom presentation is semantic and bounded; builtin or duplicate identities cannot be replaced', () => {
    for (const customStatuses of [null, {}, [{ key: 'available', label: 'Ready', tone: 'success' }],
      [{ key: 'focus', label: ' ', tone: 'primary' }], [{ key: 'focus', label: 'Focus', tone: '#ff0000' }],
      [{ key: 'focus', label: 'Focus', tone: ['primary'] }], [{ key: 'focus', label: 'Focus', tone: 'primary', icon: '<svg>' }],
      [{ key: 'focus', label: 'Focus', tone: 'primary', extra: true }],
      [{ key: 'focus', label: 'Focus', tone: 'primary' }, { key: 'focus', label: 'Focus', tone: 'primary' }]]) {
      expect(() => normalizeAuthPresence({ customStatuses } as unknown as AuthPresenceConfig)).toThrow();
    }
  });
});
