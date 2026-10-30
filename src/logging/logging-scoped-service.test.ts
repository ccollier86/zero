/** Guardian admission/final fences and malicious observations without an HTTP/auth bypass. */
import { expect, test, spyOn } from 'bun:test';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { createScopedLoggingService } from './logging-scoped-service';
import type { LoggingRuntime } from './logging-runtime';
import { resolveManagedLoggingConfig } from './logging-managed-config';
import type { LoggingEvent } from './logging-contracts';
import { AuthError } from '../auth/types';

function fixture() {
  let valid = true, admin = true, gate: Promise<void> | undefined;
  const events: LoggingEvent[] = [], reads: any[] = [];
  const assert = () => { if (!valid) throw new Error('Authority changed'); };
  const access = { requireUser: () => { assert(); return { userId: 'user-a', sessionId: 'session-a', credentialKind: 'session' }; },
    requirePlatformAdmin: () => { assert(); if (!admin) throw new Error('Forbidden'); }, requirePermission: () => { assert(); if (!admin) throw new Error('Forbidden'); },
  } as unknown as RequestAuthorizationAccess;
  const runtime = { config: resolveManagedLoggingConfig({ preset: 'detailed', metadataKeys: ['count'] }, '/tmp'),
    async append(e: LoggingEvent) { events.push(e); return { id: e.id }; }, async deliver(e: LoggingEvent) { events.push(e); return { id: e.id }; },
    async page(stream: string, scope: unknown, query: unknown) { reads.push({ stream, scope, query }); return { events: [], hasMore: false, nextBeforeOrdinal: null, highWaterOrdinal: 0 }; },
  } as unknown as LoggingRuntime;
  const service = createScopedLoggingService(runtime, access, { scopeKind: 'tenant', tenantId: 'tenant-a' } as ServiceDataScope, async () => { await gate; assert(); }, assert);
  return { service, runtime, events, reads, revoke() { valid = false; }, deny() { admin = false; }, gate(p: Promise<void>) { gate = p; } };
}
test('people and table presentation APIs retain logging-read admission, scope and final authority fences', async () => {
  const f = fixture(), calls: unknown[] = [];
  f.runtime.directory = {
    people(scope, query) { calls.push({ scope, query }); return { items: [{ id: 'user-a', name: 'Avery Example', username: 'avery' }], nextCursor: null, hasMore: false }; },
    lookup() { return []; }, tables(scope) { calls.push(scope); return [{ type: 'table.items', names: ['items'] }]; },
  };
  expect((await f.service.people({ search: 'Avery' })).items[0]?.name).toBe('Avery Example');
  expect(calls[0]).toEqual({ scope: { kind: 'tenant', tenantId: 'tenant-a' }, query: { search: 'Avery', limit: 25 } });
  expect(JSON.stringify(f.events)).not.toContain('Avery');
  expect(await f.service.tables()).toEqual([{ type: 'table.items', names: ['items'] }]);
  f.deny(); await expect(f.service.people()).rejects.toThrow('Forbidden'); await expect(f.service.tables()).rejects.toThrow('Forbidden');
  expect(calls).toHaveLength(2);
  const g = fixture(); g.runtime.directory = { people() { g.revoke(); return { items: [], nextCursor: null, hasMore: false }; }, lookup() { return []; }, tables() { return []; } };
  await expect(g.service.people()).rejects.toThrow('Authority changed');
  const h = fixture(); expect(await h.service.people()).toEqual({ items: [], nextCursor: null, hasMore: false }); expect(await h.service.tables()).toEqual([]);
});
test('read scopes cannot be replaced, permission failure does not read, and delayed revocation blocks release', async () => {
  const f = fixture(); await f.service.page('audit', { actorId: 'user-b' });
  expect(f.reads[0].scope).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
  expect(f.events[0]?.action).toBe('logging.query.window');
  await expect(f.service.page('audit', { scope: 'platform' } as any)).rejects.toMatchObject({ code: 'LOGGING_QUERY_INVALID' });
  f.deny(); await expect(f.service.page('audit')).rejects.toThrow('Forbidden'); expect(f.reads).toHaveLength(1);
  const g = fixture(); let release!: () => void; g.gate(new Promise(resolve => { release = resolve; }));
  const pending = g.service.page('audit'); g.revoke(); release(); await expect(pending).rejects.toThrow('Authority changed'); expect(g.reads).toHaveLength(0);
});

test('live page and membership reads share one audited investigation window without a query-refresh feedback loop', async () => {
  const f = fixture();
  await f.service.page('audit', { actorId: 'user-b', limit: 1, includeTotal: false });
  await f.service.page('audit', { actorId: 'user-b', limit: 25, beforeOrdinal: 200, highWaterOrdinal: 500 });
  await f.service.page('audit', { actorId: 'user-b', eventIds: [JSON.stringify(['source', 'event'])], limit: 100, includeTotal: false });
  expect(f.events.filter(event => event.action === 'logging.query.window')).toHaveLength(1);
  await f.service.page('audit', { actorId: 'user-c' });
  expect(f.events.filter(event => event.action === 'logging.query.window')).toHaveLength(2);
  expect(f.events[0]?.correlationId).toBeTruthy();
  expect(f.events[1]?.correlationId).toBe(f.events[0]?.correlationId);
  f.deny(); await expect(f.service.page('audit')).rejects.toThrow('Forbidden');
  expect(f.events.at(-1)).toMatchObject({ action: 'logging.query.denied', outcome: 'denied' });
});

