/** Real managed createApp, official SDK and file-backed SYSTEM persistence. Only loopback HTTP and synthetic Square are used. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, defineEndpoint, defineZeroPlugin } from '@zero/framework/server';
import { getPayments, getSquarePayments, squarePayments } from '../index';
import type { SquarePayments } from './service';
import { SquareFixture, squareOptions } from './square-fixture';

for (const tenancy of ['single', 'multi'] as const) test(`managed Square ${tenancy} billing preserves scope, raw signatures, reactive updates and restart receipts`, async () => {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/square-managed-'), fixture = new SquareFixture();
  let app: Awaited<ReturnType<typeof createApp>> | undefined, service: SquarePayments;
  await mkdir(join(root, 'app'));
  const config = () => ({
    app: { name: 'Square fixture', publicUrl: 'https://app.example.test' },
    db: { mode: 'file' as const, path: join(root, 'application.db') }, systemDb: { mode: 'file' as const, path: join(root, 'system.db'), synchronous: 'FULL' as const }, tables: {},
    auth: { tenancy, bootstrap: 'public' as const, registration: { mode: 'public' as const } },
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    serverResourcesDir: false as const, serverPluginsDir: false as const, serverMiddlewareDir: false as const, serverEndpointsDir: false as const, serverRoutesDir: false as const,
    workflows: false as const, stateSync: false, ai: false as const, vector: false as const, pdf: false as const, kv: false as const, email: false as const, observability: false as const,
    serverExtensions: [squarePayments({ ...squareOptions, allowEphemeralTestMode: false, fetch: fixture.fetch }),
      defineZeroPlugin({ name: 'square-fixture-capture', setup: ({ zero }) => { service = getSquarePayments(zero); expect(getPayments(zero)).toBe(service); } }),
      defineEndpoint({ method: 'GET', path: '/test/scope', auth: 'user', handler: ({ zero }) => ({ scoped: !!zero.payments,
        native: Object.hasOwn(zero.payments!, 'native'), charges: Object.hasOwn(zero.payments!, 'charges') }) }),
    ],
  });
  const request = async (path: string, body?: unknown, token?: string) => {
    const response = await fetch(`http://127.0.0.1:${app!.server!.port}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    app = await createApp(config()); app.listen({ hostname: '127.0.0.1', port: 0 });
    const registered = await request('/auth/register', { username: 'square-owner', email: 'square-owner@example.test', password: 'Fixture-only-password-123', ...(tenancy === 'multi' ? { organizationName: 'Square Fixture' } : {}) });
    expect(registered.status).toBe(200); const token = registered.body.accessToken;
    expect((await request('/api/_zero/payments/snapshot')).status).toBe(401);
    expect((await request('/test/scope', undefined, token)).body).toEqual({ scoped: true, native: false, charges: false });
    const operation = { operationId: 'managed-square-checkout', offer: 'pro' };
    const checkout = await request('/api/_zero/payments/checkout', operation, token); expect(checkout.status).toBe(200);
    const completed = fixture.complete(checkout.body.id), event = fixture.event('invoice.payment_made', completed.invoiceId!);
    const incoming = await fetch(`http://127.0.0.1:${app.server!.port}/api/webhooks/square`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-square-hmacsha256-signature': event.signature }, body: event.payload });
    expect(incoming.status).toBe(200); await service!.drain();
    const state = await request('/api/_zero/payments/snapshot', undefined, token);
    expect(state.body.entitlements).toEqual({ search: true, seats: 20 }); expect(state.body.subject.kind).toBe(tenancy === 'multi' ? 'organization' : 'user');
    expect(JSON.stringify(state.body)).not.toContain('squareup.com/pay-invoice');
    const arbitrary = await request('/api/_zero/payments/checkout', { ...operation, operationId: 'browser-arbitrary-amount', amount: 1 }, token); expect(arbitrary.status).toBe(400);
    const peer = await request('/auth/register', { username: 'square-peer', email: 'square-peer@example.test', password: 'Fixture-only-password-456', ...(tenancy === 'multi' ? { organizationName: 'Peer Organization' } : {}) });
    expect(peer.status).toBe(200);
    expect((await request(`/api/_zero/payments/invoices/${encodeURIComponent(completed.invoiceId!)}`, undefined, peer.body.accessToken)).status).toBe(403);
    const abort = new AbortController(), events = await fetch(`http://127.0.0.1:${app.server!.port}/api/_zero/payments/events`, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
    expect(events.headers.get('content-type')).toStartWith('text/event-stream'); const reader = events.body!.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: revision'); abort.abort(); await reader.cancel().catch(() => {});
    const forged = await fetch(`http://127.0.0.1:${app.server!.port}/api/webhooks/square`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-square-hmacsha256-signature': event.signature }, body: event.payload + ' ' }); expect(forged.status).toBe(400);
    const merchantInput = { operationId: 'managed-subjectless-charge', total: { amount: 728, currency: 'usd' }, description: 'Custom work', paymentToken: 'cnon:card-nonce-ok' };
    const merchant = await service!.charges.create(merchantInput);
    await app.stop(true); app = undefined;
    app = await createApp(config()); app.listen({ hostname: '127.0.0.1', port: 0 });
    const login = await request('/auth/login', { username: 'square-owner', password: 'Fixture-only-password-123' }); expect(login.status).toBe(200);
    const replay = await request('/api/_zero/payments/checkout', operation, login.body.accessToken); expect(replay.body.id).toBe(checkout.body.id);
    expect(await service!.charges.create(merchantInput)).toEqual(merchant); expect(fixture.requests.filter(value => value.path === '/v2/payments' && value.method === 'POST')).toHaveLength(1);
    expect((await request('/api/_zero/payments/snapshot', undefined, login.body.accessToken)).body.revision).toBeGreaterThan(0);
    expect(fixture.links.size).toBe(1);
  } finally { await app?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 120000);

test('merchant-only Square apps can take subjectless payments with authentication disabled', async () => {
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/square-merchant-app-');
  await mkdir(join(root, 'app')); const fixture = new SquareFixture(); let owner: SquarePayments | undefined, app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp({ db: { mode: 'memory' }, systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' }, tables: {}, auth: false,
      appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
      workflows: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false, email: false, observability: false,
      serverExtensions: [squarePayments({ ...squareOptions, catalog: {}, allowEphemeralTestMode: false, fetch: fixture.fetch }), defineZeroPlugin({ name: 'merchant-only', setup: ({ zero }) => { owner = getSquarePayments(zero); } })] });
    const result = await owner!.charges.checkout({ operationId: 'merchant-no-auth-checkout', total: { amount: 1950, currency: 'usd' }, description: 'Standalone purchase' });
    expect(result.url).toContain('square.link'); expect(fixture.customers.size).toBe(0);
  } finally { await app?.stop(true); await rm(root, { recursive: true, force: true }); }
}, 120000);
