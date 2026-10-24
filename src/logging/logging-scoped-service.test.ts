/** Guardian admission/final fences and malicious observations without an HTTP/auth bypass. */
import { expect, test } from 'bun:test';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { createScopedLoggingService } from './logging-scoped-service';
import type { LoggingRuntime } from './logging-runtime';
import { resolveManagedLoggingConfig } from './logging-managed-config';
import type { LoggingEvent } from './logging-contracts';

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
  return { service, events, reads, revoke() { valid = false; }, deny() { admin = false; }, gate(p: Promise<void>) { gate = p; } };
}
test('read scopes cannot be replaced, permission failure does not read, and delayed revocation blocks release', async () => {
  const f = fixture(); await f.service.page('audit', { actorId: 'user-b' });
  expect(f.reads[0].scope).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
  expect(f.events[0]?.action).toBe('logging.query.window');
  await expect(f.service.page('audit', { scope: 'platform' } as any)).rejects.toMatchObject({ code: 'LOGGING_QUERY_INVALID' });
  f.deny(); await expect(f.service.page('audit')).rejects.toThrow('Forbidden'); expect(f.reads).toHaveLength(1);
  const g = fixture(); let release!: () => void; g.gate(new Promise(resolve => { release = resolve; }));
  const pending = g.service.page('audit'); g.revoke(); release(); await expect(pending).rejects.toThrow('Authority changed'); expect(g.reads).toHaveLength(0);
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
