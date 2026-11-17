/** Real SDK wiring with in-memory HTTP/SSE fixtures. No server, database, browser or generated output. */
import { afterEach, expect, test } from 'bun:test';
import { createClient, getClient, type InternalClient } from './sdk';
const originalFetch = globalThis.fetch, refreshKey = '__platform_refresh_token';
const user = { userId: 'synthetic-calendar-user', username: 'synthetic', email: 'synthetic@example.test', firstName: null, lastName: null,
  role: 'user', status: 'active', passwordChangeRequired: false, emailVerifiedAt: 1, emailVerificationRequired: false, mfaRequired: false,
  properties: {}, createdAt: 1, updatedAt: null };
const tenant = (tenantId: string) => ({ tenantId, kind: 'organization', slug: tenantId, name: tenantId, role: 'owner' });
afterEach(() => { getClient()?.disconnect(); globalThis.fetch = originalFetch; if (typeof localStorage !== 'undefined') localStorage.removeItem(refreshKey); });
for (const transition of ['read-authority-reset', 'tenant-switch', 'disconnect'] as const) {
  test(`SDK calendar ${transition} releases an idle watch before a replacement authority can publish`, async () => {
    let opened = 0, cancelled = 0, delivered = 0, failures = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (url.endsWith('/auth/login') || url.endsWith('/auth/tenants/switch')) {
        const switched = url.endsWith('/switch');
        return Response.json({ user, accessToken: switched ? 'synthetic-b' : 'synthetic-a', refreshToken: switched ? 'synthetic-refresh-b' : 'synthetic-refresh-a', activeTenant: tenant(switched ? 'tenant-b' : 'tenant-a') });
      }
      if (url.includes('/api/calendar/appointments/live')) {
        opened++;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"version":1,"value":{"items":[],"truncated":false}}\n\n'));
        }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    const client = createClient({ url: 'http://calendar-retirement.test', tables: {}, auth: true, autoConnect: false }) as InternalClient;
    let stop: (() => void) | undefined;
    try {
      await client.login('synthetic', 'synthetic-password');
      stop = client.calendar.appointments.watch({ resourceIds: ['resource-a'], startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' },
        () => { delivered++; }, { onError() { failures++; } });
      await settle(() => delivered === 1);
      if (transition === 'read-authority-reset') client._syncClient.reset(); else if (transition === 'tenant-switch') await client.switchTenant('tenant-b'); else client.disconnect();
      await settle(() => cancelled === 1);
      expect(delivered).toBe(1); expect(failures).toBe(0); expect(opened).toBe(1);
    } finally { stop?.(); client.disconnect(); }
  });
}
async function settle(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  throw new Error('Synthetic SDK calendar boundary did not settle.');
}
