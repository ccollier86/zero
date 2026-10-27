import { expect, test } from 'bun:test';
import { guardianAvatarPresence } from './guardian-presence-presentation';
import { EMPTY_GUARDIAN_PRESENCE, type GuardianPresenceClientSnapshot } from './guardian-presence-client';

test('shared presentation requires fresh ready evidence and the actual catalog, not a cached online label', () => {
  const state: GuardianPresenceClientSnapshot = { ...EMPTY_GUARDIAN_PRESENCE, status: 'ready',
    capabilities: { enabled: true, state: 'ready', topology: 'single-owner', canReportActivity: true, canSetIntent: true,
      serverTime: 100, ownerLeaseDurationMs: 100, heartbeatIntervalMs: 10, idleAfterMs: 20, awayAfterMs: 30,
      statuses: [{ key: 'busy', label: 'Busy', tone: 'destructive', selectable: true }, { key: 'offline', label: 'Offline', tone: 'muted', selectable: false }] },
    observations: { person: { userId: 'person', status: 'busy', connected: true, ownerEpoch: 1, revision: 1, updatedAt: 100, freshUntil: 200, stale: false } } };
  expect(guardianAvatarPresence(state, 'person')).toEqual({ label: 'Busy', tone: 'destructive', variant: 'ring' });
  expect(guardianAvatarPresence(state, 'unknown')).toBeUndefined();
  for (const status of ['disabled', 'pending', 'loading', 'error'] as const) expect(guardianAvatarPresence({ ...state, status }, 'person')).toBeUndefined();
  expect(guardianAvatarPresence({ ...state, observations: { person: { ...state.observations.person!, stale: true } } }, 'person')).toBeUndefined();
  expect(guardianAvatarPresence({ ...state, capabilities: null }, 'person')).toBeUndefined();
  expect(guardianAvatarPresence({ ...state, observations: { person: { ...state.observations.person!, status: 'offline', connected: false } } }, 'person'))
    .toEqual({ label: 'Offline', tone: 'muted', variant: 'ring' });
});
