import { describe, expect, test } from 'bun:test';
import { GuardianPresenceClient, type GuardianPresenceBoundary } from './guardian-presence-client';
import { isAuthPresenceCapabilities } from './guardian-presence-parser';
import { readGuardianPresenceRows } from './guardian-presence-model';
import type { AuthPresenceCapabilities } from '../../auth/auth-presence-types';
import type { PresenceActivityEnvironment } from './guardian-presence-activity';
import type { Row } from '../../sync/types';

const capabilities: AuthPresenceCapabilities = { enabled: true, state: 'ready', topology: 'single-owner',
  canReportActivity: true, canSetIntent: true,
  serverTime: 1_000, ownerLeaseDurationMs: 100, heartbeatIntervalMs: 10, idleAfterMs: 30, awayAfterMs: 60,
  statuses: [{ key: 'available', label: 'Available', tone: 'success', selectable: true },
    { key: 'busy', label: 'Busy', tone: 'destructive', selectable: true }] };
const row: Row = { id: 'r1', scope_kind: 'tenant', scope_id: 'a', user_id: 'alice', status_key: 'available',
  connected: 1, revision: 2, owner_epoch: 1, updated_at: 1_000 };
const owner: Row = { owner_key: 'primary', owner_epoch: 1, fresh_until: 1_060, retired: 0 };
const own = (revision = 0) => ({ capabilities, intent: { status: 'available', expiresAt: null, revision }, observation: null });
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function harness(fetcher: (path: string, init?: RequestInit) => Promise<Response> = async path => Response.json(path.endsWith('/config') ? capabilities : own())) {
  let boundary: GuardianPresenceBoundary = { key: 'a', ready: true, connected: true, scopeKind: 'tenant', scopeId: 'a' };
  let now = 0, scheduled = 0, cancelled = 0;
  const heartbeat: object[] = [], failures: unknown[] = [], listeners = new Set<() => void>();
  let rows: Record<string, Row> = { r1: row }, currentOwner: Row | undefined = owner;
  const activity: PresenceActivityEnvironment = { target: new EventTarget(), visibility: new EventTarget(),
    now: () => now, isVisible: () => true, schedule: () => (++scheduled) as unknown as ReturnType<typeof setInterval>,
    cancel: () => { ++cancelled; } };
  const client = new GuardianPresenceClient({ enabled: true, readBoundary: () => boundary,
    subscribeBoundary: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    authenticatedFetch: fetcher, readRows: () => ({ rows, owner: currentOwner }),
    sendTransient: value => { heartbeat.push(value); return true; }, reportFailure: cause => failures.push(cause),
    activityEnvironment: activity, monotonicNow: () => now, requestTimeoutMs: 25 });
  const notify = () => { for (const callback of listeners) callback(); };
  return { client, heartbeat, failures, activity, notify, scheduled: () => scheduled, cancelled: () => cancelled,
    setBoundary: (value: Partial<GuardianPresenceBoundary>, broadcast = true) => { boundary = { ...boundary, ...value }; if (broadcast) notify(); },
    setNow: (value: number) => { now = value; }, setRows: (value: Record<string, Row>) => { rows = value; notify(); },
    setOwner: (value: Row | undefined) => { currentOwner = value; notify(); } };
}

