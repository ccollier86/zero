import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp, defineEndpoint, defineZeroPlugin } from '@zero/framework/server';
import { StripePayments, stripePayments, getStripePayments } from './index';
import { fixtureOptions, signedEvent, StripeFixture } from './payments-fixture';

for (const tenancy of ['single', 'multi'] as const) test(`managed ${tenancy} createApp preserves signed raw bodies, Guardian scoping, live events and restart state`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-payments-managed-'));
  const stripe = new StripeFixture(); let app: Awaited<ReturnType<typeof createApp>> | undefined, service: StripePayments | undefined;
  await mkdir(join(root, 'app'));
  const config = () => ({
    app: { name: 'Payment Fixture', publicUrl: 'https://app.example.test' },
    db: { mode: 'file' as const, path: join(root, 'application.db') }, systemDb: { mode: 'file' as const, path: join(root, 'system.db'), synchronous: 'FULL' as const }, tables: {},
    auth: { tenancy, bootstrap: 'public' as const, registration: { mode: 'public' as const } },
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    serverResourcesDir: false as const, serverPluginsDir: false as const, serverMiddlewareDir: false as const, serverEndpointsDir: false as const, serverRoutesDir: false as const,
    workflows: false as const, stateSync: false, ai: false as const, vector: false as const, pdf: false as const, kv: false as const,
    email: { provider: 'noop' as const, inbox: { statePath: join(root, 'inbox.sqlite'), accounts: () => [] } }, observability: false as const,
    serverExtensions: [stripePayments({ ...fixtureOptions, allowEphemeralTestMode: false, httpClient: stripe.httpClient }),
      defineZeroPlugin({ name: 'payments-fixture-capture', setup: ({ zero }) => { service = getStripePayments(zero); } }),
      defineEndpoint({ method: 'GET', path: '/test/payments-isolation', auth: 'user', handler: ({ zero }) => ({
        scoped: !!zero.payments, raw: Object.hasOwn(zero.payments!, 'native'),
      }) }),
    ],
  });
  const request = async (path: string, body?: unknown, bearer?: string) => {
    const response = await fetch(`http://127.0.0.1:${app!.server!.port}` + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    app = await createApp(config()); app.listen({ hostname: '127.0.0.1', port: 0 });
    const user = await request('/auth/register', { username: 'payment-owner', email: 'payment-owner@example.test', password: 'Fixture-only-password-123', ...(tenancy === 'multi' ? { organizationName: 'Payment Fixture' } : {}) });
    expect(user.status).toBe(200); const bearer = user.body.accessToken as string;
    expect((await request('/api/_zero/payments/snapshot')).status).toBe(401);
    expect((await request('/api/_zero/email-inbox/accounts')).status).toBe(401);
    expect(await request('/api/_zero/email-inbox/accounts', undefined, bearer)).toEqual({ status: 200, body: [] });
    expect(await request('/test/payments-isolation', undefined, bearer)).toEqual({ status: 200, body: { scoped: true, raw: false } });
    const checkout = { operationId: 'managed-checkout-1', offer: 'pro' };
    expect((await request('/api/_zero/payments/checkout', checkout, bearer)).status).toBe(200);
    const event = signedEvent();
    const incoming = await fetch(`http://127.0.0.1:${app.server!.port}/api/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': event.signature }, body: event.payload });
    expect(incoming.status).toBe(200); expect(await incoming.json()).toMatchObject({ received: true });
    await service!.drain();
    const state = await request('/api/_zero/payments/snapshot', undefined, bearer);
    expect(state.status).toBe(200); expect(state.body.entitlements).toEqual({ search: true, seats: 20 });
    expect(state.body.subject).toMatchObject({ kind: tenancy === 'multi' ? 'organization' : 'user' }); expect(state.body.revision).toBeGreaterThan(0);
    const peer = await request('/auth/register', { username: 'payment-peer', email: 'payment-peer@example.test', password: 'Fixture-only-password-456', ...(tenancy === 'multi' ? { organizationName: 'Other Payment Organization' } : {}) });
    expect(peer.status).toBe(200);
    const peerCustomer = await request('/api/_zero/payments/customers/ensure', { operationId: 'managed-peer-customer' }, peer.body.accessToken);
    expect(peerCustomer.status).toBe(200); expect(peerCustomer.body.id).not.toBe(customerId(state.body));
    expect((await request('/api/_zero/payments/invoices/in_fixture', undefined, peer.body.accessToken)).status).toBe(403);
    const streamAbort = new AbortController();
    const events = await fetch(`http://127.0.0.1:${app.server!.port}/api/_zero/payments/events`, { headers: { Authorization: `Bearer ${bearer}` }, signal: streamAbort.signal });
    expect(events.headers.get('content-type')).toStartWith('text/event-stream');
    const reader = events.body!.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: revision'); streamAbort.abort(); await reader.cancel().catch(() => {});
    const broken = await fetch(`http://127.0.0.1:${app.server!.port}/api/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': event.signature }, body: event.payload + ' ' });
    expect(broken.status).toBe(400);
    const admit = service!.store.admit;
    service!.store.admit = () => { throw new Error('Synthetic admission disk failure'); };
    try {
      const refused = await fetch(`http://127.0.0.1:${app.server!.port}/api/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': event.signature }, body: event.payload });
      expect(refused.status).toBe(503);
    } finally { service!.store.admit = admit; }
    await app.stop(true); app = undefined; expect(service!.status().enabled).toBe(false);
    app = await createApp(config()); app.listen({ hostname: '127.0.0.1', port: 0 });
    const login = await request('/auth/login', { username: 'payment-owner', password: 'Fixture-only-password-123' }); expect(login.status).toBe(200);
    const replay = await request('/api/_zero/payments/checkout', checkout, login.body.accessToken); expect(replay.status).toBe(200);
    expect(stripe.customerCount).toBe(2); expect(stripe.requests.filter(r => r.path === '/v1/checkout/sessions')).toHaveLength(1);
    expect((await request('/api/_zero/payments/snapshot', undefined, login.body.accessToken)).body.revision).toBeGreaterThan(0);
  } finally { try { await app?.stop(true); } finally { await rm(root, { recursive: true, force: true }); } }
}, 120000);
function customerId(snapshot: { customer: { id: string } }): string { return snapshot.customer.id; }

test('an app without payments gets no payment schema or SDK service', async () => {
  // Optional package import alone must not install payment tables on a plain ReactiveDB.
  const { ReactiveDB } = await import('@zero/framework/sync'); const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false });
  try { expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_zero_payments_%'").all()).toEqual([]); }
  finally { db.dispose(); }
});
