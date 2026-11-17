/** Actual SDK owner retirement with in-memory SSE; no server, database or generated output. */
import { afterEach, expect, test } from 'bun:test';
import { createClient, getClient, type InternalClient } from './sdk';

const originalFetch = globalThis.fetch, refreshKey = '__platform_refresh_token';
const user = { userId: 'synthetic-calendar-user', username: 'synthetic', email: 'synthetic@example.test', firstName: null, lastName: null,
  role: 'user', status: 'active', passwordChangeRequired: false, emailVerifiedAt: 1, emailVerificationRequired: false, mfaRequired: false,
  properties: {}, createdAt: 1, updatedAt: null };
const tenant = (tenantId: string) => ({ tenantId, kind: 'organization', slug: tenantId, name: tenantId, role: 'owner' });
const type = { id: 'type-a', revision: 1, label: 'Synthetic', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null, active: true };
const page = { items: [type], truncated: false, nextAfter: null };
const policy = { resourceId: 'resource-a', resourceRevision: 1, mode: 'unrestricted', typeIds: [] };
const lifecycle = { revision: 1, extended: false, cancellationReason: 'optional', noShowReason: 'optional' };
const transitions = { id: 'appointment-a', revision: 1, policyRevision: 1, status: 'confirmed', allowed: [{ status: 'cancelled', requiresReason: false }] };
afterEach(() => { getClient()?.disconnect(); globalThis.fetch = originalFetch; if (typeof localStorage !== 'undefined') localStorage.removeItem(refreshKey); });

for (const transition of ['read-authority-reset', 'tenant-switch', 'disconnect'] as const) {
  test(`SDK ${transition} releases catalog/type/resource-policy/lifecycle/transition watches before replacement authority publication`, async () => {
    const paths: string[] = [], cancelled: string[] = [], controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    let delivered = 0, errors = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (url.endsWith('/auth/login') || url.endsWith('/auth/tenants/switch')) {
        const switched = url.endsWith('/switch');
        return Response.json({ user, accessToken: switched ? 'synthetic-b' : 'synthetic-a', refreshToken: switched ? 'synthetic-refresh-b' : 'synthetic-refresh-a', activeTenant: tenant(switched ? 'tenant-b' : 'tenant-a') });
      }
      if (url.includes('/api/calendar/')) {
        paths.push(url); const value = url.includes('/lifecycle/') ? lifecycle : url.includes('/transitions/') ? transitions
          : url.includes('/resources/') ? policy : url.includes('/types/type-a/') ? type : page;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controllers.push(controller); controller.enqueue(frame(value));
        }, cancel() { cancelled.push(url); } }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    const client = createClient({ url: 'http://calendar-type-retirement.test', tables: {}, auth: true, autoConnect: false }) as InternalClient;
    const stops: (() => void)[] = [];
    try {
      await client.login('synthetic', 'synthetic-password');
      const listener = () => { delivered++; }, options = { onError() { errors++; } };
      stops.push(client.calendar.types.watch({ resourceIds: ['resource-a'] }, listener, options));
      stops.push(client.calendar.types.watchType(type.id, listener, options));
      stops.push(client.calendar.types.watchForResource(policy.resourceId, listener, options));
      stops.push(client.calendar.lifecycle.watch(listener, options));
      stops.push(client.calendar.appointments.watchTransitions(transitions.id, listener, options));
      await settle(() => delivered === 5); expect(paths).toHaveLength(5);
      if (transition === 'read-authority-reset') client._syncClient.reset(); else if (transition === 'tenant-switch') await client.switchTenant('tenant-b'); else client.disconnect();
      await settle(() => cancelled.length === 5);
      for (const controller of controllers) expect(() => controller.enqueue(frame({ private: 'NEVER_DELIVER' }))).toThrow();
      expect(delivered).toBe(5); expect(errors).toBe(0); expect(paths).toHaveLength(5);
    } finally { stops.forEach(stop => stop()); client.disconnect(); }
  });
}
function frame(value: unknown): Uint8Array { return new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value }) + '\n\n'); }
async function settle(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await new Promise<void>(resolve => setTimeout(resolve, 5)); }
  throw new Error('Synthetic SDK type retirement did not settle.');
}