describe('Guardian SDK presence lifecycle', () => {
  test('requires actual capability clock/catalog and never treats malformed metadata as fresh', () => {
    expect(isAuthPresenceCapabilities(capabilities)).toBe(true);
    expect(isAuthPresenceCapabilities({ ...capabilities, serverTime: undefined })).toBe(false);
    expect(isAuthPresenceCapabilities({ ...capabilities, state: ['ready'] })).toBe(false);
    expect(isAuthPresenceCapabilities({ ...capabilities, statuses: [...capabilities.statuses, capabilities.statuses[0]] })).toBe(false);
    expect(isAuthPresenceCapabilities({ ...capabilities, statuses: [{ ...capabilities.statuses[0], key: 'a'.repeat(48) }] })).toBe(true);
    expect(isAuthPresenceCapabilities({ ...capabilities, statuses: [{ ...capabilities.statuses[0], key: 'a'.repeat(49) }] })).toBe(false);
    expect(readGuardianPresenceRows({ r1: row, foreign: { ...row, user_id: 'bob', scope_id: 'b' } }, owner,
      { scopeKind: 'tenant', scopeId: 'a' }, capabilities, true, 1_020)).toMatchObject({ alice: { stale: false } });
    expect(readGuardianPresenceRows({ r1: row }, { ...owner, fresh_until: 99_999 },
      { scopeKind: 'tenant', scopeId: 'a' }, capabilities, true, 1_020).alice?.stale).toBe(true);
    expect(readGuardianPresenceRows({ r1: row }, { ...owner, owner_epoch: 2 },
      { scopeKind: 'tenant', scopeId: 'a' }, capabilities, true, 1_020).alice?.stale).toBe(true);
  });
  test('one tracker starts after readiness and does not multiply across reactive row updates', async () => {
    const h = harness();
    try {
      h.client.activate(); h.client.activate(); await flush();
      expect(h.client.getSnapshot().status).toBe('ready');
      expect(h.scheduled()).toBe(1);
      expect(h.heartbeat).toEqual([{ sequence: 1, activity: false, visible: true }]);
      h.notify(); h.setRows({ r1: { ...row, revision: 3 } });
      expect(h.scheduled()).toBe(1);
      expect(h.client.getSnapshot().observations.alice?.revision).toBe(3);
      h.setNow(61); h.notify();
      expect(h.client.getSnapshot().observations.alice?.stale).toBe(true);
      h.setBoundary({ connected: false });
      expect(h.cancelled()).toBe(1);
    } finally { h.client.dispose(); }
  });
  test('an old capability/body result cannot populate a new scope even before notification', async () => {
    let release!: (response: Response) => void;
    const h = harness(() => new Promise(resolve => { release = resolve; }));
    try {
      h.client.activate(); await flush();
      h.setBoundary({ key: 'b', scopeId: 'b' }, false);
      expect(h.client.getSnapshot().observations).toEqual({});
      release(Response.json(capabilities)); await flush();
      expect(h.client.getSnapshot().status).toBe('disabled');
      expect(h.scheduled()).toBe(0);
      await expect(h.client.getSelf()).rejects.toMatchObject({ name: 'AbortError' });
    } finally { h.client.dispose(); }
  });
  test('stale body reads are bounded and cancelled disposal cannot install a tracker', async () => {
    const h = harness(async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as Response);
    h.client.activate(); await new Promise(resolve => setTimeout(resolve, 40));
    expect(h.client.getSnapshot().status).toBe('error');
    expect(h.failures).toHaveLength(1); expect(h.scheduled()).toBe(0);
    h.client.dispose();
    expect(h.client.getSnapshot().status).toBe('disabled');
  });
  test('aborted manual writes clear pending state and older reads do not replace accepted intent', async () => {
    let releaseRead!: (response: Response) => void;
    const h = harness(async (path, init) => {
      if (path.endsWith('/config')) return Response.json(capabilities);
      if (init?.method === 'PATCH') return Response.json(own(2));
      return new Promise(resolve => { releaseRead = resolve; });
    });
    try {
      h.client.activate(); await flush();
      const pendingRead = h.client.getSelf(); await flush();
      await h.client.updateIntent({ status: 'available', expectedRevision: 0 });
      releaseRead(Response.json(own(0))); await pendingRead;
      expect(h.client.getSnapshot().self?.intent.revision).toBe(2);
      const controller = new AbortController(); controller.abort();
      await expect(h.client.updateIntent({ status: 'available', expectedRevision: 2 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(h.client.getSnapshot().saving).toBe(false);
    } finally { h.client.dispose(); }
  });
  test('scope retirement releases listeners and never carries another organization’s cached rows', async () => {
    const h = harness();
    h.client.activate(); await flush();
    h.setBoundary({ key: 'b', scopeId: 'b' }); await flush();
    expect(h.client.getSnapshot().observations).toEqual({});
    expect(h.heartbeat).toEqual([{ sequence: 1, activity: false, visible: true }, { sequence: 1, activity: false, visible: true }]);
    h.client.dispose(); h.notify();
    expect(h.scheduled()).toBe(2); expect(h.cancelled()).toBe(2);
  });
});
