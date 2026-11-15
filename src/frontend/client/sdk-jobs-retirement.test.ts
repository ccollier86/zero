/** Jobs subscriptions retire with the SDK boundary, not only the next SSE read/reconnect. */
import { afterEach, expect, test } from 'bun:test';
import { createClient, getClient, type InternalClient } from './sdk';

const originalFetch = globalThis.fetch;
const REFRESH_TOKEN_STORAGE_KEY = '__platform_refresh_token';
const user = {
  userId: 'synthetic-jobs-owner', username: 'synthetic', email: 'synthetic@example.test',
  firstName: null, lastName: null, role: 'user', status: 'active',
  passwordChangeRequired: false, emailVerifiedAt: 1, emailVerificationRequired: false,
  mfaRequired: false, properties: {}, createdAt: 1, updatedAt: null,
};
const accepted = {
  id: 'job_synthetic', definition: 'synthetic.job', definitionVersion: '1', ownerId: user.userId,
  runAs: 'actor', control: 'active', revision: 1, generation: 1, createdAt: 1, updatedAt: 1,
};
const allowed = { allowed: true, reason: null };
const summary = { ...accepted, nextDueAt: null, skipped: false, blockedCode: null, latestOccurrence: null, activeOccurrence: null,
  actions: { pause: allowed, cancel: allowed, resume: allowed, update: allowed, runNow: allowed } };
const tenant = (tenantId: string) => ({ tenantId, kind: 'organization', slug: tenantId, name: tenantId, role: 'owner' });

afterEach(() => {
  getClient()?.disconnect();
  globalThis.fetch = originalFetch;
  if (typeof localStorage !== 'undefined') localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
});

for (const boundary of ['read-authority-reset', 'tenant-switch'] as const) {
  test(`SDK ${boundary} cancels an idle jobs watch before it can reconnect into replacement authority`, async () => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    let opened = 0, cancelled = 0, delivered = 0, failures = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (url.endsWith('/auth/login') || url.endsWith('/auth/tenants/switch')) {
        const switched = url.endsWith('/switch');
        return Response.json({ user, accessToken: switched ? 'synthetic-access-b' : 'synthetic-access-a',
          refreshToken: switched ? 'synthetic-refresh-b' : 'synthetic-refresh-a', activeTenant: tenant(switched ? 'tenant-b' : 'tenant-a') });
      }
      if (url.includes('/jobs/schedules/live')) {
        opened++;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value: { items: [summary], total: 1 } }) + '\n\n'));
            // Stay idle: scope retirement must release this reader without requiring another server chunk.
          },
          cancel() { cancelled++; },
        }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    const client = createClient({ url: 'http://jobs-retirement.test', tables: {}, auth: true, autoConnect: false }) as InternalClient;
    let stop: (() => void) | undefined;
    try {
      await client.login('synthetic', 'synthetic-password');
      stop = client.jobs.schedules.watch(() => { delivered++; }, { onError() { failures++; } });
      await waitFor(() => delivered === 1);
      expect(opened).toBe(1);

      if (boundary === 'read-authority-reset') client._syncClient.reset();
      else await client.switchTenant('tenant-b');

      await waitFor(() => cancelled === 1);
      expect(delivered).toBe(1);
      expect(failures).toBe(0);
      expect(opened).toBe(1);
    } finally {
      stop?.();
      client.disconnect();
    }
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Synthetic jobs SDK boundary did not settle.');
}
