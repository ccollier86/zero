/** Deterministic real ephemeral leases: multiple tabs/devices, expiry, activity and manual precedence. */
import { describe, expect, test } from 'bun:test';
import { EphemeralStateManager } from '../sync/ephemeral-manager';
import { normalizeAuthPresence } from '../auth/auth-config-presence';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { PresenceLeaseStore } from './presence-lease-store';
import { effectivePresenceStatus, presenceStatusCatalog } from './presence-status';

const scope = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'organization-a' });
const other = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'organization-b' });
const config = normalizeAuthPresence({ enabled: true, idleAfterMs: 5000, awayAfterMs: 10000,
  heartbeatIntervalMs: 1000, leaseDurationMs: 3000, onCallEnabled: true,
  customStatuses: [{ key: 'focus', label: 'Focused', tone: 'primary', icon: 'pause' }] });

describe('presence lease and status policy', () => {
  test('one close never removes another tab/device; scopes and users are isolated', () => {
    let now = 1000, changed = 0;
    const manager = new EphemeralStateManager(0, () => now);
    const leases = new PresenceLeaseStore(manager, config, 1, () => { changed++; }, () => now);
    try {
      leases.report({ scope, userId: 'user', connectionId: 'tab-a' }, { sequence: 1, activity: true, visible: true });
      leases.report({ scope, userId: 'user', connectionId: 'tab-b' }, { sequence: 1, activity: false, visible: false });
      leases.report({ scope: other, userId: 'user', connectionId: 'device-c' }, { sequence: 1, activity: true, visible: true });
      expect(leases.forUser(scope, 'user')).toHaveLength(2);
      expect(leases.forUser(other, 'user')).toHaveLength(1); expect(leases.forUser(scope, 'other')).toHaveLength(0);
      leases.release('tab-b'); expect(leases.forUser(scope, 'user')).toHaveLength(1);
      expect(effectivePresenceStatus(leases.forUser(scope, 'user'), { status: 'available', expiresAt: null, revision: 0 }, config, now)).toBe('available');
      leases.release('tab-a'); expect(leases.forUser(scope, 'user')).toHaveLength(0);
      expect(leases.forUser(other, 'user')).toHaveLength(1); expect(changed).toBe(5);
    } finally { leases.close(); manager.dispose(); }
  });

  test('heartbeat only renewal never fabricates activity; TTL delete is notified exactly once and sequence survives expiry', () => {
    let now = 0; const events: string[] = [];
    const manager = new EphemeralStateManager(0, () => now);
    const leases = new PresenceLeaseStore(manager, config, 2, () => events.push('affected'), () => now);
    const principal = { scope, userId: 'user', connectionId: 'connection' };
    try {
      leases.report(principal, { sequence: 1, activity: true, visible: true }); now = 2000;
      leases.report(principal, { sequence: 2, activity: false, visible: true });
      expect(leases.forUser(scope, 'user')[0]?.lastActivityAt).toBe(0);
      now = 5000; expect(manager.sweep()).toBe(1); expect(manager.sweep()).toBe(0);
      expect(events).toHaveLength(3); expect(leases.forUser(scope, 'user')).toHaveLength(0);
      expect(() => leases.report(principal, { sequence: 2, activity: true, visible: true })).toThrow();
      leases.report(principal, { sequence: 3, activity: false, visible: false });
      expect(leases.forUser(scope, 'user')[0]?.lastActivityAt).toBeNull();
      expect(effectivePresenceStatus(leases.forUser(scope, 'user'), { status: 'available', expiresAt: null, revision: 0 }, config, now)).toBe('away');
      leases.close(); expect(() => leases.report(principal, { sequence: 4, activity: true, visible: true })).toThrow();
    } finally { leases.close(); manager.dispose(); }
  });

  test('automatic age, visibility, manual precedence/expiry and configured status catalog agree', () => {
    const leases = [{ lastActivityAt: 0, visible: true }];
    const available = { status: 'available', expiresAt: null, revision: 0 };
    expect(effectivePresenceStatus(leases, available, config, 1000)).toBe('available');
    expect(effectivePresenceStatus(leases, available, config, 5000)).toBe('idle');
    expect(effectivePresenceStatus(leases, available, config, 10000)).toBe('away');
    expect(effectivePresenceStatus([{ lastActivityAt: 0, visible: false }], available, config, 1000)).toBe('idle');
    for (const status of ['busy', 'away', 'on-call', 'focus']) {
      expect(effectivePresenceStatus(leases, { status, expiresAt: 2000, revision: 1 }, config, 1000)).toBe(status);
      expect(effectivePresenceStatus([], { status, expiresAt: null, revision: 1 }, config, 1000)).toBe('offline');
      expect(effectivePresenceStatus(leases, { status, expiresAt: 1000, revision: 1 }, config, 1000)).toBe('available');
    }
    expect(presenceStatusCatalog(normalizeAuthPresence()).find(status => status.key === 'on-call')).toBeUndefined();
    expect(presenceStatusCatalog(config).filter(status => status.selectable).map(status => status.key)).toEqual(['available', 'away', 'busy', 'on-call', 'focus']);
  });
});