test('continuous investigation refreshes never create a new idle audit activity at the window boundary', async () => {
  const f = fixture(); let now = 1700000000000;
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  try {
    for (let i = 0; i < 20; i++) { await f.service.page('audit', { projection: 'activities' }); now += 30000; }
    expect(f.events.filter(event => event.action === 'logging.query.window')).toHaveLength(1);
    now += 300001; await f.service.page('audit', { projection: 'activities' });
    expect(f.events.filter(event => event.action === 'logging.query.window')).toHaveLength(2);
  } finally { clock.mockRestore(); }
});
test('server emission snapshots input before yielding and derives its actor and scope', async () => {
  const f = fixture(); let release!: () => void; f.gate(new Promise(resolve => { release = resolve; }));
  const input = { id: 'record-test', family: 'records' as const, action: 'record.read', occurredAt: Date.now(), outcome: 'succeeded' as const, evidence: 'server-confirmed' as const, metadata: { count: 2 } };
  const task = f.service.record(input); input.metadata.count = 999; release(); await task;
  expect(f.events[0]?.metadata.count).toBe(2);
  expect(f.events[0]?.actor.id).toBe('user-a'); expect(f.events[0]?.scope).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
});
test('browser batch validation is atomic and durations are observations with canonical interval identities', async () => {
  const f = fixture(), interval = { viewId: 'view-a', sequence: 1, elapsedMs: 100, visibleMs: 90, activeMs: 80, incomplete: false };
  const row = { id: 'client-id', collectorId: 'collector-a', action: 'view.interval' as const, occurredAt: Date.now(), interval };
  await expect(f.service.observe([row, { ...row, id: 'second', actor: 'forged' } as any])).rejects.toMatchObject({ code: 'LOGGING_EVENT_INVALID' });
  expect(f.events).toHaveLength(0);
  await f.service.observe([row]); await f.service.observe([{ ...row, id: 'another-client-id' }]);
  expect(f.events[0]?.id).toBe(f.events[1]?.id); expect(f.events[0]?.evidence).toBe('browser-observed');
  expect(f.events[0]?.actor.id).toBe('user-a');
  await expect(f.service.observe([{ ...row, interval: { ...interval, elapsedMs: 10 } }])).rejects.toMatchObject({ code: 'LOGGING_EVENT_INVALID' });
  await expect(f.service.observe([{ ...row, interval: undefined }])).rejects.toMatchObject({ code: 'LOGGING_EVENT_INVALID' });
});

test('tenant-granted read/manage permissions cannot expose global backlog or integrity state', async () => {
  let inspected = false;
  const access = { requireUser: () => ({ userId: 'tenant-admin' }), requirePermission: () => {},
    requirePlatformAdmin: () => { throw new Error('Platform authority required'); }, requireApplicationAuthorization: () => {} } as unknown as RequestAuthorizationAccess;
  const runtime = { config: resolveManagedLoggingConfig({ preset: 'activity', access: { read: 'logs.read', manage: 'logs.manage' } }, '/tmp'),
    diagnostics() { inspected = true; return {}; }, async verify() { inspected = true; return {}; } } as unknown as LoggingRuntime;
  const service = createScopedLoggingService(runtime, access, { scopeKind: 'tenant', tenantId: 'tenant-a' } as ServiceDataScope, async () => {}, () => {});
  await expect(service.health()).rejects.toThrow('Platform authority required');
  await expect(service.verify('audit')).rejects.toThrow('Platform authority required');
  expect(inspected).toBe(false);
});

test('semantic read evidence distinguishes failed, denied and unknown operations without retaining exception content', async () => {
  for (const [error, outcome] of [
    [new Error('SYNTHETIC_PRIVATE_CONTENT'), 'failed'],
    [new AuthError('SYNTHETIC_PRIVATE_CONTENT', 'FORBIDDEN', 403), 'denied'],
    [Object.assign(new Error('SYNTHETIC_PRIVATE_CONTENT'), { outcome: 'unknown' }), 'unknown'],
  ] as const) {
    const f = fixture();
    await expect(f.service.read({ type: 'record', id: 'opaque' }, () => { throw error; })).rejects.toBe(error);
    expect(f.events.map(e => [e.action, e.outcome])).toEqual([['record.read.admitted', 'attempted'], ['record.read.' + outcome, outcome]]);
    expect(JSON.stringify(f.events)).not.toContain('SYNTHETIC_PRIVATE_CONTENT');
  }
});

test('semantic reads retain the admitted target and never release a result after authority changed', async () => {
  const f = fixture(), target = { type: 'record', id: 'original' };
  const result = await f.service.read(target, () => { target.id = 'changed'; return 42; });
  expect(result).toBe(42); expect(f.events.map(e => e.target?.id)).toEqual(['original', 'original']);
  expect(f.events.map(e => e.action)).toEqual(['record.read.admitted', 'record.read.prepared']);
  const g = fixture();
  await expect(g.service.read(target, () => { g.revoke(); return 'must-not-release'; })).rejects.toThrow('Authority changed');
  expect(g.events.some(e => e.action === 'record.read.prepared')).toBe(false);
});
